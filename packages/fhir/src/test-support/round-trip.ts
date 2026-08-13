/// <reference types="fhir" preserve="true" />

import { expect, it } from 'vitest';

/**
 * The round-trip harness ADR-0002 requires.
 *
 * A mapper without round-trip tests does not merge, so every mapper pair runs
 * the same three assertions per fixture:
 *
 * 1. `domain -> FHIR -> domain` is deep-equal to the input. This is the honesty
 *    mechanism: anything the mapper quietly drops shows up here immediately.
 * 2. `FHIR -> domain -> FHIR` is deep-equal to the intermediate resource, which
 *    is the write path - a resource posted to the API and read back is stable.
 * 3. The emitted JSON is FHIR-shaped: `resourceType` is set, and nothing is
 *    `null`, `undefined`, an empty string or an empty array.
 *
 * Fixtures always include a sparse case and a degenerate all-empty case,
 * because the interesting failures are in the absent fields, not the full ones.
 */

/** A mapper pair under test. */
export interface RoundTripMapper<D, R extends fhir4.FhirResource> {
  readonly resourceType: R['resourceType'];
  readonly toFhir: (domain: D) => R;
  readonly fromFhir: (resource: R) => D;
}

/** One named domain fixture. */
export interface RoundTripCase<D> {
  readonly label: string;
  readonly domain: D;
}

function collectViolations(value: unknown, path: string, found: string[]): void {
  if (value === null) {
    found.push(`${path} is null`);
    return;
  }
  if (typeof value === 'string') {
    if (value === '') {
      found.push(`${path} is an empty string`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      found.push(`${path} is an empty array`);
    }
    value.forEach((item, index) => collectViolations(item, `${path}[${index}]`, found));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (nested === undefined) {
        found.push(`${path}.${key} is undefined`);
        continue;
      }
      collectViolations(nested, `${path}.${key}`, found);
    }
  }
}

/**
 * Asserts a resource is valid FHIR JSON: the right `resourceType`, and no
 * nulls, undefined keys, empty strings or empty arrays anywhere inside it.
 */
export function expectValidFhirJson(resource: fhir4.FhirResource, resourceType: string): void {
  expect(resource.resourceType).toBe(resourceType);
  const found: string[] = [];
  collectViolations(resource, resourceType, found);
  expect(found).toStrictEqual([]);
}

/** Registers the three ADR-0002 assertions for every fixture. */
export function describeRoundTrips<D, R extends fhir4.FhirResource>(
  mapper: RoundTripMapper<D, R>,
  cases: readonly RoundTripCase<D>[]
): void {
  for (const testCase of cases) {
    it(`round-trips a ${testCase.label} ${mapper.resourceType}: domain to FHIR to domain`, () => {
      expect(mapper.fromFhir(mapper.toFhir(testCase.domain))).toStrictEqual(testCase.domain);
    });

    it(`round-trips a ${testCase.label} ${mapper.resourceType}: FHIR to domain to FHIR`, () => {
      const resource = mapper.toFhir(testCase.domain);
      expect(mapper.toFhir(mapper.fromFhir(resource))).toStrictEqual(resource);
    });

    it(`emits valid FHIR JSON for a ${testCase.label} ${mapper.resourceType}`, () => {
      expectValidFhirJson(mapper.toFhir(testCase.domain), mapper.resourceType);
    });
  }
}

/**
 * Asserts that a dropped-field manifest is honest: every name it lists really
 * is absent from the boundary type, proven against a fully populated fixture.
 */
export function expectDroppedFields(fullFixture: object, droppedFields: readonly string[]): void {
  expect(droppedFields.length).toBeGreaterThan(0);
  const keys = Object.keys(fullFixture);
  const leaked = droppedFields.filter((field) => keys.includes(field));
  expect(leaked).toStrictEqual([]);
}
