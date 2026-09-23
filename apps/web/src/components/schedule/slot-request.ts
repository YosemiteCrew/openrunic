import type { Translator } from '@openrunic/i18n';

import { shiftDay } from './clock';

/**
 * A slot request, said or typed, read into constraints a person then edits.
 *
 * This is a reader of words, not a scheduler. It turns "tomorrow afternoon with
 * Okafor, forty-five minutes" into the fields the Find available panel already
 * has, and everything after that is `findOpenSlots`: the same arithmetic over the
 * same booked rows whether the fields were filled by a keyboard, a microphone or
 * a hand on each field. So typed and spoken requests cannot find different slots;
 * there is only one path from the fields to an answer.
 *
 * Anything the words leave open stays open. A name that matches two clinicians,
 * an hour with no morning or afternoon on it, a day this reader does not know how
 * to name: each comes back as a `question` next to the field it concerns, and the
 * field keeps what the person had. A wrong constraint read confidently produces a
 * slot that looks like an answer, which is the one outcome worse than none.
 *
 * The words themselves are per-language and come from the message catalogue, the
 * way the palette's synonyms do, so a Spanish desk is read in Spanish.
 */

export interface SlotRequestVocabulary {
  today: readonly string[];
  tomorrow: readonly string[];
  morning: readonly string[];
  afternoon: readonly string[];
  /** Words that follow a number of minutes. */
  minutes: readonly string[];
  /** Words that follow a number of hours. */
  hours: readonly string[];
  /** A whole phrase meaning thirty minutes. */
  halfHour: readonly string[];
  /** A whole phrase meaning sixty minutes. */
  oneHour: readonly string[];
  after: readonly string[];
  before: readonly string[];
}

export interface SlotRequestProvider {
  id: string;
  name: string;
}

export type SlotRequestQuestion =
  /** Two or more clinicians answer to the name that was said. */
  | { field: 'providerId'; kind: 'ambiguous'; candidates: readonly string[] }
  /** "after 2" with no morning or afternoon: both readings are clinic hours. */
  | { field: 'notBefore' | 'notAfter'; kind: 'meridiem'; hour: number };

export interface SlotRequest {
  /** `YYYY-MM-DD`, or null when no day was named. */
  day: string | null;
  /**
   * Minutes past midnight, clinic time. `undefined` when the words said nothing
   * about that edge; `null` when they opened it ("afternoon" has no end), so a
   * correction from morning to afternoon lifts the old noon ceiling.
   */
  notBefore: number | null | undefined;
  notAfter: number | null | undefined;
  durationMinutes: number | null;
  providerId: string | null;
  questions: SlotRequestQuestion[];
}

/** Bounds on a visit, the same the booking tool accepts. */
const MIN_DURATION = 5;
const MAX_DURATION = 240;
/** Where the working day is split for "morning" and "afternoon". */
const NOON = 12 * 60;
/** Names shorter than this match too much ("Li" is inside "clinic"). */
const MIN_NAME_PART = 3;

/**
 * Lower-cased, accents folded, punctuation to spaces, so "p.m.", "Pm" and "pm"
 * are one token and "Núñez" is found from a recogniser that dropped the tilde.
 */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}:]+/gu, ' ')
    .trim();
}

function escape(word: string): string {
  return word.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** One alternation over a word list, matched on whole words. */
function anyOf(words: readonly string[]): string {
  return words
    .map((word) => fold(word))
    .filter((word) => word !== '')
    .map(escape)
    .join('|');
}

function says(text: string, words: readonly string[]): boolean {
  const pattern = anyOf(words);
  return pattern !== '' && new RegExp(String.raw`(?:^|\s)(?:${pattern})(?=\s|$)`, 'u').test(text);
}

/**
 * The day named, read after the parts of the day are taken out: in Spanish
 * "mañana" is tomorrow and "por la mañana" is the morning, and a request for
 * this morning must not page the desk to tomorrow.
 */
function readDay(said: string, today: string, vocabulary: SlotRequestVocabulary): string | null {
  const parts = anyOf([...vocabulary.morning, ...vocabulary.afternoon]);
  const text = parts
    ? said.replaceAll(new RegExp(String.raw`(?:^|\s)(?:${parts})(?=\s|$)`, 'gu'), ' ')
    : said;
  if (says(text, vocabulary.tomorrow)) return shiftDay(today, 1);
  if (says(text, vocabulary.today)) return today;
  return null;
}

function readDuration(text: string, vocabulary: SlotRequestVocabulary): number | null {
  const minutes = anyOf(vocabulary.minutes);
  const byMinutes = minutes
    ? new RegExp(String.raw`(?:^|\s)(\d{1,3})\s*(?:${minutes})(?=\s|$)`, 'u').exec(text)
    : null;
  let value: number | null = byMinutes ? Number(byMinutes[1]) : null;

  const hours = anyOf(vocabulary.hours);
  const byHours =
    value === null && hours
      ? new RegExp(String.raw`(?:^|\s)(\d)\s*(?:${hours})(?=\s|$)`, 'u').exec(text)
      : null;
  if (byHours) value = Number(byHours[1]) * 60;

  if (value === null && says(text, vocabulary.halfHour)) value = 30;
  if (value === null && says(text, vocabulary.oneHour)) value = 60;

  return value !== null && value >= MIN_DURATION && value <= MAX_DURATION ? value : null;
}

interface ReadTime {
  minutes: number;
  /** True when the hour carried no morning/afternoon and was not 24-hour. */
  ambiguous: boolean;
  hour: number;
}

/**
 * The time after a bound word: "after 2", "before 11:30", "after 2 pm", "antes de
 * las 16". A 24-hour value or an explicit am/pm is read as written. A bare 1-11
 * is ambiguous, and is given its reading inside clinic hours (7-11 morning, 1-6
 * afternoon) so the field has something to edit, with a question beside it.
 */
function readBound(text: string, words: readonly string[]): ReadTime | null {
  const bound = anyOf(words);
  if (bound === '') return null;
  const found = new RegExp(
    String.raw`(?:^|\s)(?:${bound})\s+(?:\S+\s+){0,2}?(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm|a m|p m))?(?=\s|$)`,
    'u'
  ).exec(text);
  if (!found) return null;

  const hour = Number(found[1]);
  const minute = found[2] ? Number(found[2]) : 0;
  const meridiem = found[3]?.replaceAll(' ', '');
  if (hour > 23 || minute > 59) return null;

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    const base = hour % 12;
    return {
      minutes: (meridiem === 'pm' ? base + 12 : base) * 60 + minute,
      ambiguous: false,
      hour,
    };
  }
  if (hour === 0 || hour >= 12) return { minutes: hour * 60 + minute, ambiguous: false, hour };
  const afternoon = hour <= 6;
  return { minutes: (afternoon ? hour + 12 : hour) * 60 + minute, ambiguous: true, hour };
}

