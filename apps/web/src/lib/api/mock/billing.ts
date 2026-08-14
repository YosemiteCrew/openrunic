import type {
  AgeingBucket,
  BillingPatientRef,
  Claim,
  ClaimEvent,
  ClaimListQuery,
  ClaimScrubError,
  ClaimServiceLine,
  ClaimStatus,
  FeeSheet,
  FeeSheetListQuery,
  Payment,
  PaymentListQuery,
  PayerRef,
  ProcedureCode,
  Remittance,
  RemittanceLine,
  RemittanceListQuery,
  StatementAccount,
  StatementLine,
  StatementListQuery,
} from '../billing';

import { MOCK_CLINIC_DAY, MOCK_FACILITY, MOCK_PATIENTS } from './fixtures';

/**
 * The demo clinic's revenue cycle, as fixtures.
 *
 * Same rules as `fixtures.ts`: synthetic by construction, deterministic, no
 * `Date.now()` and no randomness, every instant derived from
 * {@link MOCK_CLINIC_DAY}. A billing screen is only honest at realistic
 * density, so the shapes here carry a working day's worth of mess: an
 * unjustified charge line, two claims that failed scrubbing, a denial with a
 * rebill behind it, an 835 with three exceptions, and AR that is genuinely old.
 *
 * Money is in major units throughout. Formatting belongs to `@/lib/format`.
 */

const CURRENCY = 'USD';

/** An instant `days` before the clinic day, at a fixed wall-clock time. */
function daysBefore(days: number, clockTime = '09:00'): string {
  const base = new Date(`${MOCK_CLINIC_DAY}T${clockTime}:00.000Z`);
  return new Date(base.getTime() - days * 86_400_000).toISOString();
}

/**
 * A patient reference by MRN rather than by index: `MOCK_PATIENTS` is sorted by
 * family name, so an index would silently re-point every fixture the day a
 * patient is added.
 */
function patientRef(mrn: string): BillingPatientRef {
  const patient = MOCK_PATIENTS.find((candidate) => candidate.mrn === mrn);
  if (!patient) {
    throw new Error(`Billing fixture references an unknown MRN: ${mrn}.`);
  }
  return { id: patient.id, mrn: patient.mrn, name: patient.name };
}

/* -------------------------------------------------------------------------- */
/* Payers                                                                      */
/* -------------------------------------------------------------------------- */

export const MOCK_PAYERS: readonly PayerRef[] = [
  { id: '0192f1a0-0000-7000-8000-00000000y001', name: 'Cedar Mutual Health', payerId: '87726' },
  { id: '0192f1a0-0000-7000-8000-00000000y002', name: 'Birchwood State Plan', payerId: '61425' },
  { id: '0192f1a0-0000-7000-8000-00000000y003', name: 'Northfield Benefit', payerId: '39026' },
];

function payer(index: 0 | 1 | 2): PayerRef {
  const found = MOCK_PAYERS[index];
  if (!found) throw new Error(`Billing fixture references an unknown payer index: ${index}.`);
  return found;
}

/* -------------------------------------------------------------------------- */
/* Fee sheets (BL-01 charge capture)                                           */
/* -------------------------------------------------------------------------- */

/**
 * The code catalogue the picker searches, with the admin-configured shortcut
 * panels a family practice actually uses. Panelled codes are the one-click
 * chips above the table; the rest are search-only.
 */
export const MOCK_PROCEDURE_CATALOG: readonly ProcedureCode[] = [
  { code: '99213', display: 'Office visit, established, 20 min', fee: 128, panel: 'Office visit' },
  { code: '99214', display: 'Office visit, established, 30 min', fee: 186, panel: 'Office visit' },
  { code: '99203', display: 'Office visit, new patient, 30 min', fee: 172, panel: 'Office visit' },
  {
    code: '99396',
    display: 'Preventive visit, established, 40-64 y',
    fee: 224,
    panel: 'Preventive',
  },
  { code: '99392', display: 'Preventive visit, established, 1-4 y', fee: 198, panel: 'Preventive' },
  { code: '36415', display: 'Venipuncture, routine', fee: 18, panel: 'In-office labs' },
  { code: '81002', display: 'Urinalysis, non-automated', fee: 22, panel: 'In-office labs' },
  { code: '85610', display: 'Prothrombin time', fee: 24, panel: 'In-office labs' },
  { code: '90471', display: 'Immunisation administration, first', fee: 32, panel: 'Immunisation' },
  { code: '90686', display: 'Influenza vaccine, quadrivalent', fee: 41, panel: 'Immunisation' },
  { code: '11042', display: 'Debridement, subcutaneous tissue', fee: 214, panel: 'Procedures' },
  { code: '17110', display: 'Destruction of benign lesion', fee: 168, panel: 'Procedures' },
  { code: '69210', display: 'Removal of impacted cerumen', fee: 78, panel: 'Procedures' },
  { code: '93000', display: 'Electrocardiogram, complete', fee: 96, panel: null },
  { code: '94640', display: 'Nebuliser treatment', fee: 64, panel: null },
  { code: 'G0439', display: 'Annual wellness visit, subsequent', fee: 176, panel: null },
];

/** The panels, in the order the chip groups render. */
export const MOCK_PROCEDURE_PANELS: readonly string[] = [
  'Office visit',
  'Preventive',
  'In-office labs',
  'Immunisation',
  'Procedures',
];

