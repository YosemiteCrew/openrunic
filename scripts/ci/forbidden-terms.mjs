#!/usr/bin/env node
// Forbidden-terms gate.
//
// Both repositories are public. Prior art may be studied freely; the source may
// never be NAMED - not in code, comments, tests, fixtures, docs, commit
// messages, branch names, or pull-request text. Until this script existed the
// rule was enforced by a git hook on three laptops, and a hook is a reminder
// rather than a gate: `pnpm install` runs husky's `prepare`, which rewrites
// `core.hooksPath` for the whole clone, and the guard is disarmed until somebody
// notices. That happened seven times in one day and reached a commit once.
//
// WHAT THIS SCRIPT MUST NEVER DO
//
//   * print a match, or any substring of one
//   * print the pattern, decoded or encoded
//   * write either to a file, an output, or a job summary
//
// A guard whose failure output is the list of terms is worse than no guard: the
// run log of a public repository is a published artifact in a way a terminal is
// not. Findings therefore carry a SURFACE, a FILE and a LINE and nothing else.
// That is enough to act on, because the author knows what they wrote.
//
// WHY THE PATTERN IS AN ENVIRONMENT VARIABLE AND NOT A FILE
//
// The pattern is the term list. Committing it to a public repository publishes
// exactly what it exists to withhold, so it arrives as a base64 blob in a
// repository secret and is decoded here. The must-block corpus is a second blob
// for the same reason. The must-PASS corpus is checked in
// (forbidden-terms-allowed-prose.txt) because it names nothing.
//
// ERRORING IS NOT FINDING. Exit 2 means the guard could not run - no pattern, a
// pattern that will not compile, a corpus that came back short, a self-test that
// failed. Exit 1 means it ran and found something. Exit 0 means it ran and did
// not. A caller that treats 2 as clean has reintroduced the failure this whole
// script exists to remove.
//
// Usage:
//   node scripts/ci/forbidden-terms.mjs selftest --min-corpus <n>
//   node scripts/ci/forbidden-terms.mjs scan <surface>=<file> [<surface>=<file>...]
//
// Surfaces: diff, names, messages, branch, title, body. `diff` expects unified
// diff text and reports the file and line number of the ADDED line, which is
// why it is a surface of its own rather than another blob of text.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const PATTERN_ENV = 'FORBIDDEN_TERMS_PATTERN_B64';
const CORPUS_ENV = 'FORBIDDEN_TERMS_CORPUS_B64';

const ALLOWED_PROSE = path.join(import.meta.dirname, 'forbidden-terms-allowed-prose.txt');

const SURFACES = new Set(['diff', 'names', 'messages', 'branch', 'title', 'body']);

/** Raised for anything that means "the guard could not run" - always exit 2. */
class GuardError extends Error {}

/**
 * Decodes a base64 blob from the environment.
 *
 * An absent or empty value is an ERROR and not an empty pattern. `new
 * RegExp('')` matches every line and `grep -E ''` matches every line, while
 * some formulations match nothing: one fails every pull request and the other
 * passes every pull request silently. Both are wrong, and the silent one is the
 * failure mode this script was written to end.
 */
function decodeRequired(name) {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') {
    throw new GuardError(`${name} is unset or empty. The gate cannot run without it.`);
  }
  let decoded;
  try {
    decoded = Buffer.from(raw.trim(), 'base64').toString('utf8');
  } catch {
    throw new GuardError(`${name} is not valid base64.`);
  }
  if (decoded.trim() === '') {
    throw new GuardError(`${name} decoded to nothing. A rotated or truncated secret is an error.`);
  }
  return decoded.trim();
}

/** The pattern, compiled case-insensitively because the terms are words. */
export function compilePattern(source) {
  try {
    return new RegExp(source, 'i');
  } catch (error) {
    // The message of a failed RegExp constructor QUOTES THE PATTERN. Never let
    // it out - report that it did not compile and nothing about what it was.
    throw new GuardError(`The pattern does not compile as a regular expression: ${error.name}.`);
  }
}

/** Non-comment, non-blank lines. Shared by both corpora. */
export function corpusLines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/**
 * Added lines of a unified diff, carrying the file and line they land on.
 *
 * Only added lines, because a term being REMOVED is the fix, not the offence.
 * `+++ b/path` is the header rather than an addition, so it is skipped by
 * position rather than by content - a real added line can legitimately start
 * with `++`.
 */
export function addedLines(diff) {
  const out = [];
  let file = '';
  let lineNumber = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      file = target === '/dev/null' ? '' : target.replace(/^b\//, '');
      continue;
    }
    if (line.startsWith('---') || line.startsWith('diff ')) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      lineNumber = Number(hunk[1]);
      continue;
    }
    if (line.startsWith('+')) {
      out.push({ file: file || '(unknown file)', line: lineNumber, text: line.slice(1) });
      lineNumber += 1;
      continue;
    }
    // A context or removed line: context advances the new-file counter,
    // removal does not.
    if (line.startsWith('-')) continue;
    lineNumber += 1;
  }
  return out;
}

/** Every surface reduces to this: a list of {file, line, text} to match against. */
function entriesFor(surface, text) {
  if (surface === 'diff') return addedLines(text);
  return text
    .split('\n')
    .map((value, index) => ({ file: surface, line: index + 1, text: value }))
    .filter((entry) => entry.text.trim() !== '');
}

/**
 * Findings carry where and never what. `text` is deliberately dropped here
 * rather than at the print site: a value that is never returned cannot be
 * logged by a later edit that forgets why.
 */
