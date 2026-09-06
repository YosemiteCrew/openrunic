#!/usr/bin/env node
// Unit tests for the coverage-resolution check.
//
// This guard is the only thing standing between a mis-rooted lcov report and a
// green Sonar gate that measured nothing, and it had no test. The cases worth
// pinning are the ones where a wrong answer looks like a right one: a report
// whose paths point outside the app but exist on disk, and a report where most
// paths resolve and a few do not - which passed until the threshold that
// allowed it was removed.
//
// Driven as a subprocess rather than by import, because the workflow depends on
// the exit code and the script has no exports.
//
// Run with `node --test scripts/ci/lcov-check.test.mjs`, or
// `pnpm run check:ci-scripts:test`.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const CHECK = fileURLToPath(new URL('./lcov-check.mjs', import.meta.url));

/** An app directory holding `names`, plus an lcov listing `entries`. */
function fixture(names, entries) {
  const root = mkdtempSync(path.join(tmpdir(), 'lcov-check-'));
  const app = path.join(root, 'app');
  for (const name of names) {
    const file = path.join(app, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'export const x = 1;\n');
  }
  mkdirSync(app, { recursive: true });
  const lcov = path.join(root, 'lcov.info');
  writeFileSync(
    lcov,
    entries.map((entry) => `SF:${entry}\nDA:1,1\nend_of_record`).join('\n') + '\n'
  );
  return { root, app, lcov };
}

const run = (app, lcov) =>
  spawnSync(process.execPath, [CHECK, '--resolve', app, lcov], { encoding: 'utf8' });

describe('a report whose paths all resolve', () => {
  it('passes, and says how many it read', () => {
    const { app, lcov } = fixture(['src/a.ts', 'src/b.ts'], ['src/a.ts', 'src/b.ts']);
    const done = run(app, lcov);

    assert.equal(done.status, 0, done.stderr);
    assert.match(done.stdout, /SF entries: +2$/mu);
    assert.match(done.stdout, /resolved: +2 \(100\.0%\)/u);
  });
});

describe('a report that is partly unresolved', () => {
  // The case this suite exists for. Four of five resolving is 80%, which the
  // removed threshold treated as healthy; Sonar would have scored the missing
  // file's lines as uncovered-by-nothing and passed.
  it('fails even when most paths resolve', () => {
    const present = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'];
    const { app, lcov } = fixture(present, [...present, 'src/gone.ts']);
    const done = run(app, lcov);

    assert.equal(done.status, 1);
    assert.match(done.stderr, /1 of 5 SF: paths do not resolve/u);
    assert.match(done.stderr, /src\/gone\.ts/u);
    // The share is still printed, so the log carries the number either way.
    assert.match(done.stdout, /resolved: +4 \(80\.0%\)/u);
  });

  it('fails on a single missing path out of many', () => {
    const present = Array.from({ length: 20 }, (unused, index) => `src/f${String(index)}.ts`);
    const { app, lcov } = fixture(present, [...present, 'src/gone.ts']);
    const done = run(app, lcov);

    assert.equal(done.status, 1);
    assert.match(done.stdout, /resolved: +20 \(95\.2%\)/u);
  });
});

describe('a report that resolves nothing', () => {
  it('fails with the message about a gate that measured nothing', () => {
    const { app, lcov } = fixture(['src/a.ts'], ['wrong/root/a.ts', 'wrong/root/b.ts']);
    const done = run(app, lcov);

    assert.equal(done.status, 1);
    assert.match(done.stderr, /no SF: path resolves under/u);
    assert.match(done.stderr, /pass its gate without measuring anything/u);
  });
});

describe('a path that escapes the app directory', () => {
  // The file exists, so `existsSync` alone would call this resolved. It is
  // outside the tree being scanned, which is the definition of mis-rooted.
  it('counts as unresolved even though the file is really there', () => {
    const { root, app, lcov } = fixture(['src/a.ts'], ['../outside.ts']);
    writeFileSync(path.join(root, 'outside.ts'), 'export const x = 1;\n');
    const done = run(app, lcov);

    assert.equal(done.status, 1);
    assert.match(done.stdout, /resolved: +0 \(0\.0%\)/u);
  });
});

describe('a report that is not a report', () => {
  it('refuses a file that does not exist', () => {
    const { app, root } = fixture(['src/a.ts'], ['src/a.ts']);
    const done = run(app, path.join(root, 'absent.info'));

    assert.equal(done.status, 1);
    assert.match(done.stderr, /does not exist/u);
  });

  it('refuses an empty file rather than reading it as nothing to check', () => {
    const { app, root } = fixture(['src/a.ts'], ['src/a.ts']);
    const empty = path.join(root, 'empty.info');
    writeFileSync(empty, '   \n');
    const done = run(app, empty);

    assert.equal(done.status, 1);
    assert.match(done.stderr, /is empty/u);
  });

  it('refuses a report with no SF: entries at all', () => {
    const { app, root } = fixture(['src/a.ts'], []);
    const noSf = path.join(root, 'no-sf.info');
    writeFileSync(noSf, 'TN:\nDA:1,1\nend_of_record\n');
    const done = run(app, noSf);

    assert.equal(done.status, 1);
    assert.match(done.stderr, /records no SF: entries/u);
  });

  it('refuses the wrong arguments', () => {
    const done = spawnSync(process.execPath, [CHECK, '--nope'], { encoding: 'utf8' });

    assert.equal(done.status, 1);
    assert.match(done.stderr, /usage: --resolve/u);
  });
});
