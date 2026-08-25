import type { Messages } from '../../catalogue.js';

/**
 * The patient portal: their record, their visits, their bills, their messages.
 *
 * Its own area rather than a corner of `common` because it is a different
 * application with a different reader. `apps/web` writes for somebody at work;
 * this writes for somebody looking at their own record, possibly for the first
 * time, possibly after being told something.
 *
 * ## Why this one is not allowed to fall back
 *
 * `es/index.ts` records which areas are deliberately untranslated and why: a
 * wrong clinical term is more dangerous than English a reader has to work
 * through. That reasoning holds here and points the other way for the copy
 * around the clinical terms. A clinician can work through an English interface.
 * A patient reading their own record cannot be assumed to, and this is the
 * surface where being unable to read the page is being unable to read your own
 * results.
 *
 * So the frame is translated and the content is not. "Your last reading" is this
 * application's words; the analyte beside it arrives from the laboratory already
 * named, and putting a second name on a coded value is what `en/index.ts`
 * refuses.
 */
export const portal: Messages = {
  /* ------------------------------------------------------------ formatting */
  /*
   * The words the shared formatters produce.
   *
   * `lib/format.ts` pinned `en-GB` and wrote its own English, so a duration read
   * "1 hour 30 minutes" whatever the reader had chosen, and a date read
   * differently from the same appointment on the staff application. The unit
   * words are here; the numerals and the month names come from `Intl`.
   */
  'portal.duration.minutes': '{count} minutes',
  'portal.duration.minute': '{count} minute',
  'portal.duration.hours': '{count} hours',
  'portal.duration.hour': '{count} hour',
  'portal.duration.hoursAndMinutes': '{hours} {minutes}',

  /*
   * "3 September 2026 at 09:30". One message rather than a date, the word "at"
   * and a time: where the time sits relative to the date is a language decision
   * and the joiner is not the same word in every language.
   */
  'portal.dateTime': '{date} at {time}',

  /* "2 of 3 answered". A whole sentence, because the count, the total and the
     verb do not go in that order everywhere. */
  'portal.progress': '{done} of {total} answered',

  /* The full stop is inside the message. `pluralise` put the count and the noun
     together and the screen wrote the full stop after it, which is a sentence
     assembled from two places. */
  'portal.home.unread.one': '{count} message you have not read.',
  'portal.home.unread.other': '{count} messages you have not read.',
};
