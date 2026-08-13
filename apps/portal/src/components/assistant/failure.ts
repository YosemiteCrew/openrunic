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
 */

const SENTENCES: Readonly<Record<string, string>> = {
  [ASSISTANT_UNREACHABLE]:
    'The assistant could not be reached. Your appointments, messages, forms and bills all still work. Try again in a moment.',
  [ASSISTANT_UNEXPECTED_DRAFT]:
    'Something came back that this page will not show you. Nothing in your record has changed. Please tell your care team you saw this.',
  AGENT_UPSTREAM_UNREACHABLE:
    'The service that writes these answers did not reply, so there is no answer. Nothing else in the portal depends on it.',
  AGENT_QUOTA_EXCEEDED:
    'The assistant has been used as much as your practice allows for now. Everything else in the portal still works.',
  AGENT_TURN_LIMIT:
    'That took longer than one question is allowed. Try asking for one thing at a time.',
  AGENT_SCOPE_DENIED:
    'The assistant asked for something it is not allowed to look at. It was refused and nothing was read.',
  AGENT_COMPARTMENT_VIOLATION:
    'Something came back that was not from your record, so the answer was thrown away and nothing is shown. Please tell your care team you saw this.',
  AGENT_RESPONSE_INVALID:
    'The answer came back in a shape this page could not read, so nothing is shown rather than a guess at it.',
  AGENT_TOOL_FAILED: 'Your record could not be read just now. Try again in a moment.',
};

/**
 * The fallback says only what is certainly true.
 *
 * The server's own `detail` is deliberately not used here, unlike on the staff
 * surface. It is written for somebody who works at the practice, it can name a
 * capability or a code, and a sentence written for a colleague is the wrong
 * register for the person whose record it is.
 */
export function explainFailure(code: string): string {
  return (
    SENTENCES[code] ??
    'That did not work. Nothing in your record has changed, and the rest of the portal is fine.'
  );
}
