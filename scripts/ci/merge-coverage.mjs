#!/usr/bin/env node
// Merge per-shard coverage into one report per app, and enforce the app's floor.
//
// Usage:
//   node scripts/ci/merge-coverage.mjs --shards <dir> --out <dir> [--floor spec]
//
//   --shards  directory containing the downloaded shard artifacts; every
//             coverage-final.json beneath it is merged
//   --out     directory to write lcov.info into
//   --floor   e.g. statements=80,branches=70,functions=75,lines=80
//
// Shards are merged as istanbul JSON rather than as lcov text. lcov merging
// looks simpler but loses data: lcov-result-merger drops FN/FNDA records
// entirely, so function coverage silently disappears and a functions floor
// evaluates against nothing. Merging the istanbul coverage maps keeps all four
// metrics intact, and lcov is generated once from the merged map, for Sonar.
// vitest's istanbul provider with --coverage.reporter=json writes exactly this
// format to coverage/coverage-final.json.
//
// The merge and the lcov generation are implemented here without istanbul-lib-*
// on purpose: those libraries are not dependencies of the workspace root, and
// scripts/ci must run from a bare `pnpm install` at the root without reaching
// into any app's node_modules. Shards of the same app at the same commit share
// instrumentation, so entries for the same file carry identical statement,
// function and branch maps and the merge is a per-id counter sum; line coverage
// is derived the way istanbul derives it (max statement count per line).
//
// A floor is enforced here rather than through vitest's own coverage.thresholds
// because a sharded run gives each shard only a slice of the files; a global
// threshold would fail on every shard regardless of the real total.

import { readdirSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveWithin } from './safe-path.mjs';

const METRICS = ['statements', 'branches', 'functions', 'lines'];

