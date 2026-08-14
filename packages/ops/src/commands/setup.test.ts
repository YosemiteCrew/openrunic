import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GENERATE_SENTINEL } from '../env/secrets.js';

import { ensureEnvFile } from './setup.js';

/**
 * The one file in a self-host deployment that holds secrets.
 *
 * `.env` carries POSTGRES_PASSWORD and every generated secret, and it is created
 * by copying a template that is committed to the repository - so its permissions
 * are the template's unless something changes them. The mode is asserted rather
 * than commented, because the previous version passed `mode` to `writeFile`,
 * which only applies when the write creates the file, and .env always exists by
 * then. It read as a 0600 file and was a 0644 one.
 */

const TEMPLATE = [
  '# openrunic configuration',
  'POSTGRES_USER=openrunic',
  'POSTGRES_DB=openrunic',
  `POSTGRES_PASSWORD=${GENERATE_SENTINEL}`,
  'WEB_PORT=3000',
  '',
].join('\n');

const modeOf = async (file: string): Promise<string> =>
  ((await stat(file)).mode & 0o777).toString(8);

describe('ensureEnvFile', () => {
  let root: string;
  let envPath: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'openrunic-env-'));
    envPath = path.join(root, '.env');
    // The template is committed, so it is world-readable, which is the
    // permission .env inherits when it is copied.
    await writeFile(path.join(root, '.env.example'), TEMPLATE, 'utf8');
    await chmod(path.join(root, '.env.example'), 0o644);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('creates .env from the template and leaves it readable only by its owner', async () => {
    const result = await ensureEnvFile(root);

    expect(result.created).toBe(true);
    expect(result.generated).toEqual(['POSTGRES_PASSWORD']);
    expect(await modeOf(envPath)).toBe('600');
  });

  it('tightens the mode of an .env a previous run left world-readable', async () => {
    await writeFile(envPath, 'POSTGRES_PASSWORD=already-set\n', 'utf8');
    await chmod(envPath, 0o644);

    const result = await ensureEnvFile(root);

    // Nothing was generated this run, so a mode tied to generation would have
    // left the password world-readable.
    expect(result.generated).toEqual([]);
    expect(await modeOf(envPath)).toBe('600');
  });

  it('fills the sentinel with a secret that is not the sentinel', async () => {
    await ensureEnvFile(root);

    const contents = await readFile(envPath, 'utf8');
    const password = /^POSTGRES_PASSWORD=(.*)$/m.exec(contents)?.[1] ?? '';
    expect(password).not.toBe(GENERATE_SENTINEL);
    expect(password.length).toBeGreaterThan(20);
  });

  it('never rotates a value the deployment is already using', async () => {
    await writeFile(envPath, 'POSTGRES_PASSWORD=in-use-by-the-database\n', 'utf8');

    await ensureEnvFile(root);

    expect(await readFile(envPath, 'utf8')).toContain('POSTGRES_PASSWORD=in-use-by-the-database');
  });

  it('names the keys the template has and the file does not', async () => {
    await writeFile(envPath, 'POSTGRES_PASSWORD=in-use-by-the-database\n', 'utf8');

    const result = await ensureEnvFile(root);

    expect(result.created).toBe(false);
    expect(result.missing).toEqual(['POSTGRES_USER', 'POSTGRES_DB', 'WEB_PORT']);
  });
});
