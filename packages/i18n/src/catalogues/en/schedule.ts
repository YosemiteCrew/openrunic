import type { Messages } from '../../catalogue.js';

/**
 * The day view, the flow board, booking and check-in.
 *
 * ## Why the appointment statuses are words here rather than derived
 *
 * The screens used to render a status by lowercasing the enum member and
 * capitalising the first letter, with two hand-written exceptions because that
 * rule turns `NOSHOW` into "Noshow". A derived word cannot be translated, and
 * the flow board is the screen where that matters most: its column headings and
 * the badge on every card name the same state, so a board whose headings were
 * translated and whose badges were not would be telling a reader two different
 * things about one patient.
 *
 * Each status therefore has two messages. The first is what a heading or a
 * badge shows. The second, under `schedule.status.inline`, is the same state
 * written to sit inside a sentence - "moved from arrived to checked in". They
 * are separate messages rather than one lowercased at the call site because
 * lowercasing translated text is a per-language decision the code cannot make:
 * German capitalises its nouns wherever they appear, and Turkish has two dotless
 * i rules that turn a correct word into a wrong one.
 */
export const schedule: Messages = {
  /* ------------------------------------------------------- appointment state */
  'schedule.status.proposed': 'Proposed',
  'schedule.status.pending': 'Pending',
  'schedule.status.booked': 'Booked',
  'schedule.status.arrived': 'Arrived',
  'schedule.status.checkedIn': 'Checked in',
  'schedule.status.roomed': 'Roomed',
  'schedule.status.inProgress': 'In progress',
  'schedule.status.checkedOut': 'Checked out',
  'schedule.status.fulfilled': 'Fulfilled',
  'schedule.status.cancelled': 'Cancelled',
  'schedule.status.noShow': 'No show',
  'schedule.status.enteredInError': 'Entered in error',

  'schedule.status.inline.proposed': 'proposed',
  'schedule.status.inline.pending': 'pending',
  'schedule.status.inline.booked': 'booked',
  'schedule.status.inline.arrived': 'arrived',
  'schedule.status.inline.checkedIn': 'checked in',
  'schedule.status.inline.roomed': 'roomed',
  'schedule.status.inline.inProgress': 'in progress',
  'schedule.status.inline.checkedOut': 'checked out',
  'schedule.status.inline.fulfilled': 'fulfilled',
  'schedule.status.inline.cancelled': 'cancelled',
  'schedule.status.inline.noShow': 'no show',
  'schedule.status.inline.enteredInError': 'entered in error',

  /* --------------------------------------------------- verbs shared by screens */
  /* One message per verb rather than one per screen: the palette entry, the
     rail button and the empty state all name the same act, and three keys would
     be three chances for them to drift into three different words. */
  'schedule.action.addWalkIn': 'Add walk-in',
  'schedule.action.findAvailable': 'Find available',
  'schedule.action.cancel': 'Cancel',
  'schedule.provider.unassigned': 'Unassigned',
  'schedule.visit.unassignedSlot': 'Unassigned slot',

  /* -------------------------------------------------------------- filters */
  'schedule.filter.facility': 'Facility',
  'schedule.filter.provider': 'Provider',
  'schedule.filter.allProviders': 'All providers',
  'schedule.filter.room': 'Room',
  'schedule.filter.allRooms': 'All rooms',

  /* ------------------------------------------------------------- day view */
  'schedule.day.title': 'Schedule',
  /* Two sentences rather than one with an optional clause, because the clause
     is a place name in the middle of the sentence and a language that puts it
     elsewhere cannot move a fragment the code glued on. */
  'schedule.day.description': '{date}. The clinic day, per provider, with status inline.',
  'schedule.day.descriptionAtFacility':
    '{date} at {facility}. The clinic day, per provider, with status inline.',
  'schedule.day.subject': "today's schedule",
  'schedule.day.previousDay': 'Previous day',
  'schedule.day.today': 'Today',
  'schedule.day.nextDay': 'Next day',
  'schedule.day.empty.title': 'No appointments on this day',
  'schedule.day.empty.message':
    'Nothing is booked for this date. Find an open slot to book the first visit.',
  'schedule.day.blocked.title': 'This day cannot be booked into',
  'schedule.day.blocked.noFacility':
    'No active facility came back for this organisation, and a booking has to name the facility it happens at. Add one under Admin, Facilities before booking.',
  'schedule.day.blocked.noProvider':
    'No active clinician came back for {facility}, and a booking has to name the clinician it is with. Add one under Admin, Users and roles before booking.',

  'schedule.day.command.today': 'Go to today',
  'schedule.day.command.today.keywords': 'now, current day, reset date',
  'schedule.day.command.previousDay': 'Go to the previous day',
  'schedule.day.command.nextDay': 'Go to the next day',
  'schedule.day.command.findAvailable': 'Find available slots',
  'schedule.day.command.findAvailable.keywords': 'book, open slot, next available, appointment',
  'schedule.day.command.walkIn.keywords': 'walk in, unscheduled, squeeze in',
  'schedule.day.command.checkIn.keywords': 'arrive, arrival, front desk',
  'schedule.day.command.checkInSelected': 'Check in the selected visit',

  /* ------------------------------------------------------------- the grid */
  'schedule.grid.label': 'Day view grid',
  'schedule.grid.timeColumn': 'Time',
  'schedule.grid.timeRange': '{start} to {end}',
  'schedule.grid.doubleBooked': 'Double-booked',
  'schedule.grid.now': 'Now {time}',

  /* --------------------------------------------------------- the day rail */
  'schedule.dayRail.overline': 'Today',
  'schedule.dayRail.title': 'Day at a glance',
  /* Counters, not statuses: "Booked" here spans proposed, pending and booked,
     and "In the building" is four states at once. Their own messages, so a
     translator can name the group rather than one of the states in it. */
  'schedule.dayRail.counter.booked': 'Booked',
  'schedule.dayRail.counter.inTheBuilding': 'In the building',
  'schedule.dayRail.counter.checkedOut': 'Checked out',
  'schedule.dayRail.counter.noShow': 'No show',
  'schedule.dayRail.counter.cancelled': 'Cancelled',
  'schedule.dayRail.selectedOverline': 'Selected visit',
  'schedule.dayRail.noVisitSelected': 'No visit selected',
  'schedule.dayRail.selectPrompt':
    'Select a visit in the grid to check the patient in, open their chart, or verify coverage.',
  'schedule.dayRail.openChart': 'Open chart',
  'schedule.dayRail.insurance': 'Insurance and eligibility',
  'schedule.dayRail.noRoomAssigned': 'No room assigned',

  /* ------------------------------------------------------------- check-in */
  'schedule.checkIn.title': 'Check in this patient',
  'schedule.checkIn.describe':
    'Check in {name} for the {time} {visitType}. This moves them onto the Flow Board.',
  'schedule.checkIn.describeUnassigned': 'Check in this visit. This moves it onto the Flow Board.',
  'schedule.checkIn.named': 'Check in {name}',
  'schedule.checkIn.generic': 'Check in',
  'schedule.checkIn.visit': 'Check in visit',
  'schedule.checkIn.already': 'Already checked in',
  'schedule.checkIn.submitting': 'Checking in...',
  'schedule.checkIn.toast.title': 'Checked in',
  'schedule.checkIn.toast.message': '{name} is on the Flow Board.',
  'schedule.checkIn.toast.messageUnassigned': 'The visit is on the Flow Board.',
  'schedule.checkIn.toast.openFlowBoard': 'Open the Flow Board',

  /* -------------------------------------------------------------- booking */
  'schedule.booking.title': 'Book appointment',
  'schedule.booking.description':
    '{start} to {end} with {provider}. Booking holds the slot immediately.',
  'schedule.booking.patient': 'Patient',
  'schedule.booking.visitType': 'Visit type',
  'schedule.booking.visitTypeHint': 'Drives the slot length.',
  'schedule.booking.reason': 'Reason for visit',
  'schedule.booking.reasonHint': 'Optional. One line the provider reads before walking in.',
  'schedule.booking.submitNamed': 'Book {name}',
  'schedule.booking.submitting': 'Booking...',
  'schedule.booking.toast.title': 'Appointment booked',
  'schedule.booking.toast.message': '{name} is booked at {time} for a {visitType}.',
  'schedule.booking.toast.messageUnassigned': 'The patient is booked at {time} for a {visitType}.',

  /* ------------------------------------------------------- find available */
  'schedule.findAvailable.overline': 'Find available',
  'schedule.findAvailable.title': 'Next open {minutes}-minute slots',
  'schedule.findAvailable.hide': 'Hide open slots',
  'schedule.findAvailable.none':
    'No slot fits {minutes} minutes on this day. Add the patient to the waitlist, or look at tomorrow with the day pager.',
  'schedule.findAvailable.book': 'Book {time} with {provider}',

  /* ----------------------------------------------------------- flow board */
  'schedule.flowBoard.title': 'Flow Board',
  'schedule.flowBoard.description':
    'Where every patient is right now, and how long they have been there.',
  'schedule.flowBoard.subject': 'the flow board',
  /* A label in front of a clock, not half a sentence: the time beside it is
     rendered in the monospace face that every instant in this application uses,
     and folding it into the message would take that away. */
  'schedule.flowBoard.lastRead': 'Last read at',
  'schedule.flowBoard.backToSchedule': 'Back to the schedule',
  'schedule.flowBoard.goToSchedule': 'Go to the schedule',
  'schedule.flowBoard.filtersOverline': 'Filters',
  'schedule.flowBoard.filtersTitle': 'Narrow the board',
  'schedule.flowBoard.delayedOnly': 'Delayed patients only',
  'schedule.flowBoard.delayedOnlyHint': 'Waiting 15 minutes or more in a pre-visit status.',
  'schedule.flowBoard.columnLabelOne': '{column}, {count} patient',
  'schedule.flowBoard.columnLabelOther': '{column}, {count} patients',
  'schedule.flowBoard.columnEmpty': 'Nobody here right now.',
  'schedule.flowBoard.empty.title': 'No patients on the board yet',
  'schedule.flowBoard.empty.message':
    'Patients appear here the moment they are checked in. Check the first arrival in from the schedule.',
  'schedule.flowBoard.undo': 'Undo',
  'schedule.flowBoard.refused': 'That move was refused',
  'schedule.flowBoard.moved': '{name} moved from {from} to {to}.',
  'schedule.flowBoard.movedUnassigned': 'This visit moved from {from} to {to}.',
  'schedule.flowBoard.movedBack': 'Moved back to {status}.',
  'schedule.flowBoard.roomAssigned': 'Room assigned',
  'schedule.flowBoard.roomMessage': '{name} is in {room}.',
  'schedule.flowBoard.roomMessageUnassigned': 'This visit is in {room}.',
  'schedule.flowBoard.roomUndoMessage': '{name} is back in {room}.',
  'schedule.flowBoard.roomUndoMessageUnassigned': 'This visit is back in {room}.',
  'schedule.flowBoard.command.showAll': 'Show every patient on the board',
  'schedule.flowBoard.command.showDelayed': 'Show delayed patients only',
  'schedule.flowBoard.command.delayed.keywords': 'delay, waiting, late, filter',
  'schedule.flowBoard.command.clearFilters': 'Clear board filters',
  'schedule.flowBoard.command.clearFilters.keywords': 'reset, all providers, all rooms',
  'schedule.flowBoard.command.refresh': 'Read the board again',
  'schedule.flowBoard.command.refresh.keywords': 'refresh, sync, reload',

  /* ------------------------------------------------------------ flow card */
  'schedule.flowCard.unassignedVisit': 'Unassigned visit',
  'schedule.flowCard.waiting': 'Waiting {elapsed}',
  'schedule.flowCard.delayed': 'Delayed {elapsed}',
  'schedule.flowCard.noRoom': 'No room',
  'schedule.flowCard.inThisStatus': 'In this status',
  'schedule.flowCard.inTheBuilding': 'In the building',
  'schedule.flowCard.roomFor': 'Room for {name}',
  'schedule.flowCard.assignRoom': 'Assign a room',
  'schedule.flowCard.advance': 'Move {name} to {status}',
  'schedule.flowCard.advanceUnassigned': 'Move this visit to {status}',
  'schedule.flowCard.complete': 'Visit complete',

  /* ------------------------------------------------------- the browser tab */
  /*
   * A route file is a server component, so it cannot reach `useTranslator`.
   * `lib/i18n/metadata.ts` builds its own translator and looks these up. The tab
   * strip is often all a tired person has to tell nine open screens apart.
   */
  'schedule.page.title': 'Schedule',
  'schedule.flowBoard.page.title': 'Flow Board',
};
