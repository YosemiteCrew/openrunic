import type { Messages } from '../../catalogue.js';

/**
 * The worklist: tasks, messages, refills, cosigns.
 *
 * ## Two forms of every stream name, and of every SLA phrase
 *
 * The five streams are named as headings ("Refills"), and they are also named
 * inside sentences the screen builds around them ("No refills waiting", "Show
 * refills in the inbox"). The same is true of the SLA phrase: it is a badge on
 * its own row, and it is a clause in the rail's summary of the queue.
 *
 * Each therefore has a second message under `inline`, written for the middle of
 * a sentence, rather than the code lowercasing the first one. Lowercasing
 * translated text is a per-language decision code cannot make: German
 * capitalises its nouns wherever they stand, and Turkish has two i rules that
 * turn a correct word into a wrong one. The pair also lets a translator write
 * the two positions differently where a language needs to, which is the case
 * `toLowerCase()` cannot express at all.
 *
 * ## The verb on a row is a property of its stream, so it lives here
 *
 * It used to be a field on the item, on the reasoning that the API wrote it and
 * a disposition is audited against those words. The API writes no such field -
 * a task carries a title, a description and an outcome - and the eleven fixture
 * rows that carried one held five distinct values between them, one per stream.
 * So it was a per-stream constant written eleven times in English, in a screen
 * whose every other word is translated.
 *
 * What IS still the item's own: `summary` and `detail`, which are the task's
 * title and description as somebody typed them, and are left in whatever
 * language the deployment wrote them in.
 */
export const inbox: Messages = {
  'inbox.title': 'Inbox',
  'inbox.description': 'Results, messages, refills and cosigns, in one typed queue.',
  'inbox.subject': 'the inbox',

  /* --------------------------------------------------------- the streams */
  'inbox.stream.results': 'Results',
  'inbox.stream.messages': 'Messages',
  'inbox.stream.refills': 'Refills',
  'inbox.stream.cosign': 'Cosign',
  'inbox.stream.tasks': 'Tasks',

  'inbox.stream.inline.results': 'results',
  'inbox.stream.inline.messages': 'messages',
  'inbox.stream.inline.refills': 'refills',
  'inbox.stream.inline.cosign': 'cosign',
  'inbox.stream.inline.tasks': 'tasks',

  'inbox.streamTitle': '{stream} stream',

  /* ---------------------------------------------------------- the filters */
  'inbox.filter.label': 'Filter by stream',
  'inbox.filter.everything': 'Everything',
  'inbox.filter.mine': 'Mine',
  'inbox.filter.teamPool': 'Team pool',
  'inbox.filter.assignment': 'Assignment',

  /* -------------------------------------------------------------- the SLA */
  'inbox.sla.overdue': 'Overdue by {elapsed}',
  'inbox.sla.dueSoon': 'Due in {elapsed}',
  'inbox.sla.onTime': 'Due {when}',

  'inbox.sla.inline.overdue': 'overdue by {elapsed}',
  'inbox.sla.inline.dueSoon': 'due in {elapsed}',
  'inbox.sla.inline.onTime': 'due {when}',

  /* ------------------------------------------------------------- the rail */
  'inbox.rail.overline': 'Today',
  'inbox.rail.openItemsOne': '{count} open item',
  'inbox.rail.openItemsOther': '{count} open items',
  'inbox.rail.overdueSummaryOne': '{count} past its due time. The oldest is {oldest}.',
  'inbox.rail.overdueSummaryOther': '{count} past their due time. The oldest is {oldest}.',
  'inbox.rail.windowOne':
    '{count} of {total} items. The rest are on pages this screen cannot reach.',
  'inbox.rail.windowOther':
    '{count} of {total} items. The rest are on pages this screen cannot reach.',
  'inbox.rail.notShownOne':
    '{count} of the items on this page is not listed, because it belongs to an administrative worklist rather than this one.',
  'inbox.rail.notShownOther':
    '{count} of the items on this page are not listed, because they belong to an administrative worklist rather than this one.',
  'inbox.rail.nothingOverdue': 'Nothing is overdue. The oldest item is still inside its promise.',
  'inbox.rail.auditNote':
    'Every disposition here is audited, and an approval can be undone from the toast while it is still on screen.',

  /* -------------------------------------------------------------- the rows */
  'inbox.stream.action.results': 'Review result',
  'inbox.stream.action.messages': 'Reply',
  'inbox.stream.action.refills': 'Approve refill',
  'inbox.stream.action.cosign': 'Cosign note',
  'inbox.stream.action.tasks': 'Mark done',

  'inbox.stream.done.results': 'Result opened',
  'inbox.stream.done.messages': 'Reply sent',
  'inbox.stream.done.refills': 'Refill approved',
  'inbox.stream.done.cosign': 'Note cosigned',
  'inbox.stream.done.tasks': 'Task closed',

  'inbox.list.label': 'Inbox items',
  'inbox.list.practiceWide': 'Practice-wide',
  'inbox.list.unnamedPatient': 'Patient record',
  'inbox.list.received': 'Received {when}',
  'inbox.list.unread': 'Unread',
  'inbox.list.assignToMe': 'Assign to me',
  'inbox.list.open': 'Open',
  'inbox.list.assigned': 'Assigned to you',
  'inbox.list.undo': 'Undo',

  /* ------------------------------------------------------- the empty states */
  'inbox.empty.streamTitle': 'No {stream} waiting',
  'inbox.empty.streamMessage':
    'Nothing in this stream needs you. Clear the filter to see the rest of the queue.',
  'inbox.empty.allTitle': 'Inbox zero, for now',
  'inbox.empty.allMessage': 'New results, messages, refills and cosigns land here as they arrive.',
  'inbox.empty.goToSchedule': 'Go to the schedule',

  /* --------------------------------------------------------- the commands */
  'inbox.command.showStream': 'Show {stream} in the inbox',
  'inbox.command.showStream.keywords': 'filter inbox',
  'inbox.command.showAll': 'Show every inbox stream',
  'inbox.command.showAll.keywords': 'clear filter',
  'inbox.command.mine': 'Show only my inbox items',
  'inbox.command.mine.keywords': 'assigned to me',
  'inbox.command.team': 'Show the team pool',
  'inbox.command.team.keywords': 'shared queue, unassigned',

  /* ------------------------------------------------------- the browser tab */
  /*
   * A route file is a server component, so it cannot reach `useTranslator`.
   * `lib/i18n/metadata.ts` builds its own translator and looks these up. The tab
   * strip is often all a tired person has to tell nine open screens apart.
   */
  'inbox.page.title': 'Inbox',
};
