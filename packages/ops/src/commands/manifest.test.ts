import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readManifest } from './backup.js';

/**
 * A manifest is untrusted input.
 *
 * Backups leave the machine that took them: onto another disk, onto removable
 * media, onto a replacement server during a restore. By the time `readManifest`
 * sees one it is a file from somewhere else that happens to have been written
 * by this tool last time, and the restore path turns one of its fields into a
 * filesystem path. So the parse is where the trust boundary is, and these are
 * the shapes that must not get past it.
 */

const valid = {
  formatVersion: 1,
  createdAt: '2026-08-13T12:15:00.000Z',
  archive: 'openrunic-20260813T121500Z.dump',
  archiveBytes: 4096,
  archiveSha256: 'a'.repeat(64),
  postgresVersion: '17.2',
  database: 'openrunic',
  appliedMigrations: ['20260101000000_init'],
  rowCounts: { Patient: 20 },
  totalRows: 20,
  samplePatientId: null,
  sampleChartDigests: {},
  objectStores: [],
};

describe('readManifest', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'openrunic-manifest-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  /** Writes a manifest and returns its path. */
  const write = async (body: unknown): Promise<string> => {
    const file = path.join(directory, 'backup.manifest.json');
    await writeFile(file, JSON.stringify(body), 'utf8');
    return file;
  };

  it('reads a manifest this tool wrote', async () => {
    await expect(readManifest(await write(valid))).resolves.toMatchObject({
      archive: 'openrunic-20260813T121500Z.dump',
      totalRows: 20,
    });
  });

  it('refuses an archive that climbs out of the backup directory', async () => {
    const file = await write({ ...valid, archive: '../../etc/passwd' });

    // The restore reads whatever this names. A manifest may only point at a
    // file beside itself, or a hand-edited one chooses what gets read.
    await expect(readManifest(file)).rejects.toThrow(/only name a file beside itself/);
  });

  it('refuses an absolute archive path', async () => {
    const file = await write({ ...valid, archive: '/etc/shadow' });

    await expect(readManifest(file)).rejects.toThrow(/only name a file beside itself/);
  });

  it('refuses an archive in a subdirectory', async () => {
    const file = await write({ ...valid, archive: 'nested/openrunic.dump' });

    await expect(readManifest(file)).rejects.toThrow(/only name a file beside itself/);
  });

  it('refuses a Windows-separated archive path', async () => {
    // path.basename on POSIX treats 'a\b' as one filename, so this has to be
    // rejected explicitly: manifests are routinely written on one platform and
    // read on another.
    const file = await write({ ...valid, archive: '..\\..\\secrets.dump' });

    await expect(readManifest(file)).rejects.toThrow(/only name a file beside itself/);
  });

  it('refuses an archive that is not a string', async () => {
    const file = await write({ ...valid, archive: 42 });

    // Without this the cast made path.join throw a TypeError several frames
    // away from the file that caused it.
    await expect(readManifest(file)).rejects.toThrow(/only name a file beside itself/);
  });

  it('refuses a manifest with no checksum, because its archive cannot be verified', async () => {
    const file = await write({ ...valid, archiveSha256: '' });

    await expect(readManifest(file)).rejects.toThrow(/no archive checksum/);
  });

  it('names the format it cannot read rather than guessing at the fields', async () => {
    const file = await write({ ...valid, formatVersion: 2 });

    await expect(readManifest(file)).rejects.toThrow(/format 2.*reads format 1/);
  });

  it('refuses a JSON array', async () => {
    await expect(readManifest(await write([valid]))).rejects.toThrow(/not a backup manifest/);
  });

  it('refuses JSON that is not an object at all', async () => {
    await expect(readManifest(await write('backup'))).rejects.toThrow(/not a backup manifest/);
  });
});
