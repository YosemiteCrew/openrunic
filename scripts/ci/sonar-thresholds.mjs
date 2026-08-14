#!/usr/bin/env node
// Enforce openrunic's Sonar bar in CI, because SonarCloud will not.
//
// Usage:
//   node scripts/ci/sonar-thresholds.mjs --base-dir <app dir> \
//     [--coverage 95] [--duplication 0] [--issues 0]
//
// The scan step already passes `sonar.qualitygate.wait=true`, so a red gate reds
// the job. The trouble is which gate it waits for. Attaching a custom quality
// gate to a project needs a plan this organisation does not have - the API
// answers `api/qualitygates/select` with "Organization ... is not allowed to
// modify Quality gates" - so the only verdict available is the built-in "Sonar
// way": 80% coverage and 3% duplication on new code, and no condition on the
// issue count at all. Those are not the numbers this repository claims, and the
// difference is not small.
//
// Two further gaps come with any gate written against new code:
//
//   - A pull request analysis evaluates NEW-code conditions only, and drops even
//     those when the pull request introduces no new lines. A change can pass a
//     green gate while the project sits well below the bar.
//   - "Sonar way" carries no issue condition, so a project accumulating smells
//     passes it indefinitely as long as each individual change is clean. That is
//     exactly the drift `docs/quality-gates.md` says a gate is meant to stop.
//
// The measures read here are whole-branch figures published by the analysis this
// job just ran, so they answer the question the bar actually asks: is this
// project at 95% coverage, zero duplication and zero open issues right now.
//
// Dependency-free by design, like the other scripts in this directory: the scan
// job deliberately does not install the workspace, so this has only Node to
// work with.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolveWithin } from './safe-path.mjs';

/** The three measures the bar is written in. Whole-branch, not new code. */
export const METRICS = ['coverage', 'duplicated_lines_density', 'violations'];

/** Where the scanner leaves the receipt for the analysis it just published. */
export const REPORT_TASK = path.join('.scannerwork', 'report-task.txt');

/**
 * The paths this will read a report from, or null if `--base-dir` escapes `root`.
 *
 * The scanner writes its working directory under projectBaseDir; the root is
 * checked too, so this still works if a caller ever scans from there. Both go
 * through resolveWithin, the same guard lcov-check.mjs puts on coverage paths.
 * The argument reaches this script from the workflow's own matrix rather than
 * from anything a contributor writes, but a check that reads whatever path it is
 * handed is one flag away from being a way to read any file on the runner, and
 * refusing is cheaper than arguing about who can set the flag.
 */
export function reportCandidates(root, baseDir) {
  const candidates = [path.join(baseDir, REPORT_TASK), REPORT_TASK].map((candidate) =>
    resolveWithin(root, candidate)
  );
  return candidates.includes(null) ? null : candidates;
}

/**
 * Parse the scanner's report-task.txt.
 *
 * It is a Java properties file, which means `Properties.store` has escaped every
 * `:` and `=` in the values - so `serverUrl` arrives as `https\://sonarcloud.io`
 * and a naive read produces a URL that does not resolve. Unescaping is therefore
 * part of reading it correctly rather than a nicety.
 */
export function parseReportTask(text) {
  const entries = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    entries[line.slice(0, separator).trim()] = unescapeProperty(line.slice(separator + 1));
  }
  return entries;
}

function unescapeProperty(value) {
  return value.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_match, escaped) => {
    if (escaped[0] === 'u') return String.fromCharCode(Number.parseInt(escaped.slice(1), 16));
    if (escaped === 'n') return '\n';
    if (escaped === 't') return '\t';
    if (escaped === 'r') return '\r';
    return escaped;
  });
}

/**
 * Work out which branch or pull request the analysis published to.
 *
 * Taken from the scanner's own dashboardUrl rather than from the GitHub event,
 * so the measures read back are the ones this analysis wrote. Deriving the
 * scope independently would let the two disagree on a merge queue ref or a
 * re-run, and a check that reads the wrong branch is worse than no check.
 */
export function analysisScope(dashboardUrl) {
  const parameters = new URL(dashboardUrl).searchParams;
  const pullRequest = parameters.get('pullRequest');
  if (pullRequest) return { kind: 'pullRequest', value: pullRequest };
  const branch = parameters.get('branch');
  if (branch) return { kind: 'branch', value: branch };
  // No branch parameter means the main branch: SonarCloud omits it for the
  // project's default branch.
  return { kind: 'branch', value: null };
}

