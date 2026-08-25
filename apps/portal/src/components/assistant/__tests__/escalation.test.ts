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

  it.each([
    '¿Debo dejar de tomar las pastillas?',
    '¿Debería dejar de tomar las pastillas?',
    '¿Debería tomar este medicamento?',
    '¿Qué debería hacer?',
    '¿Qué tengo que hacer?',
    '¿Tengo que venir a la consulta?',
    '¿Es normal este resultado?',
    '¿Son normales mis análisis?',
    '¿Qué significa esto?',
    '¿Qué quiere decir este número?',
    '¿Puedo dejar la amlodipina?',
    '¿Estoy bien?',
    '¿Necesito que me vean?',
    '¿Qué me pasa?',
    '¿Qué hago ahora?',
    '¿Puedes diagnosticar lo que tengo?',
  ])('sends the Spanish %j to the care team', (question) => {
    /*
     * The gap this closes. Every one of these is the Spanish form of a question
     * two blocks up, and every one of them was answered rather than handed over
     * while the patterns were English only. Nothing about the portal looked
     * wrong: the words on the screen were Spanish, and the redirect simply did
     * not fire.
     */
    expect(needsCareTeam(question)).toBe(true);
  });

  it.each([
    '¿Cuándo es mi próxima cita?',
    '¿Qué medicamentos hay en mi historia clínica?',
    '¿Cuánto debo?',
    '¿Qué tengo pendiente de pago?',
    '¿Qué diagnósticos tengo?',
    'Necesito ver mi factura',
    '¿Qué vacunas me han puesto?',
  ])('answers the Spanish %j from the record', (question) => {
    /*
     * The other half, and the reason four of the Spanish patterns are narrower
     * than their English counterparts. `debo` is also "I owe", `diagnóstico` is
     * what the health record calls a condition, and `qué tengo` is a balance
     * unless nothing follows it. A matcher that read those as requests for a
     * judgement would refuse all three of the things the intro copy tells a
     * patient this page is for.
     */
    expect(needsCareTeam(question)).toBe(false);
  });

  it.each(['¿Qué tengo que pagar?', '¿Cuándo tengo que venir a la consulta?'])(
    'accepts redirecting %j rather than risk missing a request for advice',
    (question) => {
      /*
       * These two are balances and appointments, and they are redirected. That
       * is deliberate and it is the trade the note at the top of the module
       * describes.
       *
       * An earlier version read `tengo que` as a record question whenever an
       * interrogative introduced it, which answered both of these. It also lost
       * "¿Qué tengo que hacer?", which is the plainest way there is to ask
       * somebody to decide and is introduced by the same word. The
       * interrogative does not carry the distinction; the verb after it does,
       * and enumerating verbs is how this becomes the list of things to worry
       * about that the module forbids.
       *
       * A false match sends somebody to their care team, which is never the
       * wrong place. A miss leaves a health question with the inference
       * endpoint. Narrowing traded the cheap failure for the expensive one.
       */
      expect(needsCareTeam(question)).toBe(true);
    }
  );

  it('keeps the balance question this screen invites by name', () => {
    /*
     * `debo` still needs an infinitive after it, which is a narrowing the
     * interrogative argument above does not apply to: "¿Cuánto debo?" with
     * nothing following is a balance outright, not an obligation phrased as
     * one, so there is no advice reading to lose.
     */
    expect(needsCareTeam('¿Cuánto debo?')).toBe(false);
    expect(needsCareTeam('¿Debo dejar de tomar las pastillas?')).toBe(true);
  });

  it('folds accents rather than deleting the letters under them', () => {
    /*
     * The normaliser stripped everything outside `[a-z0-9\s]`, which removed an
     * accented letter along with its mark: "años" became "a os" and "qué"
     * became "qu". No Spanish pattern could have matched even once one existed,
     * so this is the half of the fix that is easy to leave out and impossible
     * to notice.
     */
    expect(needsCareTeam('¿Qué significa?')).toBe(true);
    expect(needsCareTeam('Que significa')).toBe(true);
    expect(needsCareTeam('¿Está grave?')).toBe(true);
  });

  it('runs every language against every question, whatever the reader chose', () => {
    /*
     * There is no per-locale selection here, and that is the point. Selecting
     * the reader's patterns would put a fail-open case in a safety path: a
     * language that shipped words but no speech acts would match nothing at
     * all. A locale can only add matches.
     *
     * So an English question is caught while the reader is on a Spanish portal,
     * and a Spanish one is caught on an English portal. `needsCareTeam` takes
     * no locale at all, which is what makes that true by construction.
     */
    expect(needsCareTeam('Should I stop taking the tablets?')).toBe(true);
    expect(needsCareTeam('¿Debo dejar de tomar las pastillas?')).toBe(true);
    expect(needsCareTeam.length).toBe(1);
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
