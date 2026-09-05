/**
 * `@openrunic/adapters` - the partner seams.
 *
 * Product code imports from here and from nowhere lower. A vendor package
 * implements one of the adapter interfaces, an installation registers it, and
 * the code that submits claims or transmits prescriptions never learns which
 * company answered.
 */

export {
  ADAPTER_ERROR_KINDS,
  CALLBACK_SIGNATURE_HEADER,
  CAPABILITIES,
  adapterConfigBase,
  callbackEnvelope,
  describeAdapterError,
  isCapability,
  isMajorCompatible,
  isoDateTime,
  isoDateTimeOf,
  malformedResponseError,
  misconfiguredError,
  moneyMinorUnits,
  opaqueRef,
  parseContractVersion,
  partialError,
  rejectedError,
  supportsFeature,
  timeoutError,
  unauthorizedError,
  unavailableError,
  unsupportedOperationError,
  zodIssuePaths,
} from './contracts/core.js';
export type {
  Adapter,
  AdapterCallSite,
  AdapterConfigBase,
  AdapterDeps,
  AdapterErr,
  AdapterError,
  AdapterErrorKind,
  AdapterEvent,
  AdapterLogEntry,
  AdapterResult,
  CallbackEnvelope,
  CallbackRequest,
  Capability,
  CapabilityContract,
  CapabilityDescriptor,
  ContractVersion,
  HealthState,
  HealthStatus,
  ItemOutcome,
  MalformedResponseAdapterError,
  MisconfiguredAdapterError,
  MisconfiguredReason,
  OperationSchema,
  OperationSchemaMap,
  PartialAdapterError,
  RejectedAdapterError,
  SchemaIssues,
  TimeoutAdapterError,
  UnauthorizedAdapterError,
  UnauthorizedReason,
  UnavailableAdapterError,
  UnsupportedOperationAdapterError,
  VerifiedCallback,
} from './contracts/core.js';

export { CONTRACTS } from './contracts/index.js';
export type {
  AnyCapabilityAdapter,
  CapabilityAdapterMap,
  ConfigOf,
  EntitlementOf,
  FeatureOf,
} from './contracts/index.js';

export {
  ERX_CONTRACT,
  ERX_CONTRACT_VERSION,
  ERX_FEATURES,
  erxConfig,
  prescriptionTransmissionStatus,
} from './contracts/erx.js';
export type {
  CancelPrescriptionInput,
  CancelPrescriptionResult,
  CheckFormularyInput,
  ErxAdapter,
  ErxConfig,
  FormularyResult,
  GetTransmissionStatusInput,
  PrescriptionTransmissionStatus,
  TransmissionReceipt,
  TransmissionStatusReport,
  TransmitPrescriptionInput,
} from './contracts/erx.js';

export {
  CLEARINGHOUSE_CONTRACT,
  CLEARINGHOUSE_CONTRACT_VERSION,
  CLEARINGHOUSE_FEATURES,
  acknowledgementLevel,
  clearinghouseConfig,
} from './contracts/clearinghouse.js';
export type {
  AcknowledgementBatch,
  AcknowledgementLevel,
  CheckEligibilityInput,
  ClearinghouseAdapter,
  ClearinghouseConfig,
  EligibilityResponse,
  FetchSinceInput,
  RemittanceBatch,
  SubmissionReceipt,
  SubmitClaimInput,
} from './contracts/clearinghouse.js';

export {
  LABS_CONTRACT,
  LABS_CONTRACT_VERSION,
  LABS_FEATURES,
  abnormalFlag,
  labOrderStatus,
  labsConfig,
} from './contracts/labs.js';
export type {
  AbnormalFlag,
  CancelOrderInput,
  CancelOrderResult,
  FetchResultsInput,
  GetOrderStatusInput,
  LabOrderStatus,
  LabsAdapter,
  LabsConfig,
  OrderReceipt,
  OrderStatusReport,
  PlaceOrderInput,
  ResultBatch,
} from './contracts/labs.js';