export const MOCK_FEE_SHEETS: readonly FeeSheet[] = [
  {
    id: '0192f1a0-0000-7000-8000-00000000c001',
    encounterId: '0192f1a0-0000-7000-8000-00000000a001',
    patient: patientRef('OR-100482'),
    providerName: 'Dr. Okafor',
    facilityId: MOCK_FACILITY.id,
    serviceDate: `${MOCK_CLINIC_DAY}T08:00:00.000Z`,
    visitType: 'Follow-up',
    status: 'OPEN',
    copayDue: 30,
    copayCollected: 30,
    currency: CURRENCY,
    diagnoses: [
      { code: 'I10', display: 'Essential hypertension' },
      { code: 'E78.5', display: 'Hyperlipidaemia, unspecified' },
      { code: 'Z00.00', display: 'General adult medical examination' },
    ],
    lines: [
      {
        id: 'c001-l1',
        code: '99214',
        display: 'Office visit, established, 30 min',
        modifiers: ['25'],
        units: 1,
        unitFee: 186,
        justifiedBy: ['I10'],
        deleted: false,
      },
      {
        id: 'c001-l2',
        code: '36415',
        display: 'Venipuncture, routine',
        modifiers: [],
        units: 1,
        unitFee: 18,
        justifiedBy: ['E78.5'],
        deleted: false,
      },
      {
        id: 'c001-l3',
        code: '93000',
        display: 'Electrocardiogram, complete',
        modifiers: [],
        units: 1,
        unitFee: 96,
        // The unjustified line the screen exists to make impossible to miss.
        justifiedBy: [],
        deleted: false,
      },
    ],
    catalog: [...MOCK_PROCEDURE_CATALOG],
    authWarning: null,
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000c002',
    encounterId: '0192f1a0-0000-7000-8000-00000000a002',
    patient: patientRef('OR-100517'),
    providerName: 'Dr. Okafor',
    facilityId: MOCK_FACILITY.id,
    serviceDate: `${MOCK_CLINIC_DAY}T08:20:00.000Z`,
    visitType: 'Chronic care',
    status: 'OPEN',
    copayDue: 30,
    copayCollected: 0,
    currency: CURRENCY,
    diagnoses: [
      { code: 'E11.9', display: 'Type 2 diabetes without complications' },
      { code: 'I10', display: 'Essential hypertension' },
    ],
    lines: [
      {
        id: 'c002-l1',
        code: '99213',
        display: 'Office visit, established, 20 min',
        modifiers: [],
        units: 1,
        unitFee: 128,
        justifiedBy: ['E11.9'],
        deleted: false,
      },
      {
        id: 'c002-l2',
        code: '81002',
        display: 'Urinalysis, non-automated',
        modifiers: [],
        units: 1,
        unitFee: 22,
        justifiedBy: ['E11.9'],
        deleted: false,
      },
      {
        id: 'c002-l3',
        code: '85610',
        display: 'Prothrombin time',
        modifiers: [],
        units: 1,
        unitFee: 24,
        justifiedBy: [],
        // Struck, retained, restorable: the mistake the legacy fee sheet hid.
        deleted: true,
      },
    ],
    catalog: [...MOCK_PROCEDURE_CATALOG],
    authWarning: 'Prior authorisation 0042-B has 0 visits remaining for this service.',
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000c003',
    encounterId: '0192f1a0-0000-7000-8000-00000000a003',
    patient: patientRef('OR-100608'),
    providerName: 'Dr. Lindqvist',
    facilityId: MOCK_FACILITY.id,
    serviceDate: `${MOCK_CLINIC_DAY}T08:40:00.000Z`,
    visitType: 'Well-child visit',
    status: 'READY',
    copayDue: 0,
    copayCollected: 0,
    currency: CURRENCY,
    diagnoses: [
      { code: 'Z00.129', display: 'Routine child health examination' },
      { code: 'Z23', display: 'Encounter for immunisation' },
    ],
    lines: [
      {
        id: 'c003-l1',
        code: '99392',
        display: 'Preventive visit, established, 1-4 y',
        modifiers: [],
        units: 1,
        unitFee: 198,
        justifiedBy: ['Z00.129'],
        deleted: false,
      },
      {
        id: 'c003-l2',
        code: '90471',
        display: 'Immunisation administration, first',
        modifiers: [],
        units: 1,
        unitFee: 32,
        justifiedBy: ['Z23'],
        deleted: false,
      },
      {
        id: 'c003-l3',
        code: '90686',
        display: 'Influenza vaccine, quadrivalent',
        modifiers: [],
        units: 1,
        unitFee: 41,
        justifiedBy: ['Z23'],
        deleted: false,
      },
    ],
    catalog: [...MOCK_PROCEDURE_CATALOG],
    authWarning: null,
  },
];

/* -------------------------------------------------------------------------- */
/* Claims (BL-03, BL-04)                                                       */
/* -------------------------------------------------------------------------- */

interface ClaimSeed {
  suffix: string;
  claimNumber: string;
  mrn: string;
  payerIndex: 0 | 1 | 2;
  status: ClaimStatus;
  /** Days before the clinic day the visit happened. */
  serviceDaysAgo: number;
  /** Days before the clinic day the claim entered its current state. */
  statusDaysAgo: number;
  lines: Array<Omit<ClaimServiceLine, 'id'>>;
  paid?: number;
  patientResponsibility?: number;
  scrubErrors?: ClaimScrubError[];
  denialCode?: string;
  denialReason?: string;
  rebilledFromSuffix?: string;
}

/** The lifecycle each state implies, so a timeline can never contradict a row. */
const LIFECYCLE: Record<ClaimStatus, readonly ClaimStatus[]> = {
  CAPTURED: ['CAPTURED'],
  SCRUBBED: ['CAPTURED', 'SCRUBBED'],
  SUBMITTED: ['CAPTURED', 'SCRUBBED', 'SUBMITTED'],
  ACKNOWLEDGED: ['CAPTURED', 'SCRUBBED', 'SUBMITTED', 'ACKNOWLEDGED'],
  PAID: ['CAPTURED', 'SCRUBBED', 'SUBMITTED', 'ACKNOWLEDGED', 'PAID'],
  DENIED: ['CAPTURED', 'SCRUBBED', 'SUBMITTED', 'ACKNOWLEDGED', 'DENIED'],
  REBILLED: ['CAPTURED', 'SCRUBBED', 'SUBMITTED', 'ACKNOWLEDGED', 'DENIED', 'REBILLED'],
};

const EVENT_COPY: Record<ClaimStatus, { label: string; detail: string; actor: string }> = {
  CAPTURED: {
    label: 'Charges captured',
    detail: 'Fee sheet marked ready for billing.',
    actor: 'Dr. Okafor',
  },
  SCRUBBED: {
    label: 'Scrub passed',
    detail: 'No edits raised against payer rules.',
    actor: 'openrunic scrubber',
  },
  SUBMITTED: {
    label: 'Submitted to payer',
    detail: 'Sent through the clearinghouse adapter.',
    actor: 'Ada Nwosu',
  },
  ACKNOWLEDGED: {
    label: 'Acknowledged',
    detail: '999 accepted, 277 status received.',
    actor: 'Clearinghouse',
  },
  PAID: { label: 'Paid', detail: 'Posted from remittance advice.', actor: 'Auto-post' },
  DENIED: { label: 'Denied', detail: 'Denial received on the 835.', actor: 'Payer' },
  REBILLED: {
    label: 'Corrected and rebilled',
    detail: 'Replacement claim sent to the payer.',
    actor: 'Ada Nwosu',
  },
};

