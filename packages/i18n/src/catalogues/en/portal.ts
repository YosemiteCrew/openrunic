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
  /*
   * THE THREE STATES EVERY READ CAN BE IN.
   *
   * Two whole sentences per screen rather than one noun phrase the component
   * drops into a frame. The frame fixed English word order, and capitalising
   * the phrase for the error title was an English rule living in shared code.
   */
  'portal.async.error.message':
    'Check your connection, then try again. If it keeps failing, message your care team.',
  'portal.async.retry': 'Try again',
  'portal.home.async.loading': 'Loading your home summary.',
  'portal.home.async.error': 'Your home summary did not load.',
  'portal.appointments.async.loading': 'Loading your appointments.',
  'portal.appointments.async.error': 'Your appointments did not load.',
  'portal.healthRecord.async.loading': 'Loading your health record.',
  'portal.healthRecord.async.error': 'Your health record did not load.',
  'portal.messages.async.loading': 'Loading your messages.',
  'portal.messages.async.error': 'Your messages did not load.',
  'portal.forms.async.loading': 'Loading your forms.',
  'portal.forms.async.error': 'Your forms did not load.',
  'portal.bills.async.loading': 'Loading your statements.',
  'portal.bills.async.error': 'Your statements did not load.',
  'portal.assistant.async.loading': 'Loading your record.',
  'portal.assistant.async.error': 'Your record did not load.',

  /*
   * MONEY.
   *
   * A negative amount is money owed back to the patient, so it renders as a
   * positive figure with this word beside it.
   */
  'portal.money.credit': 'credit',

  /*
   * ONE APPOINTMENT, AS THE WHEN, THE WHO AND THE WHERE.
   *
   * The two-part values are messages rather than pieces joined with a comma in
   * code, because which part comes first is a decision each language makes.
   */
  'portal.appointment.when': 'When',
  'portal.appointment.whenValue': '{dateTime}, {duration}',
  'portal.appointment.whoWith': 'Who with',
  'portal.appointment.whoWithValue': '{clinician}, {department}',
  'portal.appointment.where': 'Where',
  'portal.appointment.videoDefault': 'A video call',
  'portal.appointment.roomUnconfirmed': 'The practice will confirm the room.',

  /*
   * THE APPOINTMENTS SCREEN.
   *
   * Cancelling takes two steps and the second one says what cancelling costs.
   * The consequence is one message rather than three clauses assembled around
   * the appointment's own details.
   */
  'portal.appointments.overline': 'Your visits',
  'portal.appointments.title': 'Appointments',
  'portal.appointments.lede':
    'What is booked, what has already happened, and how to ask for a change.',
  'portal.appointments.request': 'Request an appointment',
  'portal.appointments.requested':
    'Your request has gone to the practice. They will confirm by message. Nothing is booked until they do.',
  'portal.appointments.cancelFailed':
    'The appointment was not cancelled and is still booked. Check your connection, then try again.',
  'portal.appointments.empty.title': 'You have no appointments.',
  'portal.appointments.empty.message':
    'Request one and the practice will confirm a time by message.',
  'portal.appointments.upcoming.label': 'Upcoming appointments',
  'portal.appointments.upcoming.heading': 'Upcoming',
  'portal.appointments.upcoming.none': 'You have nothing booked.',
  'portal.appointments.past.label': 'Past appointments',
  'portal.appointments.past.heading': 'Past',
  'portal.appointments.past.none': 'You have no past appointments on record.',
  'portal.appointments.mode.video': 'Video call',
  'portal.appointments.mode.inPerson': 'In person',
  'portal.appointments.mode.past': 'Past',
  'portal.appointments.join': 'Join the video call',
  'portal.appointments.directions': 'Get directions',
  'portal.appointments.move': 'Ask to move it',
  'portal.appointments.cancel': 'Cancel',
  'portal.appointments.cancelledBadge': 'Cancelled',
  'portal.appointments.cancelDialog.title': 'Cancel this appointment?',
  'portal.appointments.cancelDialog.description':
    'This would cancel {reason} with {clinician} on {when}. The slot goes to someone else, and to be seen you would have to request a new appointment. The next opening may be weeks later.',
  'portal.appointments.cancelDialog.keep': 'Keep the appointment',
  'portal.appointments.cancelDialog.confirm': 'Cancel the appointment',
  'portal.appointments.requestDialog.title': 'Request an appointment',
  'portal.appointments.requestDialog.rescheduleTitle': 'Ask to move this appointment',
  'portal.appointments.requestDialog.description':
    'This goes to the practice as a request. They will confirm a time by message. Nothing is booked until they do.',
  'portal.appointments.requestDialog.close': 'Close without sending',
  'portal.appointments.requestDialog.send': 'Send the request',
  'portal.appointments.requestDialog.reason.label': 'What do you need to be seen about?',
  'portal.appointments.requestDialog.reason.hint': 'A short line is enough.',
  'portal.appointments.requestDialog.times.label': 'When can you come?',
  'portal.appointments.requestDialog.times.hint': 'For example, weekday mornings.',
  'portal.appointments.requestDialog.failed':
    'Your request did not send, and what you typed is still here. Check your connection, then send it again.',
};
