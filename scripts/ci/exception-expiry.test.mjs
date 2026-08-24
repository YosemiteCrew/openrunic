import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  check,
  checkWith,
  expired,
  findExceptions,
  SOURCES,
  todayUtc,
} from './exception-expiry.mjs';

const GRYPE = SOURCES.find((source) => source.file === '.grype.yaml');
const TRIVY = SOURCES.find((source) => source.file === '.trivyignore');

const GRYPE_FILE = `ignore:
  # CVE-2025-00001 in foo: unreachable, no fix published. Owner: someone.
  # Re-review by: 2026-11-18.
  - vulnerability: CVE-2025-00001

  # CVE-2025-00002 in bar: also unreachable. Owner: someone.
  # Re-review by: 2026-01-01.
  - vulnerability: CVE-2025-00002
`;

test('finds each exception and the date documenting it', () => {
  const found = findExceptions(GRYPE_FILE, GRYPE);

  assert.equal(found.length, 2);
  assert.equal(found[0].id, 'CVE-2025-00001');
  assert.equal(found[0].date, '2026-11-18');
  assert.equal(found[1].date, '2026-01-01');
});

test('fails an exception whose date has passed', () => {
  const problems = expired(findExceptions(GRYPE_FILE, GRYPE), '2026-08-24');

  assert.equal(problems.length, 1);
  assert.equal(problems[0].id, 'CVE-2025-00002');
  assert.match(problems[0].reason, /due for re-review on 2026-01-01/u);
});

test('passes on the day itself, and fails the day after', () => {
  const onTheDay = expired(findExceptions(GRYPE_FILE, GRYPE), '2026-01-01');
  const nextDay = expired(findExceptions(GRYPE_FILE, GRYPE), '2026-01-02');

  assert.equal(onTheDay.length, 0);
  assert.equal(nextDay.length, 1);
});

/**
 * The rule that keeps this from being decorative. Requiring a date only where
 * somebody remembered one would let the next entry skip it entirely, which is
 * exactly the state this script exists to leave behind.
 */
test('a missing date is a failure, not a pass', () => {
  const undated = `ignore:
  # CVE-2025-00003 in baz: somebody was in a hurry.
  - vulnerability: CVE-2025-00003
`;

  const problems = expired(findExceptions(undated, GRYPE), '2020-01-01');

  assert.equal(problems.length, 1);
  assert.match(problems[0].reason, /carries no `Re-review by/u);
});

/**
 * Both header examples are entirely inside comments, so they document the shape
 * without ever being an entry. Asserted rather than assumed, because the first
 * draft of this script carried a special case for the `YYYY-MM-DD` placeholder
 * and a test that appeared to cover it - the branch was unreachable and the
 * test passed for the wrong reason.
 *
 * An example that stopped being fully commented would BE a live exception, and
 * failing on it is the right answer rather than a case to skip.
 */
test('a commented-out example is not an exception', () => {
  const withExample = `# EXCEPTION PROCESS - accepted findings go under \`ignore:\` below. Example:
#
# ignore:
#   # GHSA-xxxx-xxxx-xxxx in foo@1.2.3: not reachable. Owner: someone.
#   # Re-review by: YYYY-MM-DD.
#   - vulnerability: GHSA-xxxx-xxxx-xxxx
ignore:
  # CVE-2025-00001 in foo: unreachable. Owner: someone.
  # Re-review by: 2026-11-18.
  - vulnerability: CVE-2025-00001
`;

  const found = findExceptions(withExample, GRYPE);

  assert.deepEqual(
    found.map((exception) => exception.id),
    ['CVE-2025-00001'],
    'the example inside the header comment is not picked up'
  );
  assert.equal(expired(found, '2030-01-01').length, 1, 'and the real one still expires');
});

test('the same holds for the trivyignore header example', () => {
  const withExample = `#   # AVD-DS-0026 (no HEALTHCHECK) on the migration image. Owner: someone.
#   # Re-review by: YYYY-MM-DD.
#   AVD-DS-0026
`;

  assert.deepEqual(findExceptions(withExample, TRIVY), []);
});

/**
 * The placeholder is not a date, and an entry carrying it as its only date has
 * not been dated. Both header examples are commented out so this cannot arise
 * from them, but somebody copying the example into a live entry and forgetting
 * to fill it in is the obvious next mistake.
 */
test('the YYYY-MM-DD placeholder does not count as a date', () => {
  const copied = `ignore:
  # CVE-2025-00005 in qux: copied the example and forgot. Owner: someone.
  # Re-review by: YYYY-MM-DD.
  - vulnerability: CVE-2025-00005
`;

  const problems = expired(findExceptions(copied, GRYPE), '2020-01-01');

  assert.equal(problems.length, 1);
  assert.match(problems[0].reason, /carries no `Re-review by/u);
});

