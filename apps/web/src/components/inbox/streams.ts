import type { InboxStream } from '@/lib/api';

/**
 * The vocabulary of the five streams.
 *
 * The filter chips, the rows and the screens above them all name a stream, and
 * two of them naming it differently is how an inbox stops being trustworthy.
 * Catalogue keys rather than words, so that stays true in every language this
 * build carries.
 *
 * Two maps, because a stream is named in two positions: as a heading of its own
 * ("Refills") and inside a sentence the screen builds around it ("No refills
 * waiting"). The second is a message rather than the first lower-cased, because
 * casing is a per-language rule and code cannot make it - German capitalises
 * its nouns wherever they stand, and Turkish has two i rules that turn a correct
 * word into a wrong one.
 *
 * Literal keys and not `inbox.stream.${stream}`: the drift test reads the source
 * for the keys it asks for and finds literals, and a key it cannot see is a key
 * nobody can find when it breaks.
 */

export const INBOX_STREAM_LABEL_KEYS: Record<InboxStream, string> = {
  RESULTS: 'inbox.stream.results',
  MESSAGES: 'inbox.stream.messages',
  REFILLS: 'inbox.stream.refills',
  COSIGN: 'inbox.stream.cosign',
  TASKS: 'inbox.stream.tasks',
};

export const INBOX_STREAM_INLINE_KEYS: Record<InboxStream, string> = {
  RESULTS: 'inbox.stream.inline.results',
  MESSAGES: 'inbox.stream.inline.messages',
  REFILLS: 'inbox.stream.inline.refills',
  COSIGN: 'inbox.stream.inline.cosign',
  TASKS: 'inbox.stream.inline.tasks',
};

export const INBOX_STREAM_ICON: Record<InboxStream, string> = {
  RESULTS: 'flask-conical',
  MESSAGES: 'message-square',
  REFILLS: 'pill',
  COSIGN: 'pen-line',
  TASKS: 'square-check',
};
