import { describe, expect, it } from 'vitest';

import { card } from './cards.js';
import { discoveryDocument, serviceById } from './discovery.js';
import { CdsHooksError } from './errors.js';
import type { ServiceDefinition, Source } from './protocol.js';
import { contextString, draftOrders, parseRequest, requireContextString } from './request.js';

/**
 * Half of this is about what the request parser refuses. A CDS Hooks request
 * arrives from an EMR that is not this one, and two of its fields - a FHIR
 * server URL and a bundle of chart data - are a caller telling this process
 * where to connect and what to believe.
 */

const SOURCE: Source = { label: 'openrunic', url: 'https://example.invalid/openrunic' };
const INSTANCE = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hook: 'patient-view',
    hookInstance: INSTANCE,
    context: { userId: 'Practitioner/1', patientId: 'Patient/1' },
    ...overrides,
  };
}

describe('reading a request', () => {
  it('reads the three fields the specification requires', () => {
    const request = parseRequest(body());

    expect(request.hook).toBe('patient-view');
    expect(request.hookInstance).toBe(INSTANCE);
    expect(requireContextString(request, 'patientId')).toBe('Patient/1');
  });

  /**
   * Honouring `fhirServer` is a server-side request forgery with a
   * specification behind it: the caller names a host and this process connects
   * to it. This service answers about a patient in its own database, so the
   * field is recorded and never dereferenced.
   */
  it('records the FHIR server a caller offers without ever following it', () => {
    const request = parseRequest(body({ fhirServer: 'http://169.254.169.254/latest/meta-data' }));

    expect(request.offeredFhirServer).toBe('http://169.254.169.254/latest/meta-data');
    // The parsed request carries no client, no fetch and no way to reach it: the
    // only thing this codebase can do with the value is record it.
    expect(Object.keys(request).sort()).toEqual([
      'context',
      'hook',
      'hookInstance',
      'offeredFhirServer',
      'prefetchOffered',
    ]);
  });

  /**
   * Trusting a caller's copy of the chart would let the caller decide what the
   * safety screening screens against - so prefetch is noted as offered and the
   * data itself is not carried forward at all.
   */
  it('notes that prefetch was offered and keeps none of it', () => {
    const request = parseRequest(body({ prefetch: { patient: { resourceType: 'Patient' } } }));

    expect(request.prefetchOffered).toBe(true);
    expect(Object.values(request)).not.toContainEqual({ resourceType: 'Patient' });
  });

  it('says prefetch was not offered when it was not', () => {
    expect(parseRequest(body()).prefetchOffered).toBe(false);
    expect(parseRequest(body({ prefetch: null })).prefetchOffered).toBe(false);
  });

  it('refuses a body that is not an object', () => {
    for (const value of [null, 'text', 42, undefined]) {
      expect(() => parseRequest(value), String(value)).toThrow(/must be a JSON object/);
    }
  });

  it('refuses a request with no hook', () => {
    expect(() => parseRequest(body({ hook: '' }))).toThrow(/`hook` is required/);
    expect(() => parseRequest(body({ hook: 42 }))).toThrow(/`hook` is required/);
  });

  /**
   * The hook instance is what correlates a card shown to a clinician with the
   * invocation that produced it. A service that guessed at a missing one would
   * produce logs nobody can join up after an incident.
   */
  it('refuses a hook instance that is not a UUID', () => {
    expect(() => parseRequest(body({ hookInstance: 'instance-1' }))).toThrow(/must be a UUID/);
    expect(() => parseRequest(body({ hookInstance: '' }))).toThrow(/must be a UUID/);
  });

  it('refuses a context that is missing, null or an array', () => {
    for (const value of [undefined, null, []]) {
      expect(() => parseRequest(body({ context: value })), String(value)).toThrow(/`context`/);
    }
  });

  it('refuses a context field the hook needs and names which one', () => {
    const request = parseRequest(body({ context: { userId: 'Practitioner/1' } }));

    expect(() => requireContextString(request, 'patientId')).toThrow(/context.patientId/);
    expect(() => requireContextString(request, 'patientId')).toThrow(/patient-view/);
  });

  it('reads an optional context field, or nothing', () => {
    const request = parseRequest(body({ context: { patientId: 'Patient/1', encounterId: '' } }));

    expect(contextString(request, 'patientId')).toBe('Patient/1');
    expect(contextString(request, 'encounterId')).toBeUndefined();
    expect(contextString(request, 'absent')).toBeUndefined();
  });
});

