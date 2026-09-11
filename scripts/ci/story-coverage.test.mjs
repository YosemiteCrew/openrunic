#!/usr/bin/env node
// Unit tests for the new-component-needs-a-story gate.
//
// Run with `node --test scripts/ci/story-coverage.test.mjs`, or as part of
// `pnpm run check:ci-scripts:test`.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { looksLikeComponent, storyPathFor, evaluate, parseArgs } from './story-coverage.mjs';

// The library's actual convention: a plain named `export function`, not a
// default export. See Alert.tsx, Button.tsx, Modal.tsx, Select.tsx, Toast.tsx,
// IconButton.tsx - all match this shape.
const REAL_COMPONENT = `
import type { HTMLAttributes } from 'react';

export interface BadgeProps extends HTMLAttributes<HTMLElement> {
  tone: 'info' | 'success';
}

export function Badge({ tone, ...rest }: BadgeProps) {
  return (
    <span className={\`badge badge-\${tone}\`} {...rest}>
      {rest.children}
    </span>
  );
}
`;

const ARROW_COMPONENT = `
export const Spinner = ({ size }: { size: number }) => {
  return (
    <svg width={size} height={size}>
      <circle cx="8" cy="8" r="6" />
    </svg>
  );
};
`;

const HOOK_FILE = `
import { useState } from 'react';

export function useDisclosure(initial: boolean) {
  const [open, setOpen] = useState(initial);
  return { open, setOpen };
}
`;

const BARREL_FILE = `
export { Alert } from './Alert';
export type { AlertProps, AlertTone } from './Alert';
`;

// Long enough to clear the trivial-size floor on its own, so this fixture
// exercises the // no-story marker specifically, not the size check.
const OPTED_OUT_COMPONENT = `
// no-story: pure presentational wrapper exercised only inside Badge's own story
export function BadgeDot({ tone }: { tone: string }) {
  const className = tone === 'warning' ? 'dot dot-warning' : 'dot';
  return (
    <span className={className}>
      dot
    </span>
  );
}
`;

// Deliberately has a real closing tag (unlike a self-closing <div />), so this
// fixture exercises the trivial-size floor itself, not the JSX-detection check.
const TRIVIAL_COMPONENT = `
export function Spacer() {
  return <div className="spacer"></div>;
}
`;

describe('looksLikeComponent', () => {
  it("recognises a named-exported function component - this library's own convention", () => {
    assert.equal(looksLikeComponent(REAL_COMPONENT), true);
  });

  it('recognises a named-exported arrow-function component', () => {
    assert.equal(looksLikeComponent(ARROW_COMPONENT), true);
  });

  it('rejects a hook with no JSX', () => {
    assert.equal(looksLikeComponent(HOOK_FILE), false);
  });

  it('rejects a barrel re-export file', () => {
    assert.equal(looksLikeComponent(BARREL_FILE), false);
  });

  it('THE CASE THIS GATE EXISTS FOR: a real component with no export is not flagged as needing a story it cannot receive under its own name', () => {
    // A component that isn't exported can't be imported by a story either -
    // this is a different problem than "forgot the story".
    assert.equal(looksLikeComponent('function Inner() { return <div />; }'), false);
  });

  it('respects the // no-story escape hatch even on an otherwise-real component', () => {
    assert.equal(looksLikeComponent(OPTED_OUT_COMPONENT), false);
  });

  it('rejects a file below the trivial-size floor', () => {
    assert.equal(looksLikeComponent(TRIVIAL_COMPONENT), false);
  });
});

describe('storyPathFor', () => {
  it('swaps the .tsx extension for .stories.tsx', () => {
    assert.equal(
      storyPathFor('packages/ui/src/components/Badge/Badge.tsx'),
      'packages/ui/src/components/Badge/Badge.stories.tsx'
    );
  });
});

describe('parseArgs', () => {
  it('THE CASE THIS GATE EXISTS FOR: --files consumes every remaining argument, not just the first', () => {
    // Same defect class the sibling repo's equivalent gate was written to
    // avoid: a loop that doesn't stop after --files re-reads the second file
    // path as an "unknown argument" and the whole command fails.
    const args = parseArgs(['--files', 'a.tsx', 'b.tsx', 'c.tsx']);
    assert.deepEqual(args.files, ['a.tsx', 'b.tsx', 'c.tsx']);
  });

  it('parses --base and --head', () => {
    const args = parseArgs(['--base', 'sha1', '--head', 'sha2']);
    assert.equal(args.base, 'sha1');
    assert.equal(args.head, 'sha2');
  });
});

