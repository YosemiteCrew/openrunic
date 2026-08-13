import { z } from 'zod';

import type { Adapter, AdapterResult, CapabilityContract } from './core.js';
import { adapterConfigBase, opaqueRef } from './core.js';

/**
 * The address seam: turning what a patient typed into something a statement
 * will actually reach.
 *
 * It is the smallest seam in the product and the one with the clearest payback,
 * because an unreachable address turns into a returned statement, a bad-debt
 * write-off and a patient who believes they were never billed. The seam
 * proposes; it never rewrites a record on its own, which is why `verifyAddress`
 * returns a normalised candidate and a status rather than a corrected address.
 */

/** Semver of this seam. */
export const ADDRESS_VERIFY_CONTRACT_VERSION = '1.0.0';

/**
 * What the verifier concluded. `corrected` means deliverable but not as typed,
 * which is a prompt for a human rather than a silent overwrite.
 */
export const addressVerificationStatus = z.enum(['verified', 'corrected', 'unverifiable']);

/** Inferred shape of {@link addressVerificationStatus}. */
export type AddressVerificationStatus = z.infer<typeof addressVerificationStatus>;

const postalAddress = z.strictObject({
  line1: z.string().min(1).max(128),
  line2: z.string().min(1).max(128).optional(),
  city: z.string().min(1).max(64),
  /** Subdivision code or name; jurisdictional, so never an enum. */
  state: z.string().min(1).max(64),
  postalCode: z.string().min(1).max(16),
  /** ISO 3166-1 alpha-2. */
  countryCode: z.string().length(2),
});

const verifyAddressInput = postalAddress;

const addressVerificationResult = z.strictObject({
  status: addressVerificationStatus,
  /** Absent on `unverifiable`; nothing may be written back when the verifier could not place the address. */
  normalized: postalAddress.optional(),
  /** Carrier delivery-point code, when the verifier resolved to one. */
  deliveryPointCode: z.string().min(1).max(32).optional(),
  /** Requires the `geocode` feature. */
  latitude: z.number().min(-90).max(90).optional(),
  /** Requires the `geocode` feature. */
  longitude: z.number().min(-180).max(180).optional(),
});

const suggestAddressesInput = z.strictObject({
  /** Partial address as typed so far. */
  query: z.string().min(1).max(256),
  countryCode: z.string().length(2),
  limit: z.int().positive().max(20).optional(),
});

const addressSuggestions = z.strictObject({
  suggestions: z
    .array(
      z.strictObject({
        /** Opaque handle the verifier accepts on a follow-up call, when it offers one. */
        suggestionRef: opaqueRef.optional(),
        address: postalAddress,
        /** Confidence from 0 to 1; a picker sorts on it rather than inventing its own ranking. */
        score: z.number().min(0).max(1),
      })
    )
    .readonly(),
});

/** Configuration for an address-verification adapter. */
export const addressVerifyConfig = z.strictObject({
  ...adapterConfigBase.shape,
  /** Default country for queries that omit one, ISO 3166-1 alpha-2. */
  defaultCountryCode: z.string().length(2),
});

/** Inferred shape of {@link addressVerifyConfig}. */
export type AddressVerifyConfig = z.infer<typeof addressVerifyConfig>;

/** Optional features an address-verification vendor may implement. */
export const ADDRESS_VERIFY_FEATURES = ['suggestions', 'geocode', 'delivery_point'] as const;

/** A postal address in the shape this seam exchanges. */
export type PostalAddress = z.infer<typeof postalAddress>;
/** Input of `verifyAddress`. */
export type VerifyAddressInput = z.infer<typeof verifyAddressInput>;
/** Output of `verifyAddress`. */
export type AddressVerificationResult = z.infer<typeof addressVerificationResult>;
/** Input of `suggestAddresses`. */
export type SuggestAddressesInput = z.infer<typeof suggestAddressesInput>;
/** Output of `suggestAddresses`. */
export type AddressSuggestions = z.infer<typeof addressSuggestions>;

/** The address-verification seam as data. */
export const ADDRESS_VERIFY_CONTRACT = {
  capability: 'address-verify',
  contractVersion: ADDRESS_VERIFY_CONTRACT_VERSION,
  config: addressVerifyConfig,
  features: ADDRESS_VERIFY_FEATURES,
  operations: {
    verifyAddress: { input: verifyAddressInput, output: addressVerificationResult },
    suggestAddresses: { input: suggestAddressesInput, output: addressSuggestions },
  },
} as const satisfies CapabilityContract;

/** Everything an address-verification vendor must implement. */
export interface AddressVerifyAdapter extends Adapter<AddressVerifyConfig> {
  verifyAddress(input: VerifyAddressInput): Promise<AdapterResult<AddressVerificationResult>>;
  /** Requires the `suggestions` feature. */
  suggestAddresses(input: SuggestAddressesInput): Promise<AdapterResult<AddressSuggestions>>;
}
