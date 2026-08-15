#!/usr/bin/env node
/**
 * REGENERATES THE REFERENCE TABLES, AND PROVES THEY ARE THE PUBLISHED ONES.
 *
 * The growth charts in this package are somebody else's data, and a plausible
 * but wrong LMS value produces a percentile that looks entirely normal and is
 * not - which on a child's growth chart is exactly the kind of wrong that is
 * acted on. So the numbers are never typed by hand and never adjusted. They are
 * downloaded from the CDC, checksummed, and written out by this script, which is
 * committed so anybody can re-run it and diff the result.
 *
 * The CDC's own files carry precomputed percentile columns beside the LMS
 * parameters. That is a gift: this script recomputes every one of them from the
 * L, M and S it is about to write, and refuses to emit a table whose parameters
 * do not reproduce the CDC's published percentiles. A transcription error
 * therefore cannot reach the repository - the generator stops.
 *
 *   node scripts/fetch-reference.mjs
 *
 * Requires network access, which is why it is a script rather than part of the
 * build: CI builds this package from the committed output and reaches nothing.
 */

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'src', 'reference');

const BASE = 'https://www.cdc.gov/growthcharts/data/zscore';

/**
 * The tables, and what each is indexed by.
 *
 * `Agemos` for the age-based charts and `Length` for weight-for-length, which is
 * the one chart that is not a function of age at all - a nine-month-old and a
 * fourteen-month-old of the same length are compared against the same curve.
 */
const TABLES = [
  { file: 'wtageinf', name: 'weightForAgeInfant', index: 'Agemos', unit: 'kg' },
  { file: 'lenageinf', name: 'lengthForAgeInfant', index: 'Agemos', unit: 'cm' },
  { file: 'hcageinf', name: 'headCircumferenceForAgeInfant', index: 'Agemos', unit: 'cm' },
  { file: 'wtleninf', name: 'weightForLengthInfant', index: 'Length', unit: 'kg' },
  { file: 'wtage', name: 'weightForAge', index: 'Agemos', unit: 'kg' },
  { file: 'statage', name: 'statureForAge', index: 'Agemos', unit: 'cm' },
  { file: 'bmiagerev', name: 'bmiForAge', index: 'Agemos', unit: 'kg/m2' },
];

/** The percentile a `Pnn` column names, as a proportion. */
function proportionOf(column) {
  return Number(column.slice(1)) / 100;
}

/**
 * The inverse normal CDF, Acklam's rational approximation.
 *
 * Accurate to about 1.15e-9 across the range, which is far tighter than the
 * five significant figures the CDC publishes its percentile columns to - so a
 * mismatch in the verification below is a data error rather than an artefact of
 * this function.
 */
function probit(p) {
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;

  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > 1 - low) return -probit(1 - p);

  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/** The measurement at a given z, from the LMS parameters. See lms.ts. */
function valueAt(l, m, s, z) {
  return l === 0 ? m * Math.exp(s * z) : m * Math.pow(1 + l * s * z, 1 / l);
}

async function fetchCsv(file) {
  const url = `${BASE}/${file}.csv`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${String(response.status)}`);

  const text = await response.text();
  const sha256 = createHash('sha256').update(text).digest('hex');
  return { url, text, sha256 };
}

function parse(text) {
  // A byte-order mark appears on at least one of these files, and a header read
  // with one attached matches nothing.
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const [header, ...lines] = clean.trim().split(/\r?\n/);
  const columns = header.split(',');

  return lines
    .filter((line) => line.trim() !== '')
    .map((line) =>
      Object.fromEntries(line.split(',').map((value, index) => [columns[index], value]))
    );
}

/**
 * Recomputes every published percentile from the L, M and S about to be written.
 *
 * The CDC publishes to five significant figures, so the tolerance is relative
 * and generous enough for that rounding and nothing else. A row that fails is
 * reported with the column and both values rather than as a count, because the
 * only useful next step is looking at that row.
 */
function verify(rows, file) {
  const percentileColumns = Object.keys(rows[0]).filter((column) => /^P\d+$/.test(column));
  const failures = [];

  for (const row of rows) {
    const l = Number(row.L);
    const m = Number(row.M);
    const s = Number(row.S);

    for (const column of percentileColumns) {
      const published = Number(row[column]);
      const computed = valueAt(l, m, s, probit(proportionOf(column)));
      const drift = Math.abs(computed - published) / published;

      if (drift > 1e-4) {
        failures.push(
          `${file} sex=${row.Sex} ${column}: published ${row[column]}, computed ${computed.toFixed(6)}`
        );
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `The LMS parameters do not reproduce the published percentiles, so one of them was read wrong:\n  ${failures.slice(0, 10).join('\n  ')}`
    );
  }
  return percentileColumns.length * rows.length;
}

function render(table, rows, source) {
  const byIndex = (sex) =>
    rows
      .filter((row) => row.Sex === sex)
      .map(
        (row) =>
          `  [${Number(row[table.index])}, ${Number(row.L)}, ${Number(row.M)}, ${Number(row.S)}],`
      )
      .join('\n');

  return `/**
 * GENERATED. Do not edit.
 *
 * ${table.name}, from the CDC growth charts.
 *
 * Source:   ${source.url}
 * SHA-256:  ${source.sha256}
 * Rebuild:  pnpm --filter @openrunic/growth run reference:build
 *
 * Each row is [${table.index === 'Length' ? 'length in cm' : 'age in months'}, L, M, S]. The
 * generator recomputed every percentile the CDC publishes beside these
 * parameters and refused to write the table until they matched, so a
 * transcription error cannot have reached this file.
 */

import type { LmsTable } from '../lms.js';

export const ${table.name}: LmsTable = {
  measure: '${table.name}',
  unit: '${table.unit}',
  index: '${table.index === 'Length' ? 'length' : 'age'}',
  source: '${source.url}',
  male: [
${byIndex('1')}
  ],
  female: [
${byIndex('2')}
  ],
};
`;
}

async function main() {
  const names = [];

  for (const table of TABLES) {
    const source = await fetchCsv(table.file);
    const rows = parse(source.text);
    const checked = verify(rows, table.file);

    await writeFile(join(OUT, `${table.name}.ts`), render(table, rows, source), 'utf8');
    names.push(table.name);
    console.log(
      `${table.name}: ${String(rows.length)} rows, ${String(checked)} published percentiles reproduced`
    );
  }

  const index = `/**
 * GENERATED. Do not edit.
 *
 * Every reference table, and the map the lookup walks.
 *
 * Rebuild: pnpm --filter @openrunic/growth run reference:build
 */

${names.map((name) => `import { ${name} } from './${name}.js';`).join('\n')}

import type { LmsTable } from '../lms.js';

export const REFERENCE_TABLES: Readonly<Record<string, LmsTable>> = {
${names.map((name) => `  ${name},`).join('\n')}
};
`;

  await writeFile(join(OUT, 'index.ts'), index, 'utf8');
  console.log(`wrote ${String(names.length)} tables`);
}

await main();
