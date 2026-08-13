import type { ModelClient } from '../model-client.js';
import { capabilityTier, type CapabilityTier, type ModelCapabilities } from '../model-profile.js';

import { CONFORMANCE_CASES, PROBE_FAMILIES, type ConformCase, type ProbeFamily } from './cases.js';

/**
 * The runner behind `agent:conform`.
 *
 * A deployer runs this against their own endpoint before go-live and learns
 * three things: whether the endpoint can run the loop at all, which capability
 * tier they are in, and exactly which fallbacks will fire. That is what turns
 * "supports any model" from a marketing line into a testable claim.
 *
 * Nothing here sends health data. The probes are invented words and small
 * integers, and they are the same on every run.
 */

export interface CaseResult {
  id: string;
  family: ProbeFamily;
  required: boolean;
  pass: boolean;
  detail: string;
  /** Set when the endpoint itself failed rather than the model answering badly. */
  error?: string;
  latencyMs: number;
}

export interface ConformReport {
  results: readonly CaseResult[];
  byFamily: Readonly<Record<ProbeFamily, { passed: number; total: number }>>;
  capabilities: ModelCapabilities;
  tier: CapabilityTier;
  /** False when a required family failed. The endpoint cannot run the loop. */
  usable: boolean;
  totalMs: number;
}

export interface RunConformanceOptions {
  cases?: readonly ConformCase[];
  now?: () => number;
  /** Reports progress as it goes, so a slow local endpoint does not look hung. */
  onCase?: (result: CaseResult) => void;
}

export async function runConformance(
  client: ModelClient,
  options: RunConformanceOptions = {}
): Promise<ConformReport> {
  const cases = options.cases ?? CONFORMANCE_CASES;
  const now = options.now ?? ((): number => Date.now());
  const startedAt = now();
  const results: CaseResult[] = [];

  for (const probe of cases) {
    const caseStart = now();
    let result: CaseResult;

    try {
      const response = await client.generate(probe.request);
      const verdict = probe.assess(response);
      result = {
        id: probe.id,
        family: probe.family,
        required: probe.required,
        pass: verdict.pass,
        detail: verdict.detail,
        latencyMs: now() - caseStart,
      };
    } catch (error) {
      result = {
        id: probe.id,
        family: probe.family,
        required: probe.required,
        pass: false,
        detail: 'The endpoint did not answer.',
        error: error instanceof Error ? error.message : 'unknown error',
        latencyMs: now() - caseStart,
      };
    }

    results.push(result);
    options.onCase?.(result);
  }

  const byFamily = tally(results);
  const capabilities = deriveCapabilities(byFamily);

  return {
    results,
    byFamily,
    capabilities,
    tier: capabilityTier(capabilities),
    usable: results.every((result) => !result.required || result.pass),
    totalMs: now() - startedAt,
  };
}

function tally(
  results: readonly CaseResult[]
): Record<ProbeFamily, { passed: number; total: number }> {
  const counts = Object.fromEntries(
    PROBE_FAMILIES.map((family) => [family, { passed: 0, total: 0 }])
  ) as Record<ProbeFamily, { passed: number; total: number }>;

  for (const result of results) {
    const entry = counts[result.family];
    entry.total += 1;
    if (result.pass) entry.passed += 1;
  }
  return counts;
}

/**
 * Turns pass rates into the profile the loop runs against.
 *
 * Every threshold is deliberately strict, because assuming a capability the
 * endpoint does not have is how a fallback silently stops firing. A family that
 * is only sometimes right counts as absent.
 */
export function deriveCapabilities(
  byFamily: Readonly<Record<ProbeFamily, { passed: number; total: number }>>
): ModelCapabilities {
  const all = (family: ProbeFamily): boolean =>
    byFamily[family].total > 0 && byFamily[family].passed === byFamily[family].total;
  const some = (family: ProbeFamily): boolean => byFamily[family].passed > 0;

  return {
    toolChoice: all('forced-call'),
    parallelToolCalls: all('parallel-calls'),
    structuredOutput: all('structured-output')
      ? 'strict'
      : some('structured-output')
        ? 'json-mode'
        : 'prompt-only',
    // Anything less than every attempt means the policy sometimes vanishes,
    // and a safety policy that sometimes vanishes is not one.
    systemPrompt: all('system-prompt') ? 'native' : 'merged',
    reasoning: false,
  };
}

/** The report a deployer reads. Plain text on purpose: it goes in a ticket. */
export function formatReport(report: ConformReport, endpoint: string): string {
  const lines: string[] = [
    `openrunic agent conformance`,
    `Endpoint: ${endpoint}`,
    '',
    `Result: ${report.usable ? 'usable' : 'NOT USABLE'}`,
    `Capability tier: ${report.tier}`,
    `Cases: ${String(report.results.filter((r) => r.pass).length)} of ${String(report.results.length)} passed in ${String(report.totalMs)}ms`,
    '',
    'By family:',
  ];

  for (const family of PROBE_FAMILIES) {
    const entry = report.byFamily[family];
    lines.push(`  ${family.padEnd(20)} ${String(entry.passed)}/${String(entry.total)}`);
  }

  lines.push('', 'What the loop will do on this endpoint:');
  lines.push(
    `  system prompt        ${report.capabilities.systemPrompt === 'native' ? 'sent natively' : 'MERGED into the first message, because it was dropped'}`
  );
  lines.push(
    `  forced tool calls    ${report.capabilities.toolChoice ? 'used' : 'not used; a text-only turn is re-prompted once'}`
  );
  lines.push(
    `  parallel tool calls  ${report.capabilities.parallelToolCalls ? 'used' : 'not used; one call per step'}`
  );
  lines.push(`  structured output    ${describeStructured(report.capabilities.structuredOutput)}`);

  const failures = report.results.filter((result) => !result.pass);
  if (failures.length > 0) {
    lines.push('', 'Failures:');
    for (const failure of failures) {
      lines.push(`  ${failure.required ? '[required] ' : ''}${failure.id}: ${failure.detail}`);
      if (failure.error !== undefined) lines.push(`      ${failure.error}`);
    }
  }

  lines.push(
    '',
    'Approval gating, tenant scoping and the audit record do not vary by endpoint.',
    'A weaker model gets fewer tools and more confirmations, never looser rules.'
  );

  return lines.join('\n');
}

function describeStructured(mode: ModelCapabilities['structuredOutput']): string {
  if (mode === 'strict') return 'constrained decoding';
  if (mode === 'json-mode') return 'schema in the prompt, one repair retry';
  return 'schema in the prompt, then fail closed to the deterministic path';
}