export function scanSurface(pattern, surface, text) {
  return entriesFor(surface, text)
    .filter((entry) => pattern.test(entry.text))
    .map((entry) => ({ surface, file: entry.file, line: entry.line }));
}

// ---------------------------------------------------------------------------
// Self-test: the job asserts itself before it asserts anything about the diff
// ---------------------------------------------------------------------------

/**
 * Proves the guard is armed. Without this an empty, rotated or truncated secret
 * is a silently green pull request, which is failure mode six of the six this
 * gate replaces - the fix having the same defect as the thing it fixed.
 *
 * `minCorpus` is written in the workflow IN THE CLEAR. A number is not a term
 * list, and it turns "the secret lost half its entries" from silent into red.
 */
export function selfTest({ pattern, blockCorpus, passCorpus, minCorpus }) {
  const problems = [];

  if (blockCorpus.length < minCorpus) {
    problems.push(
      `the must-block corpus decoded to ${blockCorpus.length} entries, fewer than the ${minCorpus} ` +
        'this workflow expects: the secret is truncated, rotated or stale'
    );
  }

  // Known positives: every one must be caught. Reported by INDEX, never by value.
  const missed = blockCorpus
    .map((entry, index) => (pattern.test(entry) ? null : index + 1))
    .filter((index) => index !== null);
  if (missed.length > 0) {
    problems.push(
      `the pattern does not match must-block corpus entries at position(s) ${missed.join(', ')}`
    );
  }

  // Known negatives: the repository's own prose. A hit here is an over-broad
  // pattern, which is the failure that gets a gate switched off.
  const tripped = passCorpus
    .map((entry, index) => (pattern.test(entry) ? index + 1 : null))
    .filter((index) => index !== null);
  if (tripped.length > 0) {
    problems.push(
      `the pattern matches this repository's own prose at ${ALLOWED_PROSE} ` +
        `line(s) ${tripped.join(', ')}: it is too broad, and a gate that fires on ` +
        'ordinary documentation is a gate somebody switches off'
    );
  }

  return problems;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function readAllowedProse() {
  try {
    return corpusLines(readFileSync(ALLOWED_PROSE, 'utf8'));
  } catch {
    throw new GuardError(`Cannot read the must-pass corpus at ${ALLOWED_PROSE}.`);
  }
}

function runSelfTest(argv) {
  const flag = argv.indexOf('--min-corpus');
  const minCorpus = flag === -1 ? Number.NaN : Number(argv[flag + 1]);
  if (!Number.isInteger(minCorpus) || minCorpus < 1) {
    throw new GuardError(
      'selftest needs --min-corpus <n>, a positive integer written in the clear.'
    );
  }
  const pattern = compilePattern(decodeRequired(PATTERN_ENV));
  const blockCorpus = corpusLines(decodeRequired(CORPUS_ENV));
  const passCorpus = readAllowedProse();

  const problems = selfTest({ pattern, blockCorpus, passCorpus, minCorpus });
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`forbidden-terms: ${problem}\n`);
    throw new GuardError(
      'The guard failed its own self-test and has reported nothing about this pull request.'
    );
  }
  process.stdout.write(
    `forbidden-terms: armed - pattern compiled, ${blockCorpus.length} known positives all matched, ` +
      `${passCorpus.length} lines of this repository's own prose all clean.\n`
  );
  return 0;
}

function runScan(argv) {
  if (argv.length === 0) {
    throw new GuardError('scan needs at least one <surface>=<file> argument.');
  }
  const pattern = compilePattern(decodeRequired(PATTERN_ENV));

  const findings = [];
  for (const argument of argv) {
    const split = argument.indexOf('=');
    const surface = split === -1 ? '' : argument.slice(0, split);
    const file = argument.slice(split + 1);
    if (!SURFACES.has(surface)) {
      throw new GuardError(
        `Unknown surface '${surface}'. Expected one of: ${[...SURFACES].join(', ')}.`
      );
    }
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      // A surface that cannot be read is an error. Treating it as empty is how
      // a guard reports "clean" about something it never looked at.
      throw new GuardError(`Cannot read the '${surface}' surface from ${file}.`);
    }
    findings.push(...scanSurface(pattern, surface, text));
  }

  if (findings.length === 0) {
    process.stdout.write(
      'forbidden-terms: clean - no named external product on any checked surface.\n'
    );
    return 0;
  }

  process.stderr.write(
    `forbidden-terms: BLOCKED - a named external product appears on ${findings.length} line(s).\n\n`
  );
  for (const finding of findings) {
    process.stderr.write(`  [${finding.surface}] ${finding.file}:${finding.line}\n`);
  }
  process.stderr.write(
    '\nThese repositories are public. Draw on prior art freely; never name the source in code,\n' +
      'comments, tests, fixtures, docs, commit messages, branch names or pull-request text.\n' +
      'Describe the behaviour and the clinical need instead.\n\n' +
      'The match itself is deliberately not printed: this log is public.\n'
  );
  return 1;
}

function main(argv) {
  const [command, ...rest] = argv;
  try {
    if (command === 'selftest') return runSelfTest(rest);
    if (command === 'scan') return runScan(rest);
    process.stderr.write(
      'Usage: forbidden-terms.mjs selftest --min-corpus <n> | scan <surface>=<file>...\n'
    );
    return 2;
  } catch (error) {
    if (error instanceof GuardError) {
      process.stderr.write(`forbidden-terms: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(main(process.argv.slice(2)));
}
