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
// unreachable" has to be a distinct outcome rather than a pass. A 4-4-4 GHSA
// outside the observed alphabet is asked too: it may be fabricated, or GitHub
// may have widened its alphabet since this file was written.
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
// AND WHY IT DOES NOT COUNT CHARACTERS
//
// The same argument applies to every length `pattern` could restate, and the
// fabricator is not the case that makes it matter - the TYPIST is. Transcribe
// the mysql2 justification `GHSA-3f6p-5ww8-9rcr` with one character dropped and
// a segment-counting pattern does not see it at all: the report says sixteen
// citations, all resolve, exit 0, over an override justified by an identifier
// nobody can look up. Measured that way before this changed, for a dropped
// character, an added one, a dropped hyphen, a CVE with a three-digit year and
// a Go id with one - five silences, one per length `pattern` was restating.
//
// Those five are spelt out in the tests rather than here, and that is not
// tidiness. Spelling a malformed identifier in this header makes it a citation
// of exactly the kind being described, and the first version of this paragraph
// did: two of them, and the live guard failed on its own documentation. The
// test file is exempt by path; this file is not.
//
// So `pattern` is the prefix followed by at least two hyphen-separated groups,
// uniformly across all three schemes, and nothing about the group LENGTHS is
// written here. Two groups is exact for CVE and GO and one looser than GHSA,
// and the looseness is the point: what a reader recognises as a citation is a
// prefix and some segments, not a character count.
//
// The boundary is a boundary and this one is deliberate, so both directions are
// pinned by tests. Below it, prose ABOUT the format stays uncited - `GHSA-`
// named as a prefix, or a hyphenated word like `GHSA-style`, is one group and
// is not a citation. Above it, a document that writes something SHAPED like an
// identifier is a citation and needs a PLACEHOLDERS entry - which is not new,
// it is why `.grype.yaml` already has one. What remains outside is an
// identifier written with every hyphen gone; it is named here rather than
// discovered, because a boundary nobody wrote down is the defect above.
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

import path from 'node:path';
import process from 'node:process';

import { readBlobs, trackedFiles } from './git-blobs.mjs';

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
 * belongs is recognised as one: the prefix, then at least two hyphen-separated
 * groups, and no length anywhere. `wellFormed` is the issuing authority's own
 * spelling - alphabet AND lengths - so a string that authority could never have
 * issued is normally decided without a request. A GHSA with the authority's
 * 4-4-4 shape but a character outside the observed alphabet is the exception:
 * the registry decides whether the citation is fabricated or this constant is
 * stale. See {@link resolveOne}.
 *
 * Every length lives on the `wellFormed` side and none on the `pattern` side.
 * A length in `pattern` is not a second check, it is a hole: a segment that is
 * one character short stops being a citation instead of becoming a finding, and
 * that is the transcription slip rather than the fabrication - see the header.
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
    pattern: /GHSA-[0-9A-Za-z]+(?:-[0-9A-Za-z]+)+/gu,
    registryShape: /^GHSA-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}$/iu,
    wellFormed:
      /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/iu,
    url: (id) => `https://api.github.com/advisories/${encodeURIComponent(id)}`,
    registry: 'the GitHub advisory database',
  },
  {
    kind: 'cve',
    pattern: /CVE-\d+(?:-\d+)+/gu,
    wellFormed: /^CVE-\d{4}-\d{4,}$/u,
    url: (id) => `https://cveawg.mitre.org/api/cve/${encodeURIComponent(id)}`,
    registry: 'the CVE Program record service',
  },
  {
    kind: 'go',
    pattern: /GO-\d+(?:-\d+)+/gu,
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
 * Four outcomes, and keeping the last two apart is the point: `exists`,
 * `missing`, `stale-syntax`, and `unavailable` - the registry could not be asked. A
 * rate limit, a timeout and a 502 all mean the guard did not run, and reporting
 * any of them as `missing` would turn an outage into a false accusation against
 * a correct comment.
 */
export async function resolveOne(id, kind, fetchImpl = fetch) {
  const scheme = SCHEMES.find((candidate) => candidate.kind === kind);
  if (scheme === undefined) return { id, state: 'unavailable', detail: `unknown scheme ${kind}` };

  const syntaxMayBeStale = scheme.registryShape?.test(id) === true && !scheme.wellFormed.test(id);

  // Reached by ordinary scanned input, not only by a stray caller: `pattern`
  // recognises the shape a reader sees, so malformed identifiers arrive here
  // as citations rather than disappearing from the scan.
  //
  // `missing`, not `unavailable`, and that is the whole reason this branch is
  // worth having. `unavailable` means the guard could not run and exits 2; a
  // malformed length the register could never have issued is a decided answer
  // that needs no request, so it exits 1 alongside a 404. A 4-4-4 GHSA outside
  // the observed alphabet is different: the registry must say whether the
  // citation is fabricated or the observed alphabet has become stale.
  //
  // The registry is named on the way out because the message a reader gets has
  // to say who would have issued it, the same as a 404 does.
  if (!scheme.wellFormed.test(id) && !syntaxMayBeStale) {
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
    if (response.status === 200) {
      if (syntaxMayBeStale) {
        return {
          id,
          state: 'stale-syntax',
          registry: scheme.registry,
          detail:
            "exists in the registry but falls outside this guard's GHSA alphabet; widen SCHEMES[0].wellFormed",
        };
      }
      return { id, state: 'exists' };
    }
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
  const staleSyntax = results.filter((result) => result.state === 'stale-syntax');
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

  if (staleSyntax.length > 0) {
    process.stderr.write(
      `advisory-ids: ${String(staleSyntax.length)} real identifier(s) outgrew the local syntax\n\n`
    );
    for (const result of staleSyntax) {
      process.stderr.write(`  ${result.id}  ${String(result.detail)}\n`);
      process.stderr.write(`    cited at ${describe(result.sites)}\n\n`);
    }
    process.stderr.write(
      'The citation is real. Update the GHSA alphabet in SCHEMES[0].wellFormed and add\n' +
        'the identifier as the regression test; do not replace or delete the citation.\n'
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

  if (staleSyntax.length > 0) return 1;
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
