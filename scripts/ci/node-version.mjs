#!/usr/bin/env node
// The root `preinstall` script: `pnpm install` on a Node major other than the
// one named in `.nvmrc` exits non-zero with the reason.
//
// It does not stop the install from starting. pnpm 10 runs the root project's
// `preinstall` only after it has resolved the tree, written the lockfile,
// linked node_modules and run the dependency build scripts it allows, so on the
// wrong major all of that has already happened when this fails. What it
// guarantees is that such an install does not finish green and that the root
// `prepare` step does not run.
//
// `engines.node` carries only the floor, which `engine-strict` enforces before
// anything is resolved. A lockfile-only update resolves versions without running
// any package code, so it can run on a newer Node; `--lockfile-only` runs no
// lifecycle scripts, and neither does `--ignore-scripts`, so both skip this check.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const NVMRC = path.join(import.meta.dirname, '..', '..', '.nvmrc');

/**
 * Why `running` (a Node version such as `22.23.2` or `v24.1.0`) may not install
 * this repository, given the text of `.nvmrc`, or '' when it may.
 */
export function nodeMismatch(nvmrc, running) {
  const wanted = /^v?(\d+)(?:\.\d+){0,2}$/u.exec(nvmrc.trim());
  if (wanted === null) {
    return `.nvmrc should name a Node major such as 22, and it reads '${nvmrc.trim()}'.`;
  }
  const major = running.replace(/^v/u, '').split('.')[0];
  if (major === wanted[1]) return '';
  return (
    `This repository is built and tested on Node ${wanted[1]} (see .nvmrc), ` +
    `and this is Node ${running.replace(/^v?/u, 'v')}. Switch with \`nvm use\` and install again.`
  );
}

function main(nvmrcPath = NVMRC) {
  const reason = nodeMismatch(readFileSync(nvmrcPath, 'utf8'), process.versions.node);
  if (reason === '') return 0;
  process.stderr.write(`${reason}\n`);
  return 1;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  process.exit(main(process.argv[2]));
}
