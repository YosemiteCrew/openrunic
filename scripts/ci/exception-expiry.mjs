#!/usr/bin/env node
// Security-exception expiry guard.
//
// Three files in this repository accept a security finding rather than fixing
// it: `.grype.yaml` (dependency and container vulnerabilities), `.trivyignore`
// (infrastructure misconfiguration), and `.secretlintignore.ci` where one is
// used. Each of their headers demands the same three things of an entry - a
// reason, an owner, and a date it must be looked at again - and says, in the
// Trivy file's words, that an exception without all three "is not an exception,
// it is a hole".
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

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

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

  for (const [index, line] of lines.entries()) {
    const match = source.entry.exec(line);
    if (match === null) continue;

    // Walk up through the contiguous comment block above this entry.
    let block = '';
    for (let above = index - 1; above >= 0; above -= 1) {
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

function readIfPresent(root, file) {
  try {
    return readFileSync(path.join(root, file), 'utf8');
  } catch {
    return null; // A file that does not exist has no exceptions in it.
  }
}

export function check(root, today) {
  const exceptions = [];
  for (const source of SOURCES) {
    const text = readIfPresent(root, source.file);
    if (text !== null) exceptions.push(...findExceptions(text, source));
  }
  return { exceptions, problems: expired(exceptions, today) };
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
