/**
 * Value objects shared by every transaction set in this package.
 *
 * These are deliberately the codec's own shapes rather than the database's
 * row types. `packages/x12` is a pure, IO-free codec: it must be usable in a
 * unit test, in a CLI and in a worker with no Prisma client anywhere in scope,
 * and it must not acquire a dependency on a schema that changes for reasons
 * that have nothing to do with EDI. The billing service does the translation
 * from Claim, ClaimLine, ChargeItem, Patient, Coverage, Payer, Facility and
 * Practitioner rows into these shapes, and that translation is the one place
 * a schema change has to be reflected.
 */

/** A person's name as X12's NM1 segment carries it. */
export interface PersonName {
  readonly family: string;
  readonly given: string;
  readonly middle?: string;
  readonly suffix?: string;
}

/** A postal address as the N3 and N4 segments carry it. */
export interface PostalAddress {
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly state: string;
  readonly postalCode: string;
  /** ISO 3166-1 alpha-2. Omitted for domestic addresses, which is what N4 expects. */
  readonly countryCode?: string;
}

/**
 * X12's gender codes, which are not the schema's `AdministrativeGender`.
 *
 * The mapping is lossy in one direction on purpose: X12 5010 has no code for a
 * gender identity outside its three, so `OTHER` and `UNKNOWN` both become `U`.
 * Losing that distinction on a claim is correct; losing it in the chart would
 * not be, which is why the chart keeps the full value and only this boundary
 * narrows it.
 */
export type X12Gender = 'F' | 'M' | 'U';

/** The schema's administrative gender values, mirrored so no import is needed. */
export type AdministrativeGender = 'FEMALE' | 'MALE' | 'OTHER' | 'UNKNOWN';

/** Narrows an administrative gender to the three codes 5010 accepts. */
export function toX12Gender(gender: AdministrativeGender): X12Gender {
  switch (gender) {
    case 'FEMALE':
      return 'F';
    case 'MALE':
      return 'M';
    case 'OTHER':
    case 'UNKNOWN':
      return 'U';
  }
}

/** Payer responsibility sequence: SBR01 and the schema's `CoverageRank`. */
export type PayerResponsibility = 'PRIMARY' | 'SECONDARY' | 'TERTIARY';

/** Maps a coverage rank onto SBR01's single-character code. */
export function toPayerResponsibilityCode(rank: PayerResponsibility): string {
  switch (rank) {
    case 'PRIMARY':
      return 'P';
    case 'SECONDARY':
      return 'S';
    case 'TERTIARY':
      return 'T';
  }
}

/**
 * How the patient relates to the person who holds the policy.
 *
 * `self` is the case that changes the document's shape rather than one code:
 * a self-insured patient has no dependent hierarchical level at all, so this
 * value decides whether an entire loop exists.
 */
export type SubscriberRelationship = 'self' | 'spouse' | 'child' | 'other';

/** Individual relationship codes for SBR02 and PAT01. */
export function toRelationshipCode(relationship: SubscriberRelationship): string {
  switch (relationship) {
    case 'self':
      return '18';
    case 'spouse':
      return '01';
    case 'child':
      return '19';
    case 'other':
      return 'G8';
  }
}

/** The schema's `ClaimFrequency`, mirrored. */
export type ClaimFrequency = 'ORIGINAL' | 'REPLACEMENT' | 'VOID';

/**
 * Claim frequency type codes for CLM05-3.
 *
 * A payer treats these as three different transactions, not three flavours of
 * one: `7` replaces a previously adjudicated claim and `8` voids it, and both
 * require the payer's own control number for the claim being acted on. That
 * requirement is enforced by the encoder rather than left to the caller.
 */
export function toFrequencyCode(frequency: ClaimFrequency): string {
  switch (frequency) {
    case 'ORIGINAL':
      return '1';
    case 'REPLACEMENT':
      return '7';
    case 'VOID':
      return '8';
  }
}

/**
 * One CAS segment: a group code and up to six reason/amount/quantity triplets.
 *
 * Modelled as a group plus a list rather than a flat row because that is how
 * the wire carries it, and because collapsing the stacking would lose the fact
 * that six adjustments arrived as one payer decision. The reason codes are
 * CARC values, and they are never validated against a code list here: the code
 * list is licensed content and belongs to the deployer's terminology service.
 */
export interface Adjustment {
  /** CAS01: `CO` contractual, `PR` patient responsibility, `OA` other, `PI` payer initiated. */
  readonly groupCode: string;
  readonly details: readonly AdjustmentDetail[];
}

/** One reason/amount/quantity triplet inside a CAS segment. */
export interface AdjustmentDetail {
  /** A CARC code, e.g. `45` for "charge exceeds fee schedule". */
  readonly reasonCode: string;
  /** Signed integer cents. A negative adjustment gives money back. */
  readonly amountCents: number;
  readonly quantity?: number;
}

/** A party identified only by a name and an identifier, e.g. a payer or a submitter. */
export interface NamedParty {
  readonly name: string;
  readonly identifier: string;
  readonly address?: PostalAddress;
}
