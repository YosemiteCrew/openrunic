import type { Messages } from '../../catalogue.js';

/**
 * The dashboard and its exports.
 *
 * Operational rather than clinical: these are the words the practice owner
 * reads to answer "are we healthy today", and the report shell underneath them.
 * Nothing here names a code, a diagnosis or a medicine, which is what makes the
 * whole area safe to translate.
 *
 * The tile labels, the funnel stage names and the ageing bucket names are
 * deliberately absent. They arrive from the API already named, and giving a
 * server-supplied label a second name here is how two words for one number end
 * up on the same screen. See `./index.ts`.
 */
export const reports: Messages = {
  /* ------------------------------------------------------------ a stat tile */
  /* The tile's own words. Its label, its detail and its state word are not
     here: those arrive from the API already named, and `{label}` below is
     interpolated exactly as it came rather than re-cased to fit an English
     sentence. */
  'reports.tile.open': 'Open {label}',
  /* One message rather than a prefix joined to a word: the window and the
     direction sit where the language puts them, not where English does.
     `{days}` comes from the series rather than being written in, so it cannot
     go stale against a contract that says seven. */
  'reports.tile.trend': 'Last {days} days, {trend}',

  /* Which way the sparkline points. Words this codebase wrote about its own
     drawing, which is what makes them copy. */
  'reports.trend.rising': 'rising',
  'reports.trend.falling': 'falling',
  'reports.trend.steady': 'steady',

  'reports.title': 'Reports',
  'reports.description': 'Is the practice healthy today, and the numbers behind the answer.',

  /* The two data regions, as the noun phrase the loading and error copy drops
     into: "Loading the practice dashboard", "The server failed while loading
     the visits report". Lower case and no full stop, because they land mid
     sentence. */
  'reports.dashboardSubject': 'the practice dashboard',
  'reports.visitsSubject': 'the visits report',

  /* The export, offered twice on the screen and once in the palette. The
     keywords are the words a tired person types instead of the label, and are
     per-language rather than transliterations - the same rule the rail rows
     follow. */
  'reports.export': 'Export the visits report',
  'reports.export.keywords': 'csv, download, visits',
  'reports.exportCsv': 'Export CSV',
  'reports.exported.one': 'Exported {count} visit for {from} to {to}.',
  'reports.exported.other': 'Exported {count} visits for {from} to {to}.',
  'reports.exportUnsupported': 'This browser cannot download files. Copy the table instead.',
  'reports.thisWeek': 'Report on this week',
  'reports.thisWeek.keywords': 'date range, reset filters',

  /* RP-01, the practice dashboard. */
  'reports.dashboard.empty.title': 'Nothing to report yet',
  'reports.dashboard.empty.message':
    'The dashboard fills in as the practice works: visits booked, notes signed, claims submitted. Book the first appointment and it starts here.',
  'reports.dashboard.empty.action': 'Go to the schedule',
  'reports.asOf': 'As of {when}. Every number opens the workbench that owns it.',

  'reports.claims.title': 'Claims, captured to paid',
  'reports.claims.lead': 'Counts this month. The gap between two stages is where money waits.',
  'reports.claims.link': 'Open the claim workbench',
  'reports.funnel.label': 'Claim funnel by stage',
  'reports.funnel.claims.one': '{count} claim',
  'reports.funnel.claims.other': '{count} claims',
  'reports.funnel.needsBiller': 'Needs a biller',

  /* One key for the card heading and the meter's accessible name, because they
     are the same label for the same list and a screen reader announcing a
     different one from the heading above it would be reading two lists. */
  'reports.aging.title': 'Accounts receivable by age',
  'reports.aging.lead':
    'Payer and patient responsibility, split. Over 90 days is the number to watch.',
  'reports.aging.split': 'Payer {payer}, patient {patient}',
  'reports.aging.link': 'Open collections',

  'reports.unsigned.title': 'Unsigned notes by provider',
  'reports.unsigned.column.provider': 'Provider',
  'reports.unsigned.column.unsigned': 'Unsigned',
  'reports.unsigned.column.oldest': 'Oldest',
  'reports.unsigned.column.state': 'State',
  'reports.unsigned.days.one': '{count} day',
  'reports.unsigned.days.other': '{count} days',
  'reports.unsigned.late': 'Past the 48 hour target',
  'reports.unsigned.onTarget': 'Within target',

  /* RP-02, the report shell every other report is a configuration of. */
  'reports.visits.title': 'Visits',
  'reports.visits.description':
    'Every visit in the range with its duration, charges and claim state. The same shell carries every other report in openrunic; only the filters and columns change.',
  'reports.visits.filterLabel': 'Filter the visits report',
  'reports.visits.summary': '{visits} visits, {minutes} minutes, {charges}',
  'reports.visits.caption': 'Visits from {from} to {to}',
  'reports.visits.empty.title': 'No visits match these filters',
  'reports.visits.empty.message':
    'Nothing happened in this range for the chosen provider and status. Widen the dates, or clear the provider to see the whole practice.',
  'reports.visits.empty.action': 'Reset to this week',

  'reports.filter.from': 'From',
  'reports.filter.to': 'To',
  'reports.filter.provider': 'Provider',
  'reports.filter.status': 'Status',
  'reports.filter.allProviders': 'All providers',
  'reports.filter.allStatuses': 'All statuses',

  /* The six appointment states this filter offers, as this application words
     them. They are labels for an enum this codebase defines, which is what
     makes them copy rather than data; a visit's type and its claim state are
     not here, because those arrive from the API already named. */
  'reports.status.fulfilled': 'Fulfilled',
  'reports.status.checkedOut': 'Checked out',
  'reports.status.inProgress': 'In progress',
  'reports.status.roomed': 'Roomed',
  'reports.status.checkedIn': 'Checked in',
  'reports.status.noShow': 'No-show',

  'reports.visits.column.date': 'Date',
  'reports.visits.column.patient': 'Patient',
  'reports.visits.column.provider': 'Provider',
  'reports.visits.column.visitType': 'Visit type',
  'reports.visits.column.status': 'Status',
  'reports.visits.column.duration': 'Minutes',
  'reports.visits.column.charge': 'Charges',
  'reports.visits.column.claim': 'Claim',

  'reports.totals.visits': 'Visits',
  'reports.totals.minutes': 'Minutes',
  'reports.totals.charges': 'Charges',

  /* The exported file's header row. A person opens this in a spreadsheet and
     reads it, so it is copy; the values under it are the record and stay
     exactly as the API sent them. */
  'reports.csv.date': 'Date',
  'reports.csv.time': 'Time',
  'reports.csv.patient': 'Patient',
  'reports.csv.mrn': 'MRN',
  'reports.csv.provider': 'Provider',
  'reports.csv.facility': 'Facility',
  'reports.csv.visitType': 'Visit type',
  'reports.csv.status': 'Status',
  'reports.csv.minutes': 'Minutes',
  'reports.csv.charges': 'Charges',
  'reports.csv.claimState': 'Claim state',

  /* ------------------------------------------------------- the browser tab */
  /*
   * A route file is a server component, so it cannot reach `useTranslator`.
   * `lib/i18n/metadata.ts` builds its own translator and looks these up. The tab
   * strip is often all a tired person has to tell nine open screens apart.
   */
  'reports.page.title': 'Reports',
};
