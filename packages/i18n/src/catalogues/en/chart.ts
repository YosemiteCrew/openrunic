import type { Messages } from '../../catalogue.js';

/**
 * The chart rails and record panels. Mostly clinical: see the note in
 * `../es/index.ts` about what does not get translated.
 *
 * ## What is here and what is deliberately not
 *
 * The words this application wrote: headings, empty states, table column
 * headers, the sentences that explain what an absence means. Not the values a
 * chart carries. An allergen, a medication name, a LOINC display, an ICD-10
 * title, a care-gap label and an appointment type all arrive from the API
 * already named, and a second name applied here would be a second name for a
 * code that has one. So they stay as data and are interpolated into these
 * messages rather than replaced by them.
 *
 * The appointment-status words are the case worth stating, because they look
 * convertible. Seven of the nine statuses render straight from the enum through
 * `formatEnumLabel`; two are spelled out by hand because the enum writes them
 * as one word. Translating the two by hand and leaving the seven mechanical
 * would produce a status vocabulary that is half in the reader's language, so
 * all nine stay with the enum until the enum itself is rendered through a
 * catalogue.
 *
 * ## Counts
 *
 * `Messages` is flat strings, so a plural has no single key: the forms that
 * English distinguishes get one key each, suffixed with the CLDR category, and
 * the screen selects between them with `Intl.PluralRules` on the reader's
 * locale. Only `one` and `other` are written, because English has only those
 * two. A locale with more categories needs the extra keys added beside these,
 * which is a translation job rather than a code change.
 */