export {
  PAYMENTS_CONTRACT,
  PAYMENTS_CONTRACT_VERSION,
  PAYMENTS_FEATURES,
  authorizationStatus,
  paymentsConfig,
} from './contracts/payments.js';
export type {
  AuthorizationResult,
  AuthorizationStatus,
  AuthorizeInput,
  CaptureInput,
  CaptureResult,
  CreatePaymentPlanInput,
  PaymentPlan,
  PaymentsAdapter,
  PaymentsConfig,
  RefundInput,
  RefundResult,
  StoreCardOnFileInput,
  StoredCard,
} from './contracts/payments.js';

export {
  FAX_CONTRACT,
  FAX_CONTRACT_VERSION,
  FAX_FEATURES,
  faxConfig,
  faxStatus,
} from './contracts/fax.js';
export type {
  FaxAdapter,
  FaxConfig,
  FaxReceipt,
  FaxStatus,
  FaxStatusReport,
  FetchInboundFaxesInput,
  GetFaxStatusInput,
  InboundFaxBatch,
  SendFaxInput,
} from './contracts/fax.js';

export {
  SMS_CONTRACT,
  SMS_CONTRACT_VERSION,
  SMS_FEATURES,
  messageStatus,
  smsConfig,
} from './contracts/sms.js';
export type {
  FetchInboundMessagesInput,
  GetMessageStatusInput,
  InboundMessageBatch,
  MessageReceipt,
  MessageStatus,
  MessageStatusReport,
  SendMessageInput,
  SmsAdapter,
  SmsConfig,
} from './contracts/sms.js';

export {
  VIDEO_CONTRACT,
  VIDEO_CONTRACT_VERSION,
  VIDEO_FEATURES,
  participantRole,
  videoConfig,
  visitRoomStatus,
} from './contracts/video.js';
export type {
  CreateVisitRoomInput,
  EndVisitRoomInput,
  EndedVisitRoom,
  IssueJoinTokenInput,
  JoinToken,
  ParticipantRole,
  VideoAdapter,
  VideoConfig,
  VisitRoom,
  VisitRoomStatus,
} from './contracts/video.js';

export {
  ADDRESS_VERIFY_CONTRACT,
  ADDRESS_VERIFY_CONTRACT_VERSION,
  ADDRESS_VERIFY_FEATURES,
  addressVerificationStatus,
  addressVerifyConfig,
} from './contracts/address-verify.js';
export type {
  AddressSuggestions,
  AddressVerificationResult,
  AddressVerificationStatus,
  AddressVerifyAdapter,
  AddressVerifyConfig,
  PostalAddress,
  SuggestAddressesInput,
  VerifyAddressInput,
} from './contracts/address-verify.js';

export {
  DEFAULT_MOCK_SEED,
  FAILURE_MODES,
  MOCK_EPOCH,
  MockAdapterBase,
  signCallbackBody,
} from './mocks/harness.js';
export type { FailureInjection, FailureMode, MockAdapterOptions } from './mocks/harness.js';
export { mulberry32, randomHex, randomInt, randomPick } from './mocks/random.js';
export { createMockAdapter } from './mocks/index.js';
export { MockAddressVerifyAdapter } from './mocks/address-verify.js';
export { MockClearinghouseAdapter } from './mocks/clearinghouse.js';
export { MockErxAdapter } from './mocks/erx.js';
export { MockFaxAdapter } from './mocks/fax.js';
export { MockLabsAdapter } from './mocks/labs.js';
export { MockPaymentsAdapter } from './mocks/payments.js';
export { MockSmsAdapter } from './mocks/sms.js';
export { MockVideoAdapter } from './mocks/video.js';

export { AdapterRegistry } from './registry.js';
export type {
  AdapterCallRecord,
  CallOutcome,
  RegistryError,
  RegistryErrorKind,
  RegistryOptions,
} from './registry.js';
