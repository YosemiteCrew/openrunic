#!/usr/bin/env node
// Holds coverage artifacts to the full job re-run window.
//
// The Sonar stage deliberately downloads coverage produced by the test stage
// instead of reinstalling and rerunning a suite. With one-day retention, a
// failed-only re-run worked on day one and then failed at artifact download,
// even though GitHub still allowed the job to be re-run. The shard artifacts
// have the same dependency relationship with the coverage merge job. Keeping
// both producer outputs for 30 days makes either consumer independently
// re-runnable for the platform's complete re-run window.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const workflow = readFileSync(
  fileURLToPath(new URL('../../.github/workflows/_test.yaml', import.meta.url)),
  'utf8'
);

function step(name) {
  const marker = `      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `${name} step is missing`);
  const end = workflow.indexOf('\n      - name:', start + marker.length);
  return workflow.slice(start, end === -1 ? undefined : end);
}

describe('coverage artifact retention', () => {
  it('keeps shard reports for the complete failed-job re-run window', () => {
    assert.match(step('Upload shard coverage'), /\n          retention-days: 30\n/u);
  });

  it('keeps the merged Sonar report for the complete failed-job re-run window', () => {
    assert.match(step('Upload merged coverage'), /\n          retention-days: 30\n/u);
  });
});
