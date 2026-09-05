#!/usr/bin/env node
/*
 * Generates docs/roadmap.md from the repository.
 *
 * A roadmap maintained by hand is a roadmap that is wrong, and the failure is
 * silent: nobody notices the day a capability ships and the table still says it
 * is coming. So nothing here is written down twice. Every figure on the page is
 * counted at generation time from the file that already owns the truth:
 *
 *   capabilities   docs/emr-capabilities.md
 *   FHIR surface   apps/api/src/fhir/resources.ts (SERVED_MODULES)
 *   languages      packages/i18n/src/catalogues/<locale>/*.ts
 *   versions       package.json across the workspace
 *
 * `--check` regenerates in memory and exits non-zero if the committed file
 * differs, which is what stops the page going stale between releases.
 *
 * Deliberately offline. Pulling issue state from the API would make the page
 * unbuildable without a token and unreviewable in a pull request, and the three
 * things a reader actually wants (what runs, what is next, how complete each
 * language is) are all in the tree.
 *
 * The output is run through Prettier with the repository's own config before it
 * is written or compared. Without that, two gates disagree about the same file:
 * `format:check` reflows the committed copy, and `--check` then reports the
 * file it just formatted as out of date. Formatting here means both gates are
 * asking the same question.
 *
 * Prettier is imported inside `render` rather than at the top of the file, and
 * that is load-bearing rather than tidy. The parsers below are unit-tested in
 * the `node --test` job, which deliberately runs with no install because every
 * script it covers is dependency-free. A top-level import of prettier makes
 * merely LOADING this module require node_modules, so that job dies at import
 * before a single assertion runs. Kept here, the parsers stay importable with
 * nothing installed and only generating needs the dependency.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'docs', 'roadmap.md');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/* ------------------------------------------------------------------ */
/* Capabilities                                                       */
/* ------------------------------------------------------------------ */

/**
 * Every capability row, with the section heading it sits under.
 *
 * Rows are recognised by a bold state in the second cell rather than by
 * position, so a table with a different column count or an extra note column
 * does not silently contribute nothing. A `## Heading` above a table names the
 * area; the separator row and the header row are skipped by the same test that
 * finds the state.
 */
export function readCapabilities(markdown) {
  const rows = [];
  let section = '';
  for (const line of markdown.split('\n')) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      section = heading[1];
      continue;
    }
    if (!line.startsWith('|')) continue;
    const cells = line
      .slice(1)
      .split('|')
      .map((c) => c.trim());
    if (cells.length < 2) continue;
    const state = /^\*\*(.+?)\*\*$/.exec(cells[1] ?? '');
    if (!state) continue;
    rows.push({
      section,
      /* The name is sometimes bolded to mark a recent addition. That is a
         presentation choice in the source table and not part of the name. */
      name: (cells[0] ?? '').replace(/\*\*/g, '').trim(),
      state: state[1],
      note: (cells[2] ?? '').trim(),
    });
  }
  return rows;
}

/**
 * Which of the three columns a row belongs in.
 *
 * `Done` and its qualified forms are available. A seam is next, because the
 * interface exists and what is missing plugs into it. Everything else is later:
 * the work cannot start inside this repository at all.
 */
export function bucketFor(state) {
  if (state.startsWith('Done')) return 'now';
  if (state === 'Seam only') return 'next';
  return 'later';
}

/* ------------------------------------------------------------------ */
/* The FHIR surface                                                   */
/* ------------------------------------------------------------------ */

/**
 * The FHIR resource types served, read from each module's declared `type`.
 *
 * Deriving the name from the variable instead - stripping `Module` and
 * capitalising - is what the first version did, and it published `Allergy` for
 * a server that serves `AllergyIntolerance`. A page whose whole purpose is
 * telling people which standard resources they can call cannot be guessing at
 * their names, so the declaration is the source and a module whose type cannot
 * be found is an error rather than a silent fallback.
 */
