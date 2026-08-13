import type { Capability } from '../contracts/core.js';
import type { CapabilityAdapterMap } from '../contracts/index.js';
import { MockAddressVerifyAdapter } from './address-verify.js';
import { MockClearinghouseAdapter } from './clearinghouse.js';
import { MockErxAdapter } from './erx.js';
import { MockFaxAdapter } from './fax.js';
import type { MockAdapterOptions } from './harness.js';
import { MockLabsAdapter } from './labs.js';
import { MockPaymentsAdapter } from './payments.js';
import { MockSmsAdapter } from './sms.js';
import { MockVideoAdapter } from './video.js';

/** Every mock, keyed by capability, so a factory can stay type-safe over a generic key. */
type MockFactories = {
  readonly [C in Capability]: (options?: MockAdapterOptions) => CapabilityAdapterMap[C];
};

const MOCK_FACTORIES: MockFactories = {
  erx: (options) => new MockErxAdapter(options),
  clearinghouse: (options) => new MockClearinghouseAdapter(options),
  labs: (options) => new MockLabsAdapter(options),
  payments: (options) => new MockPaymentsAdapter(options),
  fax: (options) => new MockFaxAdapter(options),
  sms: (options) => new MockSmsAdapter(options),
  video: (options) => new MockVideoAdapter(options),
  'address-verify': (options) => new MockAddressVerifyAdapter(options),
};

/**
 * Builds the mock for a capability, typed as that capability's adapter.
 *
 * This is what lets a demo or a seam loop stand up all eight partners in a
 * loop over {@link CAPABILITIES} without a switch statement that has to be
 * edited every time a seam is added.
 */
export function createMockAdapter<C extends Capability>(
  capability: C,
  options?: MockAdapterOptions
): CapabilityAdapterMap[C] {
  return MOCK_FACTORIES[capability](options);
}