describe('evaluate', () => {
  // Real temp files rather than a mocked fs: the function under test reads
  // the filesystem directly, and faking that out would test the mock, not
  // the gate.
  const withFixture = (fn) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'story-coverage-'));
    try {
      return fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('flags a new component with no sibling story', () => {
    withFixture((dir) => {
      writeFileSync(path.join(dir, 'Badge.tsx'), REAL_COMPONENT);
      const { missing, checked } = evaluate({ files: ['Badge.tsx'], cwd: dir });
      assert.deepEqual(checked, ['Badge.tsx']);
      assert.deepEqual(missing, [{ file: 'Badge.tsx', expected: 'Badge.stories.tsx' }]);
    });
  });

  it('THE CASE THIS GATE EXISTS FOR: passes when the sibling story exists', () => {
    withFixture((dir) => {
      writeFileSync(path.join(dir, 'Badge.tsx'), REAL_COMPONENT);
      writeFileSync(path.join(dir, 'Badge.stories.tsx'), 'export default {};');
      const { missing } = evaluate({ files: ['Badge.tsx'], cwd: dir });
      assert.deepEqual(missing, []);
    });
  });

  it('excludes story files, test files and files under __tests__ from the check itself', () => {
    withFixture((dir) => {
      writeFileSync(path.join(dir, 'Badge.stories.tsx'), REAL_COMPONENT);
      writeFileSync(path.join(dir, 'Badge.test.tsx'), REAL_COMPONENT);
      const { missing, checked, skipped } = evaluate({
        files: ['Badge.stories.tsx', 'Badge.test.tsx'],
        cwd: dir,
      });
      assert.deepEqual(missing, []);
      assert.deepEqual(checked, []);
      assert.equal(skipped.length, 2);
    });
  });

  it('skips a hook file (no JSX) without demanding a story', () => {
    withFixture((dir) => {
      writeFileSync(path.join(dir, 'useDisclosure.tsx'), HOOK_FILE);
      const { missing, checked } = evaluate({ files: ['useDisclosure.tsx'], cwd: dir });
      assert.deepEqual(missing, []);
      assert.deepEqual(checked, []);
    });
  });

  it('treats a file added then deleted in the same range as nothing to check', () => {
    withFixture((dir) => {
      const { missing, skipped } = evaluate({ files: ['Gone.tsx'], cwd: dir });
      assert.deepEqual(missing, []);
      assert.deepEqual(skipped, ['Gone.tsx']);
    });
  });

  it('THE CASE THIS GATE EXISTS FOR: a path escaping cwd via ../ is skipped, not read', () => {
    // `files` comes from git diff output or a --files argument; the fixture
    // here plants a real file just outside `dir` and proves it is never
    // opened by asserting it does not surface as `checked` or `missing`.
    withFixture((dir) => {
      const parent = path.dirname(dir);
      const outside = path.join(parent, `story-coverage-escape-${path.basename(dir)}.tsx`);
      writeFileSync(outside, REAL_COMPONENT);
      try {
        const { missing, checked, skipped } = evaluate({
          files: [`../${path.basename(outside)}`],
          cwd: dir,
        });
        assert.deepEqual(checked, []);
        assert.deepEqual(missing, []);
        assert.deepEqual(skipped, [`../${path.basename(outside)}`]);
      } finally {
        rmSync(outside, { force: true });
      }
    });
  });

  it('an absolute path is skipped, not read', () => {
    withFixture((dir) => {
      // A private, randomly-named directory (mkdtempSync, same as withFixture)
      // rather than a predictable name under the shared os temp dir - a fixed
      // name there is a symlink-race target another process could pre-create.
      const outsideDir = mkdtempSync(path.join(tmpdir(), 'story-coverage-abs-'));
      const outside = path.join(outsideDir, 'Badge.tsx');
      try {
        writeFileSync(outside, REAL_COMPONENT);
        const { missing, checked, skipped } = evaluate({ files: [outside], cwd: dir });
        assert.deepEqual(checked, []);
        assert.deepEqual(missing, []);
        assert.deepEqual(skipped, [outside]);
      } finally {
        rmSync(outsideDir, { recursive: true, force: true });
      }
    });
  });
});
