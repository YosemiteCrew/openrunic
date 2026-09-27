#!/usr/bin/env node
// The install-time Node check in `node-version.mjs`: the decision on its own,
// then the script as `preinstall` runs it.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';

import { nodeMismatch } from './node-version.mjs';

const SCRIPT = path.join(import.meta.dirname, 'node-version.mjs');

describe('nodeMismatch', () => {
  it('lets the major named in .nvmrc install, whatever its minor and patch', () => {
    assert.equal(nodeMismatch('22\n', '22.12.0'), '');
    assert.equal(nodeMismatch('22\n', '22.23.2'), '');
  });

  it('reads .nvmrc written with a leading v or a full version', () => {
    assert.equal(nodeMismatch('v22\n', '22.23.2'), '');
    assert.equal(nodeMismatch('22.12.0', '22.23.2'), '');
  });

  it('refuses a newer major and names both versions', () => {
    const reason = nodeMismatch('22\n', '24.21.0');

    assert.match(reason, /Node 22 \(see \.nvmrc\)/u);
    assert.match(reason, /this is Node v24\.21\.0/u);
  });

  it('refuses an older major', () => {
    assert.notEqual(nodeMismatch('22\n', '20.19.5'), '');
  });

  it('compares whole majors rather than prefixes', () => {
    // A prefix test would let 220 through as 22, or 2 through against 22.
    assert.notEqual(nodeMismatch('22\n', '220.0.0'), '');
    assert.notEqual(nodeMismatch('22\n', '2.0.0'), '');
  });

  it('refuses when .nvmrc does not name a major, instead of letting anything through', () => {
    assert.match(nodeMismatch('lts/*\n', '22.23.2'), /should name a Node major/u);
    assert.match(nodeMismatch('\n', '22.23.2'), /should name a Node major/u);
  });
});

describe('node-version.mjs as the preinstall script', () => {
  const running = process.versions.node;
  const major = running.split('.')[0];
  // The script reads the .nvmrc two directories above itself and nothing else,
  // so each case runs a copy of it inside a scratch tree with its own .nvmrc.
  const withNvmrc = (text) => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'node-version-')));
    const script = path.join(root, 'scripts', 'ci', 'node-version.mjs');
    mkdirSync(path.dirname(script), { recursive: true });
    copyFileSync(SCRIPT, script);
    writeFileSync(path.join(root, '.nvmrc'), text);
    return script;
  };
  const run = (script) => spawnSync(process.execPath, [script], { encoding: 'utf8' });

  it('exits 0 and prints nothing on the major .nvmrc names', () => {
    const result = run(withNvmrc(`${major}\n`));

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
  });

  it('exits 1 with the reason on any other major', () => {
    const result = run(withNvmrc(`${Number(major) + 2}\n`));

    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`this is Node v${running.replaceAll('.', '\\.')}`, 'u'));
  });

  it('reads the repository .nvmrc, and this Node matches it', () => {
    // The same call `pnpm install` makes. CI runs the Node in .nvmrc, so a
    // failure here means the two have drifted apart.
    const result = run(SCRIPT);

    assert.equal(result.status, 0, result.stderr);
  });
});
