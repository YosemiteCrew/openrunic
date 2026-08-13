import { spawn, spawnSync } from 'node:child_process';

/**
 * Running external commands, with the two properties the ops drills need:
 * nothing is interpreted by a shell, and nothing sensitive reaches a log.
 *
 * Arguments are always passed as an array. There is no string form and no
 * `shell: true` anywhere in this package, so a database name or a file path can
 * never be read as shell syntax.
 */

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunOptions {
  readonly cwd?: string;
  /** Added to the child's environment. The parent's is inherited. */
  readonly env?: Readonly<Record<string, string>>;
  /** Stream the child's output to this process as it happens. */
  readonly inherit?: boolean;
  readonly timeoutMs?: number;
  /** Written to the child's stdin, then closed. */
  readonly input?: string;
}

/**
 * Connection strings and passwords arrive as arguments and environment values,
 * and both end up in error messages. Every string this module returns or throws
 * goes through here first.
 */
export function redact(text: string): string {
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s'"]*/gi, 'postgresql://<redacted>')
    .replace(/(PASSWORD|SECRET|TOKEN)=[^\s'"]*/gi, '$1=<redacted>');
}

export function run(command: string, args: readonly string[], options: RunOptions = {}): RunResult {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    stdio: options.inherit === true ? 'inherit' : 'pipe',
    timeout: options.timeoutMs,
    input: options.input,
    shell: false,
  });

  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(`${command} is not installed, or is not on PATH.`);
    }
    throw new Error(redact(result.error.message));
  }

  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Runs a command and throws with its output when it fails. */
export function runOrThrow(
  command: string,
  args: readonly string[],
  options: RunOptions = {}
): RunResult {
  const result = run(command, args, options);
  if (result.code !== 0) {
    const detail = redact(`${result.stderr}\n${result.stdout}`).trim();
    throw new Error(
      `${command} ${args.join(' ')} exited ${String(result.code)}${detail === '' ? '' : `\n${detail}`}`
    );
  }
  return result;
}

/** True when the command exists and answers successfully. */
export function probe(command: string, args: readonly string[]): boolean {
  try {
    return run(command, args).code === 0;
  } catch {
    return false;
  }
}

/**
 * Streams a long-running command, forwarding output as it is produced.
 *
 * Used for image builds and `compose up`, where a silent five-minute wait is
 * indistinguishable from a hang.
 */
export function runStreaming(
  command: string,
  args: readonly string[],
  options: RunOptions = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stdout += text;
      if (options.inherit === true) process.stdout.write(text);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderr += text;
      if (options.inherit === true) process.stderr.write(text);
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        new Error(
          error.code === 'ENOENT'
            ? `${command} is not installed, or is not on PATH.`
            : redact(error.message)
        )
      );
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
