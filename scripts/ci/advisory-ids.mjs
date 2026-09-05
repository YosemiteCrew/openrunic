#!/usr/bin/env node
// Every security advisory identifier cited in this repository must resolve to a
// real advisory.
//
// WHY THIS EXISTS
//
// A dependency override, a scanner suppression and a pinned base image are all
// exceptions: they accept a finding, or force a resolution, on the strength of
// a comment. The comment names an advisory so a later reader can check the
// reasoning against the source - that is the entire point of writing the
// identifier down. An identifier that resolves to nothing sends that reader
// looking for a finding which is not there, and it reads exactly as
// authoritative as a correct one.
//
// This is not hypothetical. `pnpm-workspace.yaml` justified the `mysql2`
// override with `GHSA-r8f6-24hv-cj3g` for as long as that override existed. The
// prose was accurate to the word - a hostile server downgrading the auth plugin
// to `mysql_clear_password` and leaking credentials, fixed in 3.22.0 - and the
// identifier was invented. The advisory being described is
// `GHSA-3f6p-5ww8-9rcr`.
//
// WHY A REGEX CANNOT DO THIS
//
// `GHSA-r8f6-24hv-cj3g` passes every shape check that could be written for it:
// right prefix, right segment lengths, and every character inside the alphabet
// GitHub actually issues from. Nothing separates a fabricated identifier from a
// real one except asking the registry. So this guard is a resolution, not a
// pattern - and that is why it needs the network, and why "the registry was
// unreachable" has to be a distinct outcome rather than a pass.
//
// WHICH IS WHY THE PATTERN MATCHES MORE THAN THE ALPHABET
//
// Recognising only well-formed identifiers looks tighter and is the opposite. A
// careless fabrication is far likelier to fall OUTSIDE the issuing alphabet
// than inside it - segments spelt `abcd`, `efgh`, `ijkl` are vowels and are not
// identifiers GitHub could ever have issued - and an unrecognised string is not
// a citation at all: never resolved, never reported, never counted. The founding
// defect was in the alphabet, which is the hard case, not the representative
// one. So `pattern` matches the shape a READER sees and `wellFormed` decides,
// which turns a fabrication outside the alphabet into a named failure rather
// than a silence.
//
// WHERE IT LOOKS
//
// Every tracked file, rather than a list of the files that cite advisories
// today. A list would have to be edited by whoever adds the next citation, and
// they are the same person who would have to notice that the list exists. Two
// exclusions carry the cases where an unreal identifier is correct, and both
// are asserted to still match something - see EXCLUDED_PATHS and PLACEHOLDERS.
// An exclusion that has stopped matching is silently widening the exemption,
// which is the shape this repository has been bitten by more than once.
//
// Usage:
//   node scripts/ci/advisory-ids.mjs             # resolve every citation
//   node scripts/ci/advisory-ids.mjs --offline   # list citations, resolve none
//   node scripts/ci/advisory-ids.mjs --json
//
// Exit codes:
//   0  every citation resolves
//   1  one does not, or an exclusion matched nothing, or nothing was scanned
//   2  a registry could not be reached, so the guard did not run

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

/**
 * The identifier schemes this repository cites, and the registry that issues
 * each one.
 *
 * Each is resolved against the registry that ASSIGNS the identifier, not
 * against a database that happens to mirror it. "Does this id exist" is a
 * question about the register, and a mirror answers a narrower one: GitHub's
 * advisory database is organised by package ecosystem, so an operating-system
 * CVE can be entirely real and absent from it. `CVE-2025-60876` in busybox and
 * `CVE-2026-14456` in openssl are both in this tree and both are that shape.
 *
 * Two regexes per scheme, and the split is load-bearing.
 *
 * `pattern` is the shape a reader sees, so anything written where an identifier
 * belongs is recognised as one. `wellFormed` is the issuing authority's own
 * alphabet, so a spelling that authority could never have issued is decided
 * without a request - see {@link resolveOne}, where it resolves to `missing`
 * rather than to `unavailable`, because it is an answer and not an outage.
 *
 * GHSA identifiers use twenty characters: the digits `2` to `9` and the twelve
 * letters `cfghjmpqrvwx`. It is not base32 and `8` is in it - five of the seven
 * GHSA citations in this tree carry one, as does the worked example above.
 * Nothing here may narrow that set from memory; the test that pins `8` is what
 * says so, and a comment could not.
 *
 * `wellFormed` is case-insensitive because the register is: the advisories API
 * returns 200 for an identifier spelt in upper case. Applying the alphabet
 * case-sensitively would condemn a correct citation, which is this guard's own
 * false red rather than the defect it is looking for.
 */
