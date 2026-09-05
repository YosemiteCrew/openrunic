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
// right prefix, right segment lengths, and every character inside the base32
// alphabet GitHub actually issues from. Nothing separates a fabricated
// identifier from a real one except asking the registry. So this guard is a
// resolution, not a pattern - and that is why it needs the network, and why
// "the registry was unreachable" has to be a distinct outcome rather than a
// pass.
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
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { resolveWithin } from './safe-path.mjs';

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
 * `pattern` is deliberately the issuing authority's own alphabet. GHSA ids are
 * base32 without the vowels and without `0`, `1`, `8` or `l`, so a
 * transcription that invents a character outside it is caught by the parse
 * rather than by a request.
 */
export const SCHEMES = [
  {
    kind: 'ghsa',
    pattern: /GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}/gu,
    url: (id) => `https://api.github.com/advisories/${id}`,
    registry: 'the GitHub advisory database',
  },
  {
    kind: 'cve',
    pattern: /CVE-\d{4}-\d{4,}/gu,
    url: (id) => `https://cveawg.mitre.org/api/cve/${id}`,
    registry: 'the CVE Program record service',
  },
  {
    kind: 'go',
    pattern: /GO-\d{4}-\d+/gu,
    url: (id) => `https://vuln.go.dev/ID/${id}.json`,
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
 * Identifiers that appear in documentation as an example of the SHAPE of an
 * identifier, and are not claims that an advisory exists.
 *
 * `.grype.yaml` shows the required form of an exception entry in its header.
 * The placeholder it uses is, by the alphabet above, a syntactically valid GHSA
 * id, so nothing about its spelling distinguishes it from a real one - which is
 * this guard's whole premise applied to itself.
 */
export const PLACEHOLDERS = new Map([
  ['GHSA-xxxx-xxxx-xxxx', '.grype.yaml documents the shape of an exception entry'],
]);

/** Every tracked file, as repo-relative paths. */
export function trackedFiles(root) {
  const listed = spawnSync('git', ['-C', root, 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.status !== 0) {
    throw new Error(`advisory-ids: git ls-files failed in ${root}: ${listed.stderr.trim()}`);
  }
  return listed.stdout.split('\0').filter((entry) => entry !== '');
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

/**
 * Read a tracked file as text, or null when it is not text this guard can read.
 *
 * Binary blobs and symlinks pointing outside the tree are skipped rather than
 * raised: unlike `exception-expiry.mjs`, which reads a fixed set of files that
 * MUST be readable, this walks whatever is tracked, so an unreadable entry is
 * an ordinary repository fact and not a guard that could not do its job. What
 * would make it one is reading nothing at all, and {@link scan} fails on that
 * separately.
 */
function readText(root, file) {
  const resolved = resolveWithin(root, file);
  if (resolved === null) return null;
  let raw;
  try {
    raw = readFileSync(resolved);
  } catch {
    return null;
  }
  if (raw.includes(0)) return null;
  return raw.toString('utf8');
}

/** Every citation in the tree, split into the ones to resolve and the exempt ones. */
export function scan(root, files) {
  const cited = [];
  const excludedByPath = [];
  const placeheld = [];

  for (const file of files) {
    const text = readText(root, file);
    if (text === null) continue;
    const citations = findCitations(text, file);
    if (citations.length === 0) continue;

    if (EXCLUDED_PATHS.some((pattern) => pattern.test(file))) {
      excludedByPath.push(...citations);
      continue;
    }
    for (const citation of citations) {
      if (PLACEHOLDERS.has(citation.id)) placeheld.push(citation);
      else cited.push(citation);
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
  if (excludedByPath.length === 0) {
    problems.push({
      reason:
        'EXCLUDED_PATHS matched no citation: delete the entry rather than leaving an unused exemption',
    });
  }
  for (const [id, why] of PLACEHOLDERS) {
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
      process.stderr.write(`  ${result.id}  not found in ${String(result.registry)}\n`);
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