/**
 * The clinician whose name was said. Each word of a display name, three letters
 * or longer, that appears as a whole word counts once, and the clinician with the
 * most words said wins: "Bayo Okafor" is Bayo even beside an Ada Okafor. A tie
 * is a question, never a pick.
 */
function readProvider(
  text: string,
  providers: readonly SlotRequestProvider[]
): { id: string | null; question: SlotRequestQuestion | null } {
  const words = new Set(text.split(' '));
  const scored = providers.map((provider) => ({
    id: provider.id,
    score: new Set(
      fold(provider.name)
        .split(' ')
        .filter((part) => part.length >= MIN_NAME_PART && words.has(part))
    ).size,
  }));
  const best = Math.max(0, ...scored.map((entry) => entry.score));
  if (best === 0) return { id: null, question: null };
  const top = scored.filter((entry) => entry.score === best).map((entry) => entry.id);
  if (top.length === 1) return { id: top[0]!, question: null };
  return { id: null, question: { field: 'providerId', kind: 'ambiguous', candidates: top } };
}

export function parseSlotRequest(
  said: string,
  today: string,
  providers: readonly SlotRequestProvider[],
  vocabulary: SlotRequestVocabulary
): SlotRequest {
  const text = fold(said);
  const questions: SlotRequestQuestion[] = [];

  let notBefore: number | null | undefined;
  let notAfter: number | null | undefined;
  if (says(text, vocabulary.morning)) {
    notBefore = null;
    notAfter = NOON;
  }
  if (says(text, vocabulary.afternoon)) {
    notBefore = NOON;
    notAfter = null;
  }

  const after = readBound(text, vocabulary.after);
  if (after) {
    notBefore = after.minutes;
    if (after.ambiguous) questions.push({ field: 'notBefore', kind: 'meridiem', hour: after.hour });
  }
  const before = readBound(text, vocabulary.before);
  if (before) {
    notAfter = before.minutes;
    if (before.ambiguous)
      questions.push({ field: 'notAfter', kind: 'meridiem', hour: before.hour });
  }

  const provider = readProvider(text, providers);
  if (provider.question) questions.push(provider.question);

  return {
    day: readDay(text, today, vocabulary),
    notBefore,
    notAfter,
    durationMinutes: readDuration(text, vocabulary),
    providerId: provider.id,
    questions,
  };
}

/** The reader's words, from the catalogue of the language on screen. */
export function slotRequestVocabulary(t: Translator): SlotRequestVocabulary {
  return {
    today: wordList(t('schedule.findAvailable.words.today')),
    tomorrow: wordList(t('schedule.findAvailable.words.tomorrow')),
    morning: wordList(t('schedule.findAvailable.words.morning')),
    afternoon: wordList(t('schedule.findAvailable.words.afternoon')),
    minutes: wordList(t('schedule.findAvailable.words.minutes')),
    hours: wordList(t('schedule.findAvailable.words.hours')),
    halfHour: wordList(t('schedule.findAvailable.words.halfHour')),
    oneHour: wordList(t('schedule.findAvailable.words.oneHour')),
    after: wordList(t('schedule.findAvailable.words.after')),
    before: wordList(t('schedule.findAvailable.words.before')),
  };
}

/** A catalogue list ("today, this afternoon") as the words it names. */
export function wordList(list: string): string[] {
  return list
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word !== '');
}