export const SCHEMES = [
  {
    kind: 'ghsa',
    pattern: /GHSA-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}/gu,
    wellFormed:
      /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/iu,
    url: (id) => `https://api.github.com/advisories/${encodeURIComponent(id)}`,
    registry: 'the GitHub advisory database',
  },
  {
    kind: 'cve',
    pattern: /CVE-\d{4}-\d{4,}/gu,
    wellFormed: /^CVE-\d{4}-\d{4,}$/u,
    url: (id) => `https://cveawg.mitre.org/api/cve/${encodeURIComponent(id)}`,
    registry: 'the CVE Program record service',
  },
  {
    kind: 'go',
    pattern: /GO-\d{4}-\d+/gu,
    wellFormed: /^GO-\d{4}-\d+$/u,
    url: (id) => `https://vuln.go.dev/ID/${encodeURIComponent(id)}.json`,
    registry: 'the Go vulnerability database',
  },
];

/**
 * Paths whose advisory identifiers are synthetic by design.
 *
 * A guard's own test fixtures have to contain identifiers that do not resolve -
 * that is what they are testing. Requiring each fixture to be declared in
 * PLACEHOLDERS below would make every new test case an edit to a central list
 * in another file, which is the coupling this guard avoids everywhere else.
 * Test files accept no findings and justify no overrides, so nothing in one is
 * load-bearing for a reader.
 */
export const EXCLUDED_PATHS = [/(^|\/)[^/]+\.test\.mjs$/u];

/**
 * Assembles a GHSA key so that declaring one is not a citation of it.
 *
 * Written whole, a key is an advisory identifier sitting in a tracked file this
 * guard walks - so every declared placeholder keeps its own exemption alive,
 * and the "appears nowhere" check below can never fire for any of them.
 * Measured rather than reasoned about: with the keys written whole, deleting
 * every prose mention of the worked example from both headers left the suite
 * green and the dead exemption in place. `GHSA-` is not adjacent to the
 * segments in this source, so the pattern above does not match here.
 */
const ghsa = (segments) => `GHSA-${segments}`;

/**
 * Identifiers a document NAMES without claiming they exist, and the documents
 * that are allowed to name them.
 *
 * Two kinds, and the second one is this guard failing on itself.
 *
 * `.grype.yaml` shows the required form of an exception entry in its header.
 * The placeholder it uses is, by the alphabet above, a syntactically valid GHSA
 * id, so nothing about its spelling distinguishes it from a real one - which is
 * this guard's premise applied to its own documentation.
 *
 * The second is the identifier this guard exists because of, named in the
 * header above and in advisory-ids.yml as the worked example of a fabrication.
 * It is deliberately unreal, and naming it is the clearest way to explain what
 * is being checked. It was invisible until the guard's own files were committed
 * - `git ls-files` did not list them while they were untracked, so the first
 * green run was over a tree that did not yet contain the guard.
 *
 * `where` is what keeps the exemption an exemption rather than a hole. An
 * identifier exempted everywhere is exempted in `pnpm-workspace.yaml` too, so
 * re-citing the worked example as the mysql2 justification - the exact defect
 * this guard was written for, spelt exactly as it was spelt - would scan clean.
 * Naming a fabricated id in the prose that explains it is the whole reason for
 * the entry; using one to justify an exception is the thing being caught, and
 * only the path separates the two.
 *
 * Both entries are asserted to still appear in a document that is allowed to
 * name them, so an exemption cannot outlive the document that needed it.
 */
export const PLACEHOLDERS = new Map([
  [
    ghsa('xxxx-xxxx-xxxx'),
    {
      where: /^\.grype\.yaml$/u,
      why: '.grype.yaml documents the shape of an exception entry',
    },
  ],
  [
    ghsa('r8f6-24hv-cj3g'),
    {
      where: /^(?:scripts\/ci\/advisory-ids\.mjs|\.github\/workflows\/advisory-ids\.yml)$/u,
      why: "this guard's own header and workflow name it as the fabrication they exist to catch",
    },
  ],
]);

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
    throw new Error(`advisory-ids: git ls-files failed in ${root}: ${listed.stderr.trim()}`);
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
      throw new Error(`advisory-ids: cannot parse a git ls-files record: ${record}`);
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
    throw new Error(`advisory-ids: git cat-file failed in ${root}: ${String(batch.stderr).trim()}`);
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
      throw new Error(`advisory-ids: git cat-file returned a non-blob: ${header}`);
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
      `advisory-ids: git cat-file returned ${String(text.size)} of ${String(shas.length)} blobs`
    );
  }
  return text;
}