function fail(message) {
  console.error(`merge-coverage: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { shards: '', out: '', floor: '' };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!['--shards', '--out', '--floor'].includes(flag)) fail(`unknown argument '${flag}'`);
    if (!value) fail(`${flag} requires a value`);
    args[flag.slice(2)] = value;
  }
  if (!args.shards || !args.out) fail('usage: --shards <dir> --out <dir> [--floor spec]');
  return args;
}

function findCoverageFiles(dir) {
  const found = [];
  const root = path.resolve(dir);
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      // readdirSync yields bare names, so this cannot escape today; asserting it
      // keeps that true if the traversal ever reads names from elsewhere.
      const full = resolveWithin(root, path.relative(root, path.join(current, entry)));
      if (full === null) continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === 'coverage-final.json') found.push(full);
    }
  };
  try {
    walk(dir);
  } catch (error) {
    fail(`cannot read shard directory '${dir}': ${error.message}`);
  }
  return found.sort();
}

function parseFloor(spec) {
  const floors = new Map();
  if (!spec) return floors;
  for (const part of spec.split(',')) {
    const [metric, value] = part.split('=');
    const parsed = Number(value);
    if (!METRICS.includes(metric?.trim()))
      fail(`unknown metric '${metric}', expected one of ${METRICS.join(', ')}`);
    if (Number.isNaN(parsed)) fail(`bad floor value in '${part}'`);
    floors.set(metric.trim(), parsed);
  }
  return floors;
}

// istanbul FileCoverage data: { path, statementMap, s, fnMap, f, branchMap, b }.
// Some emitters wrap it one level deeper as { data: {...} }; unwrap either way.
function normalizeEntry(key, value) {
  const data = value && typeof value === 'object' && value.data?.statementMap ? value.data : value;
  if (!data || typeof data !== 'object' || !data.statementMap || !data.s) {
    fail(`entry for '${key}' is not istanbul file coverage (missing statementMap/s)`);
  }
  return {
    path: data.path ?? key,
    statementMap: data.statementMap ?? {},
    s: data.s ?? {},
    fnMap: data.fnMap ?? {},
    f: data.f ?? {},
    branchMap: data.branchMap ?? {},
    b: data.b ?? {},
  };
}

// Sum counters per id; union ids that only one shard saw (a shard that loaded
// no test touching a lazily-instrumented chunk can miss ids entirely).
function mergeInto(target, incoming) {
  for (const [id, count] of Object.entries(incoming.s)) {
    if (id in target.s) target.s[id] += count;
    else {
      target.s[id] = count;
      target.statementMap[id] = incoming.statementMap[id];
    }
  }
  for (const [id, count] of Object.entries(incoming.f)) {
    if (id in target.f) target.f[id] += count;
    else {
      target.f[id] = count;
      target.fnMap[id] = incoming.fnMap[id];
    }
  }
  for (const [id, counts] of Object.entries(incoming.b)) {
    if (id in target.b) {
      target.b[id] = target.b[id].map((n, i) => n + (counts[i] ?? 0));
    } else {
      target.b[id] = counts.slice();
      target.branchMap[id] = incoming.branchMap[id];
    }
  }
}

// istanbul's line coverage: each statement maps to its start line; when several
// statements share a line, the highest hit count wins.
function lineCoverage(file) {
  const lines = Object.create(null);
  for (const [id, count] of Object.entries(file.s)) {
    const line = file.statementMap[id]?.start?.line;
    if (line === undefined) continue;
    if (lines[line] === undefined || lines[line] < count) lines[line] = count;
  }
  return lines;
}

function lcovRecord(file) {
  const out = ['TN:', `SF:${file.path}`];

  const fnIds = Object.keys(file.fnMap);
  for (const id of fnIds) {
    const fn = file.fnMap[id];
    out.push(`FN:${fn?.decl?.start?.line ?? fn?.loc?.start?.line ?? 0},${fn?.name ?? id}`);
  }
  out.push(`FNF:${fnIds.length}`);
  out.push(`FNH:${fnIds.filter((id) => (file.f[id] ?? 0) > 0).length}`);
  for (const id of fnIds) {
    out.push(`FNDA:${file.f[id] ?? 0},${file.fnMap[id]?.name ?? id}`);
  }

  const lines = lineCoverage(file);
  const lineNos = Object.keys(lines)
    .map(Number)
    .sort((a, b) => a - b);
  for (const line of lineNos) out.push(`DA:${line},${lines[line]}`);
  out.push(`LF:${lineNos.length}`);
  out.push(`LH:${lineNos.filter((line) => lines[line] > 0).length}`);

  let branchesFound = 0;
  let branchesHit = 0;
  for (const [id, counts] of Object.entries(file.b)) {
    const branch = file.branchMap[id];
    counts.forEach((count, i) => {
      const line = branch?.locations?.[i]?.start?.line ?? branch?.loc?.start?.line ?? 0;
      out.push(`BRDA:${line},${id},${i},${count}`);
      branchesFound += 1;
      if (count > 0) branchesHit += 1;
    });
  }
  out.push(`BRF:${branchesFound}`);
  out.push(`BRH:${branchesHit}`);
  out.push('end_of_record');
  return out.join('\n');
}

function summarize(files) {
  const summary = {};
  for (const metric of METRICS) summary[metric] = { covered: 0, total: 0, pct: 0 };
  for (const file of files) {
    summary.statements.total += Object.keys(file.s).length;
    summary.statements.covered += Object.values(file.s).filter((n) => n > 0).length;
    summary.functions.total += Object.keys(file.f).length;
    summary.functions.covered += Object.values(file.f).filter((n) => n > 0).length;
    for (const counts of Object.values(file.b)) {
      summary.branches.total += counts.length;
      summary.branches.covered += counts.filter((n) => n > 0).length;
    }
    const lines = Object.values(lineCoverage(file));
    summary.lines.total += lines.length;
    summary.lines.covered += lines.filter((n) => n > 0).length;
  }
  for (const metric of METRICS) {
    const { covered, total } = summary[metric];
    // istanbul's convention: an empty denominator reads as fully covered.
    summary[metric].pct = total === 0 ? 100 : Math.round((10000 * covered) / total) / 100;
  }
  return summary;
}

const args = parseArgs(process.argv.slice(2));
const files = findCoverageFiles(args.shards);

// No shard reports means the upload or download silently produced nothing.
// Writing an empty report here would hand Sonar a 0% measurement it accepts
// without complaint, so stop instead.
if (files.length === 0) fail(`no coverage-final.json found under '${args.shards}'`);

const merged = new Map();
for (const file of files) {
  let shard;
  try {
    shard = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`cannot merge ${file}: ${error.message}`);
  }
  for (const [key, value] of Object.entries(shard)) {
    const entry = normalizeEntry(key, value);
    if (merged.has(entry.path)) mergeInto(merged.get(entry.path), entry);
    else merged.set(entry.path, entry);
  }
}

const covered = merged.size;
if (covered === 0) fail('merged coverage map contains no files');

const orderedFiles = [...merged.values()].sort((a, b) => a.path.localeCompare(b.path));
mkdirSync(args.out, { recursive: true });
writeFileSync(
  path.join(args.out, 'lcov.info'),
  `${orderedFiles.map((file) => lcovRecord(file)).join('\n')}\n`
);

const summary = summarize(orderedFiles);
console.log(`merge-coverage: merged ${files.length} shard report(s), ${covered} files`);
for (const metric of METRICS) {
  const { pct, covered: hit, total } = summary[metric];
  console.log(`  ${metric.padEnd(11)} ${String(pct).padStart(6)}%  (${hit}/${total})`);
}

const floors = parseFloor(args.floor);
const failures = [];
for (const [metric, floor] of floors) {
  const { pct } = summary[metric];
  if (pct < floor) failures.push(`${metric} ${pct}% < ${floor}%`);
}
if (failures.length > 0) fail(`merged coverage below floor: ${failures.join(', ')}`);
