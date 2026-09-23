#!/usr/bin/env node
/**
 * Reads the machine-readable drill report and says what the drill actually
 * drove.
 *
 * The HTML report is a single self-contained file: its data is a zip, base64
 * encoded, inside a <script> element. That is fine for a browser and useless
 * for anyone holding the downloaded artifact, because every plain-text search
 * over it - for a project name, a spec file, a scenario title - returns
 * nothing whether the run covered forty scenarios or none. #575 was filed off
 * exactly that reading: a complete report from a passing run, indistinguishable
 * by grep from an empty shell.
 *
 * So the drill now also emits `test-results/drill-report.json`, which is
 * greppable, and this module reads it back and fails the drill when it names no
 * project, no spec or no test. The threshold is zero on purpose: zero separates
 * "the reporter wrote nothing" from "the run found nothing", and any threshold
 * above it would also fire on a smaller run, stealing the failure from whatever
 * assertion would have named the real cause.
 */

import fs from 'node:fs';

/**
 * Playwright nests a suite per file and then one per `describe`, so the specs
 * are not at a fixed depth. Walking is what makes this independent of how the
 * spec files happen to be organised today.
 */
function walk(suites, found) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      if (typeof spec.file === 'string' && spec.file.length > 0) found.specs.add(spec.file);
      for (const test of spec.tests ?? []) {
        found.tests += 1;
        if (typeof test.projectName === 'string' && test.projectName.length > 0) {
          found.projects.add(test.projectName);
        }
      }
    }
    walk(suite.suites, found);
  }
}

/** @param {unknown} report A parsed Playwright JSON report. */
export function summarize(report) {
  const found = { tests: 0, projects: new Set(), specs: new Set() };
  walk(report?.suites, found);
  return {
    tests: found.tests,
    projects: [...found.projects].sort(),
    specs: [...found.specs].sort(),
  };
}

/**
 * @param {string} reportPath
 * @returns {{ ok: boolean, lines: string[] }} `ok` false means the artifact
 * cannot say what ran, which is the defect this guards against.
 */
export function checkReport(reportPath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch (error) {
    return {
      ok: false,
      lines: [
        `The drill produced no readable report at ${reportPath}`,
        `  ${error instanceof Error ? error.message : String(error)}`,
        'The run cannot be reviewed from its artifact, so it does not count as having run.',
      ],
    };
  }

  /**
   * `config.webServer` is `null` in this report only because the config
   * declares its servers as an ARRAY. Playwright passes a single object
   * straight through - `Array.isArray(webServers) ? null : webServers` in
   * common/index.js - and the JSON reporter emits it verbatim, `env` included.
   * This file is uploaded whole as a public CI artifact and no gate reads
   * artifacts, so the array form is load-bearing for something nothing else
   * would catch. It is checked here rather than written down in a comment.
   */
  if (parsed?.config?.webServer != null) {
    return {
      ok: false,
      lines: [
        'The report carries the web server configuration, which includes its env.',
        'This file is uploaded as a public artifact, so that env would go out with it.',
        'Declare `webServer` as an array of one in playwright.config.ts: Playwright',
        'serialises the array form as null and runs it identically.',
      ],
    };
  }

  const { tests, projects, specs } = summarize(parsed);
  const lines = [
    `Drill report: ${String(tests)} test(s) across ${String(projects.length)} project(s) and ${String(specs.length)} spec(s)`,
    `  projects: ${projects.join(', ') || '(none)'}`,
    `  specs:    ${specs.join(', ') || '(none)'}`,
  ];
  if (tests === 0 || projects.length === 0 || specs.length === 0) {
    lines.push(
      '',
      'The report names no project, spec or test. The drill reported a result',
      'whose artifact cannot be reviewed; that is a failure, not a pass.'
    );
    return { ok: false, lines };
  }
  return { ok: true, lines };
}
