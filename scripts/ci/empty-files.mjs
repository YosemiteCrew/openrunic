#!/usr/bin/env node
// No tracked file is empty.
//
// A commit that truncates a file to zero bytes is invisible to every other gate
// here. The scanners read content and find none; the linters are given nothing
// to object to; `format:check` is satisfied by an empty file. A pull request
// that emptied nine root documents - the AGPL `LICENSE` among them - passed the
// whole pipeline and was caught by a person reading the diff.
//
// The check is the committed TREE rather than the working one, for the reason
// `git-blobs.mjs` gives: a gate should judge what was committed, so an
// uncommitted edit cannot make this report clean over a truncation about to
// land. `ls-tree -l` carries the size, so this needs no blob read.
//
// There is deliberately no allow-list. `dev` has no empty tracked file today,
// so the first legitimate one is a decision somebody makes in review rather
// than a hole standing open in advance of it.
//
// Run with `pnpm run check:empty-files`; the parser's tests are in
// `empty-files.test.mjs`.

import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * The zero-byte blobs in `git ls-tree -r -l` output.
 *
 * Split from the spawn so it is reachable from a test, the way
 * `git-blobs.mjs` splits `parseIndexRecords`.
 *
 * `<mode> SP <type> SP <sha> SP* <size> TAB <path>`. The tab is what separates
 * the metadata from the name: splitting the whole record on whitespace loses
 * every path with a space in it, and a guard that misnames the file it is
 * refusing is most of the way to being ignored. A record this cannot read is
 * refused rather than skipped, because a file that silently stops being checked
 * is the one outcome a guard must never reach quietly.
 */
export function emptyBlobs(stdout) {
  const empty = [];
  for (const record of stdout.split('\n')) {
    if (record === '') continue;
    const match =
      /^(?<mode>\d{6}) (?<type>\w+) (?<sha>[0-9a-f]{40,64}) +(?<size>[0-9-]+)\t(?<file>.*)$/su.exec(
        record
      );
    if (match === null) {
      throw new Error(`empty-files: cannot parse a git ls-tree record: ${record}`);
    }
    const { size, file } = match.groups;
    // A submodule's size is `-` rather than a number, so the string comparison
    // is what excludes it. Matching on `type` as well would be a second
    // condition that no input can reach independently of this one.
    if (size === '0') empty.push(file);
  }
  return empty;
}

function main() {
  // `--full-tree` is what makes this a whole-repository check. `ls-tree` is
  // scoped to the CURRENT DIRECTORY by default, so without it the same command
  // reads 36 records from `scripts/ci` and 1645 from the root, and a root file
  // emptied by a pull request reports clean from anywhere but the top. Raised
  // in review; `git-blobs.mjs` avoids the same trap by passing `-C root`.
  const listed = spawnSync('git', ['ls-tree', '--full-tree', '-r', '-l', 'HEAD'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.status !== 0) {
    throw new Error(`empty-files: git ls-tree failed: ${listed.stderr.trim()}`);
  }

  const empty = emptyBlobs(listed.stdout);
  if (empty.length === 0) {
    console.log('empty-files: no tracked file is empty.');
    return;
  }

  console.error('empty-files: these tracked files are empty:');
  for (const file of empty) console.error(`  ${file}`);
  console.error('A file truncated to zero bytes reads as clean to every other gate here.');
  console.error('Restore the content, or delete the file if it is meant to be gone.');
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
