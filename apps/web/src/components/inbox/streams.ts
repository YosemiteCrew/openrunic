import type { InboxStream } from '@/lib/api';

/**
 * The vocabulary of the five streams.
 *
 * The filter chips, the rows and the screens above them all name a stream, and
 * two of them naming it differently is how an inbox stops being trustworthy.
 */

export const INBOX_STREAM_LABELS: Record<InboxStream, string> = {
  RESULTS: 'Results',
  MESSAGES: 'Messages',
  REFILLS: 'Refills',
  COSIGN: 'Cosign',
  TASKS: 'Tasks',
};

export const INBOX_STREAM_ICON: Record<InboxStream, string> = {
  RESULTS: 'flask-conical',
  MESSAGES: 'message-square',
  REFILLS: 'pill',
  COSIGN: 'pen-line',
  TASKS: 'square-check',
};
