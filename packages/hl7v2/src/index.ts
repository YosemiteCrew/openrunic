/**
 * HL7 v2, in the four message types a practice's interfaces actually carry.
 *
 * ADT tells this practice a patient was registered, admitted, discharged or
 * updated. ORU brings a result back from a laboratory. ORM sends an order out.
 * VXU reports an immunisation to a registry. Every one of them is answered with
 * an acknowledgement, because an interface that accepts silently is one where a
 * laboratory believes a result was filed that never was.
 *
 * The format is open and needs no licence, which is why this is ordinary code
 * rather than a seam. What each partner requires of it - which fields they
 * populate, which identifiers they match on - is configuration and lives with
 * the interface rather than here.
 */

export {
  acknowledge,
  buildAck,
  buildAdt,
  buildOrm,
  buildOru,
  buildVxu,
  inspect,
  parseAck,
  parseAdt,
  parseOrm,
  parseOru,
  parseVxu,
} from './messages.js';

export { Hl7Error } from './errors.js';
export { DEFAULT_DELIMITERS, escapeValue, readDelimiters, unescapeValue } from './encoding.js';
export type { Delimiters } from './encoding.js';
export {
  buildSegment,
  component,
  field,
  parseMessage,
  renderMessage,
  repetitions,
  segmentNamed,
  segmentsNamed,
} from './message.js';
export type { Hl7Message, Segment } from './message.js';
export { dateFromHl7, fromHl7, hl7Date, hl7Instant, writeTime } from './time.js';

export type {
  Acknowledgement,
  AdtEvent,
  AdtMessage,
  CodedValue,
  Immunisation,
  MessageHeader,
  ObservationRequest,
  ObservationResult,
  OrmMessage,
  OrmOrder,
  OruMessage,
  Patient,
  Sex,
  Visit,
  VxuMessage,
} from './domain.js';
