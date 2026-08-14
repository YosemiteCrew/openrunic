import { describe, expect, it } from 'vitest';

import { agentRouteContracts } from '../agent/routes.js';
import { toHonoPath } from '../openapi/registry.js';
import { internalRouteContracts } from '../routes/index.js';

/**
 * Linearity, held as a property.
 *
 * The parameter name in `toHonoPath` used to be `[^}]+`, which cannot cross a
 * closing brace but can cross an opening one. An attempt that began at a `{`
 * and found no `}` therefore ran to the end of the input before failing, and
 * the global flag restarted that run at the next `{`: quadratic in the number
 * of unmatched braces. Measured on this branch, 200,000 of them took the old
 * form 18.3 seconds and the current one 0.22 milliseconds.
 *
 * This is the fifth regex of the family in this repository, after the trailing
 * separator strips in `packages/fhir`, `packages/x12`, `packages/agent-tools`
 * and the address parser in `apps/web`. It is worth naming as a family: each
 * one was a pattern that could retry a run from a new starting position, and
 * each was fixed by making a failed attempt stop early rather than by trying
 * to bound the input.
 *
 * The threshold is loose enough to survive a loaded CI runner and tight enough
 * that a reintroduced backtracker cannot pass.
 */
const BUDGET_MS = 1_000;
const RUN = 200_000;

function elapsed(work: () => void): number {
  const started = performance.now();
  work();
  return performance.now() - started;
}

describe('toHonoPath stays linear on unmatched braces', () => {
  it('handles a long run of opening braces', () => {
    const value = '{'.repeat(RUN);

    expect(elapsed(() => toHonoPath(value))).toBeLessThan(BUDGET_MS);
  });

  it('handles unmatched braces that follow a real path', () => {
    const value = `/bff/v0/patients/${'{'.repeat(RUN)}`;

    expect(elapsed(() => toHonoPath(value))).toBeLessThan(BUDGET_MS);
  });

  it('handles braces interleaved with name characters', () => {
    const value = '{id'.repeat(RUN);

    expect(elapsed(() => toHonoPath(value))).toBeLessThan(BUDGET_MS);
  });

  it('still converts the paths this API is written in', () => {
    // Correctness, not merely speed: the conversion is what mounts every route.
    expect(toHonoPath('/bff/v0/patients/{id}')).toBe('/bff/v0/patients/:id');
    expect(toHonoPath('/a/{x}/b/{y}')).toBe('/a/:x/b/:y');
    expect(toHonoPath('/no/params')).toBe('/no/params');
    expect(toHonoPath('/{a}{b}')).toBe('/:a:b');
  });

  /**
   * The narrower name class is also the stricter reading of the OpenAPI path
   * template, in which a parameter name cannot contain a brace. The two forms
   * therefore disagree on malformed input: `[^}]+` read `/{{id}` as a parameter
   * named `{id`, and this one reads it as a stray brace followed by `{id}`.
   * Neither output is a usable route, so the difference cannot reach a mounted
   * endpoint, but it is a real difference and this pins which one we get.
   */
  it('refuses to read a brace as part of a parameter name', () => {
    expect(toHonoPath('/{{id}')).toBe('/{:id');
    expect(toHonoPath('/{id')).toBe('/{id');
    expect(toHonoPath('/{}')).toBe('/{}');
  });

  /**
   * Equivalence where it counts. Every brace in a declared path is consumed by
   * the conversion, which can only happen when each one belongs to a
   * `{name}` whose name holds no brace - exactly the case in which the previous
   * form and this one produce the same string. So no route this API publishes
   * moved, and a future contract path that would have moved fails here.
   */
  it('leaves no brace behind in any declared contract path', () => {
    const paths = [...internalRouteContracts(), ...agentRouteContracts].map(
      (contract) => contract.path
    );

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(toHonoPath(path), path).not.toContain('{');
      expect(toHonoPath(path), path).not.toContain('}');
    }
  });
});
