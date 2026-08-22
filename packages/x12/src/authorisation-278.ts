import { err, ok } from '@openrunic/types';
import type { Result } from '@openrunic/types';

import type { ControlNumbers } from './control.js';
import type { Delimiters } from './delimiters.js';
import type { NamedParty, PersonName, SubscriberRelationship, X12Gender } from './domain.js';
import { toRelationshipCode } from './domain.js';
import type { X12Error } from './errors.js';
import { formatDate8, formatTime4 } from './format.js';
import { segment, simpleAt } from './segments.js';
import type { Segment } from './segments.js';
import { writeInterchange } from './writer.js';

/**
 * PRIOR AUTHORISATION: THE 278 REQUEST AND THE 278 RESPONSE.
 *
 * The transaction that asks a payer whether it will cover something before it
 * happens, and the answer. It is the same envelope in both directions - `HI` is
 * the functional identifier for both halves - which is why they live in one
 * file: the response is read by the same code that knows how the request was
 * shaped, and separating them is how a field comes to be written under one name
 * and read under another.
 *
 * ## What the answer actually is
 *
 * `A1` certified, `A2` certified partial, `A3` denied, `A4` pended, `A6`
 * modified. Four of those five are not "no", and treating anything that is not
 * `A1` as a refusal is the mistake that makes a practice re-submit an
 * authorisation it already has.
 *
 * `A4` is the one that matters operationally: pended means the payer has not
 * decided, and the request is neither approved nor refused. A system that
 * collapses it into either produces a work queue that is wrong in one direction
 * or the other - either chasing authorisations that are coming, or scheduling
 * against ones that never arrive.
 *
 * ## What this deliberately does not do
 *
 * It does not decide whether a service needs authorisation. That is a payer
 * policy question answered by a contract and a code list, not by a transaction,
 * and a system that guessed would either send requests nobody asked for or skip
 * the one that mattered.
 */

/** The 005010X217 implementation convention both halves declare. */
const IMPLEMENTATION_278 = '005010X217';

/** The requester: the practice asking for the authorisation. */
export interface AuthorisationRequester {
  readonly name: string;
  /** Ten digits. */
  readonly npi: string;
}

/** Where the service would be performed, when it is somewhere else. */
export interface AuthorisationServiceProvider {
  readonly name: string;
  readonly npi: string;
}

export interface AuthorisationSubscriber {
  readonly memberId: string;
  readonly name: PersonName;
  readonly birthDate?: string;
  readonly gender?: X12Gender;
}

export interface AuthorisationDependent {
  readonly name: PersonName;
  readonly birthDate: string;
  readonly gender: X12Gender;
  readonly relationship: SubscriberRelationship;
}

/** What is being asked for. */
export interface AuthorisationService {
  /**
   * UM02: the certification type. `I` initial, `R` renewal, `S` revised.
   * Defaults to initial, which is what a practice asking for the first time
   * means and what every payer expects when it is left off.
   */
  readonly certificationType?: 'I' | 'R' | 'S';
  /**
   * UM01: the request category. `HS` health services review, `SC` specialty
   * care review - the one a referral for a specialist opinion uses.
   */
  readonly requestCategory: 'HS' | 'SC' | 'AR' | 'IN';
  /** UM03: the service type, e.g. `2` for a surgical procedure. */
  readonly serviceTypeCode?: string;
  /** The procedure being requested. CPT or HCPCS. */
  readonly procedureCode?: string;
  /** ICD-10-CM codes justifying it. */
  readonly diagnosisCodes?: readonly string[];
  /** How many of the thing. A visit count, a unit count. */
  readonly quantity?: number;
  /** `VS` visits, `UN` units, `DA` days. */
  readonly quantityUnit?: 'VS' | 'UN' | 'DA';
  /** `YYYY-MM-DD`. When the service is proposed to start. */
  readonly serviceDate?: string;
  /** `YYYY-MM-DD`. The end of a proposed span, for a course of treatment. */
  readonly serviceEndDate?: string;
}

export interface AuthorisationRequest {
  readonly payer: NamedParty;
  readonly requester: AuthorisationRequester;
  readonly subscriber: AuthorisationSubscriber;
  readonly dependent?: AuthorisationDependent;
  readonly serviceProvider?: AuthorisationServiceProvider;
  readonly service: AuthorisationService;
  /** Echoed back on the response; this is how a practice matches the two up. */
  readonly traceNumber: string;
  readonly originatorCompanyId: string;
  readonly originatorTransactionId: string;
  readonly created: Date;
}

