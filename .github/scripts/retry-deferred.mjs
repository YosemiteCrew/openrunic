#!/usr/bin/env node
/**
 * Asks whether a deferred major upgrade works yet, by trying it.
 *
 * ## Why this exists
 *
 * `.github/dependabot.yml` holds several majors back, each with a reason and a
 * revisit condition written next to it. Those entries are the honest way to
 * carry a blocked upgrade - and they are also how a repository quietly stops
 * upgrading. The reason gets fixed upstream, nobody notices, and a note that
 * once said "revisit when eslint-plugin-react supports 10" becomes the sentence
 * that keeps ESLint on 9 for two years.
 *
 * A revisit condition nobody evaluates is not a plan. So this evaluates them,
 * the only way that means anything: install the newest version and run the
 * gates that failed.
 *
 * ## What it does NOT do
 *
 * It does not open a pull request, and it does not change the ignore list. A
 * green result here is evidence that an upgrade is worth attempting, not proof
 * that it is safe - the suite is not the whole of the truth, and someone should
 * read the changelog of a major before taking it. The output is a report.
 *
 * ## Reading the result
 *
 * `works` means the install, build, type-check and test all passed with the
 * newest version in place. That is the signal to remove the ignore entry and
 * let Dependabot offer it.
 *
 * `blocked` means something still fails, and the captured tail of the failure
 * is included so the next reader can see whether it is the SAME failure the
 * ignore entry describes or a new one. Those are different situations and the
 * report should not blur them.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

/**
 * The held majors, and the gate that has to pass for each to be adoptable.
 *
 * Kept beside the dependabot ignore list rather than derived from it, because
 * the two say different things: that file says "do not offer this", this one
 * says "here is what would have to work". Deriving one from the other would
 * lose the second half, which is the half worth automating.
 */
const DEFERRED = [
  {
    name: 'eslint',
    also: ['@eslint/js'],
    reason: 'eslint-plugin-react peers at ^9.7 and throws on ESLint 10',
    gate: ['run', 'lint'],
  },
  {
    name: 'vite',
    also: ['@vitejs/plugin-react'],
    reason: 'Rolldown, which Vite 8 uses, could not parse the TSX test files',
    gate: ['run', 'test'],
  },
  {
    name: 'jsdom',
    also: [],
    reason: 'jsdom 30 dropped the separator between adjacent children in accessible names',
    gate: ['run', 'test'],
  },
  {
    name: '@types/node',
    also: [],
    // Deliberately has no gate that can pass on its own: this one is not
    // waiting on an upstream fix, it is pinned to the runtime by policy. It is
    // listed so the report is the whole picture rather than the part that
    // happens to be automatable.
    reason: 'pinned to the Node version this project runs and CI tests',
    gate: null,
  },
  {
    name: 'typescript',
    also: [],
    reason: 'typescript-eslint peers below 7; TS 7 has no JS compiler API until 7.1',
    gate: ['run', 'type-check'],
  },
];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

/** The newest published version, or null when the registry cannot be reached. */
function latestOf(name) {
  try {
    return run('npm', ['view', name, 'version']).trim();
  } catch {
    return null;
  }
}

/** The last few lines of a failure, which is the part that says what broke. */
function tail(text, lines = 12) {
  return text.split('\n').filter(Boolean).slice(-lines).join('\n');
}

function attempt(entry) {
  const latest = latestOf(entry.name);
  if (latest === null) {
    return { ...entry, latest: null, status: 'unknown', detail: 'registry unreachable' };
  }
  if (entry.gate === null) {
    return { ...entry, latest, status: 'by-policy', detail: entry.reason };
  }

  try {
    // `--recursive`, so every workspace that declares the package moves
    // together: a major that lands in one package and not its siblings is not
    // an upgrade, it is a version skew - and skew is what made the Vite failure
    // hard to read, because the app that broke never named the dependency.
    for (const name of [entry.name, ...entry.also]) {
      run('pnpm', ['--recursive', 'update', `${name}@latest`]);
    }
    run('pnpm', ['install', '--no-frozen-lockfile']);
    run('pnpm', entry.gate);
    return { ...entry, latest, status: 'works', detail: `${entry.gate.join(' ')} passed` };
  } catch (error) {
    const output = `${String(error.stdout ?? '')}\n${String(error.stderr ?? '')}`;
    return { ...entry, latest, status: 'blocked', detail: tail(output) };
  } finally {
    // Always back to the committed state. This job reports; it does not leave
    // the tree holding an upgrade nobody decided to take.
    try {
      run('git', ['checkout', '--', '.']);
    } catch {
      /* the caller's checkout is disposable, so a failure here is not fatal */
    }
  }
}

const results = DEFERRED.map((entry) => attempt(entry));

const adoptable = results.filter((r) => r.status === 'works');
const lines = [
  '## Deferred major upgrades',
  '',
  'Each of these is held in `.github/dependabot.yml` with a reason and a revisit',
  'condition. This report evaluates those conditions by installing the newest',
  'version and running the gate that failed, so a revisit condition is something',
  'that gets answered rather than something that gets written down.',
  '',
  'A green row is evidence that an upgrade is worth attempting - not that it is',
  'safe. Read the changelog of a major before taking it.',
  '',
  '| Package | Latest | Status | Held because |',
  '| --- | --- | --- | --- |',
  ...results.map(
    (r) =>
      `| \`${r.name}\` | ${r.latest ?? '?'} | ${
        {
          works: '**adoptable**',
          blocked: 'still blocked',
          'by-policy': 'held by policy',
          unknown: 'unknown',
        }[r.status]
      } | ${r.reason} |`
  ),
  '',
];

for (const blocked of results.filter((r) => r.status === 'blocked')) {
  lines.push(
    `<details><summary><code>${blocked.name}</code> still fails</summary>`,
    '',
    'Compare this against the reason recorded in `dependabot.yml`: the same failure',
    'means the block still holds, a different one means the entry needs rewriting.',
    '',
    '```',
    blocked.detail,
    '```',
    '',
    '</details>',
    ''
  );
}

if (adoptable.length > 0) {
  lines.push(
    `**${String(adoptable.length)} upgrade${adoptable.length === 1 ? '' : 's'} now pass the gate that was blocking ${
      adoptable.length === 1 ? 'it' : 'them'
    }:** ${adoptable.map((r) => `\`${r.name}\``).join(', ')}. Remove the matching \`ignore\` entry to let Dependabot offer ${adoptable.length === 1 ? 'it' : 'them'} again.`,
    ''
  );
}

const report = lines.join('\n');
writeFileSync('deferred-report.md', report, 'utf8');
process.stdout.write(report);

// Always exit zero. A held upgrade that is still held is the expected outcome,
// not a failure, and a red monthly job trains people to ignore it. The report
// carries the finding; the exit code carries nothing.