test('reads a bare check id out of a trivyignore', () => {
  const trivy = `# AVD-DS-0026 on the migration image: one-shot job. Owner: someone.
# Re-review by: 2026-11-18.
AVD-DS-0026
`;

  const found = findExceptions(trivy, TRIVY);

  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'AVD-DS-0026');
  assert.equal(found[0].date, '2026-11-18');
});

/**
 * A comment block belongs to the entry directly below it. Without the blank-line
 * break, one dated entry would vouch for every undated entry after it.
 */
test('does not let one entry borrow the entry above it', () => {
  const shared = `ignore:
  # CVE-2025-00001 in foo. Owner: someone.
  # Re-review by: 2030-01-01.
  - vulnerability: CVE-2025-00001

  - vulnerability: CVE-2025-00004
`;

  const problems = expired(findExceptions(shared, GRYPE), '2026-08-24');

  assert.equal(problems.length, 1);
  assert.equal(problems[0].id, 'CVE-2025-00004');
});

test('this repository is currently clean', () => {
  const { problems } = check(process.cwd(), todayUtc());

  assert.deepEqual(
    problems.map((problem) => `${problem.file}:${problem.id} ${problem.reason}`),
    []
  );
});

/**
 * Guards the scanner itself. Every assertion above would pass against a parser
 * that found nothing, which is the failure mode of anything that greps a tree.
 */
test('finds the exceptions this repository actually carries', () => {
  const { exceptions } = check(process.cwd(), todayUtc());

  assert.ok(
    exceptions.filter((exception) => !exception.isExample).length >= 1,
    'expected at least one live exception in .grype.yaml'
  );
});

/**
 * A missing file is fine. `.trivyignore` may legitimately not exist, and a file
 * that is not there has no exceptions to expire.
 */
test('a missing exception file is not an error', () => {
  const empty = mkdtempSync(path.join(tmpdir(), 'exception-expiry-'));
  try {
    const { exceptions, problems } = check(empty, '2026-08-24');
    assert.deepEqual(exceptions, []);
    assert.deepEqual(problems, []);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

/**
 * A file that EXISTS and cannot be read is not fine, and this is the one that
 * matters. The first draft caught every error and returned null, so an
 * unreadable `.grype.yaml` produced "0 accepted findings, all current" and exit
 * zero - a security gate passing because it could not do its job, which is the
 * exact failure this script exists to stop happening to a re-review date.
 *
 * Raised by review rather than by me, and it was right.
 */
test('an unreadable exception file is a hard failure, not an empty scan', (t) => {
  if (process.getuid?.() === 0) {
    t.skip('root can read a mode-000 file, so this cannot be exercised as root');
    return;
  }

  const directory = mkdtempSync(path.join(tmpdir(), 'exception-expiry-'));
  const file = path.join(directory, '.grype.yaml');
  writeFileSync(file, 'ignore:\n  - vulnerability: CVE-2025-00001\n');
  chmodSync(file, 0o000);

  try {
    assert.throws(() => check(directory, '2026-08-24'), /EACCES|permission denied/iu);
  } finally {
    chmodSync(file, 0o600);
    rmSync(directory, { recursive: true, force: true });
  }
});

/**
 * Not reachable today - `SOURCES` is a constant in this file - but a guard that
 * reads paths is a guard somebody will later hand a path to.
 */
test('refuses a source path that escapes the root', () => {
  const escaping = { file: '../../etc/passwd', what: 'x', entry: /^x$/u, comment: /^#/u };
  const directory = mkdtempSync(path.join(tmpdir(), 'exception-expiry-'));

  try {
    assert.throws(() => checkWith(directory, '2026-08-24', [escaping]), /escapes/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