/**
 * The name every SonarCloud project in this organisation gives its main branch.
 *
 * ci.yaml already requires it - a project whose main branch is called `dev`
 * fails on main pushes and passes on dev pushes - so it can be checked here
 * without asking the server which name it uses.
 */
export const MAIN_BRANCH = 'main';

/**
 * Build the measures query for an analysis.
 *
 * A pull request is addressed by number. A branch is addressed by NOT naming it:
 * this organisation's plan serves the main branch and refuses every other one,
 * answering `branch=main` itself with "Organization is not allowed to access
 * data from non main branches" - so the parameter that looks correct is the one
 * that fails. Omitting it returns the main branch, which is the only branch
 * analysis the Sonar stage ever produces (ci.yaml restricts the stage to a pull
 * request or a push to main).
 *
 * A branch analysis under any other name is refused rather than measured. It
 * would silently read main's numbers and report them as that branch's, which is
 * the one way this check could pass while measuring nothing relevant.
 */
export function measuresQuery(projectKey, scope, metrics) {
  const query = new URLSearchParams({ component: projectKey, metricKeys: metrics.join(',') });
  if (scope.kind === 'pullRequest') {
    query.set('pullRequest', scope.value);
    return query;
  }
  if (scope.value !== null && scope.value !== MAIN_BRANCH) {
    throw new Error(
      `this analysis published to branch '${scope.value}', and this organisation's SonarCloud plan ` +
        `serves '${MAIN_BRANCH}' only. Measuring it would read ${MAIN_BRANCH}'s numbers under ` +
        "another branch's name, so it stops here instead."
    );
  }
  return query;
}

/**
 * Compare published measures against the limits.
 *
 * A metric that is missing fails rather than passing. Sonar publishes no
 * `coverage` measure at all when it resolved no coverage report, and both of the
 * obvious readings of that absence - treat it as zero, treat it as fine - are
 * wrong: it means the pipeline broke upstream, which is a thing to stop for.
 */
export function checkMeasures(measures, limits) {
  const failures = [];
  const value = (metric) => {
    const found = measures.find((measure) => measure.metric === metric);
    return found === undefined ? undefined : Number.parseFloat(found.value);
  };

  for (const metric of METRICS) {
    if (value(metric) === undefined || Number.isNaN(value(metric))) {
      failures.push(
        `${metric} was not published by this analysis. That is a broken pipeline rather than a ` +
          'clean project, so it fails here instead of passing quietly.'
      );
    }
  }
  if (failures.length > 0) return failures;

  if (value('coverage') < limits.coverage) {
    failures.push(`coverage ${value('coverage')}% is below the ${limits.coverage}% floor`);
  }
  if (value('duplicated_lines_density') > limits.duplication) {
    failures.push(
      `duplicated lines ${value('duplicated_lines_density')}% exceeds the ` +
        `${limits.duplication}% ceiling`
    );
  }
  if (value('violations') > limits.issues) {
    failures.push(
      `${value('violations')} open issue(s), and the ceiling is ${limits.issues}. Fix them, or ` +
        "record a narrow exclusion with its rationale in the app's sonar-project.properties."
    );
  }
  return failures;
}

/** Basic auth, which every SonarCloud token type accepts. Bearer does not. */
function authHeaders() {
  const token = process.env.SONAR_TOKEN;
  if (!token) return {};
  return { Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}` };
}

async function getJson(url) {
  const response = await fetch(url, { headers: authHeaders() });
  const body = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`${url} returned HTTP ${response.status} and no JSON`);
  }
  if (!response.ok) {
    const message = (parsed.errors ?? []).map((error) => error.msg).join('; ');
    throw new Error(`${url} returned HTTP ${response.status}: ${message || body.slice(0, 200)}`);
  }
  return parsed;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for the compute engine to finish publishing this analysis.
 *
 * The scan step's own `qualitygate.wait` has usually done this already, so the
 * first poll normally returns SUCCESS. It is repeated rather than assumed
 * because the wait can be switched off in one place and this check would then
 * read the *previous* analysis's measures and pass on them.
 */
export async function waitForAnalysis(serverUrl, ceTaskId, { timeoutMs = 300_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { task } = await getJson(`${serverUrl}/api/ce/task?id=${encodeURIComponent(ceTaskId)}`);
    if (task.status === 'SUCCESS') return task;
    if (task.status === 'FAILED' || task.status === 'CANCELED') {
      throw new Error(`analysis task ${ceTaskId} ended as ${task.status}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`analysis task ${ceTaskId} was still ${task.status} after ${timeoutMs}ms`);
    }
    await sleep(5000);
  }
}

