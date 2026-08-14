/**
 * ALLERGY SCREENING AT THE POINT OF PRESCRIBING.
 *
 * The practice already records what a patient reacts to, with codes, and it
 * already records what is being prescribed, with codes. Until now nothing
 * compared the two, so a prescriber could sign a penicillin for a patient whose
 * chart says anaphylaxis to penicillin and the system would say nothing. That is
 * the single most common preventable prescribing harm, and it is the one an EMR
 * exists to catch.
 *
 * ## What this is not
 *
 * It is NOT a drug interaction database. Drug-drug interaction content is
 * licensed (First Databank, Medi-Span and similar) and cannot ship in an
 * AGPL repository, so nothing here pretends to know that ibuprofen interacts
 * with warfarin. `MedicationSafetyPort` in `port.ts` is the seam a deployer
 * plugs a licensed service into; this module is what works with no licence at
 * all, because it only compares the patient's own record against the order in
 * front of it.
 *
 * That distinction is worth keeping sharp. A screener that quietly did half of
 * interaction checking would be worse than one that does none, because a
 * prescriber would reasonably assume the other half had been done too.
 *
 * ## Why it warns rather than blocks
 *
 * A prescriber may knowingly prescribe against a recorded allergy: the record
 * may be wrong, the reaction may have been intolerance rather than allergy, or
 * the drug may be worth the risk under supervision. Refusing outright would be
 * clinically wrong and would train people to record allergies less carefully so
 * the software stops arguing.
 *
 * So a finding is surfaced, and a HIGH-criticality finding additionally requires
 * the prescriber to say they mean it. The override is recorded with its reason,
 * because "who overrode what, and why" is the question asked after harm, and it
 * is not answerable from a prescription alone.
 */

/** How confident the match is. Ordered: an exact code match outranks a name match. */
export type AllergyMatchKind = 'code' | 'name' | 'cross-sensitivity';

/** Mirrors the AllergyIntolerance criticality the chart records. */
export type AllergyCriticality = 'LOW' | 'HIGH' | 'UNABLE_TO_ASSESS';

/** What the caller must do about a finding. */
export type SafetyAction = 'inform' | 'acknowledge';

/** One recorded allergy, reduced to what screening needs. */
export interface RecordedAllergy {
  readonly id: string;
  /** RxNorm or SNOMED CT code for the substance, when the chart has one. */
  readonly substanceCode?: string;
  readonly substanceDisplay: string;
  readonly criticality: AllergyCriticality;
  readonly reactionText?: string;
}

/** The order being screened. */
export interface ProposedMedication {
  readonly rxnormCode?: string;
  readonly display: string;
}

export interface SafetyFinding {
  readonly allergyId: string;
  readonly kind: AllergyMatchKind;
  readonly criticality: AllergyCriticality;
  readonly action: SafetyAction;
  /** Written for the prescriber, naming both sides and the recorded reaction. */
  readonly message: string;
}

export interface ScreenResult {
  readonly findings: readonly SafetyFinding[];
  /** True when at least one finding needs an explicit acknowledgement. */
  readonly requiresAcknowledgement: boolean;
}

/**
 * Cross-sensitivity groups: substances where a documented allergy to one is a
 * recognised reason to be careful with another.
 *
 * DELIBERATELY SMALL, and deliberately only the classes that are taught rather
 * than the ones a database would list. Each entry is a widely published
 * relationship a prescriber would expect to be reminded of, and the module says
 * "possible cross-sensitivity" rather than asserting a reaction, because that is
 * the strength of the claim this list can support.
 *
 * This is not a substitute for a licensed classification. It is the subset that
 * can be stated without one, and a deployer with a real terminology service
 * should screen through `MedicationSafetyPort` instead.
 *
 * Matching is on lowercase word stems, so "amoxicillin" matches the penicillin
 * group through "cillin" rather than through an exhaustive drug list nobody
 * could maintain.
 */
const CROSS_SENSITIVITY: readonly { readonly label: string; readonly stems: readonly string[] }[] =
  [
    { label: 'penicillins and cephalosporins', stems: ['cillin', 'penicillin', 'cef', 'ceph'] },
    { label: 'sulfonamides', stems: ['sulfa', 'sulfamethoxazole', 'sulfasalazine'] },
    { label: 'NSAIDs', stems: ['ibuprofen', 'naproxen', 'diclofenac', 'ketorolac', 'aspirin'] },
    { label: 'macrolides', stems: ['erythromycin', 'azithromycin', 'clarithromycin'] },
    { label: 'opioids', stems: ['codeine', 'morphine', 'oxycodone', 'hydrocodone', 'fentanyl'] },
    { label: 'fluoroquinolones', stems: ['floxacin'] },
  ];

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

/** The cross-sensitivity groups a substance name falls into, if any. */
function groupsFor(display: string): readonly string[] {
  const text = normalise(display);
  return CROSS_SENSITIVITY.filter((group) => group.stems.some((stem) => text.includes(stem))).map(
    (group) => group.label
  );
}

/**
 * HIGH criticality is the line for demanding an acknowledgement.
 *
 * `UNABLE_TO_ASSESS` deliberately does NOT demand one. It means nobody has
 * established how bad the reaction is, and treating unassessed as severe would
 * make the acknowledgement routine - which is exactly how a safety prompt stops
 * being read.
 */
