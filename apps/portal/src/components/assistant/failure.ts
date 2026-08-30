import type { Translator } from '@openrunic/i18n';

import { ASSISTANT_UNEXPECTED_DRAFT, ASSISTANT_UNREACHABLE } from '@/lib/assistant';

/**
 * What a turn that did not work says, in the voice the rest of the portal uses:
 * the fact first, what to do second, addressed as "you", never blaming the
 * reader, and never a code where a sentence belongs.
 *
 * Every line also says what is unaffected. ADR-0005's architectural claim is
 * that a dead endpoint costs a clinic its assistant and nothing else, and
 * somebody whose question just failed has no way to know that their
 * appointments and their bills are fine unless the failure says so.
 *
 * The lines are short and there are no branches inside them. A reader who has
 * just been told the thing did not work should not then have to parse a
 * paragraph about why.
 *
 * The map holds keys rather than sentences, keyed by the code the server sent.
 * The property name is the code, not `somethingKey`, so `catalogue-drift.test.ts`
 * reaches these the other way round: every key the catalogue defines has to
 * appear in the source.
 */
const SENTENCE_KEYS: Readonly<Record<string, string>> = {
  [ASSISTANT_UNREACHABLE]: 'portal.assistant.failure.unreachable',
  [ASSISTANT_UNEXPECTED_DRAFT]: 'portal.assistant.failure.unexpectedDraft',
  AGENT_UPSTREAM_UNREACHABLE: 'portal.assistant.failure.upstreamUnreachable',
  AGENT_QUOTA_EXCEEDED: 'portal.assistant.failure.quotaExceeded',
  AGENT_TURN_LIMIT: 'portal.assistant.failure.turnLimit',
  AGENT_SCOPE_DENIED: 'portal.assistant.failure.scopeDenied',
  AGENT_COMPARTMENT_VIOLATION: 'portal.assistant.failure.compartmentViolation',
  AGENT_RESPONSE_INVALID: 'portal.assistant.failure.responseInvalid',
  AGENT_TOOL_FAILED: 'portal.assistant.failure.toolFailed',
};

/**
 * The fallback says only what is certainly true.
 *
 * The server's own `detail` is deliberately not used here, unlike on the staff
 * surface. It is written for somebody who works at the practice, it can name a
 * capability or a code, and a sentence written for a colleague is the wrong
 * register for the person whose record it is. It is also the one string on this
 * page that would arrive in the source language whatever the reader chose.
 */
export function explainFailure(t: Translator, code: string): string {
  return t(SENTENCE_KEYS[code] ?? 'portal.assistant.failure.unknown');
}