const CLAIM_SEEDS: readonly ClaimSeed[] = [
  {
    suffix: 'b001',
    claimNumber: 'CLM-24118',
    mrn: 'OR-100482',
    payerIndex: 0,
    status: 'CAPTURED',
    serviceDaysAgo: 1,
    statusDaysAgo: 1,
    lines: [
      {
        code: '99214',
        display: 'Office visit, established, 30 min',
        modifiers: ['25'],
        units: 1,
        billed: 186,
        allowed: null,
        paid: null,
        adjustment: null,
        patientResponsibility: null,
      },
    ],
  },
  {
    suffix: 'b002',
    claimNumber: 'CLM-24119',
    mrn: 'OR-100744',
    payerIndex: 1,
    status: 'CAPTURED',
    serviceDaysAgo: 2,
    statusDaysAgo: 2,
    lines: [
      {
        code: '99213',
        display: 'Office visit, established, 20 min',
        modifiers: [],
        units: 1,
        billed: 128,
        allowed: null,
        paid: null,
        adjustment: null,
        patientResponsibility: null,
      },
    ],
    scrubErrors: [
      {
        code: 'DX-JUSTIFY',
        message: 'Line 1 has no diagnosis linked. Justify it on the fee sheet.',
        fixHref: '/billing/charges',
      },
    ],
  },
  {
    suffix: 'b003',
    claimNumber: 'CLM-24120',
    mrn: 'OR-100913',
    payerIndex: 0,
    status: 'CAPTURED',
    serviceDaysAgo: 3,
    statusDaysAgo: 3,
    lines: [
      {
        code: '11042',
        display: 'Debridement, subcutaneous tissue',
        modifiers: [],
        units: 1,
        billed: 214,
        allowed: null,
        paid: null,
        adjustment: null,
        patientResponsibility: null,
      },
    ],
    scrubErrors: [
      {
        code: 'MOD-59',
        message: 'Modifier 59 is required when this code is billed with an office visit.',
        fixHref: '/billing/charges',
      },
      {
        code: 'AUTH-EXHAUSTED',
        message: 'Prior authorisation 0042-B has no visits remaining.',
        fixHref: '/billing/charges',
      },
    ],
  },
  {
    suffix: 'b004',
    claimNumber: 'CLM-24112',
    mrn: 'OR-100608',
    payerIndex: 1,
    status: 'SCRUBBED',
    serviceDaysAgo: 4,
    statusDaysAgo: 1,
    lines: [
      {
        code: '99392',
        display: 'Preventive visit, established, 1-4 y',
        modifiers: [],
        units: 1,
        billed: 198,
        allowed: null,
        paid: null,
        adjustment: null,
        patientResponsibility: null,
      },
      {
        code: '90471',
        display: 'Immunisation administration, first',
        modifiers: [],
        units: 1,
        billed: 32,
        allowed: null,
        paid: null,
        adjustment: null,
        patientResponsibility: null,
      },
    ],
  },
  {
    suffix: 'b005',
    claimNumber: 'CLM-24113',
    mrn: 'OR-100810',
    payerIndex: 2,
    status: 'SCRUBBED',
    serviceDaysAgo: 4,
    statusDaysAgo: 1,
    lines: [
      {
        code: '69210',
        display: 'Removal of impacted cerumen',
        modifiers: [],
        units: 1,
        billed: 78,
        allowed: null,
        paid: null,
        adjustment: null,
        patientResponsibility: null,
      },
    ],
  },
  {
    suffix: 'b006',
    claimNumber: 'CLM-24114',
    mrn: 'OR-101088',
    payerIndex: 0,
    status: 'SCRUBBED',
    serviceDaysAgo: 5,
    statusDaysAgo: 1,
    lines: [
      {
        code: '99213',
        display: 'Office visit, established, 20 min',
        modifiers: [],
        units: 1,
        billed: 128,
        allowed: null,
        paid: null,
        adjustment: null,
        patientResponsibility: null,
      },
    ],
  },
  {
    suffix: 'b007',
    claimNumber: 'CLM-24098',
    mrn: 'OR-100517',
    payerIndex: 0,
    status: 'SUBMITTED',
    serviceDaysAgo: 12,
    statusDaysAgo: 9,
    lines: [
      {
        code: '99214',
        display: 'Office visit, established, 30 min',
        modifiers: [],
        units: 1,
        billed: 186,
        allowed: null,
        paid: null,
        adjustment: null,
        patientResponsibility: null,
      },
    ],
  },
  {
    suffix: 'b008',
    claimNumber: 'CLM-24099',
    mrn: 'OR-100866',
    payerIndex: 1,
    status: 'SUBMITTED',
    serviceDaysAgo: 14,
    statusDaysAgo: 11,
    lines: [
      {
        code: '93000',
        display: 'Electrocardiogram, complete',
        modifiers: [],
        units: 1,
        billed: 96,
        allowed: null,
        paid: null,
        adjustment: null,
        patientResponsibility: null,
      },
    ],
  },
  {
    suffix: 'b009',
    claimNumber: 'CLM-24076',
    mrn: 'OR-100978',
    payerIndex: 2,
    status: 'SUBMITTED',
    serviceDaysAgo: 38,
    statusDaysAgo: 34,
    lines: [
      {
        code: '90686',
        display: 'Influenza vaccine, quadrivalent',
        modifiers: [],
        units: 1,
        billed: 41,
        allowed: null,
        paid: null,
        adjustment: null,
        patientResponsibility: null,
      },
    ],
  },
  {
    suffix: 'b010',
    claimNumber: 'CLM-24081',
    mrn: 'OR-100702',
    payerIndex: 0,
    status: 'ACKNOWLEDGED',
    serviceDaysAgo: 22,
    statusDaysAgo: 18,
    lines: [
      {
        code: '99203',
        display: 'Office visit, new patient, 30 min',
        modifiers: [],
        units: 1,
        billed: 172,
        allowed: null,
        paid: null,
        adjustment: null,
        patientResponsibility: null,
      },
    ],
  },
  {
    suffix: 'b011',
    claimNumber: 'CLM-24082',
    mrn: 'OR-100641',
    payerIndex: 1,
    status: 'ACKNOWLEDGED',
    serviceDaysAgo: 24,
    statusDaysAgo: 20,
    lines: [
      {
        code: '17110',
        display: 'Destruction of benign lesion',
        modifiers: [],
        units: 1,
        billed: 168,
        allowed: null,
        paid: null,
        adjustment: null,
        patientResponsibility: null,
      },
    ],
  },
  {
    suffix: 'b012',
    claimNumber: 'CLM-24044',
    mrn: 'OR-100482',
    payerIndex: 0,
    status: 'PAID',
    serviceDaysAgo: 52,
    statusDaysAgo: 16,
    paid: 142,
    patientResponsibility: 38,
    lines: [
      {
        code: '99214',
        display: 'Office visit, established, 30 min',
        modifiers: [],
        units: 1,
        billed: 186,
        allowed: 180,
        paid: 142,
        adjustment: 6,
        patientResponsibility: 38,
      },
    ],
  },
  {
    suffix: 'b013',
    claimNumber: 'CLM-24045',
    mrn: 'OR-100913',
    payerIndex: 1,
    status: 'PAID',
    serviceDaysAgo: 55,
    statusDaysAgo: 21,
    paid: 96,
    patientResponsibility: 20,
    lines: [
      {
        code: '99213',
        display: 'Office visit, established, 20 min',
        modifiers: [],
        units: 1,
        billed: 128,
        allowed: 116,
        paid: 96,
        adjustment: 12,
        patientResponsibility: 20,
      },
    ],
  },
  {
    suffix: 'b014',
    claimNumber: 'CLM-24046',
    mrn: 'OR-100744',
    payerIndex: 2,
    status: 'PAID',
    serviceDaysAgo: 61,
    statusDaysAgo: 27,
    paid: 158,
    patientResponsibility: 25,
    lines: [
      {
        code: '99203',
        display: 'Office visit, new patient, 30 min',
        modifiers: [],
        units: 1,
        billed: 172,
        allowed: 183,
        paid: 158,
        adjustment: 0,
        patientResponsibility: 25,
      },
    ],
  },
  {
    suffix: 'b015',
    claimNumber: 'CLM-24061',
    mrn: 'OR-100866',
    payerIndex: 0,
    status: 'DENIED',
    serviceDaysAgo: 44,
    statusDaysAgo: 29,
    patientResponsibility: 0,
    denialCode: 'CO-16',
    denialReason: 'The claim is missing the referring provider NPI. Add it and rebill.',
    lines: [
      {
        code: '11042',
        display: 'Debridement, subcutaneous tissue',
        modifiers: [],
        units: 1,
        billed: 214,
        allowed: 0,
        paid: 0,
        adjustment: 214,
        patientResponsibility: 0,
      },
    ],
  },
  {
    suffix: 'b016',
    claimNumber: 'CLM-24062',
    mrn: 'OR-100517',
    payerIndex: 1,
    status: 'DENIED',
    serviceDaysAgo: 47,
    statusDaysAgo: 33,
    patientResponsibility: 0,
    denialCode: 'CO-97',
    denialReason: 'This service is bundled into the office visit paid on the same day.',
    lines: [
      {
        code: '81002',
        display: 'Urinalysis, non-automated',
        modifiers: [],
        units: 1,
        billed: 22,
        allowed: 0,
        paid: 0,
        adjustment: 22,
        patientResponsibility: 0,
      },
    ],
  },
  {
    suffix: 'b017',
    claimNumber: 'CLM-24063',
    mrn: 'OR-100641',
    payerIndex: 2,
    status: 'REBILLED',
    serviceDaysAgo: 49,
    statusDaysAgo: 7,
    denialCode: 'CO-16',
    denialReason: 'Subscriber id did not match the payer record. Corrected and rebilled.',
    rebilledFromSuffix: 'b015',
    lines: [
      {
        code: '17110',
        display: 'Destruction of benign lesion',
        modifiers: [],
        units: 1,
        billed: 168,
        allowed: null,
        paid: null,
        adjustment: null,
        patientResponsibility: null,
      },
    ],
  },
];

