import type { Messages } from '../../catalogue.js';

/**
 * The result list, the reading view and sign-off. Clinical.
 *
 * See `./index.ts` for how the areas compose and why they are separate files.
 *
 * ## What is here and what is deliberately not
 *
 * The sign-off queue's own words, and the labels for the triage flag this
 * application defines. Not here: a panel name, an analyte label, an analyte
 * code, a performer, a narrative, a reference range or a reading. Those arrive
 * from the laboratory already named, and a second name written in this
 * catalogue would be a second name for the same code.
 *
 * The range-state words a reading carries ("Above range", "In range") come from
 * `formatVital` in `apps/web/src/lib/format.ts`, which serves every clinical
 * surface rather than this one, so they are converted where they are written
 * rather than here.
 *
 * ## Counts carry both forms
 *
 * A key ending `One` always has a sibling ending `Other`, and the screen picks
 * between them with `plural` from this package rather than with `n === 1`.
 */
export const results: Messages = {
  /* ------------------------------------------------------------- the queue */
  'results.list.title': 'Results',
  'results.list.description': 'The sign-off queue, abnormal first.',
  'results.list.assignment': 'Assignment',
  'results.list.assignment.mine': 'Mine',
  'results.list.assignment.team': 'Team pool',
  'results.list.assignment.everyone': 'Everyone',
  /* Noun phrase, lower case: the loading and error copy build a sentence
     around it. */
  'results.list.subject': 'the results queue',
  'results.list.empty.title': 'All results reviewed',
  'results.list.empty.message':
    'Nothing is waiting in this queue. New reports arrive here as the labs send them back.',
  'results.list.empty.action': 'Go to the inbox',

  'results.queue.overline': 'Queue',
  'results.queue.title': 'Results to review',
  'results.queue.waiting': '{count} waiting',
  'results.queue.note':
    'Critical values cannot be signed in a batch. Everything else in range can, and the rest is read one at a time.',
  'results.queue.release':
    'Signing releases the result to the patient portal and closes the loop the practice promised.',

  /* Stands in for a name in a sentence, so it has to read as one. */
  'results.thisPatient': 'this patient',
  'results.notRecorded': 'Not recorded',
  'results.signedBadge': 'Signed',

  /* ---------------------------------------------------------- a queue row */
  /* The reading that earned the flag, or the count that says nothing did.
     `{count}` is analytes, never results. */
  // The analyte name comes from the laboratory and the reading is built from
  // the value it sent, so this message carries only the order they go in.
  'results.row.outOfRange': '{label} {reading}',
  'results.row.allInRangeOne': '{count} analyte, all in range',
  'results.row.allInRangeOther': '{count} analytes, all in range',
  'results.row.reportAttached': 'Report attached',
  'results.row.reported': 'Reported {at}, {performer}',
  'results.row.sign': 'Sign {panel}',

  /* ------------------------------------------------------------ the flags */
  /* What a flag means, spelled out. The badge shows it and the queue row reads
     it, so it is stated once: a result described two ways is a result somebody
     misreads. */
  'results.flag.normal': 'In range',
  'results.flag.abnormal': 'Above or below range',
  'results.flag.critical': 'Critical value',

  /* ------------------------------------------------------ the reading pane */
  'results.reading.overline': 'Reading',
  'results.reading.column.analyte': 'Analyte',
  'results.reading.column.value': 'Result',
  'results.reading.column.range': 'Reference range',
  'results.reading.column.state': 'Range state',
  'results.reading.column.previous': 'Previous',
  'results.reading.sign': 'Sign',
  'results.reading.signWithNote': 'Sign with note',
  'results.reading.followUp': 'Order follow-up',
  'results.reading.signedAtBy': 'Signed {at} by {clinician}',
  'results.reading.signedBy': 'Signed by {clinician}',
  /* Continues the identity line after the medical record number, which keeps
     its own monospace element and so cannot sit inside this message. */
  'results.reading.born': ', born {birthDate}',
  'results.reading.collected': 'Collected {collected}, reported {reported} by {performer}',
  'results.reading.orderedBy': 'Ordered by {clinician}. Today is {today}.',
  'results.reading.noteHeading': 'Note on signing',
  'results.reading.caption': '{panel}, values against their reference ranges',
  'results.reading.noRange': 'No range recorded',
  'results.reading.noPrior': 'No prior value',
  'results.reading.prior': '{value} on {at}',

  /* --------------------------------------------------------- signing one */
  'results.sign.title': 'Sign this result',
  'results.sign.description':
    'Signing {panel} for {patient} moves it out of the queue and releases it to the portal. An addendum stays possible.',
  'results.sign.cancel': 'Cancel',
  'results.sign.confirm': 'Sign result',
  'results.signed.title': '{panel} signed',
  'results.signed.messageWithNote':
    'The note is attached and the result is released to the patient.',
  'results.signed.message': 'The result is released to the patient and has left the queue.',

  /* ------------------------------------------------------- signing a batch */
  'results.bulk.actionOne': 'Sign {count} in-range result',
  'results.bulk.actionOther': 'Sign {count} in-range results',
  'results.bulk.actionNone': 'No in-range results to batch',
  'results.bulk.title': 'Sign every in-range result',
  'results.bulk.descriptionOne':
    'This signs {count} result whose values are all in range, and releases it to its patient. Critical and out-of-range results are not included.',
  'results.bulk.descriptionOther':
    'This signs {count} results whose values are all in range, and releases them to their patients. Critical and out-of-range results are not included.',
  'results.bulk.confirmOne': 'Sign {count} result',
  'results.bulk.confirmOther': 'Sign {count} results',
  'results.bulk.signedOne': '{count} in-range result signed',
  'results.bulk.signedOther': '{count} in-range results signed',
  'results.bulk.message':
    'Critical and out-of-range results stay in the queue for a person to read.',

  /* ---------------------------------------------------- signing with a note */
  'results.note.title': 'Sign with a note',
  'results.note.description':
    'Signing {panel} for {patient} moves it out of the queue and releases it to the portal with your note attached.',
  'results.note.cancel': 'Cancel',
  'results.note.confirm': 'Sign with note',
  'results.note.label': 'Note for the record',
  'results.note.placeholder': 'What the patient should do next',
  'results.note.hint': 'The note is part of the signed record and is visible to the patient.',

  /* ------------------------------------------------------- palette commands */
  'results.command.sign': 'Sign the open result',
  'results.command.signKeywords': 'sign off, review result',
  'results.command.signNote': 'Sign the open result with a note',
  'results.command.signNoteKeywords': 'addendum, tell the patient',
  'results.command.bulkSign': 'Sign every in-range result',
  'results.command.bulkSignKeywords': 'bulk sign, normal results, clear the queue',
  'results.command.mine': 'Show my results',
  'results.command.mineKeywords': 'assigned to me',
  'results.command.team': 'Show the team pool',
  'results.command.teamKeywords': 'unassigned, shared queue',

  /* ------------------------------------------------------- the browser tab */
  /*
   * A route file is a server component, so it cannot reach `useTranslator`.
   * `lib/i18n/metadata.ts` builds its own translator and looks these up. The tab
   * strip is often all a tired person has to tell nine open screens apart.
   */
  'results.page.title': 'Results',
};