/** Every advisory identifier in one file's text, with the line it sits on. */
export function findCitations(text, file) {
  const found = [];
  for (const [index, line] of text.split('\n').entries()) {
    for (const scheme of SCHEMES) {
      // Every match on the line, not the first: `pnpm-workspace.yaml` cites
      // three fast-uri advisories on one line, and one-per-line is the
      // simplification that silently drops two of them. The test named
      // "finds every identifier on a line" is what holds that - a comment here
      // could not, and an earlier revision of this file proved the point by
      // carrying a defensive clone justified by a hazard `matchAll` does not
      // have. It shares SCHEMES' global regex safely because matchAll iterates
      // a clone and never advances the original's lastIndex.
      for (const match of line.matchAll(scheme.pattern)) {
        found.push({ id: match[0], kind: scheme.kind, file, line: index + 1 });
      }
    }
  }
  return found;
}

/** Every citation in the tree, split into the ones to resolve and the exempt ones. */
export function scan(root, entries) {
  const cited = [];
  const excludedByPath = [];
  const placeheld = [];
  const blobs = readBlobs(root, entries);

  for (const { file, sha } of entries) {
    // `null` only: {@link readBlobs} guarantees a key for every sha, so an
    // absent one cannot be skipped quietly here. If one ever were, `.split`
    // throws and the run fails loudly rather than reporting clean over a file
    // it never read.
    const text = blobs.get(sha);
    if (text === null) continue;
    const citations = findCitations(text, file);
    if (citations.length === 0) continue;

    if (EXCLUDED_PATHS.some((pattern) => pattern.test(file))) {
      excludedByPath.push(...citations);
      continue;
    }
    for (const citation of citations) {
      // Both halves, because the exemption is the pair. A declared id in a file
      // that was not declared for it is an ordinary citation and gets resolved.
      const placeholder = PLACEHOLDERS.get(citation.id);
      if (placeholder !== undefined && placeholder.where.test(citation.file)) {
        placeheld.push(citation);
      } else cited.push(citation);
    }
  }

  return { cited, excludedByPath, placeheld };
}

/**
 * The reasons a scan fails before anything is resolved.
 *
 * Two of the three are about this guard rather than about the tree, and they
 * are here because a guard reporting clean having read nothing is
 * indistinguishable from one reporting clean having read everything.
 */
export function scanProblems({ cited, excludedByPath, placeheld }) {
  const problems = [];

  // Zero, not a threshold. This tree cites advisories in its override block,
  // its scanner suppressions and both Dockerfiles; finding none means the walk
  // or the patterns stopped working, not that the citations were removed.
  if (cited.length === 0) {
    problems.push({
      reason: 'no advisory identifier was found in any tracked file: this guard read nothing',
    });
  }

  // An exclusion that matches nothing is an exemption nobody is using and
  // nobody is checking, and the next file it silently covers will be one that
  // matters.
  //
  // Guarded on the list being non-empty rather than asserted unconditionally,
  // because having no path exemptions at all is a legitimate state and failing
  // on it would be this guard's own false red - the thing it refuses to do to
  // an unreachable registry, done to a correct configuration instead.
  if (EXCLUDED_PATHS.length > 0 && excludedByPath.length === 0) {
    problems.push({
      reason:
        'EXCLUDED_PATHS matched no citation: delete the entry rather than leaving an unused exemption',
    });
  }
  for (const [id, { why }] of PLACEHOLDERS) {
    if (!placeheld.some((citation) => citation.id === id)) {
      problems.push({
        reason: `PLACEHOLDERS declares ${id} (${why}) but it appears nowhere: delete the entry`,
      });
    }
  }

  return problems;
}

/**
 * Ask a registry whether one identifier exists.
 *
 * Three outcomes, and keeping the third apart from the second is the point:
 * `exists`, `missing`, and `unavailable` - the registry could not be asked. A
 * rate limit, a timeout and a 502 all mean the guard did not run, and reporting
 * any of them as `missing` would turn an outage into a false accusation against
 * a correct comment.
 */
export async function resolveOne(id, kind, fetchImpl = fetch) {
  const scheme = SCHEMES.find((candidate) => candidate.kind === kind);
  if (scheme === undefined) return { id, state: 'unavailable', detail: `unknown scheme ${kind}` };

  // Reached by ordinary scanned input, not only by a stray caller: `pattern`
  // recognises the shape a reader sees, so an identifier spelt outside the
  // issuing alphabet arrives here as a citation and is answered here.
  //
  // `missing`, not `unavailable`, and that is the whole reason this branch is
  // worth having. `unavailable` means the guard could not run and exits 2; a
  // spelling the register could never have issued is a decided answer that
  // needs no request, so it exits 1 alongside a 404. Reporting it as an outage
  // would spend the one exit code that means "do not trust this run".
  //
  // The registry is named on the way out because the message a reader gets has
  // to say who would have issued it, the same as a 404 does.
  if (!scheme.wellFormed.test(id)) {
    return {
      id,
      state: 'missing',
      registry: scheme.registry,
      detail: `not spelt the way ${scheme.registry} issues identifiers, so it was never asked for`,
    };
  }

  const headers = { accept: 'application/json', 'user-agent': 'openrunic-advisory-ids' };
  // Anonymous api.github.com allows 60 requests an hour, which a busy day of
  // pull requests can exhaust. A token raises that; its absence is not an
  // error, and its value is never printed.
  const token = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'];
  if (kind === 'ghsa' && token !== undefined && token !== '') {
    headers.authorization = `Bearer ${token}`;
  }

  let last = '';
  // One retry, because a single transient failure would otherwise take the
  // whole gate to exit 2 and teach everyone to re-run it without reading it.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(scheme.url(id), {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
      continue;
    }
    if (response.status === 200) return { id, state: 'exists' };
    if (response.status === 404) return { id, state: 'missing', registry: scheme.registry };
    last = `HTTP ${String(response.status)} from ${scheme.registry}`;
  }
  return { id, state: 'unavailable', detail: last };
}

