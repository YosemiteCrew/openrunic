/**
 * `@openrunic/x12` - the claim codec.
 *
 * A pure, IO-free ASC X12 5010 codec covering the six transactions a practice
 * actually exchanges: 837P out, 835 back, 277 and 999 to drive the claim
 * lifecycle, and 270/271 for the eligibility check that prevents claims rather
 * than fixing them. It reads and writes strings. It opens no sockets, touches
 * no database and reads no clock, which is what makes every behaviour in it
 * reproducible from a golden file.
 *
 * The package is two layers, and the separation is load-bearing:
 *
 *   * The envelope layer (`delimiters`, `segments`, `reader`, `writer`,
 *     `control`) knows about ISA/GS/ST, delimiters, control numbers and the
 *     three self-check counts. It knows nothing about claims.
 *   * The transaction mappers know about claims, remittances and benefits.
 *     They only ever see already-reconciled segment lists and they never
 *     write an envelope.
 *
 * An envelope bug therefore cannot corrupt mapping logic, and a mapping bug
 * cannot produce a structurally invalid document.
 */

// Errors: one typed union across the whole package.
export { formatX12Error } from './errors.js';
export type { X12Error, X12ErrorKind, X12EnvelopeLevel, X12Location } from './errors.js';

// The envelope layer.
export {
  DEFAULT_DELIMITERS,
  ISA_SEGMENT_LENGTH,
  detectDelimiters,
  validateDelimiters,
} from './delimiters.js';
export type { Delimiters } from './delimiters.js';

export {
  componentAt,
  isEmptyAt,
  locate,
  readSegments,
  segment,
  simpleAt,
  writeSegment,
} from './segments.js';
export type { ElementValue, Segment } from './segments.js';

export { firstTransactionOfType, readInterchange } from './reader.js';
export type { X12FunctionalGroup, X12Interchange, X12Transaction } from './reader.js';

export { writeInterchange } from './writer.js';
export type {
  FunctionalGroupDraft,
  InterchangeDraft,
  TradingPartnerAddress,
  TransactionDraft,
} from './writer.js';

export {
  createControlNumberSource,
  formatInterchangeControlNumber,
  formatTransactionControlNumber,
  validateControlNumbers,
} from './control.js';
export type { ControlNumberSource, ControlNumbers } from './control.js';

export {
  formatAmount,
  formatDate6,
  formatDate8,
  formatTime4,
  padRight,
  parseAmount,
  parseDate8,
  parseNumber,
} from './format.js';

// Shared domain value objects.
export {
  toFrequencyCode,
  toPayerResponsibilityCode,
  toRelationshipCode,
  toX12Gender,
} from './domain.js';
export type {
  AdministrativeGender,
  Adjustment,
  AdjustmentDetail,
  ClaimFrequency,
  NamedParty,
  PayerResponsibility,
  PersonName,
  PostalAddress,
  SubscriberRelationship,
  X12Gender,
} from './domain.js';

// 837P professional claim, encode.
export { IMPLEMENTATION_837P, encode837P } from './claim-837p.js';
export type {
  BillingProvider,
  ClaimEnvelope,
  ClaimHeader,
  DependentPatient,
  Encode837POptions,
  LineAdjudication,
  OtherCoverage,
  ProviderIndividual,
  ServiceFacility,
  ServiceLine,
  Subscriber,
  Submitter,
} from './claim-837p.js';

// 835 remittance advice, decode.
export { IMPLEMENTATION_835, decode835, toRemittanceLines } from './remittance-835.js';
export type {
  ProviderAdjustment,
  Remittance835,
  RemittanceAmount,
  RemittanceClaim,
  RemittanceDate,
  RemittanceFinancials,
  RemittanceLineProjection,
  RemittanceParty,
  RemittanceServiceLine,
  RemittanceTrace,
} from './remittance-835.js';

// 277 claim status, decode.
export {
  IMPLEMENTATION_277,
  REJECTION_CATEGORY_CODES,
  decode277,
  toClaimStatusOutcomes,
} from './status-277.js';
export type {
  ClaimStatusDetail,
  ClaimStatusEntry,
  ClaimStatusOutcome,
  NamedEntity,
  StatusReport277,
} from './status-277.js';

// 999 implementation acknowledgement, decode.
export { ACCEPTED_ACK_CODES, IMPLEMENTATION_999, decode999, toAckOutcomes } from './ack-999.js';
export type {
  AckOutcome,
  AckReport999,
  ElementError,
  GroupAck,
  SegmentError,
  TransactionAck,
} from './ack-999.js';

// 270 eligibility inquiry, encode.
export { DEFAULT_SERVICE_TYPE_CODES, IMPLEMENTATION_270, encode270 } from './eligibility-270.js';
export type {
  EligibilityDependent,
  EligibilityProvider,
  EligibilityRequest,
  EligibilitySubscriber,
  Encode270Options,
} from './eligibility-270.js';

// 271 eligibility response, decode.
export {
  ACTIVE_ELIGIBILITY_CODES,
  IMPLEMENTATION_271,
  decode271,
  toCoverageSummary,
} from './eligibility-271.js';
export type {
  BenefitDetail,
  CoverageSummary,
  EligibilityMember,
  EligibilityParty,
  EligibilityRejection,
  EligibilityResponse271,
} from './eligibility-271.js';
