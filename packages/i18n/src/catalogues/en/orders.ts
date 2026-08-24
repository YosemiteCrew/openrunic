import type { Messages } from '../../catalogue.js';

/**
 * The order composer, the picker, the draft tray and the order ledger.
 * Clinical.
 *
 * See `./index.ts` for how the areas compose and why they are separate files.
 *
 * ## What is here and what is deliberately not
 *
 * The words this application chose: headings, buttons, hints, the sentences
 * that explain why a signature is being held. Also the labels for the enums
 * this application defines - an order's lifecycle state, its priority, its
 * category, an alert tier - because those are names written here rather than
 * codes arriving from somewhere else.
 *
 * Not here: anything that comes back from the catalogue or the API already
 * named. An order's name, its code, its destination, its turnaround, a
 * problem's ICD-10 display, a warning's title and detail, and the specimen
 * types in `components/orders/specimens.ts` all stay as they arrive. Putting a
 * translated label on a coded value gives the code a second, diverging name,
 * which is the hazard the catalogue exists to avoid rather than to introduce.
 *
 * ## Counts carry both forms
 *
 * A key ending `One` always has a sibling ending `Other`, and the screen picks
 * between them with `plural` from this package rather than with `n === 1`.
 * English needs two forms and is the reason everybody writes the comparison;
 * the language a fork translates into may need four.
 */
