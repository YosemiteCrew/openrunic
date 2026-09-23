import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { REPORT_PATH, checkReport, summarize } from './drill-report.mjs';

/**
 * Shaped like Playwright's JSON report, and deliberately asymmetric: three
 * tests, two projects, two spec files, with one spec nested a `describe` deep.
 * Equal counts would let a reading of the wrong field pass, and a flat fixture
 * would let a walk that never recurses pass.
 */
const report = {
  // Playwright nulls this field for the array form of `webServer` and passes a
  // single object through with its env; the report is a public artifact, so the
  // accepted shape is pinned here rather than assumed.
  config: { webServer: null },
  suites: [
    {
      title: 'clinical-day.spec.ts',
      specs: [
        {
          title: 'drives the day',
          file: 'clinical-day.spec.ts',
          tests: [{ projectName: 'desktop-1440' }, { projectName: 'phone-375' }],
        },
      ],
      suites: [],
    },
    {
      title: 'portal.spec.ts',
      specs: [],
      suites: [
        {
          title: 'pet owner',
          specs: [
            {
              title: 'sees the visit',
              file: 'portal.spec.ts',
              tests: [{ projectName: 'desktop-1440' }],
            },
          ],
        },
      ],
    },
  ],
};

/**
 * The shape `readReport()` hands back. The read itself takes no argument - it
 * resolves one constant path - so the logic is exercised as a function of the
 * report's text, with no temporary files and no filesystem state to leak
 * between cases.
 */
function read(value) {
  return { raw: JSON.stringify(value) };
}

test('summarize counts every test and names both projects and specs', () => {
  assert.deepEqual(summarize(report), {
    tests: 3,
    projects: ['desktop-1440', 'phone-375'],
    specs: ['clinical-day.spec.ts', 'portal.spec.ts'],
  });
});

test('summarize reaches specs nested inside a describe block', () => {
  const nestedOnly = { suites: [report.suites[1]] };
  assert.deepEqual(summarize(nestedOnly), {
    tests: 1,
    projects: ['desktop-1440'],
    specs: ['portal.spec.ts'],
  });
});

test('a report naming projects, specs and tests passes and says what ran', () => {
  const result = checkReport(read(report));
  assert.equal(result.ok, true);
  const text = result.lines.join('\n');
  assert.match(text, /3 test\(s\) across 2 project\(s\) and 2 spec\(s\)/);
  assert.match(text, /portal\.spec\.ts/);
  assert.match(text, /phone-375/);
});

test('a report that names nothing fails rather than reading as a pass', () => {
  const result = checkReport(read({ suites: [] }));
  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /names no project, spec or test/);
});

test('a report whose suites ran no tests fails even though its files are named', () => {
  const result = checkReport(
    read({ suites: [{ title: 'clinical-day.spec.ts', specs: [], suites: [] }] })
  );
  assert.equal(result.ok, false);
});

test('a missing report fails and names the path it looked for', () => {
  const result = checkReport({ error: 'ENOENT: no such file or directory' });
  assert.equal(result.ok, false);
  const text = result.lines.join('\n');
  assert.match(text, /no readable report at .*drill-report\.json/);
  assert.match(text, /ENOENT/);
});

test('a report that is not JSON fails rather than reading as an empty run', () => {
  const result = checkReport({ raw: '<!doctype html>' });
  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /no readable report at/);
});

test('a report carrying the web server config fails before its env is published', () => {
  const leaky = {
    ...report,
    config: { webServer: { command: 'pnpm start', env: { SESSION_COOKIE_SECRET: 'CANARY' } } },
  };
  const result = checkReport(read(leaky));
  assert.equal(result.ok, false);
  const text = result.lines.join('\n');
  assert.match(text, /uploaded as a public artifact/);
  // The report is the thing that must not travel, so the check must not quote
  // the value it is refusing to publish.
  assert.doesNotMatch(text, /CANARY/);
});

/**
 * The path is the one thing here no other test can reach: `checkReport` judges
 * text, so a `REPORT_PATH` pointing at the wrong directory passes every case
 * above and fails only in a real drill. The expected tail is written out rather
 * than rebuilt from the constant - it is the same statement `playwright.config`
 * makes with `outputFile: 'test-results/drill-report.json'`, from the package
 * root, and two spellings of it that must agree is the point.
 */
test('REPORT_PATH resolves to the file the reporter is configured to write', () => {
  assert.ok(
    REPORT_PATH.endsWith(path.join('apps', 'e2e', 'test-results', 'drill-report.json')),
    `REPORT_PATH is ${REPORT_PATH}`
  );
});