function actionFor(criticality: AllergyCriticality): SafetyAction {
  return criticality === 'HIGH' ? 'acknowledge' : 'inform';
}

function describe(
  allergy: RecordedAllergy,
  medication: ProposedMedication,
  kind: AllergyMatchKind,
  group?: string
): string {
  const reaction =
    allergy.reactionText === undefined || allergy.reactionText === ''
      ? ''
      : ` Recorded reaction: ${allergy.reactionText}.`;

  if (kind === 'cross-sensitivity') {
    return (
      `${medication.display} may cross-react with a recorded allergy to ` +
      `${allergy.substanceDisplay} (${group ?? 'same class'}).${reaction}`
    );
  }
  return `${medication.display} matches a recorded allergy to ${allergy.substanceDisplay}.${reaction}`;
}

/**
 * Screens one proposed medication against a patient's recorded allergies.
 *
 * Only ACTIVE medication allergies should reach this: filtering resolved or
 * refuted entries is the caller's job, because the caller is the one holding the
 * repository and can do it in the query rather than in memory.
 *
 * At most one finding per allergy, taking the strongest match. A prescriber who
 * sees the same allergy listed three times with three confidences learns to skim
 * the list, and skimming is the failure this exists to prevent.
 */
export function screenAgainstAllergies(
  medication: ProposedMedication,
  allergies: readonly RecordedAllergy[]
): ScreenResult {
  const findings: SafetyFinding[] = [];
  const medicationGroups = groupsFor(medication.display);
  const medicationName = normalise(medication.display);

  for (const allergy of allergies) {
    const kind = matchKind(medication, medicationName, medicationGroups, allergy);
    if (kind === null) continue;

    const group = medicationGroups.find((candidate) =>
      groupsFor(allergy.substanceDisplay).includes(candidate)
    );
    findings.push({
      allergyId: allergy.id,
      kind: kind,
      criticality: allergy.criticality,
      action: actionFor(allergy.criticality),
      message: describe(allergy, medication, kind, group),
    });
  }

  return {
    findings,
    requiresAcknowledgement: findings.some((finding) => finding.action === 'acknowledge'),
  };
}

/** The strongest match between one allergy and the order, or null for none. */
function matchKind(
  medication: ProposedMedication,
  medicationName: string,
  medicationGroups: readonly string[],
  allergy: RecordedAllergy
): AllergyMatchKind | null {
  if (
    medication.rxnormCode !== undefined &&
    medication.rxnormCode !== '' &&
    medication.rxnormCode === allergy.substanceCode
  ) {
    return 'code';
  }

  const substance = normalise(allergy.substanceDisplay);
  // Substring both ways: a chart saying "penicillin" must match an order for
  // "penicillin V potassium", and a chart saying "amoxicillin-clavulanate" must
  // match an order for "amoxicillin".
  if (
    substance !== '' &&
    (medicationName.includes(substance) || substance.includes(medicationName))
  ) {
    return 'name';
  }

  const shared = groupsFor(allergy.substanceDisplay).some((group) =>
    medicationGroups.includes(group)
  );
  return shared ? 'cross-sensitivity' : null;
}

/**
 * DUPLICATE THERAPY.
 *
 * The second check that needs no licensed content: the patient is already on
 * this drug, or on another from the same class, and the new order would stack
 * them. It is a common and quiet source of harm - two prescribers, two names for
 * the same molecule, twice the dose - and it is detectable from the practice's
 * own medication list.
 *
 * Same evidence rules as the allergy screener: an RxNorm match is a duplicate,
 * a name match is a duplicate, and a shared class is a possible one. The class
 * groups are the same short published list, with the same caveat: this is not a
 * therapeutic classification system, it is the part that can be stated without
 * one.
 */
export interface DuplicateFinding {
  readonly kind: AllergyMatchKind;
  readonly existingDisplay: string;
  readonly action: SafetyAction;
  readonly message: string;
}

export function screenForDuplicates(
  medication: ProposedMedication,
  current: readonly ProposedMedication[]
): readonly DuplicateFinding[] {
  const name = normalise(medication.display);
  const groups = groupsFor(medication.display);
  const findings: DuplicateFinding[] = [];

  for (const existing of current) {
    const existingName = normalise(existing.display);
    let kind: AllergyMatchKind | null = null;

    if (
      medication.rxnormCode !== undefined &&
      medication.rxnormCode !== '' &&
      medication.rxnormCode === existing.rxnormCode
    ) {
      kind = 'code';
    } else if (
      existingName !== '' &&
      (name.includes(existingName) || existingName.includes(name))
    ) {
      kind = 'name';
    } else if (groupsFor(existing.display).some((group) => groups.includes(group))) {
      kind = 'cross-sensitivity';
    }

    if (kind === null) continue;

    findings.push({
      kind,
      existingDisplay: existing.display,
      // The same molecule twice is worth interrupting for. A shared class is
      // often deliberate - two antibiotics can be the plan - so it informs.
      action: kind === 'cross-sensitivity' ? 'inform' : 'acknowledge',
      message:
        kind === 'cross-sensitivity'
          ? `${medication.display} is in the same class as ${existing.display}, which this patient is already taking.`
          : `${medication.display} duplicates ${existing.display}, which this patient is already taking.`,
    });
  }

  return findings;
}