const CLAIM_ID_PREFIX = '0192f1a0-0000-7000-8000-0000000000';

function claimId(suffix: string): string {
  return `${CLAIM_ID_PREFIX}${suffix}`;
}

/**
 * The claim's event history, derived from its state rather than hand-written.
 *
 * Deriving it is what guarantees the invariant the workbench promises: a row's
 * state, its age and its timeline can never disagree, because they all come
 * from the same two dates.
 */
function buildEvents(seed: ClaimSeed): ClaimEvent[] {
  const path = LIFECYCLE[seed.status];
  const start = new Date(daysBefore(seed.serviceDaysAgo, '17:00')).getTime();
  const end = new Date(daysBefore(seed.statusDaysAgo, '11:30')).getTime();
  const steps = Math.max(path.length - 1, 1);

  const events = path.map((status, index): ClaimEvent => {
    const copy = EVENT_COPY[status];
    const at = new Date(start + ((end - start) * index) / steps).toISOString();
    const detail =
      status === 'DENIED' && seed.denialReason
        ? `${seed.denialCode ?? 'Denial'}: ${seed.denialReason}`
        : copy.detail;
    return {
      id: `${seed.suffix}-ev${index + 1}`,
      at,
      label: copy.label,
      detail,
      actor: copy.actor,
      status,
    };
  });

  if (seed.scrubErrors && seed.scrubErrors.length > 0) {
    events.push({
      id: `${seed.suffix}-ev-scrub`,
      at: new Date(end).toISOString(),
      label: 'Scrub failed',
      detail: `${seed.scrubErrors.length} edit${seed.scrubErrors.length === 1 ? '' : 's'} to clear before this claim can be submitted.`,
      actor: 'openrunic scrubber',
      status: null,
    });
  }

  return events;
}

function toClaim(seed: ClaimSeed): Claim {
  const billed = seed.lines.reduce((total, line) => total + line.billed, 0);
  return {
    id: claimId(seed.suffix),
    claimNumber: seed.claimNumber,
    patient: patientRef(seed.mrn),
    payer: payer(seed.payerIndex),
    serviceDate: daysBefore(seed.serviceDaysAgo, '09:00'),
    submittedAt: LIFECYCLE[seed.status].includes('SUBMITTED')
      ? daysBefore(seed.statusDaysAgo + 1, '18:00')
      : null,
    status: seed.status,
    statusSince: daysBefore(seed.statusDaysAgo, '11:30'),
    billed,
    paid: seed.paid ?? 0,
    patientResponsibility: seed.patientResponsibility ?? 0,
    currency: CURRENCY,
    scrubErrors: seed.scrubErrors ?? [],
    denialCode: seed.denialCode ?? null,
    denialReason: seed.denialReason ?? null,
    rebilledFromId: seed.rebilledFromSuffix ? claimId(seed.rebilledFromSuffix) : null,
    lines: seed.lines.map((line, index) => ({ ...line, id: `${seed.suffix}-sl${index + 1}` })),
    events: buildEvents(seed),
  };
}

