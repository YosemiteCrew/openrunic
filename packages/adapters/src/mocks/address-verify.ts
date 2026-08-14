import { ok } from '@openrunic/types';

import { ADDRESS_VERIFY_CONTRACT } from '../contracts/address-verify.js';
import type {
  AddressSuggestions,
  AddressVerificationResult,
  AddressVerifyAdapter,
  AddressVerifyConfig,
  PostalAddress,
  SuggestAddressesInput,
  VerifyAddressInput,
} from '../contracts/address-verify.js';
import type { AdapterResult } from '../contracts/core.js';
import { supportsFeature } from '../contracts/core.js';
import type { MockAdapterOptions } from './harness.js';
import { MockAdapterBase } from './harness.js';

/**
 * An in-process address verifier.
 *
 * The rule it applies is trivial on purpose - a five digit postal code
 * verifies, a shorter numeric one is corrected, anything else is unverifiable -
 * because the interesting behaviour is not the matching, it is what the
 * practice does with each of the three answers. Registration needs a prompt on
 * `corrected` and a block on `unverifiable`, and both need to be reachable from
 * a fixture.
 */

const DEFAULT_SUGGESTION_LIMIT = 3;

const FIVE_DIGIT_POSTAL = /^[0-9]{5}(-[0-9]{4})?$/;
const NUMERIC_POSTAL = /^[0-9]{1,5}$/;

function normalize(input: PostalAddress, postalCode: string): PostalAddress {
  return {
    line1: input.line1.trim().toUpperCase(),
    ...(input.line2 === undefined ? {} : { line2: input.line2.trim().toUpperCase() }),
    city: input.city.trim().toUpperCase(),
    state: input.state.trim().toUpperCase(),
    postalCode,
    countryCode: input.countryCode.toUpperCase(),
  };
}

/** The deterministic address-verification mock. */
export class MockAddressVerifyAdapter
  extends MockAdapterBase<AddressVerifyConfig>
  implements AddressVerifyAdapter
{
  constructor(options: MockAdapterOptions = {}) {
    super(ADDRESS_VERIFY_CONTRACT, options);
  }

  verifyAddress(input: VerifyAddressInput): Promise<AdapterResult<AddressVerificationResult>> {
    return this.runOperation<AddressVerificationResult>('verifyAddress', [input.postalCode], () => {
      const geocode = supportsFeature(this.descriptor, 'geocode')
        ? { latitude: 37.75, longitude: -122.45 }
        : {};
      const deliveryPoint = supportsFeature(this.descriptor, 'delivery_point')
        ? { deliveryPointCode: '01' }
        : {};
      if (FIVE_DIGIT_POSTAL.test(input.postalCode)) {
        return ok({
          status: 'verified',
          normalized: normalize(input, input.postalCode),
          ...deliveryPoint,
          ...geocode,
        });
      }
      if (NUMERIC_POSTAL.test(input.postalCode)) {
        // Deliverable but not as typed: the practice is prompted, and nothing
        // is written back without a human agreeing to the correction.
        return ok({
          status: 'corrected',
          normalized: normalize(input, input.postalCode.padStart(5, '0')),
          ...deliveryPoint,
          ...geocode,
        });
      }
      return ok({ status: 'unverifiable' });
    });
  }

  suggestAddresses(input: SuggestAddressesInput): Promise<AdapterResult<AddressSuggestions>> {
    const gate = this.featureGate('suggestAddresses', 'suggestions');
    if (gate !== undefined) {
      return Promise.resolve(gate);
    }
    return this.runOperation<AddressSuggestions>('suggestAddresses', [input.query], () => {
      const count = input.limit ?? DEFAULT_SUGGESTION_LIMIT;
      return ok({
        suggestions: Array.from({ length: count }, (_unused, index) => ({
          suggestionRef: this.mintRef('sug'),
          address: {
            line1: `${String(index + 1)}00 SYNTHETIC WAY`,
            city: 'TESTVILLE',
            state: 'ZZ',
            postalCode: `9900${String(index)}`,
            countryCode: input.countryCode.toUpperCase(),
          },
          score: Math.round((1 - index * 0.1) * 100) / 100,
        })),
      });
    });
  }
}
