import type { Messages } from '../../catalogue.js';

/**
 * The assistant panel, its composer and its turns.
 *
 * ## Why there is no `es/assistant.ts` beside this
 *
 * The assistant answers about the record, so its surface is a clinical surface:
 * the sentence that says an answer was withheld for arriving without its
 * sources is a sentence a clinician acts on. Those need a Spanish-speaking
 * clinician rather than a developer with a dictionary, and until one has read
 * them `lookup` falls back to English and records that it fell back - which
 * reads as obviously untranslated rather than as confidently wrong.
 * `catalogues.test.ts` refuses a Spanish `assistant.` key for that reason.
 *
 * ## What is not here
 *
 * Everything the server wrote. A step's label, a tool's summary, a draft
 * field's label and value, a deferral's reason, and the `detail` on a failure
 * this app has no line for all arrive on the event. They are the words the
 * deployment's own agent chose, and a second name for them invented here would
 * diverge from what the audit trail recorded.
 */
export const assistant: Messages = {
  /* One message for the launcher, the landmark and the heading. Three keys
     would be three chances for the button and the panel it opens to disagree
     about what the surface is called. */
  'assistant.name': 'Assistant',
  'assistant.close': 'Close the assistant',

  'assistant.panel.purpose':
    'Documentation support. It finds what is already in the record and shows what each answer was drawn from. It does not advise, does not rank, and does not say what is urgent.',
  'assistant.panel.scope': 'Answers are limited to the chart you have open.',
  'assistant.panel.capabilities': 'What it can reach here ({count})',
  'assistant.panel.intro':
    'Ask about the record in front of you. Every answer shows the rows it was drawn from, and you can open each one.',

  /* ADR-0005 restates the no-telemetry promise as a sentence in the product,
     on the surface whose reader is the one typing. Two messages, because the
     second is what changes and the first is what stays true. */
  'assistant.model.source': 'Answers come from {model} at {host}.',
  'assistant.model.leaves':
    'What you type here leaves this deployment and is sent to that endpoint.',
  'assistant.model.stays': 'Nothing you type here leaves this deployment.',

  'assistant.composer.label': 'Ask about this record',
  'assistant.composer.placeholder': 'What did the last visit record about the knee?',
  'assistant.composer.hint': 'Enter sends, Shift and Enter start a new line.',
  'assistant.composer.stop': 'Stop',
  'assistant.composer.ask': 'Ask',

  'assistant.command.open': 'Ask the assistant',
  'assistant.command.open.keywords': 'assistant, ask, question, search the chart',

  /* ------------------------------------------------------------- one turn */
  'assistant.turn.youAsked': 'You asked:',
  /* The step's state is in the word as well as the glyph, because a screen
     reader announces neither the icon nor the data attribute. The label is the
     server's, so it is a value here rather than part of the message. */
  'assistant.turn.stepDone': '{step} - done',
  'assistant.turn.stepRunning': '{step} - running',
  'assistant.turn.deferred': 'The assistant did not go ahead with {tool}: {reason}',
  'assistant.turn.stopped': 'You stopped this answer.',
  'assistant.turn.stillAnswering': 'Still answering.',

  'assistant.withheld.unsourced':
    'The answer arrived without the records it was drawn from, so it is not shown. An answer you cannot check against the chart is not one to work from.',
  'assistant.withheld.incomplete':
    'Stopped before the first complete sentence, so there is nothing to show.',

  /* ------------------------------------------------------------- citations */
  'assistant.sources.heading': 'Drawn from',
  'assistant.sources.untrusted': 'Patient-written or outside text',
  /* How a resource type reads to a person. Only the types whose API name is not
     already the word a clinician uses; everything else falls through to the
     server's own noun rather than gaining a second name here. */
  'assistant.citation.note': 'Note',
  'assistant.citation.result': 'Result',
  'assistant.citation.problemList': 'Problem list',

  /* ---------------------------------------------------------------- drafts */
  'assistant.draft.heading': 'Draft - nothing has been saved',
  'assistant.draft.note':
    'Open the record and make the change yourself. openrunic does not save anything the assistant drafts.',
  'assistant.draft.untrusted': 'Based partly on patient-written or outside text.',

  /* ------------------------------------------------------- the live region */
  /* One short sentence per state change. The transcript itself is not a live
     region: marking streaming prose live makes a screen reader restart the
     answer on every token.

     The source count is two messages rather than one with a plural rule,
     because the catalogue is flat strings and a count of one is the only case
     English distinguishes here. A language with more categories gets its own
     pair of files and its own decision. */
  'assistant.announce.answering': 'The assistant is answering.',
  'assistant.announce.failed': 'The assistant could not answer.',
  'assistant.announce.stoppedNoAnswer': 'Stopped. No answer is shown.',
  'assistant.announce.unsourced': 'No answer is shown, because it arrived without its sources.',
  'assistant.announce.ready': 'Answer ready, drawn from {count} records.',
  'assistant.announce.readyOne': 'Answer ready, drawn from {count} record.',
  'assistant.announce.stoppedPartial': 'Stopped. Partial answer, drawn from {count} records.',
  'assistant.announce.stoppedPartialOne': 'Stopped. Partial answer, drawn from {count} record.',

  /* -------------------------------------------------------------- failures */
  /* Every line says what happened, what to do, and what is unaffected.
     ADR-0005's architectural claim is that a dead endpoint costs a clinic its
     assistant and nothing else, and a clinician reading this at 4pm has no way
     to know that unless the failure says so. */
  'assistant.failure.transport.title': 'The assistant could not be reached',
  'assistant.failure.transport.message':
    'openrunic could not open a connection to the assistant. Check the connection and ask again. Charts, the schedule and orders are unaffected.',
  'assistant.failure.upstream.title': 'The model endpoint did not answer',
  'assistant.failure.upstream.message':
    'The endpoint this clinic configured did not respond, so there is no answer. Nothing else in openrunic depends on it: charts, the schedule and orders all work as normal.',
  'assistant.failure.quota.title': 'The assistant has spent its allowance',
  'assistant.failure.quota.message':
    'This clinic set a ceiling on assistant use and it has been reached for now. Ask a practice admin to raise it. Nothing else is affected.',
  'assistant.failure.turnLimit.title': 'The assistant ran out of time',
  'assistant.failure.turnLimit.message':
    'It took longer than one turn is allowed and was stopped before it finished. Ask again with a narrower question.',
  'assistant.failure.scope.title': 'The assistant asked for something it does not have',
  'assistant.failure.scope.message':
    'It requested a capability your role does not grant it. The request was refused and nothing was read.',
  'assistant.failure.compartment.title': 'The assistant reached outside the open chart',
  'assistant.failure.compartment.message':
    'It tried to read a record outside the chart you have open, so the turn was stopped and nothing is shown. Report this if it happens again.',
  'assistant.failure.invalid.title': 'The endpoint answered in a shape openrunic could not read',
  'assistant.failure.invalid.message':
    'Nothing was shown, because openrunic will not guess at a malformed answer. Ask again; if it keeps happening, report it to whoever configured the endpoint.',
  /* The unmapped case keeps the server's own `detail` as its message, which is
     always a written sentence rather than a code, so only the heading is here. */
  'assistant.failure.unknown.title': 'That did not complete',
};
