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

const TABLE: Record<string, FailureExplanation> = {
  [AGENT_TRANSPORT_FAILED]: {
    title: 'The assistant could not be reached',
    message:
      'openrunic could not open a connection to the assistant. Check the connection and ask again. Charts, the schedule and orders are unaffected.',
  },
  AGENT_UPSTREAM_UNREACHABLE: {
    title: 'The model endpoint did not answer',
    message:
      'The endpoint this clinic configured did not respond, so there is no answer. Nothing else in openrunic depends on it: charts, the schedule and orders all work as normal.',
  },
  AGENT_QUOTA_EXCEEDED: {
    title: 'The assistant has spent its allowance',
    message:
      'This clinic set a ceiling on assistant use and it has been reached for now. Ask a practice admin to raise it. Nothing else is affected.',
  },
  AGENT_TURN_LIMIT: {
    title: 'The assistant ran out of time',
    message:
      'It took longer than one turn is allowed and was stopped before it finished. Ask again with a narrower question.',
  },
  AGENT_SCOPE_DENIED: {
    title: 'The assistant asked for something it does not have',
    message:
      'It requested a capability your role does not grant it. The request was refused and nothing was read.',
  },
  AGENT_COMPARTMENT_VIOLATION: {
    title: 'The assistant reached outside the open chart',
    message:
      'It tried to read a record outside the chart you have open, so the turn was stopped and nothing is shown. Report this if it happens again.',
  },
  AGENT_RESPONSE_INVALID: {
    title: 'The endpoint answered in a shape openrunic could not read',
    message:
      'Nothing was shown, because openrunic will not guess at a malformed answer. Ask again; if it keeps happening, report it to whoever configured the endpoint.',
  },
};

/**
 * The fallback uses the server's own `detail`, which is always a written
 * sentence rather than a code. That is why an unmapped code still reads as
 * product copy: the API never sends a stack trace or a provider message here.
 */
export function describeFailure(failure: AssistantFailure): FailureExplanation {
  return TABLE[failure.code] ?? { title: 'That did not complete', message: failure.detail };
}
