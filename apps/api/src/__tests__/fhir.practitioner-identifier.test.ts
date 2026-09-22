import { SYSTEMS, type Bundle } from '@openrunic/fhir';
import { describe, expect, it } from 'vitest';

import { COLLECTION_SPECS } from '../repositories/specs/index.js';
import type { UserIdentifierQuery } from '../repositories/specs/platform.js';
import type { ScopedRow } from '../repositories/rows.js';

import { matchesWhere } from './fake-port.js';
import { bearer, createTestApp, seed, storageColumns, testId, TOKENS } from './support.js';

/**
 * `Practitioner?identifier=`, and the thing it must not do.
 *
 * The boundary already emits both identifiers on every practitioner, so the
 * search was the missing half of a resource it was otherwise honest about: a
 * client could read an NPI off a Practitioner and then had no way to ask for
 * the practitioner holding it.
 *
 * The interesting cases are all about the system, not the value. A token that
 * names one identifier's namespace must not be answered from the other, and a
 * token naming a namespace this server does not publish must select nothing
 * rather than fall back to matching on the value alone. Both fallbacks return
 * a real practitioner who is the wrong one, and a wrong answer that looks like
 * a result is worse here than a 400.
 */

/** The same digits, held by one practitioner as an NPI and another as a DEA. */
const SHARED = '1234567893';

const NPI_HOLDER = testId(7101);
const DEA_HOLDER = testId(7102);
const NEITHER = testId(7103);

function practitioner(
  id: string,
  familyName: string,
  identifiers: { npi: string | null; dea: string | null }
): ScopedRow<'User'> {
  return {
    ...storageColumns(id),
    email: `${familyName.toLowerCase()}@example.invalid`,
    givenName: 'Testina',
    familyName,
    credential: 'MD',
    npi: identifiers.npi,
    dea: identifiers.dea,
    taxonomyCode: '207Q00000X',
    isProvider: true,
    locale: 'en-US',
    status: 'ACTIVE',
    lastLoginAt: null,
  };
}

function directory(): ReturnType<typeof createTestApp>['app'] {
  const { app, dataset } = createTestApp();
  seed(dataset, 'User', practitioner(NPI_HOLDER, 'Okafor', { npi: SHARED, dea: 'BO9876543' }));
  seed(dataset, 'User', practitioner(DEA_HOLDER, 'Mbeki', { npi: '1245319599', dea: SHARED }));
  seed(dataset, 'User', practitioner(NEITHER, 'Sorensen', { npi: null, dea: null }));
  return app;
}

async function search(
  app: ReturnType<typeof createTestApp>['app'],
  token: string
): Promise<{ status: number; ids: string[] }> {
  const res = await app.request(`/fhir/Practitioner?identifier=${encodeURIComponent(token)}`, {
    headers: bearer(TOKENS.adminA),
  });
  if (res.status !== 200) return { status: res.status, ids: [] };
  const bundle = (await res.json()) as Bundle;
  return {
    status: res.status,
    ids: (bundle.entry ?? []).map((entry) => entry.resource?.id ?? ''),
  };
}