/** Seventeen claims across all seven states, oldest state first. */
export const MOCK_CLAIMS: readonly Claim[] = CLAIM_SEEDS.map(toClaim).sort((a, b) =>
  a.statusSince.localeCompare(b.statusSince)
);

/* -------------------------------------------------------------------------- */
/* Remittances (BL-05 ERA posting)                                             */
/* -------------------------------------------------------------------------- */

interface RemittanceLineSeed {
  suffix: string;
  claimSuffix: string;
  claimNumber: string;
  mrn: string;
  code: string;
  display: string;
  billed: number;
  allowed: number;
  paid: number;
  adjustment: number;
  patientResponsibility: number;
  expectedPaid: number;
  exceptionReason?: string;
  adjustmentCode?: string;
  secondaryPayerName?: string;
}

function toRemittanceLine(seed: RemittanceLineSeed): RemittanceLine {
  return {
    id: seed.suffix,
    claimId: claimId(seed.claimSuffix),
    claimNumber: seed.claimNumber,
    patient: patientRef(seed.mrn),
    code: seed.code,
    display: seed.display,
    billed: seed.billed,
    allowed: seed.allowed,
    paid: seed.paid,
    adjustment: seed.adjustment,
    patientResponsibility: seed.patientResponsibility,
    expectedPaid: seed.expectedPaid,
    state: seed.exceptionReason ? 'EXCEPTION' : 'AUTO_POSTED',
    exceptionReason: seed.exceptionReason ?? null,
    adjustmentCode: seed.adjustmentCode ?? null,
    secondaryPayerName: seed.secondaryPayerName ?? null,
  };
}

export const MOCK_REMITTANCES: readonly Remittance[] = [
  {
    id: '0192f1a0-0000-7000-8000-00000000e001',
    reference: 'EFT-8841207',
    payer: payer(0),
    receivedAt: daysBefore(0, '06:40'),
    paymentAmount: 396,
    currency: CURRENCY,
    method: 'EFT',
    status: 'EXCEPTIONS',
    lines: [
      {
        suffix: 'e001-l1',
        claimSuffix: 'b012',
        claimNumber: 'CLM-24044',
        mrn: 'OR-100482',
        code: '99214',
        display: 'Office visit, established, 30 min',
        billed: 186,
        allowed: 180,
        paid: 142,
        adjustment: 6,
        patientResponsibility: 38,
        expectedPaid: 142,
      },
      {
        suffix: 'e001-l2',
        claimSuffix: 'b013',
        claimNumber: 'CLM-24045',
        mrn: 'OR-100913',
        code: '99213',
        display: 'Office visit, established, 20 min',
        billed: 128,
        allowed: 116,
        paid: 78,
        adjustment: 12,
        patientResponsibility: 38,
        expectedPaid: 96,
        exceptionReason: 'Paid 18.00 under the contracted allowed amount.',
        adjustmentCode: 'CO-45',
      },
      {
        suffix: 'e001-l3',
        claimSuffix: 'b015',
        claimNumber: 'CLM-24061',
        mrn: 'OR-100866',
        code: '11042',
        display: 'Debridement, subcutaneous tissue',
        billed: 214,
        allowed: 0,
        paid: 0,
        adjustment: 214,
        patientResponsibility: 0,
        expectedPaid: 171,
        exceptionReason: 'Denied as missing information. No payment to post.',
        adjustmentCode: 'CO-16',
      },
      {
        suffix: 'e001-l4',
        claimSuffix: 'b010',
        claimNumber: 'CLM-24081',
        mrn: 'OR-100702',
        code: '99203',
        display: 'Office visit, new patient, 30 min',
        billed: 172,
        allowed: 164,
        paid: 131,
        adjustment: 8,
        patientResponsibility: 33,
        expectedPaid: 131,
        secondaryPayerName: 'Birchwood State Plan',
      },
      {
        suffix: 'e001-l5',
        claimSuffix: 'b014',
        claimNumber: 'CLM-24046',
        mrn: 'OR-100744',
        code: '99203',
        display: 'Office visit, new patient, 30 min',
        billed: 172,
        allowed: 183,
        paid: 45,
        adjustment: 0,
        patientResponsibility: 25,
        expectedPaid: 158,
        exceptionReason: 'Allowed amount is above the fee schedule. Check the contract.',
        adjustmentCode: 'PR-2',
      },
    ].map(toRemittanceLine),
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000e002',
    reference: 'CHK-550194',
    payer: payer(1),
    receivedAt: daysBefore(1, '07:15'),
    paymentAmount: 174,
    currency: CURRENCY,
    method: 'CHECK',
    status: 'POSTED',
    lines: [
      {
        suffix: 'e002-l1',
        claimSuffix: 'b011',
        claimNumber: 'CLM-24082',
        mrn: 'OR-100641',
        code: '17110',
        display: 'Destruction of benign lesion',
        billed: 168,
        allowed: 152,
        paid: 122,
        adjustment: 16,
        patientResponsibility: 30,
        expectedPaid: 122,
      },
      {
        suffix: 'e002-l2',
        claimSuffix: 'b016',
        claimNumber: 'CLM-24062',
        mrn: 'OR-100517',
        code: '81002',
        display: 'Urinalysis, non-automated',
        billed: 22,
        allowed: 20,
        paid: 20,
        adjustment: 2,
        patientResponsibility: 0,
        expectedPaid: 20,
      },
      {
        suffix: 'e002-l3',
        claimSuffix: 'b008',
        claimNumber: 'CLM-24099',
        mrn: 'OR-100866',
        code: '93000',
        display: 'Electrocardiogram, complete',
        billed: 96,
        allowed: 40,
        paid: 32,
        adjustment: 56,
        patientResponsibility: 8,
        expectedPaid: 32,
      },
    ].map(toRemittanceLine),
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000e003',
    reference: 'EFT-8839002',
    payer: payer(2),
    receivedAt: daysBefore(3, '06:52'),
    paymentAmount: 203,
    currency: CURRENCY,
    method: 'EFT',
    status: 'POSTING',
    lines: [
      {
        suffix: 'e003-l1',
        claimSuffix: 'b009',
        claimNumber: 'CLM-24076',
        mrn: 'OR-100978',
        code: '90686',
        display: 'Influenza vaccine, quadrivalent',
        billed: 41,
        allowed: 38,
        paid: 38,
        adjustment: 3,
        patientResponsibility: 0,
        expectedPaid: 38,
      },
      {
        suffix: 'e003-l2',
        claimSuffix: 'b005',
        claimNumber: 'CLM-24113',
        mrn: 'OR-100810',
        code: '69210',
        display: 'Removal of impacted cerumen',
        billed: 78,
        allowed: 70,
        paid: 56,
        adjustment: 8,
        patientResponsibility: 14,
        expectedPaid: 56,
      },
      {
        suffix: 'e003-l3',
        claimSuffix: 'b017',
        claimNumber: 'CLM-24063',
        mrn: 'OR-100641',
        code: '17110',
        display: 'Destruction of benign lesion',
        billed: 168,
        allowed: 136,
        paid: 109,
        adjustment: 32,
        patientResponsibility: 27,
        expectedPaid: 109,
      },
    ].map(toRemittanceLine),
  },
];

