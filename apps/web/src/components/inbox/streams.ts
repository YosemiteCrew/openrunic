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

/**
 * The verb that finishes a row of this stream, and what the toast says after.
 *
 * A property of the stream rather than of the item: a refill is approved and a
 * cosign is signed whichever refill it is. It used to be two fields on the
 * item, which made it eleven copies of five English strings on the one screen
 * where every other word is translated - and unanswerable for a row read from
 * the API, which carries a title and a description and nothing that is a verb.
 */
export const INBOX_STREAM_ACTION_KEYS: Record<InboxStream, string> = {
  RESULTS: 'inbox.stream.action.results',
  MESSAGES: 'inbox.stream.action.messages',
  REFILLS: 'inbox.stream.action.refills',
  COSIGN: 'inbox.stream.action.cosign',
  TASKS: 'inbox.stream.action.tasks',
};

export const INBOX_STREAM_DONE_KEYS: Record<InboxStream, string> = {
  RESULTS: 'inbox.stream.done.results',
  MESSAGES: 'inbox.stream.done.messages',
  REFILLS: 'inbox.stream.done.refills',
  COSIGN: 'inbox.stream.done.cosign',
  TASKS: 'inbox.stream.done.tasks',
};

export const INBOX_STREAM_ICON: Record<InboxStream, string> = {
  RESULTS: 'flask-conical',
  MESSAGES: 'message-square',
  REFILLS: 'pill',
  COSIGN: 'pen-line',
  TASKS: 'square-check',
};
