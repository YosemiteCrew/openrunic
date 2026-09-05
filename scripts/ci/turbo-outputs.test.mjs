// The build cache must capture everything the build produces.
//
// `prisma generate` writes the client somewhere `schema.prisma` chooses, and
// turbo only restores what `turbo.json` declares. When the two disagreed, a
// cache hit replayed the log of a successful build - "Generated Prisma Client",
// from a run in a different worktree - and left the tree without the client.
// Every fresh worktree then failed `pnpm verify` in a package nobody had
// touched, and the build log argued against the only correct reading of it.
//
// Two people hit it independently in one afternoon, which is what makes it
// worth a test rather than a fix.
//
// The check reads the SCHEMA rather than a hand-kept list, so a generator that
// moves its output takes this test red with it instead of silently leaving the
// cache behind. That is the property the fix needs and the reason the one-line
// change alone would not have been enough: nothing would have said when it
// stopped being true.

import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

/** Every `output = "..."` declared by a generator in a tracked Prisma schema. */
function declaredGeneratorOutputs() {
  const schemas = execFileSync('git', ['ls-files', '*.prisma'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

  const outputs = [];
  for (const schema of schemas) {
    const text = readFileSync(path.join(ROOT, schema), 'utf8');
    for (const block of text.matchAll(/generator\s+\w+\s*\{([^}]*)\}/g)) {
      const declared = /output\s*=\s*"([^"]+)"/.exec(block[1]);
      if (!declared) continue;
      const absolute = path.resolve(ROOT, path.dirname(schema), declared[1]);
      outputs.push({ schema, packageRelative: path.relative(packageRootFor(absolute), absolute) });
    }
  }
  return outputs;
}

/** The nearest ancestor holding a package.json - the directory turbo runs in. */
function packageRootFor(target) {
  let directory = path.dirname(target);
  while (directory.startsWith(ROOT)) {
    if (existsSync(path.join(directory, 'package.json'))) return directory;
    directory = path.dirname(directory);
  }
  throw new Error(`No package.json above ${target}`);
}

test('the build cache captures every generated output the schemas declare', () => {
  const outputs = declaredGeneratorOutputs();

  // The canary, and it is the load-bearing half. Without it a moved schema, a
  // renamed block or a regex that stops matching leaves this test passing over
  // an empty list - a rail whose success is indistinguishable from having
  // nothing to catch, which is the failure this whole file is about.
  assert.ok(
    outputs.length > 0,
    'no generator output found in any tracked .prisma schema: this test is reading nothing'
  );

  const declared = JSON.parse(readFileSync(path.join(ROOT, 'turbo.json'), 'utf8'));
  const patterns = declared.tasks.build.outputs.filter((pattern) => !pattern.startsWith('!'));

  for (const { schema, packageRelative } of outputs) {
    // Compare on a segment boundary: `dist` must not be read as covering
    // `dist-report/`, which a bare prefix test would allow.
    const covered = patterns.some((pattern) =>
      `${packageRelative}/`.startsWith(`${pattern.replace(/\/?\*+$/, '')}/`)
    );
    assert.ok(
      covered,
      `${schema} generates into ${packageRelative}, which no turbo build output covers. ` +
        'A cache hit will replay the build log without producing the files.'
    );
  }
});