export function readServedResources(source) {
  const block = /export const SERVED_MODULES[^=]*=\s*\[([\s\S]*?)\]/.exec(source);
  if (!block) throw new Error('SERVED_MODULES not found in apps/api/src/fhir/resources.ts');

  const declared = new Map();
  const definition =
    /const (\w+) = defineFhirResource\(\{\s*(?:\/\*[\s\S]*?\*\/\s*)?type: '([\w]+)'/g;
  for (const match of source.matchAll(definition)) declared.set(match[1], match[2]);

  return block[1]
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((name) => {
      const type = declared.get(name);
      if (type === undefined) {
        throw new Error(`${name} is in SERVED_MODULES but its resource type could not be read`);
      }
      return type;
    });
}

/* ------------------------------------------------------------------ */
/* Language coverage                                                  */
/* ------------------------------------------------------------------ */

/** The message keys declared in one catalogue file. */
function keysIn(file) {
  const found = readFileSync(file, 'utf8').match(/^\s*'([^']+)':/gm) ?? [];
  return new Set(found.map((line) => line.trim().replace(/':$/, '').replace(/^'/, '')));
}

/**
 * Per-area key counts for every locale, against the source language.
 *
 * Counted per area rather than as one total because that is the unit somebody
 * picks up: "translate the chart" is a job, "translate 745 keys" is not.
 */
export function readLanguages(cataloguesDir) {
  const locales = readdirSync(cataloguesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const source = 'en';
  const areasOf = (locale) =>
    readdirSync(join(cataloguesDir, locale))
      .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
      .map((f) => f.replace(/\.ts$/, ''));

  const areas = areasOf(source).sort();
  return {
    locales,
    source,
    areas: areas.map((area) => {
      const total = keysIn(join(cataloguesDir, source, `${area}.ts`)).size;
      const per = {};
      for (const locale of locales) {
        if (locale === source) continue;
        const file = join(cataloguesDir, locale, `${area}.ts`);
        per[locale] = existsSync(file) ? keysIn(file).size : 0;
      }
      return { area, total, per };
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Workspace                                                          */
/* ------------------------------------------------------------------ */

export function readWorkspace() {
  const out = [];
  for (const group of ['apps', 'packages']) {
    for (const name of readdirSync(join(ROOT, group)).sort()) {
      const manifest = join(ROOT, group, name, 'package.json');
      if (!existsSync(manifest)) continue;
      const json = JSON.parse(readFileSync(manifest, 'utf8'));
      out.push({ group, dir: `${group}/${name}`, name: json.name, version: json.version });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Render                                                             */
/* ------------------------------------------------------------------ */

const bar = (done, total, width = 18) => {
  if (total === 0) return '';
  const filled = Math.round((done / total) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
};

async function render() {
  const { default: prettier } = await import('prettier');
  const version = JSON.parse(read('package.json')).version;
  const capabilities = readCapabilities(read('docs/emr-capabilities.md'));
  const served = readServedResources(read('apps/api/src/fhir/resources.ts'));
  const languages = readLanguages(join(ROOT, 'packages/i18n/src/catalogues'));
  const workspace = readWorkspace();

  const now = capabilities.filter((c) => bucketFor(c.state) === 'now');
  const next = capabilities.filter((c) => bucketFor(c.state) === 'next');
  const later = capabilities.filter((c) => bucketFor(c.state) === 'later');

  const L = [];
  L.push('<!-- Generated by scripts/roadmap/build.mjs. Do not edit by hand. -->');
  L.push('<!-- Regenerate with `pnpm roadmap`; CI fails if this file is out of date. -->');
  L.push('');
  L.push('# Roadmap');
  L.push('');
  L.push(
    `Everything below is counted from this repository at version **${version}**, not maintained` +
      ' alongside it. If a capability ships, the table changes on the next commit, because the' +
      ' table is generated from the same file the capability map lives in.'
  );
  L.push('');
  L.push(
    `**${now.length} available now. ${next.length} next. ${later.length} later.**` +
      ` ${served.length} FHIR R4 resource types served at the boundary.` +
      ` ${languages.locales.length} languages.`
  );
  L.push('');

  L.push('## Available now');
  L.push('');
  L.push(`${now.length} capabilities are in the current release.`);
  L.push('');
  for (const section of [...new Set(now.map((c) => c.section))]) {
    const rows = now.filter((c) => c.section === section);
    L.push(`**${section}**`);
    L.push('');
    for (const r of rows) L.push(`- ${r.name}`);
    L.push('');
  }

  L.push('## Next');
  L.push('');
  L.push(
    'The interface is written and the implementation plugs into it. Each of these becomes' +
      ' available to a deployment the moment the content behind it is supplied, without a change' +
      ' to any screen.'
  );
  L.push('');
  L.push('| Capability | Area | Where it plugs in |');
  L.push('| --- | --- | --- |');
  for (const r of next) L.push(`| ${r.name} | ${r.section} | ${r.note || ''} |`);
  L.push('');

  L.push('## Later');
  L.push('');
  L.push(
    'These cannot be started inside this repository. Each needs an external body, and the reason' +
      ' is recorded rather than left as an empty cell.'
  );
  L.push('');
  L.push('| Capability | Area | State | Reason |');
  L.push('| --- | --- | --- | --- |');
  for (const r of later) L.push(`| ${r.name} | ${r.section} | ${r.state} | ${r.note || ''} |`);
  L.push('');

  L.push('## Standards at the boundary');
  L.push('');
  L.push(`${served.length} FHIR R4 resource types are served:`);
  L.push('');
  L.push(served.map((r) => `\`${r}\``).join(', ') + '.');
  L.push('');

  L.push('## Languages');
  L.push('');
  const others = languages.locales.filter((l) => l !== languages.source);
  const totalKeys = languages.areas.reduce((n, a) => n + a.total, 0);
  for (const locale of others) {
    const done = languages.areas.reduce((n, a) => n + (a.per[locale] ?? 0), 0);
    L.push(
      `**${locale}**: ${done} of ${totalKeys} messages ` +
        `(${Math.round((done / totalKeys) * 100)}%).`
    );
  }
  L.push('');
  L.push(`| Area | ${languages.source} | ${others.join(' | ')} | |`);
  L.push(`| --- | ---: | ${others.map(() => '---:').join(' | ')} | --- |`);
  for (const a of languages.areas) {
    const cells = others.map((l) => a.per[l] ?? 0);
    const worst = Math.min(...cells);
    L.push(`| ${a.area} | ${a.total} | ${cells.join(' | ')} | \`${bar(worst, a.total)}\` |`);
  }
  L.push('');

  L.push('## Workspace');
  L.push('');
  L.push(`${workspace.length} workspaces, all at ${version}.`);
  L.push('');
  for (const group of ['apps', 'packages']) {
    const rows = workspace.filter((w) => w.group === group);
    L.push(`**${group}/** ` + rows.map((r) => `\`${r.name}\``).join(', ') + '.');
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push(
    'The capability states, and the reason behind every one that is not available, live in' +
      ' [emr-capabilities.md](emr-capabilities.md). This page is a view over it.'
  );
  L.push('');

  const markdown = L.join('\n');
  const config = (await prettier.resolveConfig(OUT)) ?? {};
  return prettier.format(markdown, { ...config, filepath: OUT });
}

/* ------------------------------------------------------------------ */

/* Only when run, never when imported. The parsers above are unit-tested, and a
   test that imported this file would otherwise rewrite docs/roadmap.md as a
   side effect of loading it. */
const RUN_DIRECTLY = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (!RUN_DIRECTLY) {
  /* imported for its parsers */
} else if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== (await render())) {
    console.error(`${relative(ROOT, OUT)} is out of date. Run \`pnpm roadmap\` and commit it.`);
    process.exit(1);
  }
  console.log(`${relative(ROOT, OUT)} is current.`);
} else {
  writeFileSync(OUT, await render());
  console.log(`wrote ${relative(ROOT, OUT)}`);
}