export const chart: Messages = {
  /* ------------------------------------------------------------------ shell */
  'chart.title': 'Chart',
  'chart.tabs.label': 'Chart sections',

  /* ------------------------------------------------------------------- tabs */
  'chart.tab.summary': 'Summary',
  'chart.tab.visits': 'Visits',
  'chart.tab.results': 'Results',
  'chart.tab.medications': 'Medications',
  'chart.tab.documents': 'Documents',
  'chart.tab.careTeam': 'Care team',

  /* ---------------------------------------------------------------- actions */
  'chart.action.printSummary': 'Print summary',
  'chart.action.openVisitNote': 'Open visit note',

  /* The palette entries. Keywords are the words a tired person types instead of
     the label, comma separated and split at render, the way the navigation
     table already does it. Per-language rather than transliterated. */
  'chart.command.showTab': 'Show {tab}',
  'chart.command.showTab.keywords': 'chart, tab',
  'chart.command.openNote.keywords': 'note, soap, documentation, sign',
  'chart.command.print': 'Print chart summary',
  'chart.command.print.keywords': 'print, paper, record',

  /* ------------------------------------------------------- the context rail */
  'chart.rail.label': 'Patient context for {name}',

  /* What the chart's sections are called, wherever they are named. Each is the
     heading a reader sees on the rail AND the accessible name of the section it
     opens, and "Care gaps" is also the summary card's title. One key each, on
     purpose: two keys holding one wording is two chances for a translation to
     make the same section answer to two names. */
  'chart.section.allergies': 'Allergies',
  'chart.section.problems': 'Problems',
  'chart.section.medications': 'Medications',
  'chart.section.careGaps': 'Care gaps',
  'chart.section.documentation': 'Documentation',
  'chart.section.appointments': 'Appointments',
  'chart.section.balance': 'Balance',

  /* The two reads every chart screen makes, and what each says while it is
     waiting or when it comes back with nothing. Shared by the rail and the
     chart itself rather than written twice, because a patient that failed to
     load has to read the same on both. The subjects are noun phrases in lower
     case: the boundary drops them into a sentence it composes. */
  'chart.boundary.patient.subject': 'this patient',
  'chart.boundary.chart.subject': 'this chart',
  'chart.boundary.patient.title': 'No patient loaded',
  'chart.boundary.patient.message':
    'Open a chart from the patient index, or press Cmd-K to search.',
  'chart.boundary.chart.title': 'No chart data',
  'chart.boundary.chart.message': 'Nothing has been recorded for this patient.',

  /* Allergies. "Not recorded" and "none" are different facts and are said
     differently: an empty list must never read as safe. */
  'chart.rail.allergies.notRecorded': 'Allergies not recorded',
  'chart.rail.allergies.prompt':
    'Nobody has asked yet. Record allergies before prescribing: an empty list is not the same as none.',
  'chart.rail.allergies.none': 'No known allergies',
  'chart.rail.allergies.affirmed': 'Affirmed {date}',

  /* Identity. The demographics line is one message rather than three joined at
     the call site, because the order of an age, a birth date and a sex is not
     the same in every language and a sentence assembled from pieces cannot be
     reordered by a translator. */
  'chart.rail.identity.legalName': 'Legal name {name}',
  'chart.rail.identity.demographics': '{age}, born {birthDate}, {sex}',
  'chart.rail.identity.mrn': 'MRN',
  'chart.rail.identity.deceased': 'Deceased {date}. This chart is read-only.',

  /* Handling flags. Only the ones that apply are rendered. */
  'chart.rail.flags.interpreter': 'Interpreter needed, {language}',
  'chart.rail.flags.privacy': 'Privacy: {level}',
  'chart.rail.flags.portal': 'Portal active',

  'chart.rail.problems.none': 'No problems recorded',
  'chart.rail.problems.more': '{count} more on the summary',

  'chart.rail.medications.none': 'No current medications',
  'chart.rail.medications.count.one': '{count} active medication',
  'chart.rail.medications.count.other': '{count} active medications',

  'chart.rail.careGaps.due': '{gap}, due {date}',

  'chart.rail.documentation.unsigned.one': '{count} unsigned note',
  'chart.rail.documentation.unsigned.other': '{count} unsigned notes',
  'chart.rail.documentation.openNote': 'Open the {date} note',

  'chart.rail.appointments.next': 'Next {when}, {type}',
  'chart.rail.appointments.none': 'No appointment scheduled',
  'chart.rail.appointments.lastVisit': 'Last visit {date}',

  'chart.rail.balance.due': 'Patient responsibility, due',
  'chart.rail.balance.settled': 'Patient responsibility, settled',

  /* ---------------------------------------------------------- the summary */
  'chart.summary.today': 'Today',
  'chart.summary.openVisitNote': 'Open the visit note',
  'chart.summary.noVisitToday': 'No visit today. The last recorded visit was {date}.',
  /* Dropped into the sentence above where a date would go, so the line reads
     as a sentence rather than trailing off after "was". */
  'chart.summary.never': 'never',
  'chart.summary.recentVisits': 'Recent visits',
  'chart.summary.noVisits': 'No visits recorded.',
  'chart.summary.recentResults': 'Recent results',
  'chart.summary.noResults': 'No results recorded.',
  'chart.summary.collected': 'Collected {when}',
  'chart.summary.activeProblems': 'Active problems',
  'chart.summary.noProblems': 'No problems recorded.',
  /* The code itself is rendered mono beside this line rather than inside it, so
     this message carries everything from the coding system onwards. */
  'chart.summary.problemMeta': '{system}, since {onset}, {status}',
  'chart.summary.noMedications': 'No current medications.',
  'chart.summary.careGapDue': 'Due {date}',
  'chart.summary.careGapNoDate': 'No target date',

  /* ----------------------------------------------------- the record panels */
  'chart.visits.title': 'Visits',
  'chart.visits.caption': 'Visits, most recent first',
  'chart.visits.column.date': 'Date',
  'chart.visits.column.type': 'Visit',
  'chart.visits.column.provider': 'Provider',
  'chart.visits.column.reason': 'Reason',
  'chart.visits.column.note': 'Note',
  'chart.visits.column.open': 'Documentation',
  'chart.visits.noNote': 'No note',
  'chart.visits.openNote': 'Open note',
  /* The accessible name of the same link, which names the visit it opens so a
     column of identical links is still distinguishable. It contains the visible
     text verbatim, which is what lets a voice user say what they can read. */
  'chart.visits.openNoteFrom': 'Open note from {date}',
  'chart.visits.nothingToOpen': 'Nothing to open',

  'chart.results.title': 'Results',
  'chart.results.caption': 'Results, most recent first',
  'chart.results.column.analyte': 'Analyte',
  'chart.results.column.code': 'LOINC',
  'chart.results.column.value': 'Result',
  'chart.results.column.range': 'Reference range',
  'chart.results.column.state': 'Range state',
  'chart.results.column.collected': 'Collected',
  'chart.results.column.review': 'Review',
  'chart.results.signedOff': 'Signed off',
  'chart.results.awaitingReview': 'Awaiting review',

  'chart.medications.title': 'Current medications',
  'chart.medications.caption': 'Active medications',
  'chart.medications.column.drug': 'Medication',
  'chart.medications.column.sig': 'Directions',
  'chart.medications.column.prescriber': 'Prescriber',
  'chart.medications.column.started': 'Started',
  'chart.medications.column.source': 'Source',
  'chart.medications.column.refills': 'Refills',
  'chart.medications.column.stopped': 'Stopped',
  'chart.medications.discontinued.title': 'Discontinued',
  'chart.medications.discontinued.caption': 'Discontinued medications',

  'chart.documents.title': 'Documents',
  'chart.documents.caption': 'Documents, most recent first',
  'chart.documents.column.name': 'Document',
  'chart.documents.column.category': 'Category',
  'chart.documents.column.received': 'Received',
  'chart.documents.column.source': 'Source',
  'chart.documents.column.expiry': 'Expiry',
  'chart.documents.noExpiry': 'No expiry',
  'chart.documents.expired': 'Expired {date}',
  'chart.documents.expires': 'Expires {date}',

  'chart.careTeam.title': 'Care team',

  /* ------------------------------------------------------- the empty states */
  /* One per tab: the fact, why it is empty, and exactly one way on. A blank
     panel reads as "not loaded yet" rather than as "there is nothing here". */
  'chart.empty.summary.title': 'No history yet',
  'chart.empty.summary.message':
    'Nothing has been recorded for this patient. The first visit starts the chart.',
  'chart.empty.summary.action': "Go to today's schedule",
  'chart.empty.visits.title': 'No visits recorded',
  'chart.empty.visits.message':
    'Visits appear here once the patient has been seen or an appointment is fulfilled.',
  'chart.empty.visits.action': 'Book an appointment',
  'chart.empty.results.title': 'No results for this patient',
  'chart.empty.results.message':
    'Laboratory and imaging results file to the chart as they arrive from the lab.',
  'chart.empty.results.action': 'Go to results',
  'chart.empty.medications.title': 'No medications recorded',
  'chart.empty.medications.message':
    'Prescriptions written here and medications the patient reports both appear on this list.',
  'chart.empty.medications.action': 'Go to orders',
  'chart.empty.documents.title': 'No documents filed',
  'chart.empty.documents.message':
    'Uploads, scans and inbound faxes filed to this chart appear here.',
  'chart.empty.documents.action': 'Go to the inbox',
  'chart.empty.careTeam.title': 'No care team recorded',
  'chart.empty.careTeam.message':
    'The primary provider and anyone else responsible for this patient appear here.',
};
