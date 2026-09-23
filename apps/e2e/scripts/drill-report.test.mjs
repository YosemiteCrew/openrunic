import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkReport, summarize } from './drill-report.mjs';

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

function writeReport(value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drill-report-'));
  const file = path.join(dir, 'drill-report.json');
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
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
  const result = checkReport(writeReport(report));
  assert.equal(result.ok, true);
  const text = result.lines.join('\n');
  assert.match(text, /3 test\(s\) across 2 project\(s\) and 2 spec\(s\)/);
  assert.match(text, /portal\.spec\.ts/);
  assert.match(text, /phone-375/);
});

test('a report that names nothing fails rather than reading as a pass', () => {
  const result = checkReport(writeReport({ suites: [] }));
  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /names no project, spec or test/);
});

test('a report whose suites ran no tests fails even though its files are named', () => {
  const result = checkReport(
    writeReport({ suites: [{ title: 'clinical-day.spec.ts', specs: [], suites: [] }] })
  );
  assert.equal(result.ok, false);
});

test('a missing report fails and names the path it looked for', () => {
  const missing = path.join(os.tmpdir(), 'drill-report-absent', 'drill-report.json');
  const result = checkReport(missing);
  assert.equal(result.ok, false);
  assert.match(result.lines.join('\n'), /no readable report at .*drill-report\.json/);
});

test('a report carrying the web server config fails before its env is published', () => {
  const leaky = {
    ...report,
    config: { webServer: { command: 'pnpm start', env: { SESSION_COOKIE_SECRET: 'CANARY' } } },
  };
  const result = checkReport(writeReport(leaky));
  assert.equal(result.ok, false);
  const text = result.lines.join('\n');
  assert.match(text, /uploaded as a public artifact/);
  // The report is the thing that must not travel, so the check must not quote
  // the value it is refusing to publish.
  assert.doesNotMatch(text, /CANARY/);
});