export interface Encode278Options {
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

export function encode278(
  request: AuthorisationRequest,
  options: Encode278Options
): Result<string, X12Error> {
  if (!/^\d{10}$/.test(request.requester.npi)) {
    return err({
      kind: 'encode_precondition',
      message: `an NPI must be ten digits, received "${request.requester.npi}"`,
      path: ['requester', 'npi'],
    });
  }
  if (request.subscriber.memberId === '') {
    return err({
      kind: 'encode_precondition',
      message: 'an authorisation request must carry the subscriber member id',
      path: ['subscriber', 'memberId'],
    });
  }
  if (request.traceNumber === '') {
    // Without it the response cannot be matched to the request that produced
    // it, and an authorisation nobody can attach to a patient is one nobody can
    // act on.
    return err({
      kind: 'encode_precondition',
      message: 'an authorisation request must carry a trace number to match the response against',
      path: ['traceNumber'],
    });
  }

  return writeInterchange({
    sender: options.sender,
    receiver: options.receiver,
    created: request.created,
    usageIndicator: options.usageIndicator,
    controlNumbers: options.controlNumbers,
    ...(options.delimiters === undefined ? {} : { delimiters: options.delimiters }),
    groups: [
      {
        functionalIdentifier: 'HI',
        version: IMPLEMENTATION_278,
        transactions: [
          {
            setIdentifier: '278',
            implementationConvention: IMPLEMENTATION_278,
            segments: buildRequest(request),
          },
        ],
      },
    ],
  });
}

function buildRequest(request: AuthorisationRequest): readonly Segment[] {
  const out: Segment[] = [];
  const hasDependent = request.dependent !== undefined;

  // `0007` is the 278 request structure; `13` says this is a request rather
  // than a response, which is the one element that decides how the receiving
  // system routes the whole transaction.
  out.push(
    segment(
      'BHT',
      '0007',
      '13',
      request.originatorTransactionId,
      formatDate8(request.created),
      formatTime4(request.created)
    )
  );

  // 2000A the payer being asked.
  out.push(segment('HL', '1', '', '20', '1'));
  out.push(
    segment('NM1', 'X3', '2', request.payer.name, '', '', '', '', 'PI', request.payer.identifier)
  );

  // 2000B the requester.
  out.push(segment('HL', '2', '1', '21', '1'));
  out.push(
    segment('NM1', '1P', '2', request.requester.name, '', '', '', '', 'XX', request.requester.npi)
  );

  // 2000C the subscriber.
  out.push(segment('HL', '3', '2', '22', hasDependent ? '1' : '0'));
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

  if (hasDependent && request.dependent !== undefined) {
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
  }

  out.push(...serviceSegments(request));
  return out;
}

function serviceSegments(request: AuthorisationRequest): readonly Segment[] {
  const out: Segment[] = [];
  const { service } = request;

  // 2000E the service being requested. The trace number rides here, on the
  // level the response answers about.
  out.push(
    segment(
      'HL',
      hasDependentLevel(request) ? '5' : '4',
      hasDependentLevel(request) ? '4' : '3',
      'SS',
      '0'
    )
  );
  out.push(segment('TRN', '1', request.traceNumber, request.originatorCompanyId));
  out.push(
    segment(
      'UM',
      service.requestCategory,
      service.certificationType ?? 'I',
      service.serviceTypeCode ?? ''
    )
  );

  for (const [index, code] of (service.diagnosisCodes ?? []).entries()) {
    // `ABK` is the principal diagnosis and `ABF` each one after it. Sending
    // every code as principal is a common defect and produces a request the
    // payer reads as several unrelated conditions.
    // Components, not a joined string with a hardcoded colon. The colon is only
    // the DEFAULT component separator - a partner may declare another, and this
    // was emitting a literal one regardless - and passing the parts lets the
    // writer check the diagnosis code itself for a delimiter rather than seeing
    // an element that already contains one.
    out.push(segment('HI', [index === 0 ? 'ABK' : 'ABF', code]));
  }

  if (service.serviceDate !== undefined) {
    out.push(
      service.serviceEndDate === undefined
        ? segment('DTP', '472', 'D8', compactDate(service.serviceDate))
        : segment(
            'DTP',
            '472',
            'RD8',
            `${compactDate(service.serviceDate)}-${compactDate(service.serviceEndDate)}`
          )
    );
  }

  if (service.procedureCode !== undefined) {
    out.push(
      segment('SV1', ['HC', service.procedureCode], '', 'UN', String(service.quantity ?? 1))
    );
  }

  if (service.quantity !== undefined && service.quantityUnit !== undefined) {
    out.push(segment('HSD', service.quantityUnit, String(service.quantity)));
  }

  if (request.serviceProvider !== undefined) {
    out.push(
      segment(
        'NM1',
        'SJ',
        '2',
        request.serviceProvider.name,
        '',
        '',
        '',
        '',
        'XX',
        request.serviceProvider.npi
      )
    );
  }

  return out;
}

function hasDependentLevel(request: AuthorisationRequest): boolean {
  return request.dependent !== undefined;
}

/* ----------------------------------------------------------- the response */

/**
 * What a payer answered.
 *
 * Five outcomes, and only one of them is a plain yes. `pended` is the one that
 * decides whether a practice waits or acts, and a system that folded it into
 * approved or denied would produce a work queue that is wrong in one direction
 * or the other.
 */
export type AuthorisationDecision =
  'certified' | 'certified-partial' | 'modified' | 'denied' | 'pended' | 'cancelled';

/** HCR01 action codes, as the standard defines them. */
const DECISIONS: Readonly<Record<string, AuthorisationDecision>> = {
  A1: 'certified',
  A2: 'certified-partial',
  A3: 'denied',
  A4: 'pended',
  A6: 'modified',
  CT: 'cancelled',
};

export interface AuthorisationResponse {
  /** The trace number from the request, which is how the two are matched. */
  readonly traceNumber: string;
  readonly decision: AuthorisationDecision;
  /** The number to quote on the claim. Absent while pended or denied. */
  readonly authorisationNumber?: string;
  /**
   * Why, in the payer's own code. Present on a denial, a modification and
   * usually a pend; each names a different thing to do about it.
   */
  readonly reasonCodes: readonly string[];
  /** How many the payer actually certified, which may be fewer than asked. */
  readonly certifiedQuantity?: number;
  readonly certifiedUnit?: string;
  /** `YYYY-MM-DD`. The span the authorisation is valid for. */
  readonly effectiveFrom?: string;
  readonly effectiveTo?: string;
  /** Free text the payer attached, when it did. */
  readonly message?: string;
}

/**
 * Reads a 278 response.
 *
 * Takes the parsed segments rather than the raw string, so the envelope reader
 * stays the one place that knows about ISA and GS - see reader.ts. A response
 * carrying several authorisation levels answers several requests, so this
 * returns one entry per HCR.
 */
export function decode278(segments: readonly Segment[]): Result<AuthorisationResponse[], X12Error> {
  const responses: AuthorisationResponse[] = [];
  let trace = '';
  // A mutable accumulator, because the fields arrive across several segments
  // and the shape they build up to is immutable.
  let pending: {
    -readonly [K in keyof AuthorisationResponse]?: AuthorisationResponse[K];
  } & { reasonCodes: string[] } = { reasonCodes: [] };
  let open = false;

  const flush = (): void => {
    if (!open) return;
    const decision = pending.decision;
    if (decision !== undefined) {
      responses.push({
        // Never a fallback to the running trace. An HCR is refused outright
        // without one, so a decision that reaches here always carries the trace
        // that was on its own level; a `?? trace` here would be the same
        // inheritance the HCR branch exists to refuse, reintroduced one function
        // away.
        traceNumber: pending.traceNumber ?? '',
        decision,
        reasonCodes: pending.reasonCodes,
        ...(pending.authorisationNumber === undefined
          ? {}
          : { authorisationNumber: pending.authorisationNumber }),
        ...(pending.certifiedQuantity === undefined
          ? {}
          : { certifiedQuantity: pending.certifiedQuantity }),
        ...(pending.certifiedUnit === undefined ? {} : { certifiedUnit: pending.certifiedUnit }),
        ...(pending.effectiveFrom === undefined ? {} : { effectiveFrom: pending.effectiveFrom }),
        ...(pending.effectiveTo === undefined ? {} : { effectiveTo: pending.effectiveTo }),
        ...(pending.message === undefined ? {} : { message: pending.message }),
      });
    }
    pending = { reasonCodes: [] };
    open = false;
  };

  for (const current of segments) {
    if (current.tag === 'TRN') {
      // A trace on its own level; the HCR that follows answers about it.
      trace = simpleAt(current, 2);
      continue;
    }

    if (current.tag === 'HCR') {
      // A new decision closes the previous one, which is what makes several
      // authorisations in one response come back as several entries rather
      // than as one with the last payer's fields on it.
      flush();
      open = true;
      // The trace is CONSUMED here, not merely read. It rides on the 2000E
      // level the decision answers about, one per decision, so a second HCR
      // arriving without its own TRN has nothing to be matched by - and the
      // accumulator used to hand it the previous decision's. That is the
      // dangerous shape: the caller matches prior-authorisation results by this
      // field, so an inherited one posts a denial, an approval or an
      // authorisation number against a different request and therefore a
      // different patient. A wrong answer, where a refusal is only a missing
      // one.
      if (trace === '') {
        return err({
          kind: 'missing_segment',
          message:
            'an HCR decision arrived with no TRN of its own, so there is nothing to match this response to the request that produced it',
          tag: 'TRN',
        });
      }
      const decisionTrace = trace;
      trace = '';
      const code = simpleAt(current, 1);
      const decision = DECISIONS[code];
      if (decision === undefined) {
        return err({
          kind: 'invalid_element',
          message: `HCR01 carried "${code}", which is not an action code this decoder knows`,
          at: { segmentIndex: segments.indexOf(current), segmentTag: 'HCR', elementPosition: 1 },
          value: code,
          expected: Object.keys(DECISIONS).join(', '),
        });
      }
      pending.decision = decision;
      pending.traceNumber = decisionTrace;
      const reason = simpleAt(current, 3);
      if (reason !== '') pending.reasonCodes.push(reason);
      continue;
    }

    if (!open) continue;

    if (current.tag === 'REF' && simpleAt(current, 1) === 'BB') {
      // `BB` is the authorisation number: the thing the whole exchange exists
      // to obtain, and the value that goes on the claim.
      pending.authorisationNumber = simpleAt(current, 2);
      continue;
    }

    if (current.tag === 'HSD') {
      pending.certifiedUnit = simpleAt(current, 1);
      const quantity = Number.parseFloat(simpleAt(current, 2));
      if (!Number.isNaN(quantity)) pending.certifiedQuantity = quantity;
      continue;
    }

    if (current.tag === 'DTP' && simpleAt(current, 1) === '007') {
      const span = readSpan(simpleAt(current, 2), simpleAt(current, 3));
      if (span !== undefined) {
        pending.effectiveFrom = span.from;
        if (span.to !== undefined) pending.effectiveTo = span.to;
      }
      continue;
    }

    if (current.tag === 'MSG') {
      pending.message = simpleAt(current, 1);
    }
  }

  flush();
  return ok(responses);
}

/** `D8` is one date, `RD8` a range written `YYYYMMDD-YYYYMMDD`. */
function readSpan(format: string, value: string): { from: string; to?: string } | undefined {
  if (format === 'D8' && /^\d{8}$/.test(value)) return { from: expandDate(value) };
  if (format === 'RD8') {
    const [from, to] = value.split('-');
    if (from !== undefined && /^\d{8}$/.test(from)) {
      return to !== undefined && /^\d{8}$/.test(to)
        ? { from: expandDate(from), to: expandDate(to) }
        : { from: expandDate(from) };
    }
  }
  return undefined;
}

function expandDate(compact: string): string {
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function compactDate(isoDate: string): string {
  return isoDate.replaceAll('-', '');
}

/**
 * Whether a decision means the practice may go ahead.
 *
 * Named rather than left to each caller, because "is this approved" is a
 * question with one right answer and several plausible wrong ones - and a
 * caller that treats anything other than `certified` as a refusal makes a
 * practice re-submit an authorisation it already holds, while one that treats
 * `pended` as approval schedules against an answer that never came.
 */
export function isAuthorised(decision: AuthorisationDecision): boolean {
  return decision === 'certified' || decision === 'certified-partial' || decision === 'modified';
}

/** Whether the payer has yet to decide, which is neither yes nor no. */
export function isPending(decision: AuthorisationDecision): boolean {
  return decision === 'pended';
}
