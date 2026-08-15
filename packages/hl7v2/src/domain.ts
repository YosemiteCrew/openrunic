/**
 * WHAT THE MESSAGES CARRY, INDEPENDENT OF THEIR PUNCTUATION.
 *
 * The shape a caller supplies and receives. It is not a Prisma row and not a
 * FHIR resource: it sits between them and the pipes, so the codec can be tested
 * without a database and the mapping from the practice's tables is one readable
 * function rather than field arithmetic interleaved with repository calls.
 *
 * Everything optional here is optional in real traffic. A registration message
 * without a middle name, a result without a reference range, an order without a
 * placer comment - all of them are ordinary, and requiring any of them would
 * mean inventing a value that another clinician then reads.
 */

/** Who sent it, who it is for, and what it is. */
export interface MessageHeader {
  readonly sendingApplication: string;
  readonly sendingFacility: string;
  readonly receivingApplication: string;
  readonly receivingFacility: string;
  /** ISO instant. */
  readonly sentAt: string;
  /** Unique per sender; what an acknowledgement quotes back. */
  readonly controlId: string;
  /** `P` production, `T` training, `D` debugging. */
  readonly processingId: 'P' | 'T' | 'D';
  /** The version the sender claims to speak, e.g. `2.5.1`. */
  readonly version: string;
}

export type Sex = 'M' | 'F' | 'O' | 'U';

export interface Patient {
  /** The practice's medical record number. */
  readonly mrn: string;
  readonly familyName: string;
  readonly givenName: string;
  readonly middleName?: string;
  /** `YYYY-MM-DD`. A date, never an instant: see time.ts. */
  readonly birthDate?: string;
  readonly sex?: Sex;
  readonly address?: {
    readonly line1?: string;
    readonly city?: string;
    readonly state?: string;
    readonly postalCode?: string;
    readonly country?: string;
  };
  readonly phone?: string;
  /** Present only on a death notification; its absence is not a claim. */
  readonly deceasedAt?: string;
}

export interface Visit {
  /** The practice's visit number, what a downstream system reconciles on. */
  readonly visitNumber: string;
  /** `I` inpatient, `O` outpatient, `E` emergency, `P` preadmit, `R` recurring. */
  readonly patientClass: string;
  readonly location?: string;
  readonly attendingProviderId?: string;
  readonly attendingProviderName?: string;
  readonly admittedAt?: string;
  readonly dischargedAt?: string;
}

/** A code from a named system: `code^display^system`. */
export interface CodedValue {
  readonly code: string;
  readonly display?: string;
  /** `LN` for LOINC, `SCT` for SNOMED, `CVX` for vaccines, and so on. */
  readonly system?: string;
}

export interface ObservationResult {
  /** `NM` numeric, `ST` string, `TX` text, `CE` coded, and the rest. */
  readonly valueType: string;
  readonly identifier: CodedValue;
  readonly value: string;
  readonly units?: string;
  readonly referenceRange?: string;
  /** `N`, `H`, `L`, `A`, `AA` - the abnormal-flag vocabulary. */
  readonly abnormalFlag?: string;
  /** `F` final, `P` preliminary, `C` corrected. */
  readonly status: string;
  readonly observedAt?: string;
  /** Free-text notes the analyser sent with this result. */
  readonly notes?: readonly string[];
}

export interface ObservationRequest {
  /** The order number the placer assigned. */
  readonly placerOrderNumber: string;
  /** The order number the filler assigned, when there is one. */
  readonly fillerOrderNumber?: string;
  readonly service: CodedValue;
  readonly requestedAt?: string;
  readonly observedAt?: string;
  readonly orderingProviderId?: string;
  readonly orderingProviderName?: string;
  readonly results: readonly ObservationResult[];
}

/** ADT, in the four events that actually change a chart. */
export type AdtEvent = 'A01' | 'A03' | 'A04' | 'A08';

export interface AdtMessage {
  readonly header: MessageHeader;
  readonly event: AdtEvent;
  /** When the event happened, which is not when the message was sent. */
  readonly occurredAt: string;
  readonly patient: Patient;
  readonly visit?: Visit;
}

export interface OruMessage {
  readonly header: MessageHeader;
  readonly patient: Patient;
  readonly visit?: Visit;
  readonly orders: readonly ObservationRequest[];
}

export interface OrmOrder {
  readonly placerOrderNumber: string;
  readonly fillerOrderNumber?: string;
  /** `NW` new, `CA` cancel, `XO` change, `OK` accepted. */
  readonly orderControl: string;
  readonly service: CodedValue;
  readonly requestedAt?: string;
  readonly orderingProviderId?: string;
  readonly orderingProviderName?: string;
  readonly priority?: string;
  readonly notes?: readonly string[];
}

export interface OrmMessage {
  readonly header: MessageHeader;
  readonly patient: Patient;
  readonly visit?: Visit;
  readonly orders: readonly OrmOrder[];
}

export interface Immunisation {
  /** Sequence within the message, 1-based. */
  readonly sequence: number;
  readonly vaccine: CodedValue;
  readonly administeredAt: string;
  /** Absent when the dose was refused or not given; see `completionStatus`. */
  readonly amount?: string;
  readonly units?: string;
  readonly lotNumber?: string;
  readonly manufacturer?: CodedValue;
  readonly route?: CodedValue;
  readonly site?: CodedValue;
  /** `CP` complete, `RE` refused, `NA` not administered, `PA` partial. */
  readonly completionStatus: string;
  readonly administeringProviderId?: string;
}

export interface VxuMessage {
  readonly header: MessageHeader;
  readonly patient: Patient;
  readonly immunisations: readonly Immunisation[];
}

/** What an acknowledgement says about a message that arrived. */
export interface Acknowledgement {
  readonly header: MessageHeader;
  /** `AA` accepted, `AE` application error, `AR` application reject. */
  readonly code: 'AA' | 'AE' | 'AR';
  /** The control id of the message being acknowledged. */
  readonly acknowledgedControlId: string;
  readonly text?: string;
}
