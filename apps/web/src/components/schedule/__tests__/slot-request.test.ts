import { appCatalogue, createTranslator } from '@openrunic/i18n';
import { describe, expect, it } from 'vitest';

import { parseSlotRequest, slotRequestVocabulary } from '@/components/schedule';

/**
 * The reader of a slot request, against the real catalogue words in both
 * languages. What is asserted is what lands in the fields, and what is left as a
 * question rather than guessed.
 */

const TODAY = '2026-08-12';
const TOMORROW = '2026-08-13';
const PROVIDERS = [
  { id: 'okafor', name: 'Ada Okafor, MD' },
  { id: 'lindqvist', name: 'Ingrid Lindqvist, NP' },
  { id: 'okafor-b', name: 'Bayo Okafor, PA' },
];
const TWO = PROVIDERS.slice(0, 2);

const en = slotRequestVocabulary(createTranslator(appCatalogue, 'en'));
const es = slotRequestVocabulary(createTranslator(appCatalogue, 'es'));

function read(said: string, providers = TWO, vocabulary = en) {
  return parseSlotRequest(said, TODAY, providers, vocabulary);
}

describe('parseSlotRequest', () => {
  it('reads a whole request into the fields', () => {
    expect(read('Tomorrow afternoon with Okafor, 45 minutes')).toEqual({
      day: TOMORROW,
      notBefore: 12 * 60,
      notAfter: null,
      durationMinutes: 45,
      providerId: 'okafor',
      questions: [],
    });
  });

  it('leaves every field unsaid when nothing in the words names it', () => {
    expect(read('a follow-up please')).toEqual({
      day: null,
      notBefore: undefined,
      notAfter: undefined,
      durationMinutes: null,
      providerId: null,
      questions: [],
    });
  });

  it('reads today, and a morning as a noon ceiling with no floor', () => {
    const request = read('today, morning');
    expect(request.day).toBe(TODAY);
    expect(request.notBefore).toBeNull();
    expect(request.notAfter).toBe(12 * 60);
  });

  it('reads lengths in minutes, hours and phrases, inside the bookable bounds', () => {
    expect(read('20 mins').durationMinutes).toBe(20);
    expect(read('2 hours').durationMinutes).toBe(120);
    expect(read('half an hour').durationMinutes).toBe(30);
    expect(read('an hour').durationMinutes).toBe(60);
    expect(read('3 minutes').durationMinutes).toBeNull();
    expect(read('500 minutes').durationMinutes).toBeNull();
  });

  it('prefers a number of minutes over a phrase in the same sentence', () => {
    expect(read('45 minutes, not an hour').durationMinutes).toBe(45);
    expect(read('20 minutes, not half an hour').durationMinutes).toBe(20);
    expect(read('1 hour, not half an hour').durationMinutes).toBe(60);
    expect(read('90 minutes, not 2 hours').durationMinutes).toBe(90);
  });

  it('reads an explicit am or pm, and 24-hour time, without asking', () => {
    const request = read('after 2 p.m. and before 16:30');
    expect(request.notBefore).toBe(14 * 60);
    expect(request.notAfter).toBe(16 * 60 + 30);
    expect(request.questions).toEqual([]);
    expect(read('after 12 am').notBefore).toBe(0);
    expect(read('before 9 am').notAfter).toBe(9 * 60);
  });

  it('gives a bare hour its clinic-hours reading and asks about it', () => {
    const request = read('after 2 before 11');
    expect(request.notBefore).toBe(14 * 60);
    expect(request.notAfter).toBe(11 * 60);
    expect(request.questions).toEqual([
      { field: 'notBefore', kind: 'meridiem', hour: 2 },
      { field: 'notAfter', kind: 'meridiem', hour: 11 },
    ]);
  });

  it('refuses a time that is not a time', () => {
    expect(read('after 25').notBefore).toBeUndefined();
    expect(read('after 10:75').notBefore).toBeUndefined();
    expect(read('after 13 pm').notBefore).toBeUndefined();
  });

  it('asks which clinician when a name matches two, and picks neither', () => {
    const request = read('with Okafor', PROVIDERS);
    expect(request.providerId).toBeNull();
    expect(request.questions).toEqual([
      { field: 'providerId', kind: 'ambiguous', candidates: ['okafor', 'okafor-b'] },
    ]);
  });

  it('picks the clinician more of whose name was said', () => {
    const request = read('with Bayo Okafor', PROVIDERS);
    expect(request.providerId).toBe('okafor-b');
    expect(request.questions).toEqual([]);
  });

  it('ignores name parts too short to mean anyone', () => {
    const request = parseSlotRequest('with MD', TODAY, [{ id: 'x', name: 'Al Md' }], en);
    expect(request.providerId).toBeNull();
  });

  it('matches a name the recogniser wrote without its accent', () => {
    const request = parseSlotRequest('con nunez', TODAY, [{ id: 'n', name: 'Rosa Núñez' }], es);
    expect(request.providerId).toBe('n');
  });

  it('reads Spanish, and does not take "por la mañana" for tomorrow', () => {
    expect(read('por la mañana', TWO, es)).toMatchObject({ day: null, notAfter: 12 * 60 });
    expect(read('mañana por la mañana', TWO, es)).toMatchObject({ day: TOMORROW });
    expect(read('mañana por la tarde con Lindqvist, media hora', TWO, es)).toEqual({
      day: TOMORROW,
      notBefore: 12 * 60,
      notAfter: null,
      durationMinutes: 30,
      providerId: 'lindqvist',
      questions: [],
    });
    expect(read('antes de las 16', TWO, es).notAfter).toBe(16 * 60);
  });

  it('reads nothing from an empty word list', () => {
    const empty = { ...en, minutes: [], hours: [], after: [], before: [], morning: [] };
    const request = read('after 14 morning 30 minutes 2 hours', TWO, empty);
    expect(request.durationMinutes).toBeNull();
    expect(request.notBefore).toBeUndefined();
    expect(request.notAfter).toBeUndefined();
  });
});
