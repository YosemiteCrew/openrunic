import type { Translator } from '@openrunic/i18n';

import { AGENT_TRANSPORT_FAILED } from '@/lib/agent';

import type { AssistantFailure } from './transcript';

/**
 * What a failed turn says, in the register `explain()` already set for the rest
 * of the app: state the fact, then what to do, never blame the reader and never
 * show a code where a sentence belongs.
 *
 * Every line here also says what is unaffected. ADR-0005's whole architectural
 * claim is that a dead endpoint costs a clinic its assistant and nothing else,
 * and a clinician reading a failure at 4pm has no way to know that unless the
 * failure says so.
 */

export interface FailureExplanation {
  title: string;
  message: string;
}

/** Catalogue keys per code. The words themselves live in `en/assistant.ts`. */
const TABLE: Record<string, { titleKey: string; messageKey: string }> = {
  [AGENT_TRANSPORT_FAILED]: {
    titleKey: 'assistant.failure.transport.title',
    messageKey: 'assistant.failure.transport.message',
  },
  AGENT_UPSTREAM_UNREACHABLE: {
    titleKey: 'assistant.failure.upstream.title',
    messageKey: 'assistant.failure.upstream.message',
  },
  AGENT_QUOTA_EXCEEDED: {
    titleKey: 'assistant.failure.quota.title',
    messageKey: 'assistant.failure.quota.message',
  },
  AGENT_TURN_LIMIT: {
    titleKey: 'assistant.failure.turnLimit.title',
    messageKey: 'assistant.failure.turnLimit.message',
  },
  AGENT_SCOPE_DENIED: {
    titleKey: 'assistant.failure.scope.title',
    messageKey: 'assistant.failure.scope.message',
  },
  AGENT_COMPARTMENT_VIOLATION: {
    titleKey: 'assistant.failure.compartment.title',
    messageKey: 'assistant.failure.compartment.message',
  },
  AGENT_RESPONSE_INVALID: {
    titleKey: 'assistant.failure.invalid.title',
    messageKey: 'assistant.failure.invalid.message',
  },
};

/**
 * The fallback uses the server's own `detail`, which is always a written
 * sentence rather than a code. That is why an unmapped code still reads as
 * product copy: the API never sends a stack trace or a provider message here.
 * It is also why the fallback message is not translated - it is the
 * deployment's own words, and a second version of them written here would say
 * something the audit trail does not record.
 */
export function describeFailure(t: Translator, failure: AssistantFailure): FailureExplanation {
  const known = TABLE[failure.code];
  if (known === undefined) {
    return { title: t('assistant.failure.unknown.title'), message: failure.detail };
  }
  return { title: t(known.titleKey), message: t(known.messageKey) };
}