/* -------------------------------------------------------------------------- */
/* Statements and patient AR (BL-07, BL-08)                                    */
/* -------------------------------------------------------------------------- */

interface StatementSeed {
  suffix: string;
  mrn: string;
  ageing: Record<AgeingBucket, number>;
  lastPaymentDaysAgo?: number;
  lastPaymentAmount?: number;
  statementsSent: number;
  lastStatementDaysAgo?: number;
  dunningStage: StatementAccount['dunningStage'];
  plan?: StatementAccount['paymentPlan'];
  mobile?: string;
  cardOnFile?: boolean;
  lines: Array<Omit<StatementLine, 'id' | 'visitId'> & { visitSuffix: string }>;
}

/** The oldest bucket carrying money. That bucket is what the row is judged on. */
function oldestBucket(ageing: Record<AgeingBucket, number>): AgeingBucket {
  if (ageing.DAYS_91_PLUS > 0) return 'DAYS_91_PLUS';
  if (ageing.DAYS_61_90 > 0) return 'DAYS_61_90';
  if (ageing.DAYS_31_60 > 0) return 'DAYS_31_60';
  return 'CURRENT';
}

const STATEMENT_SEEDS: readonly StatementSeed[] = [
  {
    suffix: 's001',
    mrn: 'OR-100482',
    ageing: { CURRENT: 38, DAYS_31_60: 0, DAYS_61_90: 0, DAYS_91_PLUS: 0 },
    lastPaymentDaysAgo: 16,
    lastPaymentAmount: 30,
    statementsSent: 0,
    dunningStage: 'NONE',
    mobile: '+1 555 0142 118',
    cardOnFile: true,
    lines: [
      {
        visitSuffix: 'v001',
        serviceDate: daysBefore(52, '09:00'),
        description: 'Office visit, established, 30 min',
        charges: 186,
        insurancePaid: 142,
        adjustments: 6,
        patientResponsibility: 38,
        outstanding: 38,
      },
    ],
  },
  {
    suffix: 's002',
    mrn: 'OR-100517',
    ageing: { CURRENT: 30, DAYS_31_60: 45, DAYS_61_90: 0, DAYS_91_PLUS: 0 },
    lastPaymentDaysAgo: 41,
    lastPaymentAmount: 25,
    statementsSent: 1,
    lastStatementDaysAgo: 12,
    dunningStage: 'FIRST_NOTICE',
    mobile: '+1 555 0142 204',
    cardOnFile: false,
    lines: [
      {
        visitSuffix: 'v002',
        serviceDate: daysBefore(47, '09:00'),
        description: 'Urinalysis, non-automated',
        charges: 22,
        insurancePaid: 0,
        adjustments: 0,
        patientResponsibility: 22,
        outstanding: 22,
      },
      {
        visitSuffix: 'v003',
        serviceDate: daysBefore(38, '09:00'),
        description: 'Office visit, established, 20 min',
        charges: 128,
        insurancePaid: 96,
        adjustments: 9,
        patientResponsibility: 23,
        outstanding: 23,
      },
      {
        visitSuffix: 'v004',
        serviceDate: `${MOCK_CLINIC_DAY}T08:20:00.000Z`,
        description: 'Copay, chronic care visit',
        charges: 30,
        insurancePaid: 0,
        adjustments: 0,
        patientResponsibility: 30,
        outstanding: 30,
      },
    ],
  },
  {
    suffix: 's003',
    mrn: 'OR-100866',
    ageing: { CURRENT: 0, DAYS_31_60: 0, DAYS_61_90: 96, DAYS_91_PLUS: 214 },
    lastPaymentDaysAgo: 118,
    lastPaymentAmount: 40,
    statementsSent: 3,
    lastStatementDaysAgo: 9,
    dunningStage: 'FINAL_NOTICE',
    mobile: '+1 555 0142 771',
    cardOnFile: false,
    lines: [
      {
        visitSuffix: 'v005',
        serviceDate: daysBefore(94, '09:00'),
        description: 'Debridement, subcutaneous tissue',
        charges: 214,
        insurancePaid: 0,
        adjustments: 0,
        patientResponsibility: 214,
        outstanding: 214,
      },
      {
        visitSuffix: 'v006',
        serviceDate: daysBefore(72, '09:00'),
        description: 'Electrocardiogram, complete',
        charges: 96,
        insurancePaid: 0,
        adjustments: 0,
        patientResponsibility: 96,
        outstanding: 96,
      },
    ],
  },
  {
    suffix: 's004',
    mrn: 'OR-100641',
    ageing: { CURRENT: 0, DAYS_31_60: 60, DAYS_61_90: 0, DAYS_91_PLUS: 0 },
    lastPaymentDaysAgo: 6,
    lastPaymentAmount: 50,
    statementsSent: 2,
    lastStatementDaysAgo: 34,
    dunningStage: 'SECOND_NOTICE',
    plan: { instalmentAmount: 50, instalmentsPaid: 2, instalmentsTotal: 4 },
    mobile: '+1 555 0142 330',
    cardOnFile: true,
    lines: [
      {
        visitSuffix: 'v007',
        serviceDate: daysBefore(49, '09:00'),
        description: 'Destruction of benign lesion',
        charges: 168,
        insurancePaid: 78,
        adjustments: 0,
        patientResponsibility: 90,
        outstanding: 60,
      },
    ],
  },
  {
    suffix: 's005',
    mrn: 'OR-100913',
    ageing: { CURRENT: 20, DAYS_31_60: 0, DAYS_61_90: 0, DAYS_91_PLUS: 0 },
    lastPaymentDaysAgo: 21,
    lastPaymentAmount: 15,
    statementsSent: 0,
    dunningStage: 'NONE',
    mobile: '+1 555 0142 545',
    cardOnFile: true,
    lines: [
      {
        visitSuffix: 'v008',
        serviceDate: daysBefore(55, '09:00'),
        description: 'Office visit, established, 20 min',
        charges: 128,
        insurancePaid: 96,
        adjustments: 12,
        patientResponsibility: 20,
        outstanding: 20,
      },
    ],
  },
  {
    suffix: 's006',
    mrn: 'OR-100744',
    ageing: { CURRENT: 0, DAYS_31_60: 0, DAYS_61_90: 25, DAYS_91_PLUS: 0 },
    lastPaymentDaysAgo: 88,
    lastPaymentAmount: 20,
    statementsSent: 2,
    lastStatementDaysAgo: 27,
    dunningStage: 'SECOND_NOTICE',
    cardOnFile: false,
    lines: [
      {
        visitSuffix: 'v009',
        serviceDate: daysBefore(61, '09:00'),
        description: 'Office visit, new patient, 30 min',
        charges: 172,
        insurancePaid: 158,
        adjustments: 0,
        patientResponsibility: 25,
        outstanding: 25,
      },
    ],
  },
  {
    suffix: 's007',
    mrn: 'OR-100810',
    ageing: { CURRENT: 14, DAYS_31_60: 0, DAYS_61_90: 0, DAYS_91_PLUS: 0 },
    statementsSent: 0,
    dunningStage: 'NONE',
    mobile: '+1 555 0142 908',
    cardOnFile: false,
    lines: [
      {
        visitSuffix: 'v010',
        serviceDate: daysBefore(38, '09:00'),
        description: 'Removal of impacted cerumen',
        charges: 78,
        insurancePaid: 56,
        adjustments: 8,
        patientResponsibility: 14,
        outstanding: 14,
      },
    ],
  },
  {
    suffix: 's008',
    mrn: 'OR-100702',
    ageing: { CURRENT: 0, DAYS_31_60: 33, DAYS_61_90: 0, DAYS_91_PLUS: 0 },
    lastPaymentDaysAgo: 60,
    lastPaymentAmount: 45,
    statementsSent: 1,
    lastStatementDaysAgo: 15,
    dunningStage: 'FIRST_NOTICE',
    mobile: '+1 555 0142 612',
    cardOnFile: false,
    lines: [
      {
        visitSuffix: 'v011',
        serviceDate: daysBefore(22, '09:00'),
        description: 'Office visit, new patient, 30 min',
        charges: 172,
        insurancePaid: 131,
        adjustments: 8,
        patientResponsibility: 33,
        outstanding: 33,
      },
    ],
  },
];

