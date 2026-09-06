import { describe, expect, it } from 'vitest';

import { ROLE_CAPABILITIES, capabilitiesForRoles } from '@/lib/api/capabilities';

/**
 * The demonstration build's answer to `/bff/v0/me`.
 *
 * `capabilities.ts` is generated from the API's `ROLE_PERMISSIONS`, and
 * `scripts/ci/capability-parity.mjs` is what keeps the table itself honest.
 * These assertions are about the FUNCTION under it, which is hand-written in
 * the generator's footer and is the half no diff covers.
 */
describe('capabilitiesForRoles', () => {
  it('gives a clinician the permission a signature needs, and a biller not', () => {
    /* The whole of #313 in one pair. If these ever agree, the screen has
       nothing left to decide and the biller is offered Sign orders again. */
    expect(capabilitiesForRoles(['clinician'])).toContain('order.write');
    expect(capabilitiesForRoles(['biller'])).not.toContain('order.write');
  });

  it('sums roles and returns each permission once, in a stable order', () => {
    const both = capabilitiesForRoles(['clinician', 'biller']);

    expect(new Set(both).size).toBe(both.length);
    expect(both).toStrictEqual([...both].sort((a, b) => a.localeCompare(b)));
    for (const permission of [
      ...capabilitiesForRoles(['clinician']),
      ...capabilitiesForRoles(['biller']),
    ]) {
      expect(both).toContain(permission);
    }
  });

  it('contributes nothing for a role it does not know, rather than throwing', () => {
    /* A deployment that renames a role should lose access, not break the
       interface - the API's own rule. Throwing here would take the composer
       down for everyone the moment a role was added server-side. */
    expect(capabilitiesForRoles(['not-a-role'])).toStrictEqual([]);
    expect(capabilitiesForRoles(['clinician', 'not-a-role'])).toStrictEqual(
      capabilitiesForRoles(['clinician'])
    );
  });

  it('holds every role the generator emitted, so an empty answer is a real answer', () => {
    /* Guards the degenerate pass: every assertion above is satisfied by a table
       of empty arrays. `read-only` is named because it is the one whose grant
       is computed in the API, and the one a text parser dropped in silence. */
    expect(Object.keys(ROLE_CAPABILITIES)).toContain('read-only');
    for (const [role, permissions] of Object.entries(ROLE_CAPABILITIES)) {
      expect(permissions.length, `${role} holds nothing`).toBeGreaterThan(0);
    }
  });
});
