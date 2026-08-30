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
  /*
   * THE HEALTH RECORD.
   *
   * Every date line is one message with the date in it rather than a word and a
   * date placed next to each other, because "on" is not a word every language
   * puts there, or puts first.
   *
   * What the practice recorded stays as it arrived: the condition, the dose
   * label, the severity, the plain-language gloss beside a coded term. Those
   * are the record, not the interface, and inventing a translation for a
   * clinical word is the failure this catalogue avoids everywhere else.
   */
  'portal.healthRecord.overline': 'Your record',
  'portal.healthRecord.title': 'Health record',
  'portal.healthRecord.lede':
    'Everything your care team has written down, with a plain-language explanation beside each clinical term.',
  'portal.healthRecord.empty.title': 'Your record has nothing in it yet.',
  'portal.healthRecord.empty.message':
    'Results, conditions, medicines and documents appear here after your first appointment.',
  'portal.healthRecord.results.overline': 'Results',
  'portal.healthRecord.results.title': 'Recent test results',
  'portal.healthRecord.results.none': 'No results have been added to your record.',
  'portal.healthRecord.results.noRange': 'No usual range was recorded for this test.',
  'portal.healthRecord.results.usualRange': 'Usual range: {range}',
  'portal.healthRecord.results.takenOn': 'Taken on {date}',
  'portal.healthRecord.results.ask': 'Ask about this result',
  'portal.healthRecord.results.explainer.title': 'What to do about this number',
  'portal.healthRecord.results.explainer.body':
    'A single result is one moment, not a diagnosis. Your care team reads it alongside everything else they know about you. If you want it explained, send them a message and quote the test name and the date.',
  'portal.healthRecord.results.explainer.action': 'Message your care team',
  'portal.healthRecord.problems.overline': 'Conditions',
  'portal.healthRecord.problems.title': 'Problems on your record',
  'portal.healthRecord.problems.none': 'No conditions are recorded.',
  'portal.healthRecord.problems.recordedOn': 'Recorded on {date}',
  'portal.healthRecord.medications.overline': 'Medicines',
  'portal.healthRecord.medications.title': 'What you have been prescribed',
  'portal.healthRecord.medications.none': 'No medicines are recorded.',
  'portal.healthRecord.medications.prescribedBy': 'Prescribed by {clinician}, started {date}',
  'portal.healthRecord.allergies.overline': 'Allergies',
  'portal.healthRecord.allergies.title': 'What to avoid',
  'portal.healthRecord.allergies.none': 'No allergies are recorded.',
  'portal.healthRecord.allergies.reaction': 'What happened: {reaction}',
  'portal.healthRecord.allergies.recordedOn': 'Recorded on {date}',
  'portal.healthRecord.immunisations.overline': 'Vaccinations',
  'portal.healthRecord.immunisations.title': 'Immunisations you have had',
  'portal.healthRecord.immunisations.none': 'No vaccinations are recorded.',
  'portal.healthRecord.immunisations.givenOn': 'Given on {date}',
  'portal.healthRecord.documents.overline': 'Documents',
  'portal.healthRecord.documents.title': 'Letters and reports',
  'portal.healthRecord.documents.none': 'No documents have been added.',
  'portal.healthRecord.documents.addedOn': 'Added on {date}',
  /*
   * BILLS.
   *
   * The currency is never written into a word. It arrives on the money itself,
   * so the column header and the note under the table both take it as a value:
   * the practice that bills in euros used to get a column headed "Amount (GBP)"
   * above euro figures.
   */
  'portal.bills.overline': 'Your account',
  'portal.bills.title': 'Bills',
  'portal.bills.lede':
    'Every statement the practice has issued, what each charge was for, and how to pay.',
  'portal.bills.empty.title': 'You have no statements.',
  'portal.bills.empty.message':
    'When the practice bills you for a visit, the statement appears here.',
  'portal.bills.statement.overline': 'Statement {reference}',
  'portal.bills.statement.title': 'Issued {date}',
  'portal.bills.statement.status': 'Status',
  'portal.bills.statement.dueBy': 'Due by',
  'portal.bills.statement.stillToPay': 'Still to pay',
  'portal.bills.statement.total': 'Total',
  'portal.bills.statement.open': 'See what this was for',
  'portal.bills.status.due': 'Due',
  'portal.bills.status.paid': 'Paid',
  'portal.bills.status.credit': 'In credit',
  'portal.bills.lines.caption': 'Charges on statement {reference}',
  'portal.bills.lines.description': 'What it was for',
  'portal.bills.lines.code': 'Code',
  'portal.bills.lines.quantity': 'Quantity',
  'portal.bills.lines.amount': 'Amount ({currency})',
  'portal.bills.lines.note':
    'Amounts are in {currency}. A figure marked credit is money owed back to you.',
  'portal.bills.receipt.title': 'Payment received',
  'portal.bills.receipt.body':
    'You paid {amount} on {paidOn} with the card ending {cardLast4}. Your receipt reference is {reference}. Keep it if you need to query the payment.',
  'portal.bills.pay.failed':
    'The payment did not go through and you have not been charged. Check your connection, then try again.',
  'portal.bills.pay.action': 'Pay this statement',
  'portal.bills.back': 'Back to your statements',
  'portal.bills.payDialog.title': 'Pay this statement?',
  'portal.bills.payDialog.description':
    'This takes {amount} from the card the practice holds for you. Payments cannot be reversed from this portal. To get the money back you would have to ask the practice for a refund.',
  'portal.bills.payDialog.notNow': 'Not now',
  'portal.bills.payDialog.confirm': 'Pay now',
  /*
   * MESSAGES.
   *
   * The "not for emergencies" notice sits above the compose box, in the
   * catalogue as one message, because it is a safety notice and a half of it
   * would still look like a safety notice.
   */
  'portal.messages.overline': 'Your care team',
  'portal.messages.title': 'Messages',
  'portal.messages.lede':
    'Read what your care team has written and reply. This is not the way to get help quickly.',
  'portal.messages.empty.title': 'You have no messages.',
  'portal.messages.empty.message':
    'When your care team writes to you, the conversation appears here.',
  'portal.messages.threads.label': 'Conversations',
  'portal.messages.threads.heading': 'Conversations',
  'portal.messages.threads.unread': 'Unread',
  'portal.messages.threads.meta': '{correspondent}, {when}',
  'portal.messages.conversation.overline': 'Conversation',
  'portal.messages.conversation.who': '{author}, {when}',
  'portal.messages.notice.title': 'Not for emergencies',
  'portal.messages.notice.body':
    'Replies can take a few working days. If you need help now, call the practice. For a medical emergency, call the emergency services on your local number.',
  'portal.messages.compose.label': 'Your message',
  'portal.messages.compose.placeholder': 'Write your reply here.',
  'portal.messages.compose.send': 'Send message',
  'portal.messages.compose.sending': 'Sending',
  'portal.messages.compose.sent': 'Message sent. It is at the bottom of the conversation above.',
  'portal.messages.compose.failed':
    'Your message did not send, and your draft is still in the box. Check your connection, then send it again.',

  /*
   * FORMS.
   *
   * `yes` and `no` are the words shown for a yes/no question. They are not what
   * is stored: the answer that goes back to the practice is fixed, so the same
   * question cannot come back holding two different values depending on which
   * language it was answered in.
   */
  'portal.forms.overline': 'Before your visit',
  'portal.forms.title': 'Forms',
  'portal.forms.lede':
    'Questionnaires your care team has asked you to fill in. Save as you go and finish whenever you like.',
  'portal.forms.empty.title': 'You have no forms to fill in.',
  'portal.forms.empty.message':
    'When your care team sends you one, it appears here with the date it is needed by.',
  'portal.forms.status.notStarted': 'Not started',
  'portal.forms.status.inProgress': 'Saved, not sent',
  'portal.forms.status.submitted': 'Sent',
  'portal.forms.neededBy': 'Needed by {date}',
  'portal.forms.open': 'Open the form',
  'portal.forms.continue': 'Continue the form',
  'portal.forms.yes': 'Yes',
  'portal.forms.no': 'No',
  'portal.forms.inProgress.overline': 'In progress',
  'portal.forms.save': 'Save and finish later',
  'portal.forms.submit': 'Send to the practice',
  'portal.forms.back': 'Back to your forms',
  'portal.forms.saved': 'Your answers are saved. You can close this and come back to it later.',
  'portal.forms.saveFailed':
    'Your answers were not saved, and they are still on this page. Check your connection, then save again.',
  'portal.forms.submitFailed':
    'Your form did not send, and your answers are still on this page. Check your connection, then send it again.',
  'portal.forms.sent.overline': 'Sent',
  'portal.forms.sent.title': 'Your form has gone to the practice',
  'portal.forms.sent.body':
    'Your answers are with your care team and will be read before your appointment. You do not need to do anything else.',
  /*
   * THE ASSISTANT.
   *
   * Two things here are not ordinary interface copy. The service line is
   * ADR-0005's no-telemetry promise said in the product, and the failure
   * sentences each say what is unaffected as well as what went wrong. Both are
   * whole messages: a translator working on half of either would be working on
   * a claim about where a patient's words go.
   */
  'portal.assistant.overline': 'Your record',
  'portal.assistant.title': 'Assistant',
  'portal.assistant.lede':
    'Ask a question about what your care team has written down, and see the records each answer came from.',
  'portal.assistant.notice.title': 'What this can and cannot do',
  'portal.assistant.notice.body':
    'It looks things up in your own record and shows you where each answer came from. It cannot tell you what something means, whether it matters, or what to do next. For those, message your care team. For a medical emergency, call the emergency services on your local number.',
  'portal.assistant.service.line':
    'Your practice uses a computer service to write these answers. It is called {model} and it runs at {host}.',
  'portal.assistant.service.leaves':
    'What you type here is sent out of your practice to that service. Your practice chose it and holds the agreement with it.',
  'portal.assistant.service.stays':
    "What you type here stays on the practice's own computers and is not sent anywhere else.",
  'portal.assistant.section.label': 'Assistant',
  'portal.assistant.reach.summary': 'What it is allowed to look at',
  'portal.assistant.intro':
    'Ask about something already written down, such as when your next appointment is, what medicines are on your record, or what is left to pay. Every answer shows the records behind it, and you can open each one.',
  'portal.assistant.intro.careTeam': 'Write to your care team',
  'portal.assistant.intro.forAnythingElse': 'for anything else.',
  'portal.assistant.compose.label': 'Your question',
  'portal.assistant.compose.placeholder': 'What did the practice write down about my last visit?',
  'portal.assistant.compose.ask': 'Ask',
  'portal.assistant.compose.stop': 'Stop',
  'portal.assistant.turn.youAsked': 'You asked:',
  'portal.assistant.turn.stillLooking': 'Still looking.',
  'portal.assistant.step.done': ', done',
  'portal.assistant.step.stillGoing': ', still going',
  'portal.assistant.step.notFinished': ', not finished',
  'portal.assistant.withheld.unsourced':
    'The answer came back without the records it was based on, so it is not shown. An answer you cannot check against your own record is not one to rely on.',
  'portal.assistant.withheld.incomplete':
    'You stopped this before it finished a sentence, so there is nothing to show.',
  'portal.assistant.withheld.careTeam':
    'This one is for a person, not for this page. It can look things up in your record; it cannot tell you what something means, whether it matters, or what to do.',
  'portal.assistant.deferral': 'The assistant did not go ahead with part of this: {reason}',
  'portal.assistant.careTeam.text':
    'Ask your care team. They can see the same record and they can answer questions this page cannot.',
  'portal.assistant.careTeam.link': 'Write to your care team',
  'portal.assistant.sources.head': 'Where this came from',
  'portal.assistant.sources.untrusted': 'Written by you or by someone outside the practice',
  /* The dash belongs to the sentence rather than to the code that joins the two
     halves, because it is punctuation this language happens to use there. */
  'portal.assistant.sources.line': '{name}: {label}',
  'portal.assistant.sources.lineBeforeLink': '{name}: {label} -',
  'portal.assistant.sources.seeIn': 'see it in {destination}',
  'portal.assistant.record.condition': 'Condition',
  'portal.assistant.record.medicine': 'Medicine',
  'portal.assistant.record.allergy': 'Allergy',
  'portal.assistant.record.vaccination': 'Vaccination',
  'portal.assistant.record.appointment': 'Appointment',
  'portal.assistant.record.bill': 'Bill',
  'portal.assistant.record.other': 'Record',
  'portal.assistant.destination.home': 'Home',
  'portal.assistant.destination.healthRecord': 'your health record',
  'portal.assistant.destination.messages': 'your messages',
  'portal.assistant.destination.appointments': 'your appointments',
  'portal.assistant.destination.forms': 'your forms',
  'portal.assistant.destination.bills': 'your bills',
  'portal.assistant.destination.assistant': 'the assistant',
  'portal.assistant.announce.looking': 'Looking in your record.',
  'portal.assistant.announce.careTeam': 'This one is for your care team.',
  'portal.assistant.announce.failed': 'No answer came back.',
  'portal.assistant.announce.withheld': 'No answer is shown.',
  'portal.assistant.announce.ready.one': 'Answer ready, from {count} record.',
  'portal.assistant.announce.ready.other': 'Answer ready, from {count} records.',
  'portal.assistant.failure.unreachable':
    'The assistant could not be reached. Your appointments, messages, forms and bills all still work. Try again in a moment.',
  'portal.assistant.failure.unexpectedDraft':
    'Something came back that this page will not show you. Nothing in your record has changed. Please tell your care team you saw this.',
  'portal.assistant.failure.upstreamUnreachable':
    'The service that writes these answers did not reply, so there is no answer. Nothing else in the portal depends on it.',
  'portal.assistant.failure.quotaExceeded':
    'The assistant has been used as much as your practice allows for now. Everything else in the portal still works.',
  'portal.assistant.failure.turnLimit':
    'That took longer than one question is allowed. Try asking for one thing at a time.',
  'portal.assistant.failure.scopeDenied':
    'The assistant asked for something it is not allowed to look at. It was refused and nothing was read.',
  'portal.assistant.failure.compartmentViolation':
    'Something came back that was not from your record, so the answer was thrown away and nothing is shown. Please tell your care team you saw this.',
  'portal.assistant.failure.responseInvalid':
    'The answer came back in a shape this page could not read, so nothing is shown rather than a guess at it.',
  'portal.assistant.failure.toolFailed':
    'Your record could not be read just now. Try again in a moment.',
  'portal.assistant.failure.unknown':
    'That did not work. Nothing in your record has changed, and the rest of the portal is fine.',
};
