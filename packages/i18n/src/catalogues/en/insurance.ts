import type { Messages } from '../../catalogue.js';

/**
 * Coverage cards and eligibility. Clinical, and untranslated on purpose: see
 * `catalogues.test.ts`, which refuses a Spanish `insurance.ts` until a
 * Spanish-speaking clinician has reviewed one.
 *
 * See `./index.ts` for how the areas compose and why they are separate files.
 *
 * ## What is here and what is deliberately not
 *
 * The words this application chose: headings, buttons, the field names on a
 * coverage card, and the sentence that tells the front desk what to do about
 * each eligibility answer. Also the labels for the two enums this application
 * defines - the billing slot a coverage sits in, and what the eligibility
 * adapter answered - because those are names written here rather than codes
 * arriving from somewhere else.
 *
 * Not here: everything a coverage carries with it. The payer name, the plan
 * name, the member id, the group number, the subscriber's name and their
 * relationship to the patient, and the one-sentence `detail` the payer sent
 * back all render exactly as they arrived. The relationship in particular is a
 * code - `subscriberRelationshipCode` in the schema - and giving it a second,
 * translated name here would be giving one code two names.
 *
 * ## Counts carry both forms
 *
 * A key ending `One` always has a sibling ending `Other`, and the screen picks
 * between them with `plural` from this package rather than with `n === 1`.
 * English needs two forms and is the reason everybody writes the comparison;
 * the language a fork translates into may need four.
 */
export const insurance: Messages = {
  /* --------------------------------------------------------- the screen */
  'insurance.screen.title': 'Insurance and eligibility',
  'insurance.screen.description':
    'Coverage in billing order, verified against the payer in one click.',
  'insurance.screen.verifyAll': 'Verify all coverages',
  /* Noun phrases, lower case: the loading and error copy build a sentence
     around them. */
  'insurance.screen.subject': "this patient's coverage",
  'insurance.screen.patientSubject': 'this patient',

  'insurance.screen.patientOverline': 'Patient',
  'insurance.screen.born': 'born {date}',
  'insurance.screen.noPatient.title': 'No patient loaded',
  'insurance.screen.noPatient.message':
    'Open this screen from a patient record, or press Cmd-K to search.',
  'insurance.screen.noCoverageBadge': 'No coverage on file',
  'insurance.screen.openChart': 'Open chart',

  'insurance.screen.empty.title': 'No coverage on file',
  'insurance.screen.empty.message':
    'This patient has no insurance recorded, so visits bill as self-pay. Add a coverage from the insurance card at check-in.',
  'insurance.screen.mockNote':
    'Mock mode: eligibility answers come from fixtures, and the priority order is held for this session only.',

  'insurance.screen.command.verifyAll': 'Verify every coverage now',
  'insurance.screen.command.verifyAllKeywords': 'eligibility, 270, 271, check coverage, benefits',
  'insurance.screen.command.openChart': 'Open this chart',
  'insurance.screen.command.openChartKeywords': 'chart, summary, patient',

  /* The verify-all summary. The title counts what was asked; the body is a
     list of the answers, and each entry is a whole phrase rather than a
     fragment of a sentence, because which entries appear depends on what came
     back. */
  'insurance.screen.checkedOne': '{count} coverage checked',
  'insurance.screen.checkedOther': '{count} coverages checked',
  'insurance.screen.activeOne': '{count} active',
  'insurance.screen.activeOther': '{count} active',
  'insurance.screen.attentionOne': '{count} needing attention',
  'insurance.screen.attentionOther': '{count} needing attention',
  'insurance.screen.unavailableOne': '{count} queued for a payer that did not answer',
  'insurance.screen.unavailableOther': '{count} queued for a payer that did not answer',

  'insurance.screen.priorityChanged': 'Coverage priority changed',
  'insurance.screen.priorityMessage':
    '{payer} is now the {priority} coverage. Claims bill in this order.',

  /* ------------------------------------------------------ the billing slots */
  'insurance.priority.primary': 'Primary',
  'insurance.priority.secondary': 'Secondary',
  'insurance.priority.tertiary': 'Tertiary',

  /* ------------------------------------------------- the eligibility answer */
  /* The line worth defending is the one between a payer that said no and a
     payer that said nothing: they read differently and lead to different
     actions at the desk. An active coverage has no guidance, because there is
     nothing to do. */
  'insurance.eligibility.active.label': 'Coverage active',
  'insurance.eligibility.inactive.label': 'Coverage terminated',
  'insurance.eligibility.inactive.guidance':
    'Ask the patient for a current insurance card, or record this visit as self-pay before check-in.',
  'insurance.eligibility.notFound.label': 'Member not found',
  'insurance.eligibility.notFound.guidance':
    'Check the member id and date of birth against the card, correct them here, and verify again.',
  'insurance.eligibility.unavailable.label': 'Payer did not answer',
  'insurance.eligibility.unavailable.guidance':
    'The eligibility service is unavailable. The check is queued; check-in can continue and this will answer when the service returns.',
  'insurance.eligibility.unverified.label': 'Not verified',
  'insurance.eligibility.unverified.guidance':
    'Verify now to get today’s answer before the patient is roomed.',

  /* ---------------------------------------------------- the coverage card */
  'insurance.card.priority': '{priority} coverage',
  'insurance.card.moveUp': 'Move {payer} up the priority order',
  'insurance.card.moveDown': 'Move {payer} down the priority order',
  'insurance.card.memberId': 'Member id',
  'insurance.card.group': 'Group',
  'insurance.card.subscriber': 'Subscriber',
  'insurance.card.effective': 'Effective',
  'insurance.card.effectiveRange': '{from} to {to}',
  'insurance.card.noEndDate': 'no end date',
  'insurance.card.copay': 'Copay',
  'insurance.card.assignment': 'Assignment of benefits',
  'insurance.card.assignmentAccepted': 'Accepted',
  'insurance.card.assignmentNotAccepted': 'Not accepted',
  'insurance.card.copayToday': 'Copay today',
  'insurance.card.deductibleRemaining': 'Deductible remaining',
  'insurance.card.checking': 'Checking eligibility with {payer}',
  'insurance.card.lastVerified': 'Last verified {when}.',
  'insurance.card.neverVerified': 'This coverage has never been verified.',
  'insurance.card.queued': 'Queued',
  /* A parenthesised count rather than a counted noun: the word does not
     inflect on either side of it in English, and a translator who needs it to
     can move the number. */
  'insurance.card.history': 'Eligibility history ({count})',
  'insurance.card.verify': 'Verify now',
  'insurance.card.verifying': 'Checking',
  'insurance.card.verifyFor': 'Verify eligibility with {payer} now',
};
