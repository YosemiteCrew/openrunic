import { err } from '@openrunic/types';
import type { Result } from '@openrunic/types';

import type { ControlNumbers } from './control.js';
import type { Delimiters } from './delimiters.js';
import type { NamedParty, PersonName, SubscriberRelationship, X12Gender } from './domain.js';
import { toRelationshipCode } from './domain.js';
import type { X12Error } from './errors.js';
import { formatDate8, formatTime4 } from './format.js';
import { segment } from './segments.js';
import type { Segment } from './segments.js';
import { writeInterchange } from './writer.js';

/**
 * The 270 eligibility request encoder.
 *
 * Eligibility is the cheapest possible intervention in the revenue cycle: a
 * request that costs nothing at the front desk prevents a claim that would
 * have denied three weeks later for inactive coverage. That economics is why
 * this transaction exists in the product at all, and why the encoder is
 * deliberately narrow. It asks about coverage for a subscriber or a dependent
 * on a date, and nothing else.
 */

/** The provider asking, loop 2100B. */
export interface EligibilityProvider {
  readonly name: string;
  /** Ten digits. */
  readonly npi: string;
}

/** The person whose coverage is in question, loop 2100C. */
export interface EligibilitySubscriber {
  readonly memberId: string;
  readonly name: PersonName;
  /** `YYYY-MM-DD`. Payers use it to disambiguate a member id. */
  readonly birthDate?: string;
  readonly gender?: X12Gender;
}

/** A dependent inquiry, loop 2100D, when the patient is not the member. */
export interface EligibilityDependent {
  readonly name: PersonName;
  readonly birthDate: string;
  readonly gender: X12Gender;
  readonly relationship: SubscriberRelationship;
}

/** Everything one eligibility inquiry needs. */
export interface EligibilityRequest {
  readonly payer: NamedParty;
  readonly provider: EligibilityProvider;
  readonly subscriber: EligibilitySubscriber;
  readonly dependent?: EligibilityDependent;
  /**
   * EQ01 service type codes. `30` is "health benefit plan coverage", the
   * general question, and is the default because it is what a front desk
   * actually wants: is this policy live today.
   */
  readonly serviceTypeCodes?: readonly string[];
  /** DTP*291, `YYYY-MM-DD`. The date coverage is being asked about. */
  readonly serviceDate?: string;
  /** TRN02, our reassociation key for matching the 271 back. */
  readonly traceNumber: string;
  /** TRN03, our own identifier as the originator. */
  readonly originatorCompanyId: string;
  /** BHT03. */
  readonly originatorTransactionId: string;
  /** BHT04 and BHT05. */
  readonly created: Date;
}

/** The interchange-level facts the mapper does not own. */
export interface Encode270Options {
  readonly sender: {
    readonly qualifier: string;
    readonly id: string;
    readonly applicationId: string;
  };
  readonly receiver: {
    readonly qualifier: string;
    readonly id: string;
    readonly applicationId: string;
  };
  readonly usageIndicator: 'P' | 'T';
  readonly controlNumbers: ControlNumbers;
  readonly delimiters?: Delimiters;
}

/** The implementation convention this encoder writes. */
export const IMPLEMENTATION_270 = '005010X279A1';

/** The general "is this coverage active" inquiry. */
export const DEFAULT_SERVICE_TYPE_CODES: readonly string[] = ['30'];

/** Encodes one eligibility inquiry as a complete 270 interchange. */
export function encode270(
  request: EligibilityRequest,
  options: Encode270Options
): Result<string, X12Error> {
  if (!/^\d{10}$/.test(request.provider.npi)) {
    return err({
      kind: 'encode_precondition',
      message: `an NPI must be ten digits, received "${request.provider.npi}"`,
      path: ['provider', 'npi'],
    });
  }
  if (request.subscriber.memberId === '') {
    return err({
      kind: 'encode_precondition',
      message: 'an eligibility inquiry must carry the subscriber member id',
      path: ['subscriber', 'memberId'],
    });
  }

  return writeInterchange({
    sender: options.sender,
    receiver: options.receiver,
    created: request.created,
    usageIndicator: options.usageIndicator,
    controlNumbers: options.controlNumbers,
    delimiters: options.delimiters,
    groups: [
      {
        functionalIdentifier: 'HS',
        version: IMPLEMENTATION_270,
        transactions: [
          {
            setIdentifier: '270',
            implementationConvention: IMPLEMENTATION_270,
            segments: buildTransaction(request),
          },
        ],
      },
    ],
  });
}

function buildTransaction(request: EligibilityRequest): readonly Segment[] {
  const out: Segment[] = [];
  const hasDependent = request.dependent !== undefined;

  out.push(
    segment(
      'BHT',
      '0022',
      '13',
      request.originatorTransactionId,
      formatDate8(request.created),
      formatTime4(request.created)
    )
  );

  // 2000A information source: the payer being asked.
  out.push(segment('HL', '1', '', '20', '1'));
  out.push(
    segment('NM1', 'PR', '2', request.payer.name, '', '', '', '', 'PI', request.payer.identifier)
  );

  // 2000B information receiver: the provider asking.
  out.push(segment('HL', '2', '1', '21', '1'));
  out.push(
    segment('NM1', '1P', '2', request.provider.name, '', '', '', '', 'XX', request.provider.npi)
  );

  // 2000C subscriber. The child code flips when a dependent level follows,
  // exactly as it does in the 837.
  out.push(segment('HL', '3', '2', '22', hasDependent ? '1' : '0'));
  out.push(segment('TRN', '1', request.traceNumber, request.originatorCompanyId));
  out.push(
    segment(
      'NM1',
      'IL',
      '1',
      request.subscriber.name.family,
      request.subscriber.name.given,
      request.subscriber.name.middle ?? '',
      '',
      '',
      'MI',
      request.subscriber.memberId
    )
  );
  if (request.subscriber.birthDate !== undefined && request.subscriber.gender !== undefined) {
    out.push(
      segment('DMG', 'D8', compactDate(request.subscriber.birthDate), request.subscriber.gender)
    );
  }

  if (request.dependent === undefined) {
    out.push(...inquirySegments(request));
    return out;
  }

  // 2000D dependent.
  const dependent = request.dependent;
  out.push(segment('HL', '4', '3', '23', '0'));
  out.push(
    segment(
      'NM1',
      '03',
      '1',
      dependent.name.family,
      dependent.name.given,
      dependent.name.middle ?? ''
    )
  );
  out.push(segment('DMG', 'D8', compactDate(dependent.birthDate), dependent.gender));
  out.push(segment('INS', 'N', toRelationshipCode(dependent.relationship)));
  out.push(...inquirySegments(request));
  return out;
}

function inquirySegments(request: EligibilityRequest): readonly Segment[] {
  const out: Segment[] = [];
  if (request.serviceDate !== undefined) {
    out.push(segment('DTP', '291', 'D8', compactDate(request.serviceDate)));
  }
  // One EQ per service type rather than one EQ with a repeating element. Both
  // are legal; separate segments survive partners whose parsers quietly ignore
  // the repetition separator, and cost one extra segment each.
  for (const code of request.serviceTypeCodes ?? DEFAULT_SERVICE_TYPE_CODES) {
    out.push(segment('EQ', code));
  }
  return out;
}

function compactDate(isoDate: string): string {
  return isoDate.replaceAll('-', '');
}
