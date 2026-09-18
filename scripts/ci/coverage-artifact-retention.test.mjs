#!/usr/bin/env node
// Holds producer artifacts to the full job re-run window.
//
// Consumer jobs deliberately download outputs from successful producer jobs
// instead of repeating their work. With one-day retention, a failed-only
// re-run worked on day one and then failed at artifact download, even though
// GitHub still allowed the job to be re-run. Keeping each producer output for
// 30 days makes its consumers independently re-runnable for the platform's
// complete re-run window.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const testWorkflow = readFileSync(
  fileURLToPath(new URL('../../.github/workflows/_test.yaml', import.meta.url)),
  'utf8'
);
const coreWorkflow = readFileSync(
  fileURLToPath(new URL('../../.github/workflows/_core.yaml', import.meta.url)),
  'utf8'
);

function step(workflow, name) {
  const marker = `      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `${name} step is missing`);
  const end = workflow.indexOf('\n      - name:', start + marker.length);
  return workflow.slice(start, end === -1 ? undefined : end);
}

describe('coverage artifact retention', () => {
  it('keeps shared package output for the complete failed-job re-run window', () => {
    assert.match(
      step(coreWorkflow, 'Upload shared package dist output'),
      /\n          retention-days: 30\n/u
    );
  });

  it('keeps shard reports for the complete failed-job re-run window', () => {
    assert.match(step(testWorkflow, 'Upload shard coverage'), /\n          retention-days: 30\n/u);
  });

  it('keeps the merged Sonar report for the complete failed-job re-run window', () => {
    assert.match(step(testWorkflow, 'Upload merged coverage'), /\n          retention-days: 30\n/u);
  });
});
