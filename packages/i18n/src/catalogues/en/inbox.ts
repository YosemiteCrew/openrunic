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
 * What is NOT here: the words on an inbox row itself. `summary`, `detail`,
 * `actionLabel` and `doneLabel` all arrive on the item from the API, which is
 * what wrote them and what a disposition is audited against.
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
  'inbox.rail.openItems': '{count} open items',
  'inbox.rail.overdueSummary': '{count} past their due time. The oldest is {oldest}.',
  'inbox.rail.nothingOverdue': 'Nothing is overdue. The oldest item is still inside its promise.',
  'inbox.rail.auditNote':
    'Every disposition here is audited, and an approval can be undone from the toast while it is still on screen.',

  /* -------------------------------------------------------------- the rows */
  'inbox.list.label': 'Inbox items',
  'inbox.list.practiceWide': 'Practice-wide',
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
};