function toStatementAccount(seed: StatementSeed): StatementAccount {
  const balance =
    seed.ageing.CURRENT +
    seed.ageing.DAYS_31_60 +
    seed.ageing.DAYS_61_90 +
    seed.ageing.DAYS_91_PLUS;
  return {
    id: `0192f1a0-0000-7000-8000-0000000000${seed.suffix}`,
    patient: patientRef(seed.mrn),
    balance,
    currency: CURRENCY,
    ageing: seed.ageing,
    bucket: oldestBucket(seed.ageing),
    lastPaymentAt:
      seed.lastPaymentDaysAgo === undefined ? null : daysBefore(seed.lastPaymentDaysAgo, '14:10'),
    lastPaymentAmount: seed.lastPaymentAmount ?? null,
    statementsSent: seed.statementsSent,
    lastStatementAt:
      seed.lastStatementDaysAgo === undefined
        ? null
        : daysBefore(seed.lastStatementDaysAgo, '05:00'),
    dunningStage: seed.dunningStage,
    paymentPlan: seed.plan ?? null,
    mobile: seed.mobile ?? null,
    cardOnFile: seed.cardOnFile ?? false,
    lines: seed.lines.map((line) => ({
      id: `${seed.suffix}-${line.visitSuffix}`,
      visitId: `0192f1a0-0000-7000-8000-0000000000${line.visitSuffix}`,
      serviceDate: line.serviceDate,
      description: line.description,
      charges: line.charges,
      insurancePaid: line.insurancePaid,
      adjustments: line.adjustments,
      patientResponsibility: line.patientResponsibility,
      outstanding: line.outstanding,
    })),
  };
}

/** Eight accounts, largest balance first, as the AR workbench ranks them. */
export const MOCK_STATEMENT_ACCOUNTS: readonly StatementAccount[] = STATEMENT_SEEDS.map(
  toStatementAccount
).sort((a, b) => b.balance - a.balance);

/* -------------------------------------------------------------------------- */
/* Payments (BL-02, BL-06)                                                     */
/* -------------------------------------------------------------------------- */