/** Resolve every distinct identifier once, keeping every site that cites it. */
export async function resolveAll(citations, resolver = resolveOne) {
  const distinct = new Map();
  for (const citation of citations) {
    const existing = distinct.get(citation.id);
    if (existing === undefined) distinct.set(citation.id, { ...citation, sites: [citation] });
    else existing.sites.push(citation);
  }

  const results = [];
  for (const [id, entry] of distinct) {
    results.push({ ...(await resolver(id, entry.kind)), kind: entry.kind, sites: entry.sites });
  }
  return results;
}

function describe(sites) {
  return sites.map((site) => `${site.file}:${String(site.line)}`).join(', ');
}

export async function main(argv, { root = process.cwd(), resolver = resolveOne } = {}) {
  const json = argv.includes('--json');
  const offline = argv.includes('--offline');

  const scanned = scan(root, trackedFiles(root));
  const problems = scanProblems(scanned);
  if (problems.length > 0) {
    if (json) process.stdout.write(`${JSON.stringify({ problems }, null, 2)}\n`);
    else for (const problem of problems) process.stderr.write(`advisory-ids: ${problem.reason}\n`);
    return 1;
  }

  if (offline) {
    const listing = { cited: scanned.cited, exempt: scanned.excludedByPath.length };
    if (json) process.stdout.write(`${JSON.stringify(listing, null, 2)}\n`);
    else
      for (const citation of scanned.cited) {
        process.stdout.write(`  ${citation.file}:${String(citation.line)}  ${citation.id}\n`);
      }
    return 0;
  }

  const results = await resolveAll(scanned.cited, resolver);
  const missing = results.filter((result) => result.state === 'missing');
  const unavailable = results.filter((result) => result.state === 'unavailable');

  if (json) {
    process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
  }

  // Reported before the exit code is decided, because an identifier nobody
  // could check is not an identifier that passed, whichever of the two numbers
  // this run ends on.
  for (const result of unavailable) {
    process.stderr.write(`advisory-ids: could not check ${result.id} - ${String(result.detail)}\n`);
  }
  if (unavailable.length > 0) {
    process.stderr.write(
      'This is a guard that could not run, not a guard that passed. Nothing is being\n' +
        'claimed about the identifiers above.\n\n'
    );
  }

  if (missing.length > 0) {
    process.stderr.write(`advisory-ids: ${String(missing.length)} identifier(s) do not exist\n\n`);
    for (const result of missing) {
      // `detail` when the verdict carries one, because the two ways to be
      // missing are not the same sentence. A 404 was asked and answered; a
      // spelling outside the issuing alphabet was never asked at all, and
      // printing "not found in the registry" over it would be this guard
      // making the exact claim it exists to catch - an assertion about a
      // lookup that never happened.
      const why = result.detail ?? `not found in ${String(result.registry)}`;
      process.stderr.write(`  ${result.id}  ${String(why)}\n`);
      process.stderr.write(`    cited at ${describe(result.sites)}\n\n`);
    }
    process.stderr.write(
      'The comment is probably describing a real advisory under the wrong id. Find the\n' +
        'one it means and correct the identifier - deleting the reference instead leaves\n' +
        'the exception with nothing a later reader can check it against.\n'
    );
    // A confirmed fabrication outranks an incomplete scan. Both are red, so the
    // choice is only about which one a reader is told to act on, and "this id
    // does not exist" is actionable now while "the registry was down" is not.
    // The unavailable list is above either way, so the incomplete half is never
    // silently absorbed into the finding.
    return 1;
  }

  if (unavailable.length > 0) return 2;

  process.stdout.write(
    `advisory-ids: ${String(results.length)} identifier(s) across ` +
      `${String(scanned.cited.length)} citation(s), all resolve.\n`
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(await main(process.argv.slice(2)));
}
