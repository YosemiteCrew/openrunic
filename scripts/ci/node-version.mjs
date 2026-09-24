#!/usr/bin/env node
// The `preinstall` script: an install runs on the Node major named in `.nvmrc`
// and on no other.
//
// `engines.node` carries only the floor. A lockfile-only update resolves
// versions without running any package code, so it can run on a newer Node, but
// an install builds and tests the tree, and that has to happen on the Node CI
// uses. Lockfile-only commands skip lifecycle scripts, so this check reaches
// every install and nothing else.

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
