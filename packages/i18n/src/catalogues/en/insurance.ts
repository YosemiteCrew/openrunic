import type { Messages } from '../../catalogue.js';

/**
 * COVERAGE AND ELIGIBILITY.
 *
 * The sentence worth defending in this file is the one that separates a payer
 * outage from a real negative answer. "The payer did not respond" and "the
 * payer says this plan ended" look alike in a log and mean opposite things at a
 * front desk: one means carry on with the check-in, the other means take a new
 * card off the person standing there. Keep them worded so nobody has to guess
 * which they are reading.
 *
 * What is deliberately NOT here: the payer name, the plan name, the member id,
 * the group number and the detail sentence an eligibility answer carries. Those
 * are the payer's own words about the payer's own record, and translating them
 * here would put a second name on somebody else's answer. The mock fixtures
 * stand in for them with English we wrote, which is a fixture standing in for a
 * 271 response rather than a string this catalogue should own.
 *
 * The subscriber relationship is NOT in that list and is not here either, and
 * the difference is worth stating because it looked like the same case. The
 * schema stores `subscriberRelationshipCode` as an HL7 v3 RoleCode, so the code
 * is external and the DISPLAY is ours to supply - exactly like sex at birth in
 * `patients.ts`. It has no keys yet only because the web client's mock still
 * carries a display string rather than the code, so there is nothing to key on
 * until that is wired. Filed rather than guessed at: keying today would mean
 * mapping the fixture's English back to codes, which is a lookup that breaks
 * the moment the real shape arrives.
 */
export const insurance: Messages = {
  /* ------------------------------------------------------------ the outcome */
  'insurance.eligibility.active': 'Coverage active',
  'insurance.eligibility.terminated': 'Coverage terminated',
  'insurance.eligibility.terminatedGuidance':
    'Ask the patient for a current insurance card, or record this visit as self-pay before check-in.',
  'insurance.eligibility.notFound': 'Member not found',
  'insurance.eligibility.notFoundGuidance':
    'Check the member id and date of birth against the card, correct them here, and verify again.',
  'insurance.eligibility.unavailable': 'Payer did not answer',
  'insurance.eligibility.unavailableGuidance':
    'The eligibility service is unavailable. The check is queued; check-in can continue and this will answer when the service returns.',
  'insurance.eligibility.notVerified': 'Not verified',
  'insurance.eligibility.notVerifiedGuidance':
    'Verify now to get today’s answer before the patient is roomed.',

  /* ---------------------------------------------------------------- the slot */
  /* Each slot is a whole phrase rather than an ordinal dropped into a frame.
     "Primary" is an adjective that agrees with its noun in most of the
     languages this will be translated into, and a frame cannot know that. */
  'insurance.coverage.overlinePrimary': 'Primary coverage',
  'insurance.coverage.overlineSecondary': 'Secondary coverage',
  'insurance.coverage.overlineTertiary': 'Tertiary coverage',
  'insurance.priority.changed': 'Coverage priority changed',
  'insurance.priority.movedPrimary':
    '{payer} is now the primary coverage. Claims bill in this order.',
  'insurance.priority.movedSecondary':
    '{payer} is now the secondary coverage. Claims bill in this order.',
  'insurance.priority.movedTertiary':
    '{payer} is now the tertiary coverage. Claims bill in this order.',

  /* ------------------------------------------------------------------- card */
  'insurance.coverage.memberId': 'Member id',
  'insurance.coverage.group': 'Group',
  'insurance.coverage.subscriber': 'Subscriber',
  'insurance.coverage.effective': 'Effective',
  'insurance.coverage.effectiveRange': '{from} to {to}',
  'insurance.coverage.noEndDate': 'no end date',
  'insurance.coverage.copay': 'Copay',
  'insurance.coverage.assignment': 'Assignment of benefits',
  'insurance.coverage.accepted': 'Accepted',
  'insurance.coverage.notAccepted': 'Not accepted',
  'insurance.coverage.copayToday': 'Copay today',
  'insurance.coverage.deductibleRemaining': 'Deductible remaining',
  'insurance.coverage.checking': 'Checking eligibility with {payer}',
  'insurance.coverage.queued': 'Queued',
  'insurance.coverage.lastVerified': 'Last verified {when}.',
  'insurance.coverage.neverVerified': 'This coverage has never been verified.',
  'insurance.coverage.historySummary': 'Eligibility history ({count})',
  'insurance.coverage.moveUp': 'Move {payer} up the priority order',
  'insurance.coverage.moveDown': 'Move {payer} down the priority order',
  'insurance.coverage.verify': 'Verify now',
  'insurance.coverage.verifying': 'Checking',
  'insurance.coverage.verifyWith': 'Verify eligibility with {payer} now',

  /* ----------------------------------------------------------------- screen */
  'insurance.screen.title': 'Insurance and eligibility',
  'insurance.screen.description':
    'Coverage in billing order, verified against the payer in one click.',
  'insurance.screen.verifyAll': 'Verify all coverages',
  'insurance.screen.patientSubject': 'this patient',
  'insurance.screen.coverageSubject': "this patient's coverage",
  'insurance.screen.noPatientTitle': 'No patient loaded',
  'insurance.screen.noPatientMessage':
    'Open this screen from a patient record, or press Cmd-K to search.',
  'insurance.screen.patientOverline': 'Patient',
  'insurance.screen.born': 'born {date}',
  'insurance.screen.noCoverageBadge': 'No coverage on file',
  'insurance.screen.openChart': 'Open chart',
  'insurance.screen.emptyTitle': 'No coverage on file',
  'insurance.screen.emptyMessage':
    'This patient has no insurance recorded, so visits bill as self-pay. Add a coverage from the insurance card at check-in.',
  'insurance.screen.mockNote':
    'Mock mode: eligibility answers come from fixtures, and the priority order is held for this session only.',

  /* ------------------------------------------------------- verifying it all */
  'insurance.verifyAll.titleOne': '{count} coverage checked',
  'insurance.verifyAll.titleOther': '{count} coverages checked',
  /* Four whole sentences rather than three clauses joined with a comma. A
     summary assembled from fragments gets the English right and the word order
     wrong everywhere else, and a translator handed "needing attention" on its
     own has no sentence to agree with. */
  'insurance.verifyAll.summaryClean': '{active} active.',
  'insurance.verifyAll.summaryProblems': '{active} active, {problems} needing attention.',
  'insurance.verifyAll.summaryQueued':
    '{active} active, {unavailable} queued for a payer that did not answer.',
  'insurance.verifyAll.summaryBoth':
    '{active} active, {problems} needing attention, {unavailable} queued for a payer that did not answer.',

  /* --------------------------------------------------------------- commands */
  'insurance.command.verifyAll': 'Verify every coverage now',
  'insurance.command.verifyAll.keywords': 'eligibility, 270, 271, check coverage, benefits',
  'insurance.command.openChart': 'Open this chart',
  'insurance.command.openChart.keywords': 'chart, summary, patient',

  /* ------------------------------------------------------- the browser tab */
  /*
   * A route file is a server component, so it cannot reach `useTranslator`.
   * `lib/i18n/metadata.ts` builds its own translator and looks these up. The tab
   * strip is often all a tired person has to tell nine open screens apart.
   */
  'insurance.page.title': 'Insurance',
};
