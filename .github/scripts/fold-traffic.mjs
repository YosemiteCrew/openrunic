#!/usr/bin/env node
/**
 * Folds a 14-day traffic snapshot into a permanent, date-keyed history.
 *
 * ## The problem this exists for
 *
 * `GET /repos/{owner}/{repo}/traffic/clones` returns the last 14 days and
 * nothing else. Run it today and again tomorrow and the two responses overlap
 * by thirteen days, so adding the totals together roughly doubles them. Store
 * only the latest response and the history is forever 14 days long, which is
 * the problem we started with.
 *
 * So the history is a map from ISO date to that day's counts, and folding a
 * snapshot means writing each of its days into that map. A day that is already
 * there is overwritten rather than added: the newer snapshot is at worst equal
 * and at best more complete, because GitHub is still counting the current day
 * when the earlier snapshot was taken.
 *
 * ## What "all time" honestly means
 *
 * It means "since this job first ran". Anything before that is unrecoverable -
 * GitHub discarded it - and the summary says so rather than implying the number
 * reaches back to the first commit. A count that overstates its own coverage is
 * worse than one that admits a start date.
 *
 * Unique cloners and unique visitors are summed per day as GitHub reports them.
 * The sum over a range is therefore NOT the number of distinct people over that
 * range: someone who clones on Monday and again on Friday is unique on both
 * days. GitHub's own 14-day "unique" figure deduplicates across the window, so
 * these two numbers answer different questions and the summary labels them as
 * daily-unique rather than quietly presenting them as distinct people.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    if (fallback === undefined) throw new Error(`missing --${name}`);
    return fallback;
  }
  const value = process.argv[index + 1];
  if (value === undefined) throw new Error(`--${name} needs a value`);
  return value;
}

/** The day part of GitHub's ISO timestamps, which are always midnight UTC. */
function dayOf(timestamp) {
  return String(timestamp).slice(0, 10);
}

/** A snapshot from the environment, or an empty window if it is absent or bad. */
function parseEnv(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return { days: [] };
  try {
    return JSON.parse(raw);
  } catch {
    return { days: [] };
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Writes each day of a snapshot into the history.
 *
 * Overwrite, never add - see the header. The guard on `count` keeps a malformed
 * or empty response from replacing a real figure with a zero, which would be a
 * silent loss rather than a visible failure.
 */
function fold(history, snapshot) {
  let changed = 0;
  for (const day of snapshot.days ?? []) {
    const date = dayOf(day.timestamp);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (typeof day.count !== 'number' || typeof day.uniques !== 'number') continue;

    const existing = history[date];
    if (existing?.count === day.count && existing.uniques === day.uniques) continue;
    history[date] = { count: day.count, uniques: day.uniques };
    changed += 1;
  }
  return changed;
}

function totals(history) {
  let count = 0;
  let uniques = 0;
  for (const day of Object.values(history)) {
    count += day.count;
    uniques += day.uniques;
  }
  const dates = Object.keys(history).sort();
  return {
    count,
    uniques,
    since: dates[0] ?? null,
    until: dates.at(-1) ?? null,
    days: dates.length,
  };
}

/** shields.io endpoint payload. `schemaVersion` 1 is the only version there is. */
function badge(label, value, color) {
  return `${JSON.stringify({ schemaVersion: 1, label, message: value, color }, null, 2)}\n`;
}

function human(value) {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

const out = arg('out');
const historyDir = path.join(out, 'history');
const badgeDir = path.join(out, 'badges');

const clonesHistory = readJson(path.join(historyDir, 'clones.json'), {});
const viewsHistory = readJson(path.join(historyDir, 'views.json'), {});

// The snapshots come through the environment rather than as file paths.
// The workflow has already fetched them, so writing them to disk only to read
// them back would add a step, a temporary file, and a path this script would
// have to be trusted with. Parsing failures fall back to an empty window, which
// the fold treats as "nothing to record" rather than as zeroes to write.
const clonesChanged = fold(clonesHistory, parseEnv('CLONES_JSON'));
const viewsChanged = fold(viewsHistory, parseEnv('VIEWS_JSON'));

writeJson(path.join(historyDir, 'clones.json'), clonesHistory);
writeJson(path.join(historyDir, 'views.json'), viewsHistory);

const clones = totals(clonesHistory);
const views = totals(viewsHistory);

// Warm-bone palette, so the traffic badges read as part of the same set as the
// rest of the header rather than as something bolted on.
writeFileSync(path.join(badgeDir, 'clones.json'), badge('clones', human(clones.count), 'C4552D'));
writeFileSync(
  path.join(badgeDir, 'cloners.json'),
  badge('cloners', human(clones.uniques), '8C5E3C')
);
writeFileSync(path.join(badgeDir, 'views.json'), badge('views', human(views.count), '6B7A4F'));
writeFileSync(
  path.join(badgeDir, 'visitors.json'),
  badge('visitors', human(views.uniques), 'A9714B')
);

writeFileSync(
  path.join(out, 'README.md'),
  [
    '# Traffic history',
    '',
    'Generated by `.github/workflows/traffic.yml`. Do not edit by hand: every run rewrites it.',
    '',
    'GitHub serves a rolling 14-day traffic window and discards the rest, so these totals start',
    'when the job first ran rather than at the first commit.',
    '',
    '| | Total | Daily-unique | First recorded | Last recorded | Days |',
    '| --- | --- | --- | --- | --- | --- |',
    `| Clones | ${clones.count} | ${clones.uniques} | ${clones.since ?? '-'} | ${clones.until ?? '-'} | ${clones.days} |`,
    `| Views | ${views.count} | ${views.uniques} | ${views.since ?? '-'} | ${views.until ?? '-'} | ${views.days} |`,
    '',
    'Daily-unique is the sum of GitHub’s per-day unique counts. It is not the number of distinct',
    'people over the whole period: somebody who clones on two days is unique on each of them.',
    '',
  ].join('\n')
);

process.stdout.write(
  `clones: ${String(clones.count)} total over ${String(clones.days)} day(s), ${String(clonesChanged)} updated\n` +
    `views:  ${String(views.count)} total over ${String(views.days)} day(s), ${String(viewsChanged)} updated\n`
);

/**
 * Writes the history with its dates in order.
 *
 * Rebuilt into a new object rather than passed to JSON.stringify's second
 * argument: that parameter is an allowlist, not a sort, and handing it the
 * top-level date keys would have filtered `count` and `uniques` out of every
 * nested value and written a file full of empty objects. Ordering matters only
 * so the daily commit diff reads as one added line.
 */
function writeJson(file, value) {
  const ordered = {};
  for (const key of Object.keys(value).sort()) ordered[key] = value[key];
  writeFileSync(file, `${JSON.stringify(ordered, null, 2)}\n`);
}