describe('draft orders', () => {
  it('reads the resources out of the bundle', () => {
    const request = parseRequest(
      body({
        hook: 'order-sign',
        context: {
          patientId: 'Patient/1',
          draftOrders: {
            resourceType: 'Bundle',
            entry: [
              { resource: { resourceType: 'MedicationRequest', id: 'a' } },
              { resource: { resourceType: 'ServiceRequest', id: 'b' } },
            ],
          },
        },
      })
    );

    expect(draftOrders(request).map((order) => order.id)).toEqual(['a', 'b']);
  });

  /**
   * A malformed bundle is the caller's defect, and refusing the invocation over
   * it would replace a safety check with an error dialog - which is a worse
   * outcome than screening the orders that could be read.
   */
  it('answers with nothing for a bundle it cannot read, rather than throwing', () => {
    for (const draftOrders_ of [undefined, null, 'text', {}, { entry: 'not a list' }]) {
      const request = parseRequest(
        body({ context: { patientId: 'Patient/1', draftOrders: draftOrders_ } })
      );

      expect(draftOrders(request), String(draftOrders_)).toEqual([]);
    }
  });

  it('skips entries that carry no resource', () => {
    const request = parseRequest(
      body({
        context: {
          patientId: 'Patient/1',
          draftOrders: {
            entry: [{ resource: { id: 'a' } }, {}, null, 'text', { resource: null }],
          },
        },
      })
    );

    expect(draftOrders(request)).toEqual([{ id: 'a' }]);
  });
});

describe('cards', () => {
  it('builds a card with only what it was given', () => {
    expect(card({ summary: 'Nothing to report', indicator: 'info', source: SOURCE })).toEqual({
      summary: 'Nothing to report',
      indicator: 'info',
      source: SOURCE,
    });
  });

  /**
   * A summary cut mid-clause by somebody else's renderer can invert its meaning,
   * so the specification's cap is enforced here and the cut is marked.
   */
  it('trims an over-long summary at a word boundary and marks the cut', () => {
    const long = `${'Penicillin allergy recorded with anaphylaxis '.repeat(5)}end`;

    const trimmed = card({ summary: long, indicator: 'warning', source: SOURCE }).summary;
    const kept = trimmed.slice(0, -1);

    expect(trimmed.length).toBeLessThanOrEqual(140);
    expect(trimmed.endsWith('…')).toBe(true);
    // The cut is at a word boundary: what was kept is a prefix of the original,
    // and the original continues with a space rather than mid-word.
    expect(long.startsWith(kept)).toBe(true);
    expect(long.charAt(kept.length)).toBe(' ');
  });

  it('leaves a summary that fits exactly as it was written', () => {
    const summary = 'x'.repeat(140);

    expect(card({ summary, indicator: 'info', source: SOURCE }).summary).toBe(summary);
  });

  it('cuts mid-word only when there is no word boundary to use', () => {
    const summary = 'x'.repeat(200);

    const trimmed = card({ summary, indicator: 'info', source: SOURCE }).summary;

    expect(trimmed).toHaveLength(140);
    expect(trimmed.endsWith('…')).toBe(true);
  });

  /**
   * The specification requires the field whenever suggestions are present, and a
   * receiving EMR that finds it missing has no defined way to render the choice
   * it is being offered.
   */
  it('refuses to build a card with suggestions and no selection behaviour', () => {
    expect(() =>
      card({
        summary: 'Consider an alternative',
        indicator: 'warning',
        source: SOURCE,
        suggestions: [{ label: 'Use cefalexin' }],
      })
    ).toThrow(/selectionBehavior/);
  });

  it('carries suggestions, links and a uuid when they are given', () => {
    const built = card({
      summary: 'Consider an alternative',
      detail: 'The recorded allergy is to penicillin.',
      indicator: 'warning',
      source: SOURCE,
      suggestions: [{ label: 'Use cefalexin' }],
      selectionBehavior: 'at-most-one',
      links: [{ label: 'Guideline', url: 'https://example.invalid/g', type: 'absolute' }],
      uuid: INSTANCE,
    });

    expect(built.selectionBehavior).toBe('at-most-one');
    expect(built.links?.[0]?.label).toBe('Guideline');
    expect(built.detail).toContain('penicillin');
    expect(built.uuid).toBe(INSTANCE);
  });
});

describe('discovery', () => {
  const services: { definition: ServiceDefinition }[] = [
    { definition: { id: 'order-sign-safety', hook: 'order-sign', description: 'b' } },
    { definition: { id: 'allergy-summary', hook: 'patient-view', description: 'a' } },
  ];

  it('sorts the services so two servers can be compared', () => {
    const document = discoveryDocument(services.map((service) => service.definition));

    expect(document.services.map((service) => service.id)).toEqual([
      'allergy-summary',
      'order-sign-safety',
    ]);
  });

  it('does not mutate the list it was given', () => {
    const definitions = services.map((service) => service.definition);

    discoveryDocument(definitions);

    expect(definitions[0]?.id).toBe('order-sign-safety');
  });

  it('finds a service by id', () => {
    expect(serviceById(services, 'allergy-summary').definition.hook).toBe('patient-view');
  });

  /**
   * 404 rather than an empty card list: those mean different things to a calling
   * EMR, and "we looked and found nothing to say" is a clinically load-bearing
   * statement to make about a service that was never consulted.
   */
  it('refuses an id it does not serve rather than answering with no cards', () => {
    expect(() => serviceById(services, 'nonsense')).toThrow(CdsHooksError);
    expect(() => serviceById(services, 'nonsense')).toThrow(/serves no CDS service/);
    expect(serviceById.bind(null, services, 'nonsense')).toThrow(/\/cds-services/);
  });

  it('carries the status a route should answer with', () => {
    expect(CdsHooksError.malformed('x').status).toBe(400);
    expect(CdsHooksError.noSuchService('x').status).toBe(404);
  });
});
