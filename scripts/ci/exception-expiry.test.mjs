import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
const GRANT = SOURCES.find((source) => source.file === '.grant.yaml');

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
 * A source that names a file which is not there is a failure, not an empty read.
 *
 * This used to pass, and passing was the hole: rename `.grant.yaml` without
 * touching `SOURCES` and the guard reported "2 accepted finding(s), all
 * current", exit 0, with seven dated licence exceptions no longer re-reviewed.
 * `.trivyignore` was the quiet version - it carries no live entries today, so
 * renaming it did not even move the count.
 *
 * The message has to name the file, because the two ways to reach this state
 * have opposite fixes: a rename wants the list updated, a dropped scanner wants
 * the entry deleted.
 */
test('a source naming a file that is not there is a failure', () => {
  const empty = mkdtempSync(path.join(tmpdir(), 'exception-expiry-'));
  try {
    // Deliberately not naming a file. Which source is reported first is a fact
    // about the order of a list this test is not about - asserting `.grype.yaml`
    // here went red when the list was reordered, a legal edit. WHICH files are
    // covered is the next test's job, and it does not care about order either.
    assert.throws(() => check(empty, '2026-08-24'), /is named in SOURCES but is not in/u);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

/**
 * And every file in the list is checked for, not just the first one. Asserting
 * only the first would pass against a loop that stopped after it - which is the
 * shape of the defect this test exists for, one level in.
 */
test('every source in the list must name a file that exists', () => {
  assert.notEqual(SOURCES.length, 0, 'no sources: this test is reading nothing');

  const directory = mkdtempSync(path.join(tmpdir(), 'exception-expiry-'));
  try {
    for (const source of SOURCES) {
      const missing = SOURCES.filter((other) => other !== source);
      for (const other of missing) writeFileSync(path.join(directory, other.file), '');
      assert.throws(
        () => check(directory, '2026-08-24'),
        new RegExp(`${source.file.replaceAll('.', '\\.')} is named in SOURCES but is not in`, 'u'),
        `${source.file} going missing was not reported`
      );
      for (const other of missing) rmSync(path.join(directory, other.file));
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
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
/*
 * The synthetic-root tests below drive `checkWith` with one source rather than
 * `check` with all of them, now that a source naming nothing is a failure. Two
 * reasons, and the second is the one that matters: a temp directory holding
 * only `.grype.yaml` would otherwise fail on the two files it was never meant
 * to have, and `check` passed here before only because `.grype.yaml` happens to
 * be first in `SOURCES` - a result that depended on the iteration order of a
 * list these tests are not about. `checkWith` takes its sources for exactly
 * this.
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
    assert.throws(() => checkWith(directory, '2026-08-24', [GRYPE]), /EACCES|permission denied/iu);
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

/**
 * A dangling symlink fails the read with ENOENT, the same code a missing file
 * gives, so an error-code check alone would call it absent and report a clean
 * scan. The path exists, somebody put it there deliberately, and whatever it
 * pointed at is gone - the unreadable case wearing the missing case's error
 * code.
 *
 * Raised in review of this file, and it is the second time the same
 * fail-open shape has been found in a script written to prevent exactly that.
 */
test('a dangling symlink is a read failure, not an absent file', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'exception-expiry-'));
  symlinkSync(path.join(directory, 'nowhere.yaml'), path.join(directory, '.grype.yaml'));

  try {
    assert.throws(() => checkWith(directory, '2026-08-24', [GRYPE]), /ENOENT|no such file/iu);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** And a symlink that resolves is read through, so the guard is not just strict. */
test('a symlink that resolves is read normally', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'exception-expiry-'));
  writeFileSync(
    path.join(directory, 'real.yaml'),
    'ignore:\n  # CVE-2025-00001 in foo. Owner: someone.\n  # Re-review by: 2030-01-01.\n  - vulnerability: CVE-2025-00001\n'
  );
  symlinkSync(path.join(directory, 'real.yaml'), path.join(directory, '.grype.yaml'));

  try {
    const { exceptions, problems } = checkWith(directory, '2026-08-24', [GRYPE]);
    assert.deepEqual(
      exceptions.map((exception) => exception.id),
      ['CVE-2025-00001']
    );
    assert.deepEqual(problems, []);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

/**
 * `.grant.yaml` holds two lists of the same shape, and only one of them is an
 * exception list. Every SPDX identifier under `allow:` would otherwise read as
 * an undated exception - three dozen failures saying an allow-list entry needs
 * a re-review date, which is not a thing an allow-list entry has.
 */
test('reads only the ignore-packages section of a grant policy', () => {
  const grant = `allow:
  - MIT
  - Apache-2.0
require-license: false
ignore-packages:
  # some-package: metadata is not machine-readable. Owner: someone.
  # Re-review by: 2027-01-01.
  - some-package
`;

  const found = findExceptions(grant, GRANT);

  assert.deepEqual(
    found.map((exception) => exception.id),
    ['some-package'],
    'MIT and Apache-2.0 are allow-list entries, not exceptions'
  );
  assert.equal(found[0].date, '2027-01-01');
});

test('stops reading at the next top-level key', () => {
  const grant = `ignore-packages:
  # one: reason. Owner: someone. Re-review by: 2027-01-01.
  - one
allow:
  - MIT
`;

  assert.deepEqual(
    findExceptions(grant, GRANT).map((exception) => exception.id),
    ['one']
  );
});

/**
 * A run of list items written with nothing between them is one decision.
 * `.grant.yaml` excepts `react-doctor` and `oxlint-plugin-react-doctor` on one
 * argument in two lines, and demanding the argument twice would be asking for a
 * copy rather than a reason.
 */
test('adjacent entries share the block above them', () => {
  const grant = `ignore-packages:
  # both packages, one argument. Owner: someone. Re-review by: 2027-01-01.
  - first
  - second
`;

  const problems = expired(findExceptions(grant, GRANT), '2026-08-24');

  assert.deepEqual(problems, []);
});

/**
 * And the hazard stays closed: a blank line ends the run, so a dated entry
 * cannot vouch for an unrelated one below it.
 */
test('a blank line ends the run', () => {
  const grant = `ignore-packages:
  # first only. Owner: someone. Re-review by: 2027-01-01.
  - first

  - unrelated
`;

  const problems = expired(findExceptions(grant, GRANT), '2026-08-24');

  assert.deepEqual(
    problems.map((problem) => problem.id),
    ['unrelated']
  );
});

test('an intervening comment ends the run too', () => {
  const grant = `ignore-packages:
  # first only. Owner: someone. Re-review by: 2027-01-01.
  - first
  # a note about the next one, with no date
  - unrelated
`;

  assert.deepEqual(
    expired(findExceptions(grant, GRANT), '2026-08-24').map((problem) => problem.id),
    ['unrelated']
  );
});

/** YAML lets a scalar be bare, single-quoted or double-quoted, and grant honours all three. */
for (const [name, written] of [
  ['bare', '@scope/name'],
  ['single-quoted', "'@scope/name'"],
  ['double-quoted', '"@scope/name"'],
]) {
  test(`handles a ${name} scoped package name`, () => {
    const grant = `ignore-packages:
  # reason. Owner: someone. Re-review by: 2027-01-01.
  - ${written}
`;

    assert.deepEqual(
      findExceptions(grant, GRANT).map((exception) => exception.id),
      ['@scope/name']
    );
  });
}

/**
 * The rule that closes the class rather than the instance.
 *
 * Three separate fail-open bugs were found in review of this script - an
 * unreadable file, a dangling symlink, and a double-quoted package name - and
 * all three had one shape: something the guard could not read became something
 * the guard did not check. A suppression the scanner honours and this does not
 * is an exception with no expiry, which is the state the script exists to make
 * impossible. So an unparseable list item is an error.
 */
test('refuses a list item it cannot parse rather than skipping it', () => {
  const grant = `ignore-packages:
  # reason. Owner: someone. Re-review by: 2027-01-01.
  - { name: some-package, version: 1.2.3 }
`;

  assert.throws(() => findExceptions(grant, GRANT), /cannot parse .grant.yaml:3/u);
});

test('a mismatched quote does not sneak through as a bare name', () => {
  const grant = `ignore-packages:
  # reason. Owner: someone. Re-review by: 2027-01-01.
  - 'some-package"
`;

  assert.throws(() => findExceptions(grant, GRANT), /cannot parse/u);
});
