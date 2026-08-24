import type { Messages } from '../../catalogue.js';

/**
 * REPORTS: THE PRACTICE DASHBOARD AND THE REPORT SHELL UNDER IT.
 *
 * Operational rather than clinical. Everything here counts visits, claims,
 * money and unsigned notes; nothing names a diagnosis, a medicine or a lab
 * value, so all of it can be translated by anybody who speaks the language.
 *
 * What is deliberately NOT here: the tile labels, the funnel stage names and
 * the ageing bucket names. Those arrive from the API already worded, and the
 * dashboard renders what it was given rather than a second name for it.
 *
 * `{subject}` messages are in `common`. The two subjects this screen supplies
 * to them are `reports.subject.*`, which is why they read as noun phrases in
 * lower case and with no full stop: they are dropped into somebody else's
 * sentence.
 */
export const reports: Messages = {
  'reports.title': 'Reports',
  'reports.description': 'Is the practice healthy today, and the numbers behind the answer.',

  'reports.subject.dashboard': 'the practice dashboard',
  'reports.subject.visits': 'the visits report',

  'reports.action.export': 'Export the visits report',
  'reports.action.exportCsv': 'Export CSV',
  'reports.command.export.keywords': 'csv, download, visits',
  'reports.command.week.label': 'Report on this week',
  'reports.command.week.keywords': 'date range, reset filters',

  /* ----------------------------------------------------- RP-01, the dashboard */
  'reports.dashboard.empty.title': 'Nothing to report yet',
  'reports.dashboard.empty.message':
    'The dashboard fills in as the practice works: visits booked, notes signed, claims submitted. Book the first appointment and it starts here.',
  'reports.dashboard.empty.action': 'Go to the schedule',
  'reports.dashboard.asOf': 'As of {when}. Every number opens the workbench that owns it.',

  /* One tile. The label and the state word come from the API; the trend and the
     link around them are the interface's own words. */
  'reports.tile.trend': 'Last 7 days, {trend}',
  'reports.tile.open': 'Open {label}',
  'reports.trend.rising': 'rising',
  'reports.trend.falling': 'falling',
  'reports.trend.steady': 'steady',

  'reports.funnel.title': 'Claims, captured to paid',
  'reports.funnel.lede': 'Counts this month. The gap between two stages is where money waits.',
  'reports.funnel.meterLabel': 'Claim funnel by stage',
  'reports.funnel.claimCount': '{count} claims',
  'reports.funnel.needsBiller': 'Needs a biller',
  'reports.funnel.link': 'Open the claim workbench',

  'reports.aging.title': 'Accounts receivable by age',
  'reports.aging.lede':
    'Payer and patient responsibility, split. Over 90 days is the number to watch.',
  'reports.aging.meterLabel': 'Accounts receivable by age',
  'reports.aging.split': 'Payer {payer}, patient {patient}',
  'reports.aging.link': 'Open collections',

  'reports.unsigned.title': 'Unsigned notes by provider',
  'reports.unsigned.caption': 'Unsigned notes by provider',
  'reports.unsigned.days': '{days} days',
  'reports.unsigned.late': 'Past the 48 hour target',
  'reports.unsigned.onTarget': 'Within target',

  /* --------------------------------------------------- RP-02, the report shell */
  'reports.visits.title': 'Visits',
  'reports.visits.description':
    'Every visit in the range with its duration, charges and claim state. The same shell carries every other report in openrunic; only the filters and columns change.',
  'reports.visits.caption': 'Visits from {from} to {to}',
  'reports.visits.empty.title': 'No visits match these filters',
  'reports.visits.empty.message':
    'Nothing happened in this range for the chosen provider and status. Widen the dates, or clear the provider to see the whole practice.',
  'reports.visits.empty.action': 'Reset to this week',

  'reports.filter.label': 'Filter the visits report',
  'reports.filter.summary': '{visits} visits, {minutes} minutes, {charges}',
  'reports.filter.from': 'From',
  'reports.filter.to': 'To',
  'reports.filter.provider': 'Provider',
  'reports.filter.status': 'Status',
  'reports.filter.allProviders': 'All providers',
  'reports.filter.allStatuses': 'All statuses',

  /* Column headings, shared by the table on screen and the CSV a person opens
     in a spreadsheet. One set rather than two, because a column that is called
     one thing on screen and another in the export is the same defect as a
     mistranslation with extra steps. */
  'reports.column.date': 'Date',
  'reports.column.time': 'Time',
  'reports.column.patient': 'Patient',
  'reports.column.mrn': 'MRN',
  'reports.column.provider': 'Provider',
  'reports.column.facility': 'Facility',
  'reports.column.visitType': 'Visit type',
  'reports.column.status': 'Status',
  'reports.column.minutes': 'Minutes',
  'reports.column.charges': 'Charges',
  'reports.column.claim': 'Claim',
  'reports.column.claimState': 'Claim state',
  'reports.column.unsigned': 'Unsigned',
  'reports.column.oldest': 'Oldest',
  'reports.column.state': 'State',

  'reports.totals.visits': 'Visits',
  'reports.totals.minutes': 'Minutes',
  'reports.totals.charges': 'Charges',

  'reports.export.done': 'Exported {count} visits for {from} to {to}.',
  'reports.export.unsupported': 'This browser cannot download files. Copy the table instead.',
};
