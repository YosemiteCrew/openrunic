/**
 * The patient assistant surface.
 *
 * A sibling of the one clinicians use, not a fork of it: the same probe, the
 * same fail-shut default, the same rule that an answer without its records is
 * not shown. What differs is what it is allowed to reach, what it is allowed to
 * say, and where it sends somebody when the honest answer is "ask a person".
 */

export { AssistantProvider, useAssistant } from './AssistantProvider';
export type { AssistantContextValue, AssistantProviderProps } from './AssistantProvider';

export { AssistantComposer } from './AssistantComposer';
export type { AssistantComposerProps } from './AssistantComposer';

export { AssistantReadback } from './AssistantReadback';
export type { AssistantReadbackProps } from './AssistantReadback';

export { AssistantTurnView } from './AssistantTurn';
export type { AssistantTurnViewProps } from './AssistantTurn';

export { citationDestination, citationHref, citationName } from './citations';
export { needsCareTeam } from './escalation';
export { explainFailure } from './failure';

export {
  EMPTY_TRANSCRIPT,
  announcementFor,
  offersCareTeam,
  transcriptReducer,
  trimToLastSentence,
} from './transcript';
export type {
  AssistantStep,
  AssistantTurn,
  TranscriptAction,
  TranscriptState,
  TurnOutcome,
  WithheldReason,
} from './transcript';

export { SILENT, readbackReducer, speakableAnswer } from './readback';
export type { ReadbackAction, ReadbackEnding, ReadbackState, Speaking } from './readback';

export { useConversation } from './useConversation';
export type { Conversation } from './useConversation';

export { useReadback } from './useReadback';
export type { Readback } from './useReadback';
