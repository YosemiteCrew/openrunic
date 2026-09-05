#!/usr/bin/env node
// Security-exception expiry guard.
//
// Some files in this repository accept a security finding rather than fixing
// it. SOURCES below is that list, and it is the ONLY list. Restating it here
// too is how this comment came to name `.secretlintignore.ci`, which carries
// build-artifact globs and has never held a dated exception in any commit,
// while omitting `.grant.yaml`, which does hold them. One fact, two spellings,
// wrong in both directions, in the guard whose whole subject is a claim that
// nothing keeps true.
//
// Each file in SOURCES demands the same three things of an entry - a reason, an
// owner, and a date it must be looked at again - and says, in the Trivy file's
// words, that an exception without all three "is not an exception, it is a
// hole".
//
// Until this script existed, the date was the part nothing checked. An accepted
// finding therefore stayed accepted forever: the comment said November, nobody
// was told when November arrived, and the exception outlived the reasoning that
// justified it. That is the ordinary way a temporary suppression becomes
// permanent, and it is worse than having no expiry field at all, because the
// field makes the process look rigorous while changing nothing.
//
// So: every exception must carry `Re-review by: YYYY-MM-DD`, and the build
// fails once that date has passed.
//
// DESIGN NOTES, both of which are about failing usefully rather than loudly:
//
//   * A MISSING date is a failure too, not a pass. Requiring the field only
//     where somebody remembered it would let the next entry skip it, which is
//     the one outcome that makes this script decorative.
//   * The example blocks in those headers are entirely inside comments, so
//     they never parse as entries and never expire. That is checked rather
//     than assumed: an example that stopped being fully commented would BE a
//     live exception, and failing on it is then the right answer rather than a
//     case to skip.
//
// An expiry is not an instruction to delete the entry. It is an instruction to
// re-read it: confirm the finding is still unreachable, check whether a fix has
// been published since, and then either remove the exception or renew it with a
// fresh date and a note saying what was checked.
//
// Usage:
//   node scripts/ci/exception-expiry.mjs           # check every file
//   node scripts/ci/exception-expiry.mjs --json    # machine-readable
//   node scripts/ci/exception-expiry.mjs --today=2026-12-01   # for tests
//
// Exit code 0 when every exception is current, 1 when one has expired or is
// missing a date, 2 on a usage error.

import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { readBlobs, trackedFiles } from './git-blobs.mjs';
import { resolveWithin } from './safe-path.mjs';

/**
 * The files that carry exceptions, and how an entry is recognised in each.
 *
 * `entry` matches the line that ACCEPTS something. Comments above it are its
 * documentation, so the date is looked for in the comment block immediately
 * preceding, which is the shape both files already use.
 */
