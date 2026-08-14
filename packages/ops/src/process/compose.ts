import { probe, run, runStreaming, type RunOptions, type RunResult } from './run.js';

/**
 * Finding Docker Compose, whichever way this machine has it.
 *
 * Compose ships two ways and both are in the field: as the `docker compose`
 * CLI plugin, and as a standalone `docker-compose` binary. A host can also have
 * the plugin directory present but the plugin itself dangling - a broken
 * symlink left behind by an uninstalled Docker Desktop makes `docker compose`
 * report "unknown command" while `docker-compose` works perfectly. That is not
 * a hypothetical; it is the configuration this code was first run on.
 *
 * So the invocation is probed rather than assumed, once, and every caller uses
 * what the probe found.
 */

export interface ComposeCommand {
  readonly command: string;
  readonly baseArgs: readonly string[];
  /** Which form was found, for the doctor report. */
  readonly kind: 'plugin' | 'standalone';
}

let cached: ComposeCommand | null = null;

export function resolveCompose(): ComposeCommand {
  if (cached !== null) return cached;

  if (probe('docker', ['compose', 'version'])) {
    cached = { command: 'docker', baseArgs: ['compose'], kind: 'plugin' };
    return cached;
  }
  if (probe('docker-compose', ['version'])) {
    cached = { command: 'docker-compose', baseArgs: [], kind: 'standalone' };
    return cached;
  }

  throw new Error(
    [
      'Docker Compose was not found.',
      '',
      'Install Docker Engine with the Compose plugin (docker compose), or the',
      'standalone docker-compose binary. On most Linux distributions:',
      '',
      '  sudo apt install docker-compose-plugin      # Debian, Ubuntu',
      '  sudo dnf install docker-compose-plugin      # Fedora, RHEL',
    ].join('\n')
  );
}

/** Resets the probe. Tests only. */
export function resetComposeCache(): void {
  cached = null;
}

function composeArgs(projectFile: string, args: readonly string[]): string[] {
  const compose = resolveCompose();
  return [...compose.baseArgs, '-f', projectFile, ...args];
}

export function compose(
  projectFile: string,
  args: readonly string[],
  options: RunOptions = {}
): RunResult {
  const resolved = resolveCompose();
  return run(resolved.command, composeArgs(projectFile, args), options);
}

export function composeStreaming(
  projectFile: string,
  args: readonly string[],
  options: RunOptions = {}
): Promise<RunResult> {
  const resolved = resolveCompose();
  return runStreaming(resolved.command, composeArgs(projectFile, args), options);
}
