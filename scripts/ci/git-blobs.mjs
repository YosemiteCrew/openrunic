import { spawnSync } from 'node:child_process';

/**
 * The repository's tracked content, read from git rather than from disk.
 *
 * Extracted from `advisory-ids.mjs` when `exception-expiry.mjs` needed the same
 * walk, for the reason `@openrunic/i18n` records for `counted` and
 * `searchWords`: the alternative was a second copy, and a second copy of a
 * security-relevant reader is a second place for the symlink argument below to
 * be got wrong.
 *
 * READING THE BLOB IS THE POINT, not an optimisation, and the argument is in
 * {@link readBlobs}. The short version: `git ls-files` lists tracked symlinks
 * and `readFileSync` follows them, so a pull request could add a link to a file
 * on the runner and have a guard read it. A symlink's blob is the target PATH
 * rather than the target's contents, and {@link trackedFiles} drops it by mode
 * before it gets here anyway.
 *
 * Everything here judges the INDEX. That is deliberate - a gate should judge
 * what was committed - and it is a trap when probing: an unstaged edit is
 * invisible to every function in this file.
 *
 * The tests are in `advisory-ids.test.mjs`, under the heading they were written
 * under. They stayed because they need that file's `gitRepo` fixture, and
 * because two of them assert what the guard does with what this returns - a
 * symlink's blob is never scanned, a binary one is skipped - which is the pair
 * rather than either half. Moving them is mechanical if a second consumer ever
 * makes this module's own behaviour the subject.
 */

/**
 * Every tracked regular file, as `{ file, sha }`.
 *
 * The mode is the reason this reads `ls-files -s` rather than `ls-files`.
 * `120000` is a symlink and `160000` is a submodule; neither is a file this
 * guard has any business reading, and dropping them here means the rest of the
 * script never has to remember that they exist.
 */
export function trackedFiles(root) {
  const listed = spawnSync('git', ['-C', root, 'ls-files', '-s', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.status !== 0) {
    throw new Error(`git-blobs: git ls-files failed in ${root}: ${listed.stderr.trim()}`);
  }

  return parseIndexRecords(listed.stdout);
}

/**
 * `git ls-files -s -z` output as `{ file, sha }`, regular files only.
 *
 * Split out so the refusal below is reachable from a test. It guards an input
 * git does not currently produce, and an unreachable guard nothing exercises is
 * the shape this file has already removed once - so it is either tested or it
 * should not be here.
 */
export function parseIndexRecords(stdout) {
  const entries = [];
  for (const record of stdout.split('\0')) {
    if (record === '') continue;
    // `<mode> SP <sha> SP <stage> TAB <path>`
    const match = /^(?<mode>\d{6}) (?<sha>[0-9a-f]{40,64}) \d\t(?<file>.*)$/su.exec(record);
    if (match === null) {
      // Refused rather than skipped. A record this cannot read is a file that
      // would silently stop being scanned, which is the one outcome a guard
      // must never reach quietly.
      throw new Error(`git-blobs: cannot parse a git ls-files record: ${record}`);
    }
    const { mode, sha, file } = match.groups;
    // 120000 is a symlink and 160000 a submodule; neither is a file this guard
    // has any business reading, and dropping them here means nothing later has
    // to remember they exist.
    if (mode !== '100644' && mode !== '100755') continue;
    entries.push({ file, sha });
  }
  return entries;
}

/**
 * The text of every blob, keyed by sha, read from git rather than from disk.
 *
 * READING THE BLOB IS THE POINT, not an optimisation. An earlier revision
 * resolved each path and called `readFileSync`, and that had two problems this
 * does not have.
 *
 * The first was real and is why it changed: `git ls-files` lists tracked
 * symlinks, `readFileSync` follows them, and `safe-path.mjs` cannot see that -
 * it is documented as reasoning about path STRINGS and never touching the disk,
 * so a link is just an ordinary name inside the root to it. A pull request could
 * add a link to a file on the runner and have this guard read it. Reading blobs
 * closes that by construction rather than by a check somebody has to keep: a
 * symlink's blob is the target PATH, not the target's contents, and
 * {@link trackedFiles} drops it by mode before it gets here anyway.
 *
 * The second is that a working tree is not what a gate should judge. `--cached`
 * content is what was committed, so an uncommitted edit cannot make this report
 * clean over a citation that is about to land.
 *
 * `--batch` is one process for the whole tree rather than one per file, and its
 * output is `<sha> SP <type> SP <size> LF <content> LF`, parsed on bytes
 * because `size` is a byte count and a multi-byte character would desynchronise
 * a character-indexed cursor.
 */
export function readBlobs(root, entries) {
  const shas = [...new Set(entries.map((entry) => entry.sha))];
  if (shas.length === 0) return new Map();

  const batch = spawnSync('git', ['-C', root, 'cat-file', '--batch'], {
    input: `${shas.join('\n')}\n`,
    maxBuffer: 512 * 1024 * 1024,
  });
  if (batch.status !== 0) {
    throw new Error(`git-blobs: git cat-file failed in ${root}: ${String(batch.stderr).trim()}`);
  }

  return parseBatch(batch.stdout, shas);
}

/**
 * `git cat-file --batch` output as `sha -> text`, with `null` for binary.
 *
 * Split out for the same reason {@link parseIndexRecords} is: the refusal below
 * is not reachable through a real `git` - a missing sha, a tree and a submodule
 * all throw on the type, and a truncated stream sets a non-zero status - and an
 * unreachable guard nothing exercises is a comment wearing a check's clothes.
 * Exported, so it is either tested or it should not be here.
 */
export function parseBatch(out, shas) {
  const text = new Map();
  let at = 0;
  while (at < out.length) {
    const newline = out.indexOf(0x0a, at);
    if (newline === -1) break;
    const header = out.toString('utf8', at, newline);
    const [sha, type, size] = header.split(' ');
    if (type !== 'blob') {
      throw new Error(`git-blobs: git cat-file returned a non-blob: ${header}`);
    }
    const start = newline + 1;
    const end = start + Number(size);
    const raw = out.subarray(start, end);
    // A blob with a NUL byte is binary; git's own heuristic, and the reason
    // this guard has never needed a file-type list.
    text.set(sha, raw.includes(0) ? null : raw.toString('utf8'));
    at = end + 1;
  }

  // Every sha asked for, or nothing. `null` here is a decision - this blob is
  // binary, skip it - and an ABSENT key is the opposite: a file that stopped
  // being scanned with nothing counting the shortfall. The caller cannot tell
  // those apart from a `get` returning nothing, so they are told apart here,
  // where the number to compare against is known. Fail closed, because a guard
  // that reads fewer files than it was given and says nothing is the failure
  // this whole script exists to make impossible.
  if (text.size !== shas.length) {
    throw new Error(
      `git-blobs: git cat-file returned ${String(text.size)} of ${String(shas.length)} blobs`
    );
  }
  return text;
}
