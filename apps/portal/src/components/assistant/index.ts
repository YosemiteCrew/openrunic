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

export { AssistantDictation } from './AssistantDictation';
export type { AssistantDictationProps } from './AssistantDictation';

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

export { speakableAnswer } from './readback';

/* The voice itself is shared with the staff surface. Re-exported here so that
   everything this surface knows about readback still arrives from one import. */
export { SILENT, readbackReducer, useReadback } from '@openrunic/voice';
export type {
  Readback,
  ReadbackAction,
  ReadbackEnding,
  ReadbackState,
  Speaking,
} from '@openrunic/voice';

export { useConversation } from './useConversation';
export type { Conversation } from './useConversation';

export { IDLE, appendDictation, dictationReducer, useDictation } from '@openrunic/voice';
export type {
  DictationAction,
  DictationEnding,
  DictationPhase,
  DictationSession,
  Dictation,
  DictationState,
} from '@openrunic/voice';