function readOption(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const parsed = Number.parseFloat(argv[index + 1]);
  if (Number.isNaN(parsed)) throw new Error(`--${name} needs a number`);
  return parsed;
}

async function main(argv) {
  const baseIndex = argv.indexOf('--base-dir');
  if (baseIndex === -1 || !argv[baseIndex + 1]) {
    process.stderr.write('sonar-thresholds: usage: --base-dir <app dir> [--coverage n] ...\n');
    return 2;
  }
  const baseDir = argv[baseIndex + 1];

  // Checked up front because the failure it prevents is unreadable. The measures
  // API serves these public projects to anyone, but `api/ce/task` does not: it
  // answers an unauthenticated caller with 404 "Project doesn't exist", which
  // reads as a missing project rather than a missing token.
  if (!process.env.SONAR_TOKEN) {
    process.stderr.write(
      'sonar-thresholds: SONAR_TOKEN is empty. The scan that produced this analysis needed it too, ' +
        "so this is a wiring problem in the job rather than anything about the project's code.\n"
    );
    return 1;
  }

  const limits = {
    coverage: readOption(argv, 'coverage', 95),
    duplication: readOption(argv, 'duplication', 0),
    issues: readOption(argv, 'issues', 0),
  };

  const candidates = reportCandidates(process.cwd(), baseDir);
  if (candidates === null) {
    process.stderr.write(
      `sonar-thresholds: --base-dir '${baseDir}' resolves outside the checkout at ` +
        `${process.cwd()}, so it is refused rather than read.\n`
    );
    return 1;
  }
  const reportPath = candidates.find((candidate) => existsSync(candidate));
  if (!reportPath) {
    process.stderr.write(
      `sonar-thresholds: no report-task.txt at ${candidates.join(' or ')}. The scan did not run, ` +
        'so there is nothing to check and this is not a pass.\n'
    );
    return 1;
  }

  const report = parseReportTask(readFileSync(reportPath, 'utf8'));
  for (const key of ['serverUrl', 'projectKey', 'ceTaskId', 'dashboardUrl']) {
    if (!report[key]) {
      process.stderr.write(`sonar-thresholds: ${reportPath} has no ${key}\n`);
      return 1;
    }
  }

  const scope = analysisScope(report.dashboardUrl);
  const task = await waitForAnalysis(report.serverUrl, report.ceTaskId);

  // The report file names the project and the task independently, and a stale
  // .scannerwork picked up from the repository root would agree with itself
  // while describing a different app. Cheap to check, and the failure it
  // prevents is a green check measured against the wrong project.
  if (task.componentKey && task.componentKey !== report.projectKey) {
    process.stderr.write(
      `sonar-thresholds: ${reportPath} names ${report.projectKey}, but its analysis task belongs ` +
        `to ${task.componentKey}. That report is not this scan's.\n`
    );
    return 1;
  }

  const query = measuresQuery(report.projectKey, scope, METRICS);
  const { component } = await getJson(`${report.serverUrl}/api/measures/component?${query}`);
  const measures = component.measures ?? [];

  const shown = (metric) =>
    measures.find((measure) => measure.metric === metric)?.value ?? '(none)';
  process.stdout.write(`sonar-thresholds: ${report.projectKey}\n`);
  process.stdout.write(`  analysed:    ${scope.kind} ${scope.value ?? '(main)'}\n`);
  process.stdout.write(`  coverage:    ${shown('coverage')}%  (floor ${limits.coverage}%)\n`);
  process.stdout.write(
    `  duplication: ${shown('duplicated_lines_density')}%  (ceiling ${limits.duplication}%)\n`
  );
  process.stdout.write(`  issues:      ${shown('violations')}  (ceiling ${limits.issues})\n`);
  process.stdout.write(`  dashboard:   ${report.dashboardUrl}\n`);

  const failures = checkMeasures(measures, limits);
  if (failures.length === 0) {
    process.stdout.write('sonar-thresholds: the bar is met.\n');
    return 0;
  }
  for (const failure of failures) process.stderr.write(`sonar-thresholds: ${failure}\n`);
  return 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`sonar-thresholds: ${error.message}\n`);
      process.exit(1);
    }
  );
}
