import { loadAgentSubsystem } from '../config.js';
import { createAiSdkModelClient } from '../model-client.js';
import { buildModelProfile } from '../model-profile.js';
import { resolveProvider } from '../provider.js';

import { formatReport, runConformance } from './run.js';

/**
 * `pnpm agent:conform`.
 *
 * Reads the same environment the running product reads, so a deployer is
 * testing the endpoint they configured rather than one they typed twice. It
 * refuses to run when nothing is configured, because there is nothing to test
 * and a green result would be a lie.
 *
 * Exit codes: `0` usable, `1` not usable, `2` nothing to test or a
 * misconfiguration.
 */
export async function main(
  env: Readonly<Record<string, string | undefined>>,
  write: (line: string) => void
): Promise<number> {
  const subsystem = loadAgentSubsystem(env);

  if (subsystem.status === 'disabled') {
    write('No inference endpoint is configured, so there is nothing to test.');
    write(
      'Set OPENRUNIC_AGENT_BASE_URL and OPENRUNIC_AGENT_MODEL, then run this again before go-live.'
    );
    return 2;
  }

  if (subsystem.status === 'misconfigured') {
    write(`The agent subsystem will not start: ${subsystem.reason}`);
    return 2;
  }

  const { config } = subsystem;
  const resolved = resolveProvider(config.model);
  const profile = buildModelProfile(resolved.model, config.model);

  write(`Running conformance against ${config.model.baseUrl} (${config.model.modelId}).`);
  write(
    config.model.phiEgress === 'none'
      ? 'This endpoint is on your own network. The probes contain no patient data in any case.'
      : 'This endpoint is remote. The probes contain no patient data.'
  );
  write('');

  const report = await runConformance(createAiSdkModelClient(profile), {
    onCase: (result) => {
      write(`  ${result.pass ? 'pass' : 'FAIL'}  ${result.id} (${String(result.latencyMs)}ms)`);
    },
  });

  write('');
  write(formatReport(report, config.model.baseUrl));
  return report.usable ? 0 : 1;
}

/* c8 ignore start -- process wiring, exercised by running the command itself. */
if (process.argv[1]?.endsWith('cli.js') === true) {
  main(process.env, (line) => {
    process.stdout.write(`${line}\n`);
  })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stdout.write(
        `Conformance could not run: ${error instanceof Error ? error.message : 'unknown error'}\n`
      );
      process.exitCode = 2;
    });
}
/* c8 ignore stop */
