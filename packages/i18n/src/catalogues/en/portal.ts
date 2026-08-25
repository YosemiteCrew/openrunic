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

  /* ------------------------------------------------------------ the chrome */
  /*
   * The masthead, the navigation and the footer. `nav.ts` used to carry its
   * labels as plain strings on the route table; they are keys now, in the same
   * `labelKey` shape the staff application's navigation uses, so the drift test
   * can see them.
   */
  'portal.skipToContent': 'Skip to content',
  'portal.eyebrow': 'Patient portal',
  'portal.recordNumber': 'Record number {mrn}',
  'portal.navLabel': 'Portal sections',
  'portal.nav.home': 'Home',
  'portal.nav.healthRecord': 'Health record',
  'portal.nav.messages': 'Messages',
  'portal.nav.appointments': 'Appointments',
  'portal.nav.forms': 'Forms',
  'portal.nav.bills': 'Bills',
  'portal.nav.assistant': 'Assistant',
  'portal.footer.whatThisIs':
    'This portal shows the record your care team keeps. If something looks wrong, message your care team and ask for it to be checked.',
  'portal.footer.emergency':
    'For a medical emergency, call the emergency services on your local number.',

  /* -------------------------------------------------------------- the home */
  'portal.home.overline': 'Your care',
  'portal.home.title': 'Home',
  'portal.home.lede':
    'What needs your attention today. Everything else is in the sections around this page.',
  'portal.home.subject': 'your home summary',
  'portal.home.empty.title': 'Nothing needs your attention.',
  'portal.home.empty.message':
    'Your appointments, health record, messages and bills are all still here whenever you want them.',
  'portal.home.balance.overline': 'Balance',
  'portal.home.balance.title': 'What you owe',
  'portal.home.balance.nothing': 'There is nothing to pay.',
  /* Two whole sentences rather than a clause appended to one: a language that
     puts the instruction first cannot express that by translating fragments. */
  'portal.home.balance.dueUnknown':
    'Ask the practice when this is due. You can pay online, or ask the practice about paying in instalments.',
  'portal.home.balance.dueBy':
    'Due by {date}. You can pay online, or ask the practice about paying in instalments.',
  'portal.home.balance.seeBills': 'See your bills',
  'portal.home.balance.pay': 'Pay a bill',
  'portal.home.messages.overline': 'Messages',
  'portal.home.messages.title': 'From your care team',
  'portal.home.messages.open': 'Open messages',
  'portal.home.actions.overline': 'Action needed',
  'portal.home.actions.title': 'Things only you can do',
  'portal.home.actions.none': 'There is nothing waiting on you.',
  'portal.home.actions.badge': 'To do',
  'portal.home.appointment.overline': 'Next appointment',
  'portal.home.appointment.none': 'You have no appointments booked',
  'portal.home.appointment.noneMessage':
    'Ask the practice for a slot and they will confirm it by message.',
  'portal.home.appointment.request': 'Request an appointment',
  'portal.home.appointment.videoLocation': 'A video call. The link opens in this browser.',
  'portal.home.page.title': 'Home',
  'portal.home.page.description':
    'Your next appointment, your balance, your messages and anything waiting on you.',
  /*
   * TAB TITLES.
   *
   * The template is a message rather than a format string in code, because
   * where the page name sits relative to the application name is a decision
   * each language makes for itself.
   */
  'portal.app.title': 'Patient portal',
  'portal.app.titleTemplate': '{page} - patient portal',
  'portal.app.description': 'See your appointments, health record, messages, forms and bills.',
  'portal.appointments.page.title': 'Appointments',
  'portal.appointments.page.description':
    'Your upcoming and past appointments, and how to request, move or cancel one.',
  'portal.bills.page.title': 'Bills',
  'portal.bills.page.description': 'Your statements, what each charge was for, and how to pay.',
  'portal.forms.page.title': 'Forms',
  'portal.forms.page.description':
    'Questionnaires to fill in before your appointments. Save as you go and finish later.',
  'portal.healthRecord.page.title': 'Health record',
  'portal.healthRecord.page.description':
    'Your results, conditions, medicines, allergies, vaccinations and documents, each with a plain-language explanation.',
  'portal.messages.page.title': 'Messages',
  'portal.messages.page.description': 'Read what your care team has written and reply to them.',
  'portal.assistant.page.title': 'Assistant',
  'portal.assistant.page.description':
    'Ask a question about what your care team has written down, and see the records each answer came from.',
};
