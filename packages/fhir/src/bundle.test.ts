/// <reference types="fhir" preserve="true" />

import { describe, expect, it } from 'vitest';

import { searchsetBundle } from './bundle.js';
import { operationOutcome } from './operation-outcome.js';

const PATIENT: fhir4.Patient = { resourceType: 'Patient', id: 'p1' };
const OTHER: fhir4.Patient = { resourceType: 'Patient', id: 'p2' };
const BASE = 'https://example.invalid/fhir';

/**
 * What a searchset says about the rows it could not return.
 *
 * A server that cannot project a matched row may not simply leave it out: a
 * result one entry short, with nothing saying so, is indistinguishable from a
 * result that genuinely had one fewer. R4's answer is an entry whose
 * `search.mode` is `outcome`, and this is the half of it the package owns.
 */
describe('a searchset that could not return everything it matched', () => {
  const withheld = operationOutcome([
    { severity: 'warning', code: 'incomplete', diagnostics: 'Patient/p3 could not be projected.' },
  ]);

  it('carries the outcome as an entry marked outcome, after the matches', () => {
    const bundle = searchsetBundle([PATIENT, OTHER], {
      total: 3,
      outcomes: [withheld],
      baseUrl: BASE,
    });

    expect(bundle.entry?.map((entry) => entry.search?.mode)).toEqual(['match', 'match', 'outcome']);
    expect(bundle.entry?.[2]?.resource).toBe(withheld);
  });

  it('leaves total counting matches, not entries', () => {
    /*
     * The number a client's pager reads. A row that matched and could not be
     * projected still matched, so the total is unchanged - and the outcome
     * entry is not a match, so counting it would make the total wrong in the
     * other direction. The gap between the two is the thing the outcome
     * explains.
     */
    const bundle = searchsetBundle([PATIENT, OTHER], { total: 3, outcomes: [withheld] });

    expect(bundle.total).toBe(3);
    expect(bundle.entry).toHaveLength(3);
  });

  it('gives the outcome entry no fullUrl even when the matches have one', () => {
    /* A `fullUrl` says the entry is retrievable there. A diagnostic about this
       search is not a resource on this server, and claiming it is would send a
       client after a URL that answers 404. */
    const bundle = searchsetBundle([PATIENT], { total: 2, outcomes: [withheld], baseUrl: BASE });

    expect(bundle.entry?.[0]?.fullUrl).toBe(`${BASE}/Patient/p1`);
    expect(bundle.entry?.[1]).toBeDefined();
    expect(bundle.entry?.[1]).not.toHaveProperty('fullUrl');
  });

  it('keeps an outcome with an id from claiming a URL anyway', () => {
    /*
     * The mutation this guards. `fullUrl` is derived from the resource's id, so
     * a caller that built its outcome with one would silently get a fullUrl if
     * the mode were not consulted - and it would look right.
     */
    const identified = { ...withheld, id: 'oo1' };

    const bundle = searchsetBundle([PATIENT], { total: 2, outcomes: [identified], baseUrl: BASE });

    expect(bundle.entry?.[1]).not.toHaveProperty('fullUrl');
  });

  it('is unchanged from an ordinary searchset when nothing was withheld', () => {
    /*
     * The control, and the assertion that matters most: every searchset this
     * server produces goes through this function, so the interesting question
     * is not whether the new entry appears but whether anything else moved.
     */
    const plain = searchsetBundle([PATIENT, OTHER], { total: 2, baseUrl: BASE });

    expect(searchsetBundle([PATIENT, OTHER], { total: 2, baseUrl: BASE, outcomes: [] })).toEqual(
      plain
    );
    expect(plain.entry?.every((entry) => entry.search?.mode === 'match')).toBe(true);
  });

  it('orders includes before outcomes, and marks each as itself', () => {
    const bundle = searchsetBundle([PATIENT], {
      total: 2,
      includes: [OTHER],
      outcomes: [withheld],
      baseUrl: BASE,
    });

    expect(bundle.entry?.map((entry) => entry.search?.mode)).toEqual([
      'match',
      'include',
      'outcome',
    ]);
    // An include is a real resource and keeps its fullUrl; only the outcome loses one.
    expect(bundle.entry?.[1]?.fullUrl).toBe(`${BASE}/Patient/p2`);
  });
});
