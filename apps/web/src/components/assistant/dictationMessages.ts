/**
 * The sentences the dictation control says, kept apart from the control so the
 * component module exports only components.
 */

import type { MessageKey } from '@openrunic/i18n';

/**
 * Every sentence this control says, by what it is saying. The assistant's are
 * the default; a surface that asks something other than a question - the
 * schedule's slot request - hands its own, and the rules stay the same ones.
 */
export interface DictationMessages {
  speak: MessageKey;
  stop: MessageKey;
  hint: MessageKey;
  hintHosted: MessageKey;
  noLanguage: MessageKey;
  noLanguageHosted: MessageKey;
  notInstalled: MessageKey;
  starting: MessageKey;
  listening: MessageKey;
  denied: MessageKey;
  noSpeech: MessageKey;
  noAudio: MessageKey;
  offDevice: MessageKey;
  failed: MessageKey;
}

export const ASSISTANT_DICTATION_MESSAGES: DictationMessages = {
  speak: 'assistant.dictation.speak',
  stop: 'assistant.dictation.stop',
  hint: 'assistant.dictation.hint',
  hintHosted: 'assistant.dictation.hintHosted',
  noLanguage: 'assistant.dictation.noLanguage',
  noLanguageHosted: 'assistant.dictation.noLanguageHosted',
  notInstalled: 'assistant.dictation.notInstalled',
  starting: 'assistant.dictation.starting',
  listening: 'assistant.dictation.listening',
  denied: 'assistant.dictation.denied',
  noSpeech: 'assistant.dictation.noSpeech',
  noAudio: 'assistant.dictation.noAudio',
  offDevice: 'assistant.dictation.offDevice',
  failed: 'assistant.dictation.failed',
};
