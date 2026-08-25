import { appCatalogue, createTranslator } from '@openrunic/i18n';
import { describe, expect, it } from 'vitest';
import {
  citationDestination,
  citationHref,
  citationName,
  explainFailure,
  needsCareTeam,
} from '@/components/assistant';
import { ASSISTANT_UNEXPECTED_DRAFT, ASSISTANT_UNREACHABLE } from '@/lib/assistant';

/* These are plain modules, not components, so they take a translator the way
   every formatter here does rather than reaching for a hook. */
const t = createTranslator(appCatalogue, 'en');
const es = createTranslator(appCatalogue, 'es');

/**
 * Which questions this surface declines to carry, where a citation goes, and
 * how a failure reads.
 */

describe('questions that are for a person', () => {
  it.each([
    'Should I stop taking the tablets?',
    'should i come in',
    'Do I need to see someone about this?',
    'Is this normal?',
    'is it serious',
    'What does this mean?',
    'What do my results mean?',
    'Can I stop the medicine early?',
    'What should I do next?',
    'Can you diagnose what this is',
    'Am I ok?',
  ])('sends %j to the care team', (question) => {
    expect(needsCareTeam(question)).toBe(true);
  });

  it.each([
    'When is my next appointment?',
    'What medicines are on my record?',
    'How much do I still owe?',
    'Which vaccinations have I had?',
    'What did the practice write down last time?',
    // "should" inside a word is not somebody asking for a judgement.
    'What did they write about my shoulder?',
  ])('answers %j from the record', (question) => {
    expect(needsCareTeam(question)).toBe(false);
  });

  it('reads a question the same way however it is punctuated or capitalised', () => {
    expect(needsCareTeam('SHOULD I...?!')).toBe(true);
    expect(needsCareTeam('should    i')).toBe(true);
  });

  it('never decides by what the question is about, only by what it asks for', () => {
    /* Two questions naming the same thing. One asks for a record and is
       answered; one asks for a judgement and is not. Nothing here knows or
       cares that a chest is more worrying than a knee. */
    expect(needsCareTeam('What did the practice write down about my chest?')).toBe(false);
    expect(needsCareTeam('Is my chest normal?')).toBe(true);
  });
});

describe('where a citation opens', () => {
  const source = { resourceId: 'record-1', label: 'A row', untrusted: false };

  it.each([
    ['Condition', '/health-record'],
    ['Medicine', '/health-record'],
    ['Allergy', '/health-record'],
    ['Vaccination', '/health-record'],
    ['Appointment', '/appointments'],
    ['Bill', '/bills'],
  ])('opens a %s in %s', (resourceType, href) => {
    expect(citationHref({ ...source, resourceType })).toBe(href);
  });

  it('renders a type this app has no screen for as words rather than a wrong link', () => {
    expect(citationHref({ ...source, resourceType: 'DiagnosticReport' })).toBeNull();
    expect(citationName(t, { ...source, resourceType: 'DiagnosticReport' })).toBe('Record');
  });

  it('can never build a link that carries a record identifier', () => {
    /* The portal has no per-record page, so there is no route with an id in it
       and therefore no way for this module to link into anybody's chart. That
       is the property, not an accident of the current route list. */
    for (const resourceType of [
      'Condition',
      'Medicine',
      'Allergy',
      'Vaccination',
      'Appointment',
      'Bill',
    ]) {
      const href = citationHref({ ...source, resourceType, resourceId: 'someone-elses-record' });
      expect(href).not.toBeNull();
      expect(href).not.toContain('someone-elses-record');
    }
  });

  it('says where a link goes rather than making the reader guess', () => {
    expect(citationDestination(t, '/health-record')).toBe('your health record');
    expect(citationDestination(t, '/bills')).toBe('your bills');
  });

  it('names the record type and the destination in the readers language', () => {
    expect(citationName(es, { ...source, resourceType: 'Medicine' })).toBe('Medicamento');
    expect(citationDestination(es, '/bills')).toBe('sus facturas');
  });
});

describe('how a failure reads', () => {
  it('says what still works, so nobody thinks the portal is down', () => {
    expect(explainFailure(t, ASSISTANT_UNREACHABLE)).toContain('still work');
    expect(explainFailure(t, 'AGENT_UPSTREAM_UNREACHABLE')).toContain('Nothing else in the portal');
  });

  it('tells somebody to speak up when a record from outside their own arrived', () => {
    expect(explainFailure(t, 'AGENT_COMPARTMENT_VIOLATION')).toContain('tell your care team');
    expect(explainFailure(t, ASSISTANT_UNEXPECTED_DRAFT)).toContain('tell your care team');
  });

  it('says only what is certainly true for a code it does not know', () => {
    const fallback = explainFailure(t, 'SOMETHING_NEW');
    expect(fallback).toContain('Nothing in your record has changed');
    expect(fallback).not.toContain('SOMETHING_NEW');
  });

  it('reads in the readers language, including the line for a code it does not know', () => {
    /*
     * The fallback is the one sentence here that could quietly stay English:
     * every named code has a key, and a code nobody has seen yet is exactly
     * when a reader is least able to work out what happened.
     */
    expect(explainFailure(es, ASSISTANT_UNREACHABLE)).toContain('siguen funcionando');
    expect(explainFailure(es, 'SOMETHING_NEW')).toBe(
      'Eso no ha funcionado. No ha cambiado nada en su historia clínica y el resto del portal está bien.'
    );
  });
});
