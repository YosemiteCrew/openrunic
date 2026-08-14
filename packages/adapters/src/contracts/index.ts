import { ADDRESS_VERIFY_CONTRACT } from './address-verify.js';
import type { AddressVerifyAdapter } from './address-verify.js';
import { CLEARINGHOUSE_CONTRACT } from './clearinghouse.js';
import type { ClearinghouseAdapter } from './clearinghouse.js';
import type { Capability, CapabilityContract } from './core.js';
import { ERX_CONTRACT } from './erx.js';
import type { ErxAdapter } from './erx.js';
import { FAX_CONTRACT } from './fax.js';
import type { FaxAdapter } from './fax.js';
import { LABS_CONTRACT } from './labs.js';
import type { LabsAdapter } from './labs.js';
import { PAYMENTS_CONTRACT } from './payments.js';
import type { PaymentsAdapter } from './payments.js';
import { SMS_CONTRACT } from './sms.js';
import type { SmsAdapter } from './sms.js';
import { VIDEO_CONTRACT } from './video.js';
import type { VideoAdapter } from './video.js';

/**
 * Every seam contract in one place.
 *
 * The registry reads this to learn the version product code was compiled
 * against and to find the output schema for an operation it is instrumenting,
 * which is what lets one generic wrapper police eight different seams without
 * knowing anything about any of them.
 */
export const CONTRACTS = {
  erx: ERX_CONTRACT,
  clearinghouse: CLEARINGHOUSE_CONTRACT,
  labs: LABS_CONTRACT,
  payments: PAYMENTS_CONTRACT,
  fax: FAX_CONTRACT,
  sms: SMS_CONTRACT,
  video: VIDEO_CONTRACT,
  'address-verify': ADDRESS_VERIFY_CONTRACT,
} as const satisfies Record<Capability, CapabilityContract>;

/**
 * Which adapter interface belongs to which capability.
 *
 * This is the type that makes `registry.resolve('labs')` return a `LabsAdapter`
 * with no cast at the call site. Without it every resolution would hand back a
 * union and every caller would need a narrowing step that could be got wrong.
 */
export interface CapabilityAdapterMap {
  erx: ErxAdapter;
  clearinghouse: ClearinghouseAdapter;
  labs: LabsAdapter;
  payments: PaymentsAdapter;
  fax: FaxAdapter;
  sms: SmsAdapter;
  video: VideoAdapter;
  'address-verify': AddressVerifyAdapter;
}

/** Any seam adapter, for the places that hold one without knowing which. */
export type AnyCapabilityAdapter = CapabilityAdapterMap[Capability];
