import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Prisma ban, as a test rather than as a promise.
 *
 * ADR-0005: tools call the existing HTTP API with the end user's own
 * credentials, so tenant scoping, consent, policy and the hash-chained audit
 * are enforced by middleware that already exists. A tool holding a database
 * client would be a second door with different locks, and an agent with direct
 * database access is an agent that can quietly cross tenants.
 *
 * There is also an ESLint rule (`eslint.config.mjs`). Both exist on purpose:
 * lint runs where someone can pass `--no-eslintrc`, add an inline disable, or
 * simply not run it, and this suite runs in CI on every pull request. It checks
 * the **source and the built output**, because a transitive re-export would
 * appear in `dist` while no source file named the package.
 */

const PACKAGE_ROOT = new URL('..', import.meta.url).pathname;

const BANNED = ['@prisma/client', '@prisma/adapter-pg', '@openrunic/database'];

async function filesUnder(directory: string, extension: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await filesUnder(path, extension)));
    } else if (entry.name.endsWith(extension)) {
      found.push(path);
    }
  }
  return found;
}

describe('the database ban', () => {
  it('holds over every source file', async () => {
    const sources = await filesUnder(join(PACKAGE_ROOT, 'src'), '.ts');
    expect(sources.length).toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const path of sources) {
      const text = await readFile(path, 'utf8');
      // The ban is on importing, not on naming: this file, the ESLint config
      // and the ADR all mention the packages by name and must keep doing so.
      const imports = [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
        (match) => match[1] ?? ''
      );
      for (const specifier of imports) {
        if (BANNED.some((banned) => specifier === banned || specifier.startsWith(`${banned}/`))) {
          offenders.push(`${path}: ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('holds over the built output when one exists', async () => {
    const built = await filesUnder(join(PACKAGE_ROOT, 'dist'), '.js');
    const offenders: string[] = [];
    for (const path of built) {
      const text = await readFile(path, 'utf8');
      for (const banned of BANNED) {
        if (text.includes(banned)) offenders.push(`${path}: ${banned}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('holds over the declared dependencies', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8')
    );
    const record = manifest as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    const declared = [
      ...Object.keys(record.dependencies ?? {}),
      ...Object.keys(record.devDependencies ?? {}),
      ...Object.keys(record.peerDependencies ?? {}),
    ];

    for (const banned of BANNED) {
      expect(declared).not.toContain(banned);
    }
  });
});
