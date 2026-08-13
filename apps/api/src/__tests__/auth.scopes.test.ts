import { describe, expect, it } from 'vitest';

import {
  grantedCompartment,
  grantsScope,
  parseScope,
  parseScopes,
  type ScopeAction,
  type SmartScope,
} from '../auth/scopes.js';

/** Parses a scope that is expected to be a resource scope, or fails loudly. */
function parsed(value: string): SmartScope {
  const scope = parseScope(value);
  if (scope === null) throw new Error(`expected "${value}" to parse as a resource scope`);
  return scope;
}

function actionsOf(value: string): ScopeAction[] {
  return [...parsed(value).actions].sort();
}

describe('parseScope, version 1 syntax', () => {
  it('reads compartment, resource and actions', () => {
    const scope = parsed('patient/Observation.read');

    expect(scope.compartment).toBe('patient');
    expect(scope.resource).toBe('Observation');
    expect(scope.raw).toBe('patient/Observation.read');
  });

  it('treats read as read plus search, because a search is a read of many', () => {
    expect(actionsOf('patient/Observation.read')).toEqual(['read', 'search']);
  });

  it('treats write as create, update and delete but never as a read', () => {
    expect(actionsOf('user/*.write')).toEqual(['create', 'delete', 'update']);
  });

  it('treats * as every action', () => {
    expect(actionsOf('system/Patient.*')).toEqual(['create', 'delete', 'read', 'search', 'update']);
  });

  it('keeps * as a resource wildcard rather than expanding it', () => {
    expect(parsed('user/*.write').resource).toBe('*');
  });

  it('accepts every compartment', () => {
    expect(parsed('patient/Patient.read').compartment).toBe('patient');
    expect(parsed('user/Patient.read').compartment).toBe('user');
    expect(parsed('system/Patient.read').compartment).toBe('system');
  });

  it('ignores surrounding whitespace', () => {
    expect(parsed('  user/Encounter.read  ').raw).toBe('user/Encounter.read');
  });
});

describe('parseScope, version 2 syntax', () => {
  it('reads permission letters', () => {
    expect(actionsOf('patient/Observation.rs')).toEqual(['read', 'search']);
    expect(actionsOf('user/Patient.cruds')).toEqual([
      'create',
      'delete',
      'read',
      'search',
      'update',
    ]);
  });

  it('accepts a single letter', () => {
    expect(actionsOf('system/AuditEvent.c')).toEqual(['create']);
    expect(actionsOf('system/AuditEvent.d')).toEqual(['delete']);
    expect(actionsOf('system/AuditEvent.u')).toEqual(['update']);
  });

  it('accepts letters in any order, because a set has none', () => {
    expect(actionsOf('user/Patient.sr')).toEqual(['read', 'search']);
  });

  it('parses a search-parameter filter without interpreting it', () => {
    const scope = parsed('patient/Observation.rs?category=laboratory');

    expect(scope.resource).toBe('Observation');
    expect([...scope.actions].sort()).toEqual(['read', 'search']);
  });

  it('keeps the filter verbatim in raw, so an audit record shows the scope as issued', () => {
    expect(parsed('patient/Observation.rs?category=laboratory').raw).toBe(
      'patient/Observation.rs?category=laboratory'
    );
  });

  it('is not confused by a filter value containing a slash', () => {
    const scope = parsed('patient/Observation.rs?code=http://example.invalid/loinc|1234-5');

    expect(scope.compartment).toBe('patient');
    expect(scope.resource).toBe('Observation');
  });
});

describe('parseScope, everything that is not a resource scope', () => {
  it('returns null for the standard non-resource scopes', () => {
    for (const value of ['openid', 'profile', 'fhirUser', 'offline_access', 'launch']) {
      expect(parseScope(value), value).toBeNull();
    }
  });

  it('returns null for a launch context, which names no resource', () => {
    expect(parseScope('launch/patient')).toBeNull();
    expect(parseScope('launch/encounter')).toBeNull();
  });

  it('returns null for an unknown compartment', () => {
    expect(parseScope('admin/Patient.read')).toBeNull();
    expect(parseScope('Patient/Patient.read')).toBeNull();
  });

  it('returns null for an empty or blank string', () => {
    expect(parseScope('')).toBeNull();
    expect(parseScope('   ')).toBeNull();
  });

  it('returns null when the resource type is empty', () => {
    expect(parseScope('patient/.read')).toBeNull();
  });

  it('returns null for a resource type that is not alphabetic', () => {
    expect(parseScope('patient/Observation-1.read')).toBeNull();
    expect(parseScope('patient/nested/Observation.read')).toBeNull();
  });

  it('returns null when no permission is given at all', () => {
    expect(parseScope('patient/Observation')).toBeNull();
    expect(parseScope('patient/Observation.')).toBeNull();
  });

  it('returns null for permission letters outside cruds', () => {
    expect(parseScope('patient/Observation.x')).toBeNull();
    expect(parseScope('patient/Observation.rz')).toBeNull();
    expect(parseScope('patient/Observation.READ')).toBeNull();
  });

  it('returns null for a repeated permission letter rather than deduplicating it', () => {
    expect(parseScope('patient/Observation.rr')).toBeNull();
  });

  it('returns null for a bare word with no compartment', () => {
    expect(parseScope('Observation.read')).toBeNull();
  });
});