export const SOURCES = [
  {
    file: '.grype.yaml',
    what: 'vulnerability exception',
    // `  - vulnerability: CVE-...` under the `ignore:` key.
    entry: /^\s*-\s*vulnerability:\s*(?<id>\S+)/u,
    comment: /^\s*#/u,
  },
  {
    file: '.trivyignore',
    what: 'misconfiguration exception',
    // A bare check id on its own line, e.g. `AVD-DS-0026`.
    entry: /^(?<id>[A-Z]{2,}[A-Z0-9-]*)\s*$/u,
    comment: /^\s*#/u,
  },
  {
    file: '.grant.yaml',
    what: 'licence exception',
    // `  - some-package` under `ignore-packages:`, bare or quoted either way.
    // The quotes are a backreference so they have to match each other, which is
    // what YAML requires anyway.
    entry: /^\s+-\s*(?<quote>['"]?)(?<id>[@A-Za-z0-9][^'"\s]*)\k<quote>\s*$/u,
    // Anything in the section that looks like a list item and is not an entry.
    // See {@link findExceptions}: a line this file cannot parse must fail,
    // never be skipped.
    item: /^\s+-\s*\S/u,
    comment: /^\s*#/u,
    // Scoped, and this is the whole reason the field exists. `allow:` in the
    // same file is a list of the same shape, and every SPDX identifier on it
    // would otherwise read as an undated exception - three dozen failures
    // saying an allow-list entry needs a re-review date, which is not a thing
    // an allow-list entry has.
    section: /^ignore-packages:/u,
  },
];

const DATE = /Re-review by:\s*(?<date>\d{4}-\d{2}-\d{2})/u;

/**
 * Every exception in one file, with the re-review date its comment block
 * carries.
 *
 * The comment block is read upwards from the entry rather than downwards from a
 * marker, because that is how both files are already written and asking authors
 * to restructure them to suit a script is the wrong way round.
 */
export function findExceptions(text, source) {
  const lines = text.split('\n');
  const found = [];
  // A top-level YAML key: what ends the section, when a source names one.
  const nextKey = /^[A-Za-z]/u;
  let inSection = source.section === undefined;

  for (const [index, line] of lines.entries()) {
    if (source.section !== undefined) {
      if (source.section.test(line)) {
        inSection = true;
        continue;
      }
      if (inSection && nextKey.test(line)) inSection = false;
    }
    if (!inSection) continue;

    const match = source.entry.exec(line);
    if (match === null) {
      // An entry this file cannot parse is refused rather than skipped. Three
      // separate fail-open bugs in this script were found in review - an
      // unreadable file, a dangling symlink, and a double-quoted package name
      // - and every one of them had the same shape: something the guard could
      // not read became something the guard did not check. A suppression the
      // scanner honours and this does not is an exception with no expiry, which
      // is the state this whole script exists to make impossible.
      if (source.item?.test(line) === true) {
        throw new Error(
          `exception-expiry: cannot parse ${source.file}:${String(index + 1)} - ${line.trim()}`
        );
      }
      continue;
    }

    // Walk up to the comment block that documents this entry.
    //
    // Adjacent entries share one block, because a run of list items written
    // with nothing between them is one decision: `.grant.yaml` excepts
    // `react-doctor` and `oxlint-plugin-react-doctor` on one argument, in two
    // lines, and demanding the argument twice would be asking for a copy rather
    // than a reason.
    //
    // A blank line or an intervening comment ends the run, which is what keeps
    // the hazard closed: a dated entry cannot vouch for an unrelated one below
    // it, only for the ones written as part of the same list item group.
    let block = '';
    let above = index - 1;
    while (above >= 0 && source.entry.test(lines[above] ?? '')) above -= 1;
    for (; above >= 0; above -= 1) {
      const previous = lines[above] ?? '';
      if (!source.comment.test(previous)) break;
      block = `${previous}\n${block}`;
    }

    const date = DATE.exec(block)?.groups?.['date'];
    found.push({
      file: source.file,
      what: source.what,
      id: match.groups?.['id'] ?? '(unnamed)',
      line: index + 1,
      date: date ?? null,
    });
  }

  return found;
}

/** The exceptions that fail the build, and why each one does. */
export function expired(exceptions, today) {
  const problems = [];
  for (const exception of exceptions) {
    if (exception.date === null) {
      problems.push({
        ...exception,
        reason: 'carries no `Re-review by: YYYY-MM-DD` in the comment above it',
      });
      continue;
    }
    if (exception.date < today) {
      problems.push({ ...exception, reason: `was due for re-review on ${exception.date}` });
    }
  }
  return problems;
}

/** Today in UTC, so the gate says the same thing in every timezone CI runs in. */
export function todayUtc(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * One exception file's text. A file named here and not on disk is a failure.
 *
 * It used to return null instead, because `.trivyignore` "can legitimately be
 * absent" and a file that is not there has no exceptions to expire. That
 * sentence was speculative - all three files exist - and it bought a hole:
 * an entry in {@link SOURCES} that has stopped naming a real file is
 * INDISTINGUISHABLE from a file that legitimately has none. Rename
 * `.grant.yaml` and leave the list alone and this script reports
 * "2 accepted finding(s), all current" and exits 0, with seven dated licence
 * exceptions no longer re-reviewed and the success line counting the survivors
 * as though they were all of them.
 *
 * `.trivyignore` is the quiet version: it carries no live entries today, so
 * renaming it does not move the count at all, and the exception somebody adds
 * to the new name next month is never checked.
 *
 * So the optionality is gone rather than made configurable. A scanner that is
 * genuinely dropped loses its {@link SOURCES} entry in the same commit that
 * removes its config, which is the coupling that was missing. A per-entry
 * "expected" flag would have restored the hole for whichever entry carried the
 * flag, and the caller deciding the coverage is the defect this repository has
 * spent the day removing from other guards.
 *
 * A file that EXISTS and cannot be read stays a different thing, and the
 * distinction is still worth its `lstat`: a dangling symlink fails the read
 * with ENOENT too, so an error-code check alone would report it with the
 * missing file's message. The path is there, somebody put it there, and what
 * it pointed at is gone. `lstat` sees the link rather than its target, so the
 * two keep their own messages.
 *
 * The path goes through `resolveWithin` for the reason the other CI scripts do.
 * It is not reachable input today, {@link SOURCES} being a constant in this
 * file, but a guard that reads paths is a guard somebody will later hand a path
 * to.
 */
function readSource(root, file) {
  const resolved = resolveWithin(root, file);
  if (resolved === null) {
    throw new Error(`exception-expiry: refusing to read ${file}, which escapes ${root}`);
  }
  try {
    lstatSync(resolved);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(
        `exception-expiry: ${file} is named in SOURCES but is not in ${root}. ` +
          'Either the file was renamed and the list was not, or the scanner was ' +
          'dropped and its entry should go with it. A source that names nothing ' +
          'is not a source with no exceptions.'
      );
    }
    throw error;
  }

  // Past this point the path exists, so every failure is a real one - including
  // the ENOENT a dangling symlink raises.
  return readFileSync(resolved, 'utf8');
}

/**
 * The suppression marker, and why it cannot be a {@link SOURCES} entry.
 *
 * Every source above is a named file. A scanner suppression written in code is
 * not: it can be on any line of any module, and the file it lands in is chosen
 * by wherever the finding was. A list of files would have to be edited by
 * whoever adds the next marker, and they are the same person who would have to
 * notice that the list exists - which is the coupling #295 removed from the
 * other direction and is not worth reintroducing here.
 *
 * So this half is a walk, and the walk reads the index through
 * `git-blobs.mjs`. That is not a preference: a guard that resolves a path from
 * `git ls-files` and reads it follows tracked symlinks, and reading blobs closes
 * that by construction. See the header of that module.
 *
 * Scoped to the extensions a marker means anything in. A fenced code block in a
 * document showing the syntax is not a suppression, and would otherwise be a
 * red build over correct documentation - the failure that gets a gate deleted.
 */
export const SUPPRESSION_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/u;

/**
 * A marker, matched by its SHAPE rather than by the word.
 *
 * Anchored to a comment opener immediately before it, so prose that mentions
 * the marker - including every sentence in this file - is not one. That
 * distinction is the whole reason this pattern is written the way it is: the
 * advisory guard shipped a defect three hours ago where explaining a thing in a
 * header made the header an instance of it.
 */
export const SUPPRESSION = {
  file: '(source)',
  what: 'scanner suppression',
  entry: /(?:\/\/|\/\*)\s*(?<id>nosec)\b/u,
  // Line comments only, and the narrowness is the design rather than an
  // omission. The walk reads upward from the marker and stops at the first line
  // that is not a comment, so a `/* */` block further up - separated by code -
  // is not reachable and never will be. Accepting `*` lines would put a pattern
  // in the file for a case the walk cannot deliver, which is the shape this
  // repository has deleted three times today. The date goes on a `//` line
  // immediately above the marker run, which is also where a reader deleting a
  // marker would look.
  comment: /^\s*\/\//u,
};

/**
 * Every suppression marker in the tree, with the date its comment carries.
 *
 * Written before the first marker that would have satisfied it, which is the
 * opposite of the usual order and is deliberate: with zero sites this check
 * would be vacuously green, and a canary added later cannot prove it was ever
 * red. It is red on `dev` as written - both markers in `rls-port.ts` carry a
 * `Revisit:` CONDITION and no date, and this file's own header explains why a
 * condition nobody is told about is how a temporary suppression becomes
 * permanent.
 */
export function findSuppressions(root) {
  const entries = trackedFiles(root).filter((entry) => SUPPRESSION_FILE.test(entry.file));
  const blobs = readBlobs(root, entries);
  const found = [];

  for (const { file, sha } of entries) {
    // `null` only. `readBlobs` guarantees a key for every sha it was given, so
    // an absent one cannot be skipped quietly here.
    const text = blobs.get(sha);
    if (text === null) continue;
    for (const marker of findExceptions(text, SUPPRESSION)) found.push({ ...marker, file });
  }

  return found;
}

/** Every exception in a given set of sources, and the ones that fail the build. */
export function checkWith(root, today, sources, suppressions = []) {
  const exceptions = [];
  for (const source of sources) {
    exceptions.push(...findExceptions(readSource(root, source.file), source));
  }
  exceptions.push(...suppressions);
  return { exceptions, problems: expired(exceptions, today) };
}

/**
 * The whole gate: the named files, and the markers written in the code.
 *
 * `root` must be a git repository, which `checkWith` does not require. That is
 * the walk's doing and it is the right way round - a guard over tracked content
 * that cannot read the tree has not passed, it has not run - but it is why the
 * synthetic-root tests drive `checkWith` directly.
 */
export function check(root, today) {
  return checkWith(root, today, SOURCES, findSuppressions(root));
}

function main(argv) {
  const json = argv.includes('--json');
  const override = argv
    .find((argument) => argument.startsWith('--today='))
    ?.slice('--today='.length);
  if (override !== undefined && !/^\d{4}-\d{2}-\d{2}$/u.test(override)) {
    process.stderr.write('exception-expiry: --today must be YYYY-MM-DD\n');
    return 2;
  }

  const today = override ?? todayUtc();
  const { exceptions, problems } = check(process.cwd(), today);

  if (json) {
    process.stdout.write(`${JSON.stringify({ today, exceptions, problems }, null, 2)}\n`);
    return problems.length === 0 ? 0 : 1;
  }

  if (problems.length === 0) {
    process.stdout.write(
      `exception-expiry: ${String(exceptions.length)} accepted finding(s), all current as of ${today}.\n`
    );
    return 0;
  }

  process.stdout.write(
    `exception-expiry: ${String(problems.length)} exception(s) need attention\n\n`
  );
  for (const problem of problems) {
    process.stdout.write(`  ${problem.file}:${String(problem.line)}  ${problem.id}\n`);
    process.stdout.write(`    This ${problem.what} ${problem.reason}.\n\n`);
  }
  process.stdout.write(
    'Re-read each one: is the finding still unreachable, and has a fix been published\n' +
      'since? Then either delete the exception or renew it with a fresh date and a note\n' +
      'saying what you checked. Renewing without re-reading is the thing this prevents.\n'
  );
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(main(process.argv.slice(2)));
}