describe('Practitioner identifier search', () => {
  it('matches a bare value against either identifier', async () => {
    /*
     * A bare token names no system, which in FHIR means the code alone. Both
     * holders carry these digits, in different namespaces, so both are legal
     * answers to a question that did not distinguish them.
     */
    const found = await search(directory(), SHARED);

    expect(found.status).toBe(200);
    expect([...found.ids].sort()).toEqual([NPI_HOLDER, DEA_HOLDER].sort());
  });

  it('matches only the NPI when the token names the NPI system', async () => {
    const found = await search(directory(), `${SYSTEMS.npi}|${SHARED}`);

    expect(found.ids).toEqual([NPI_HOLDER]);
  });

  it('matches only the DEA when the token names the DEA system', async () => {
    // The half that proves the qualified form is doing work rather than being
    // ignored: the same digits, and a different practitioner comes back.
    const found = await search(directory(), `${SYSTEMS.dea}|${SHARED}`);

    expect(found.ids).toEqual([DEA_HOLDER]);
  });

  it('selects nothing for a system this server does not publish', async () => {
    /*
     * The case worth having a test for. Matching on the value alone here would
     * answer a question about somebody's staff number with somebody else's
     * clinician, and the client has no way to tell.
     */
    const found = await search(directory(), `urn:example:staff-number|${SHARED}`);

    expect(found.status).toBe(200);
    expect(found.ids).toEqual([]);
  });

  it('selects nothing for a token that asks for no system at all', async () => {
    // `|value` means an identifier carrying no system. Every identifier this
    // server emits carries one, so nothing can answer it.
    const found = await search(directory(), `|${SHARED}`);

    expect(found.ids).toEqual([]);
  });

  it('selects nobody when no practitioner holds the value', async () => {
    const found = await search(directory(), '9999999999');

    expect(found.status).toBe(200);
    expect(found.ids).toEqual([]);
  });

  it('answers `system|` with everyone holding that identifier, and nobody holding none', async () => {
    /*
     * FHIR's `system|` form asks for any identifier in a system, whatever its
     * value. Both practitioners carry an NPI - different ones - so both answer;
     * the third carries neither and must not.
     *
     * That third row is the one a filter written as "not different from" lets
     * through, because a null column is not different from anything.
     */
    const found = await search(directory(), `${SYSTEMS.npi}|`);

    expect([...found.ids].sort()).toEqual([NPI_HOLDER, DEA_HOLDER].sort());
    expect(found.ids).not.toContain(NEITHER);
  });

  it('composes with the name search rather than replacing it', async () => {
    /*
     * Both parameters write a disjunction, and sent together they have to mean
     * both: this token matches two practitioners and the name narrows it to
     * one.
     *
     * This runs on the memory port, so it pins `matches` and not the emitted
     * `where` - which is where the two-`OR`-keys mistake would actually live.
     * `repositories.port-agreement.test.ts` is what catches that half, and it
     * does: nesting the identifier disjunction under `AND` rather than as a
     * second `OR` key is the difference between those two tests passing and
     * failing.
     */
    const res = await directory().request(`/fhir/Practitioner?identifier=${SHARED}&name=Mbeki`, {
      headers: bearer(TOKENS.adminA),
    });
    const bundle = (await res.json()) as Bundle;

    expect(res.status).toBe(200);
    expect((bundle.entry ?? []).map((entry) => entry.resource?.id)).toEqual([DEA_HOLDER]);
  });

  it('is advertised in the CapabilityStatement now that it is implemented', async () => {
    const { app } = createTestApp();
    const res = await app.request('/fhir/metadata', { headers: bearer(TOKENS.adminA) });
    const statement = (await res.json()) as {
      rest?: { resource?: { type?: string; searchParam?: { name?: string }[] }[] }[];
    };
    const practitionerEntry = statement.rest?.[0]?.resource?.find(
      (entry) => entry.type === 'Practitioner'
    );

    expect(practitionerEntry?.searchParam?.map((param) => param.name)).toContain('identifier');
  });
});

/**
 * The shapes the port-agreement table cannot state.
 *
 * That table sets every parameter at once and asserts the two ports agree on a
 * row the filter selects. It therefore cannot express "and this row must not be
 * selected", which is the whole content of the qualified and unknown-system
 * cases. These ask both halves directly, the same way the table's oracle does.
 */
describe('the two ports agree about every identifier shape', () => {
  const spec = COLLECTION_SPECS.users;
  const base = { page: 1, pageSize: 25, sort: 'familyName' as const, order: 'asc' as const };

  const row = (npi: string | null, dea: string | null): Record<string, unknown> => ({
    id: 'id-user',
    npi,
    dea,
  });

  const cases: [string, UserIdentifierQuery, Record<string, unknown>, boolean][] = [
    ['bare token, NPI holder', { value: SHARED, columns: ['npi', 'dea'] }, row(SHARED, null), true],
    ['bare token, DEA holder', { value: SHARED, columns: ['npi', 'dea'] }, row(null, SHARED), true],
    ['bare token, neither', { value: SHARED, columns: ['npi', 'dea'] }, row(null, null), false],
    ['NPI-qualified, NPI holder', { value: SHARED, columns: ['npi'] }, row(SHARED, null), true],
    ['NPI-qualified, DEA holder', { value: SHARED, columns: ['npi'] }, row(null, SHARED), false],
    ['DEA-qualified, DEA holder', { value: SHARED, columns: ['dea'] }, row(null, SHARED), true],
    ['DEA-qualified, NPI holder', { value: SHARED, columns: ['dea'] }, row(SHARED, null), false],
    ['unknown system', { value: SHARED, columns: [] }, row(SHARED, SHARED), false],
    ['any value in a system', { value: '', columns: ['npi'] }, row(SHARED, null), true],
    ['any value in a system, absent', { value: '', columns: ['npi'] }, row(null, SHARED), false],
  ];

  it.each(cases)('%s', (_label, identifier, candidate, expected) => {
    const query = { ...base, identifier };
    const where = spec.where(query);

    expect(spec.matches(candidate as never, query), 'memory').toBe(expected);
    expect(matchesWhere(candidate, where), 'Prisma').toBe(expected);
  });
});