describe('parseScopes', () => {
  it('splits a whitespace-separated scope string', () => {
    const scopes = parseScopes('openid fhirUser patient/Observation.rs user/Patient.read');

    expect(scopes.map((scope) => scope.raw)).toEqual([
      'patient/Observation.rs',
      'user/Patient.read',
    ]);
  });

  it('tolerates runs of whitespace and leading or trailing space', () => {
    expect(parseScopes('  patient/Patient.read \t user/Patient.read  ')).toHaveLength(2);
  });

  it('accepts a list of scope strings', () => {
    const scopes = parseScopes(['patient/Observation.rs', 'openid', 'system/Patient.*']);

    expect(scopes.map((scope) => scope.compartment)).toEqual(['patient', 'system']);
  });

  it('accepts any iterable, not only an array', () => {
    const scopes = parseScopes(new Set(['user/Patient.read', 'user/Patient.read']));

    expect(scopes).toHaveLength(1);
  });

  it('splits entries of a list that themselves hold several scopes', () => {
    expect(parseScopes(['patient/Patient.read user/Patient.read'])).toHaveLength(2);
  });

  it('returns an empty list for an empty string', () => {
    expect(parseScopes('')).toEqual([]);
  });

  it('drops everything it cannot understand instead of failing the whole token', () => {
    expect(parseScopes('nonsense patient/Observation.qq user/Patient.read')).toHaveLength(1);
  });
});

describe('grantsScope', () => {
  it('grants a matching resource and action', () => {
    expect(
      grantsScope(parseScopes('patient/Observation.rs'), {
        resourceType: 'Observation',
        action: 'read',
      })
    ).toBe(true);
  });

  it('refuses an action the scope does not carry', () => {
    expect(
      grantsScope(parseScopes('patient/Observation.rs'), {
        resourceType: 'Observation',
        action: 'update',
      })
    ).toBe(false);
  });

  it('refuses a resource the scope does not name', () => {
    expect(
      grantsScope(parseScopes('patient/Observation.rs'), {
        resourceType: 'Condition',
        action: 'read',
      })
    ).toBe(false);
  });

  it('matches * against any resource type', () => {
    expect(
      grantsScope(parseScopes('user/*.read'), { resourceType: 'Condition', action: 'search' })
    ).toBe(true);
  });

  it('matches resource types case-sensitively, as FHIR defines them', () => {
    expect(
      grantsScope(parseScopes('user/Patient.read'), { resourceType: 'patient', action: 'read' })
    ).toBe(false);
  });

  it('refuses everything when no scope was granted', () => {
    expect(grantsScope([], { resourceType: 'Patient', action: 'read' })).toBe(false);
  });

  it('takes the union of several scopes', () => {
    const scopes = parseScopes('patient/Observation.rs patient/Condition.c');

    expect(grantsScope(scopes, { resourceType: 'Condition', action: 'create' })).toBe(true);
    expect(grantsScope(scopes, { resourceType: 'Condition', action: 'read' })).toBe(false);
  });

  it('never lets a read scope write, or a write scope read', () => {
    expect(
      grantsScope(parseScopes('user/Patient.read'), { resourceType: 'Patient', action: 'create' })
    ).toBe(false);
    expect(
      grantsScope(parseScopes('user/Patient.write'), { resourceType: 'Patient', action: 'read' })
    ).toBe(false);
  });
});

describe('grantedCompartment', () => {
  const request = { resourceType: 'Observation', action: 'read' } as const;

  it('returns the compartment of the only scope that grants the request', () => {
    expect(grantedCompartment(parseScopes('user/Observation.rs'), request)).toBe('user');
    expect(grantedCompartment(parseScopes('system/Observation.rs'), request)).toBe('system');
  });

  it('confines a token holding both a patient and a user scope to the patient', () => {
    expect(
      grantedCompartment(parseScopes('patient/Observation.read user/Observation.read'), request)
    ).toBe('patient');
  });

  it('reaches the same answer whichever order the scopes arrive in', () => {
    expect(
      grantedCompartment(parseScopes('user/Observation.read patient/Observation.read'), request)
    ).toBe('patient');
  });

  it('prefers user over system', () => {
    expect(
      grantedCompartment(parseScopes('system/Observation.read user/Observation.read'), request)
    ).toBe('user');
  });

  it('ignores a narrower compartment that does not grant this request', () => {
    expect(
      grantedCompartment(parseScopes('patient/Condition.read user/Observation.read'), request)
    ).toBe('user');
  });

  it('returns null when nothing grants the request', () => {
    expect(grantedCompartment(parseScopes('patient/Observation.write'), request)).toBeNull();
    expect(grantedCompartment([], request)).toBeNull();
  });

  it('resolves a wildcard scope to its own compartment', () => {
    expect(grantedCompartment(parseScopes('patient/*.read'), request)).toBe('patient');
  });
});
