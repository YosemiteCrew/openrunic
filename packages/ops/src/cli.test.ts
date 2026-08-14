import { describe, expect, it } from 'vitest';

import { parseRestoreArgs } from './cli.js';

/**
 * RESTORE ARGUMENTS, AND WHY THEY GET THEIR OWN TEST.
 *
 * `restore` is the command that runs when something has already gone wrong. It
 * is typed by someone under time pressure, probably at an unfamiliar shell, and
 * it is the one command in this tool that destroys data when it is right and
 * wastes the outage when it is wrong.
 *
 * The bug these cover was invisible in review: the positional filter dropped
 * arguments beginning with `--`, and nothing else, so the VALUE of `--into`
 * stayed in the list and became the manifest path. Written the other way round
 * the identical command worked, which is what kept it hidden - the failing order
 * is the one somebody types when the database they are restoring into is the
 * thing on their mind.
 */
describe('parseRestoreArgs', () => {
  const DEFAULT_DATABASE = 'openrunic';

  it('keeps the value of --into out of the positionals', () => {
    const parsed = parseRestoreArgs(
      ['--into', 'scratch', 'backup.manifest.json'],
      DEFAULT_DATABASE
    );

    expect(parsed.into).toBe('scratch');
    // The regression: this used to be 'scratch', and the restore then went
    // looking for a backup manifest named after the target database.
    expect(parsed.manifestArgument).toBe('backup.manifest.json');
  });

  it('reads the same command written the other way round identically', () => {
    const flagFirst = parseRestoreArgs(
      ['--into', 'scratch', 'backup.manifest.json'],
      DEFAULT_DATABASE
    );
    const flagLast = parseRestoreArgs(
      ['backup.manifest.json', '--into', 'scratch'],
      DEFAULT_DATABASE
    );

    expect(flagFirst).toEqual(flagLast);
  });

  it('falls back to the configured database when --into is absent', () => {
    const parsed = parseRestoreArgs(['backup.manifest.json'], DEFAULT_DATABASE);

    expect(parsed.into).toBe(DEFAULT_DATABASE);
    expect(parsed.manifestArgument).toBe('backup.manifest.json');
  });

  it('leaves the manifest undefined so the newest backup is taken', () => {
    expect(parseRestoreArgs([], DEFAULT_DATABASE).manifestArgument).toBeUndefined();
    expect(parseRestoreArgs(['--yes'], DEFAULT_DATABASE).manifestArgument).toBeUndefined();
  });

  it('reports --yes wherever it appears', () => {
    expect(parseRestoreArgs(['--yes', 'b.json'], DEFAULT_DATABASE).confirmed).toBe(true);
    expect(parseRestoreArgs(['b.json', '--yes'], DEFAULT_DATABASE).confirmed).toBe(true);
    expect(parseRestoreArgs(['b.json'], DEFAULT_DATABASE).confirmed).toBe(false);
  });

  /**
   * `--into` with nothing after it yields an empty target rather than silently
   * adopting the live database. The caller compares `into` against the
   * configured database to decide whether to demand `--yes`, and an empty string
   * is not equal to it, so an incomplete command cannot arrive at the live
   * database by default.
   */
  it('does not fall back to the live database when --into has no value', () => {
    const parsed = parseRestoreArgs(['backup.manifest.json', '--into'], DEFAULT_DATABASE);

    expect(parsed.into).toBe('');
    expect(parsed.into).not.toBe(DEFAULT_DATABASE);
    expect(parsed.manifestArgument).toBe('backup.manifest.json');
  });
});