export const MOCK_PAYMENTS: readonly Payment[] = [
  {
    id: '0192f1a0-0000-7000-8000-00000000f001',
    receiptNumber: 'RCP-70412',
    patient: patientRef('OR-100482'),
    takenAt: `${MOCK_CLINIC_DAY}T07:58:00.000Z`,
    takenBy: 'Ada Nwosu',
    amount: 30,
    currency: CURRENCY,
    method: {
      kind: 'CARD_ON_FILE',
      label: 'Visa ending 4242',
      last4: '4242',
      consentAt: daysBefore(210, '10:05'),
    },
    status: 'CAPTURED',
    allocations: [
      {
        id: 'f001-a1',
        visitId: '0192f1a0-0000-7000-8000-00000000a001',
        serviceDate: `${MOCK_CLINIC_DAY}T08:00:00.000Z`,
        description: 'Copay, follow-up visit',
        outstanding: 30,
        allocated: 30,
      },
    ],
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000f002',
    receiptNumber: 'RCP-70411',
    patient: patientRef('OR-100641'),
    takenAt: daysBefore(6, '15:22'),
    takenBy: 'Ada Nwosu',
    amount: 50,
    currency: CURRENCY,
    method: {
      kind: 'CARD_ON_FILE',
      label: 'Mastercard ending 8801',
      last4: '8801',
      consentAt: daysBefore(120, '11:40'),
    },
    status: 'CAPTURED',
    allocations: [
      {
        id: 'f002-a1',
        visitId: '0192f1a0-0000-7000-8000-0000000000v007',
        serviceDate: daysBefore(49, '09:00'),
        description: 'Payment plan instalment 2 of 4',
        outstanding: 110,
        allocated: 50,
      },
    ],
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000f003',
    receiptNumber: 'RCP-70408',
    patient: patientRef('OR-100913'),
    takenAt: daysBefore(21, '16:04'),
    takenBy: 'Ravi Menon',
    amount: 15,
    currency: CURRENCY,
    method: { kind: 'CASH', label: 'Cash', last4: null, consentAt: null },
    status: 'CAPTURED',
    allocations: [
      {
        id: 'f003-a1',
        visitId: '0192f1a0-0000-7000-8000-0000000000v008',
        serviceDate: daysBefore(55, '09:00'),
        description: 'Office visit, established, 20 min',
        outstanding: 35,
        allocated: 15,
      },
    ],
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000f004',
    receiptNumber: 'RCP-70399',
    patient: patientRef('OR-100702'),
    takenAt: daysBefore(60, '11:12'),
    takenBy: 'Ada Nwosu',
    amount: 45,
    currency: CURRENCY,
    method: { kind: 'CHECK', label: 'Check 2041', last4: null, consentAt: null },
    status: 'CAPTURED',
    allocations: [
      {
        id: 'f004-a1',
        visitId: '0192f1a0-0000-7000-8000-0000000000v011',
        serviceDate: daysBefore(22, '09:00'),
        description: 'Office visit, new patient, 30 min',
        outstanding: 78,
        allocated: 45,
      },
    ],
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000f005',
    receiptNumber: 'RCP-70386',
    patient: patientRef('OR-100744'),
    takenAt: daysBefore(88, '09:36'),
    takenBy: 'Ravi Menon',
    amount: 20,
    currency: CURRENCY,
    method: {
      kind: 'CARD_MANUAL',
      label: 'Card keyed at the desk',
      last4: '1194',
      consentAt: null,
    },
    status: 'CAPTURED',
    allocations: [
      {
        id: 'f005-a1',
        visitId: '0192f1a0-0000-7000-8000-0000000000v009',
        serviceDate: daysBefore(61, '09:00'),
        description: 'Office visit, new patient, 30 min',
        outstanding: 45,
        allocated: 20,
      },
    ],
  },
  {
    id: '0192f1a0-0000-7000-8000-00000000f006',
    receiptNumber: 'RCP-70371',
    patient: patientRef('OR-100866'),
    takenAt: daysBefore(118, '13:48'),
    takenBy: 'Ada Nwosu',
    amount: 40,
    currency: CURRENCY,
    method: { kind: 'CHECK', label: 'Check 1088', last4: null, consentAt: null },
    status: 'REVERSED',
    allocations: [
      {
        id: 'f006-a1',
        visitId: '0192f1a0-0000-7000-8000-0000000000v005',
        serviceDate: daysBefore(94, '09:00'),
        description: 'Debridement, subcutaneous tissue',
        outstanding: 254,
        allocated: 40,
      },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Filters, mirroring what the API will apply                                  */
/* -------------------------------------------------------------------------- */

/* Built once per patient reference and kept while that object is alive: a
   biller filtering a ledger types a character at a time, and rebuilding a
   joined, lowercased string for every row on every keystroke is the whole cost
   of the filter. A WeakMap, so nothing is retained past the fixture. */
const HAYSTACKS = new WeakMap<BillingPatientRef, string>();

function haystack(patient: BillingPatientRef): string {
  const cached = HAYSTACKS.get(patient);
  if (cached !== undefined) return cached;
  const { given, family, preferred } = patient.name;
  const built = [given, family, preferred ?? '', patient.mrn].join(' ').toLowerCase();
  HAYSTACKS.set(patient, built);
  return built;
}

export function filterFeeSheets(
  rows: readonly FeeSheet[],
  query: FeeSheetListQuery = {}
): readonly FeeSheet[] {
  return rows.filter((sheet) => {
    if (query.patientId && sheet.patient.id !== query.patientId) return false;
    if (query.status && sheet.status !== query.status) return false;
    if (query.serviceDate && !sheet.serviceDate.startsWith(query.serviceDate)) return false;
    return true;
  });
}

export function filterClaims(rows: readonly Claim[], query: ClaimListQuery = {}): readonly Claim[] {
  const needle = query.q?.trim().toLowerCase();

  const matched = rows.filter((claim) => {
    if (query.status && claim.status !== query.status) return false;
    if (query.payerId && claim.payer.id !== query.payerId) return false;
    if (query.patientId && claim.patient.id !== query.patientId) return false;
    if (needle) {
      const text = `${claim.claimNumber} ${haystack(claim.patient)}`.toLowerCase();
      if (!text.includes(needle)) return false;
    }
    return true;
  });

  const direction = query.order === 'desc' ? -1 : 1;
  const sort = query.sort ?? 'statusSince';
  return [...matched].sort((a, b) => {
    if (sort === 'billed') return (a.billed - b.billed) * direction;
    if (sort === 'serviceDate') return a.serviceDate.localeCompare(b.serviceDate) * direction;
    return a.statusSince.localeCompare(b.statusSince) * direction;
  });
}

export function filterRemittances(
  rows: readonly Remittance[],
  query: RemittanceListQuery = {}
): readonly Remittance[] {
  return rows.filter((remittance) => {
    if (query.payerId && remittance.payer.id !== query.payerId) return false;
    if (query.status && remittance.status !== query.status) return false;
    return true;
  });
}

export function filterStatements(
  rows: readonly StatementAccount[],
  query: StatementListQuery = {}
): readonly StatementAccount[] {
  const needle = query.q?.trim().toLowerCase();

  return rows.filter((account) => {
    if (query.bucket && account.bucket !== query.bucket) return false;
    if (query.dunningStage && account.dunningStage !== query.dunningStage) return false;
    if (query.minBalance !== undefined && account.balance < query.minBalance) return false;
    if (needle) {
      const searchable: string = haystack(account.patient);
      if (!searchable.includes(needle)) return false;
    }
    return true;
  });
}

export function filterPayments(
  rows: readonly Payment[],
  query: PaymentListQuery = {}
): readonly Payment[] {
  const needle = query.q?.trim().toLowerCase();

  return rows.filter((payment) => {
    if (query.patientId && payment.patient.id !== query.patientId) return false;
    if (query.method && payment.method.kind !== query.method) return false;
    if (needle) {
      const text = `${payment.receiptNumber} ${haystack(payment.patient)}`.toLowerCase();
      if (!text.includes(needle)) return false;
    }
    return true;
  });
}