export const orders: Messages = {
  /* ------------------------------------------------------------ the ledger */
  'orders.list.title': 'Orders',
  'orders.list.description': 'Every order for the practice, with its lifecycle.',
  'orders.list.newOrder': 'New order',
  'orders.list.statusFilter': 'Status',
  'orders.list.everyStatus': 'Every status',
  'orders.list.card': 'Order ledger',
  /* Noun phrase, lower case: the loading and error copy build a sentence
     around it. */
  'orders.list.subject': 'the order ledger',
  'orders.list.caption': 'Orders across the practice, newest first',

  'orders.list.empty.title': 'No orders yet',
  'orders.list.empty.message':
    'Orders placed from a visit or from the composer appear here with their status.',
  'orders.list.empty.filteredTitle': 'No {status} orders',
  'orders.list.empty.filteredMessage':
    'Nothing sits in that state right now. Clear the filter to see the rest of the ledger.',

  'orders.list.column.order': 'Order',
  'orders.list.column.patient': 'Patient',
  'orders.list.column.placed': 'Placed',
  'orders.list.column.provider': 'Ordered by',
  'orders.list.column.destination': 'Destination',
  'orders.list.column.status': 'Status',
  'orders.list.column.age': 'In this state',
  'orders.list.column.actions': 'Actions',

  'orders.list.noDiagnosis': 'No diagnosis linked',
  'orders.list.patientNotRecorded': 'Not recorded',
  'orders.list.openResult': 'Open result for {order}',
  'orders.list.retry': 'Retry {order}',

  'orders.list.command.pended': 'Show pended orders',
  'orders.list.command.pendedKeywords': 'unsigned orders, tray',
  'orders.list.command.transmitted': 'Show transmitted orders',
  'orders.list.command.transmittedKeywords': 'sent to lab, awaiting acknowledgement',
  'orders.list.command.all': 'Show orders in every status',
  'orders.list.command.allKeywords': 'clear filter, everything',

  /* ------------------------------------------------- the enums this app owns */
  /* An order's lifecycle, its priority and its category are named here rather
     than derived from the enum member, because "IN_PROGRESS" is a value and
     "In progress" is a sentence fragment somebody reads. */
  'orders.status.pended': 'Pended',
  'orders.status.signed': 'Signed',
  'orders.status.transmitted': 'Transmitted',
  'orders.status.inProgress': 'In progress',
  'orders.status.resulted': 'Resulted',
  'orders.status.cancelled': 'Cancelled',

  'orders.priority.routine': 'Routine',
  'orders.priority.urgent': 'Urgent',
  'orders.priority.stat': 'Stat',

  'orders.category.lab': 'Lab',
  'orders.category.imaging': 'Imaging',
  'orders.category.procedure': 'Procedure',

  'orders.age.unacknowledged': 'Unacknowledged {elapsed}',

  /* ---------------------------------------------------------- the composer */
  'orders.new.title': 'New order',
  'orders.new.description':
    'Labs, imaging and procedures. Build the list, then review and sign it.',

  'orders.new.patients.subject': 'the patient list',
  'orders.new.patients.emptyTitle': 'No patients to order for',
  'orders.new.patients.emptyMessage':
    'Register a patient first; orders always belong to one chart.',
  'orders.new.patients.emptyAction': 'Go to patients',

  'orders.new.steps.label': 'Composer steps',
  'orders.new.steps.build': '1. Build the order',
  'orders.new.steps.review': '2. Review and sign',

  'orders.new.patient.card': 'Patient',
  'orders.new.patient.label': 'Ordering for',
  'orders.new.patient.hint': 'Orders belong to one chart. Switching patients starts a new draft.',
  /* Stands in for a name in a sentence, so it has to read as one. */
  'orders.new.thisPatient': 'this patient',

  'orders.new.build.addCard': 'Add an order',
  'orders.new.build.emptyCard': 'Nothing drafted yet',
  'orders.new.build.emptyBody':
    'Pick a favourite or search the catalogue. Specimen, destination and priority are filled in for you, and a diagnosis is suggested from the problem list.',
  'orders.new.build.review': 'Review and sign',

  'orders.new.rail.overline': 'Ordering for',
  'orders.new.rail.mrn': 'MRN',
  'orders.new.rail.age': 'Age',
  'orders.new.rail.ageValue': '{age}, born {birthDate}',
  'orders.new.rail.problems': 'Problems',
  'orders.new.rail.noProblems': 'No problems recorded',
  'orders.new.rail.note':
    'Signing transmits immediately. Pending keeps the orders in the visit tray, unsigned.',

  /* What stands between the draft and a signature, in the order a person fixes
     it. `{warning}` and `{order}` arrive already named by the API and the
     catalogue, so only the sentence around them is translated. */
  'orders.new.blocker.critical': '{warning}. Choose an override reason or remove the order.',
  'orders.new.blocker.noDiagnosis': '{order} has no diagnosis linked.',
  'orders.new.blockers.heading': 'Before signing',

  'orders.new.review.headingOne': 'Review {count} order',
  'orders.new.review.headingOther': 'Review {count} orders',
  'orders.new.review.empty':
    'The draft is empty. Go back and add an order from the favourites or the catalogue.',
  'orders.new.review.caption': 'Orders drafted for {patient}',
  'orders.new.review.column.order': 'Order',
  'orders.new.review.column.code': 'Code',
  'orders.new.review.column.priority': 'Priority',
  'orders.new.review.column.specimen': 'Specimen',
  'orders.new.review.column.diagnosis': 'Diagnosis',
  'orders.new.review.column.destination': 'Destination',
  'orders.new.review.noSpecimen': 'Not applicable',
  'orders.new.review.back': 'Back to building',

  'orders.new.pend': 'Pend orders',
  'orders.new.signEmpty': 'Sign orders',
  'orders.new.signOne': 'Sign {count} order',
  'orders.new.signOther': 'Sign {count} orders',

  'orders.new.pended.titleOne': '{count} order pended',
  'orders.new.pended.titleOther': '{count} orders pended',
  'orders.new.pended.message': 'They stay unsigned in the visit tray until someone signs them.',
  'orders.new.signed.titleOne': '{count} order signed',
  'orders.new.signed.titleOther': '{count} orders signed',
  'orders.new.signed.message': 'Transmitted to {destinations}.',
  'orders.new.cleared.title': 'Draft cleared',
  'orders.new.cleared.message':
    'Orders belong to one chart, so switching patients starts a new draft.',

  'orders.new.confirm.title': 'Sign these orders',
  'orders.new.confirm.bodyOne':
    'Signing transmits {count} order for {patient} immediately. Cancelling one afterwards is possible and audited.',
  'orders.new.confirm.bodyOther':
    'Signing transmits {count} orders for {patient} immediately. Cancelling one afterwards is possible and audited.',
  'orders.new.confirm.line': '{order}, {priority}, to {destination}',
  'orders.new.confirm.keepEditing': 'Keep editing',
  'orders.new.confirm.sign': 'Sign and transmit',

  'orders.new.command.search': 'Search the order catalogue',
  'orders.new.command.searchKeywords': 'find order, lab, imaging, procedure',
  'orders.new.command.add': 'Order {order}',
  'orders.new.command.review': 'Review the draft orders',
  'orders.new.command.reviewKeywords': 'check orders, before signing',
  'orders.new.command.pend': 'Pend the draft orders',
  'orders.new.command.pendKeywords': 'tray, unsigned, save for later',
  'orders.new.command.sign': 'Sign the draft orders',
  'orders.new.command.signKeywords': 'transmit, send to lab, submit',

  /* ------------------------------------------------------------ the picker */
  'orders.picker.favourites': 'Favourites',
  'orders.picker.favouritesLabel': 'Favourite orders',
  'orders.picker.searchLabel': 'Search the order catalogue',
  'orders.picker.searchHint':
    "Ranked against this patient's problem list. Arrow keys move, Enter adds.",
  'orders.picker.searchPlaceholder': 'Test, scan or procedure',
  'orders.picker.listLabel': 'Matching orders',
  'orders.picker.noMatch':
    'Nothing in the catalogue matches "{query}". Try the test name or its short code.',
  'orders.picker.onProblemList': 'On the problem list',
  'orders.picker.alreadyDrafted': 'Already drafted',

  /* -------------------------------------------------------- the draft tray */
  'orders.draft.listLabel': 'Drafted orders',
  'orders.draft.notLinked': 'Not linked yet',
  'orders.draft.needsDiagnosis': 'Needs a diagnosis',
  'orders.draft.priority': 'Priority',
  'orders.draft.specimen': 'Specimen',
  'orders.draft.noSpecimen': 'No specimen is collected for {category}.',
  'orders.draft.diagnosis': 'Diagnosis this order justifies',
  'orders.draft.diagnosisHint': 'From the active problem list. Required before signing.',
  'orders.draft.remove': 'Remove {order}',

  /* ---------------------------------------------------------- the warnings */
  /* The tier is a word before it is a colour, so the word is the thing that
     has to be translated well. */
  'orders.warning.tier.info': 'Information',
  'orders.warning.tier.caution': 'Caution',
  'orders.warning.tier.critical': 'Critical',
  'orders.warning.label': '{tier}: {title}',
  'orders.warning.overridden': 'Overridden',
  'orders.warning.acknowledged': 'Acknowledged',
  'orders.warning.acknowledge': 'Acknowledge',
  'orders.warning.override': 'Override and keep this order',
  'orders.warning.reasonLabel': 'Reason for overriding',
  'orders.warning.undoOverride': 'Undo, keep the override open',
  'orders.warning.undoWarning': 'Undo, keep the warning open',
  /* The reason recorded when a tier below CRITICAL is cleared, which is the
     only tier with no list of reasons to choose from. */
  'orders.warning.defaultReason': 'Acknowledged',
};
