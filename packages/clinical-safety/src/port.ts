import { screenAgainstAllergies, screenForDuplicates } from './allergy.js';
import type { ProposedMedication, RecordedAllergy, ScreenResult } from './allergy.js';

/**
 * THE SEAM A LICENSED SAFETY SERVICE PLUGS INTO.
 *
 * Allergy screening works with no licence because it only compares the
 * patient's own record against the order. Everything else a prescriber expects -
 * drug-drug interactions, duplicate therapy, dose range by weight and renal
 * function, pregnancy category - needs licensed clinical content that cannot
 * ship in this repository.
 *
 * Pretending otherwise would be the dangerous option. A prescriber who sees a
 * safety panel reasonably assumes it covers what safety panels usually cover, so
 * a system that screens allergies and silently skips interactions is more
 * misleading than one that screens nothing. This interface exists so the gap is
 * a named, fillable hole rather than an unstated absence: `capabilities` is what
 * the panel is allowed to claim, and the built-in implementation claims exactly
 * one thing.
 */

/** What a screening implementation actually checks. Surfaced to the prescriber. */
export type SafetyCapability =
  'allergy' | 'drug-drug' | 'duplicate-therapy' | 'dose-range' | 'pregnancy';

export interface ScreenRequest {
  readonly medication: ProposedMedication;
  /** ACTIVE medication allergies only; the caller filters in the query. */
  readonly allergies: readonly RecordedAllergy[];
  /** Everything the patient is already on, for implementations that use it. */
  readonly currentMedications?: readonly ProposedMedication[];
}

export interface MedicationSafetyPort {
  /**
   * What this implementation checks. A caller renders this beside the result so
   * an empty finding list reads as "nothing found in these checks" rather than
   * as "nothing to find".
   */
  readonly capabilities: readonly SafetyCapability[];
  screen(request: ScreenRequest): Promise<ScreenResult> | ScreenResult;
}

/**
 * The implementation that needs no licence and no network.
 *
 * Declares allergy and duplicate-therapy: both are answerable from the
 * practice's own records. It still cannot see a pharmacological interaction
 * between two different medicines, which is what the remaining capabilities
 * name, and it does not claim to.
 */
export function createBuiltInSafetyPort(): MedicationSafetyPort {
  return {
    capabilities: ['allergy', 'duplicate-therapy'],
    screen({ medication, allergies, currentMedications = [] }: ScreenRequest): ScreenResult {
      const allergy = screenAgainstAllergies(medication, allergies);
      // Duplicates are reported as findings of the same shape, so a caller
      // renders one list. A prescriber does not care which module noticed.
      const duplicates = screenForDuplicates(medication, currentMedications).map((finding) => ({
        allergyId: '',
        kind: finding.kind,
        criticality: 'UNABLE_TO_ASSESS' as const,
        action: finding.action,
        message: finding.message,
      }));
      const findings = [...allergy.findings, ...duplicates];
      return {
        findings,
        requiresAcknowledgement: findings.some((finding) => finding.action === 'acknowledge'),
      };
    },
  };
}

/** Every capability this build does NOT check, for the panel to say so plainly. */
export function missingCapabilities(port: MedicationSafetyPort): readonly SafetyCapability[] {
  const all: readonly SafetyCapability[] = [
    'allergy',
    'drug-drug',
    'duplicate-therapy',
    'dose-range',
    'pregnancy',
  ];
  return all.filter((capability) => !port.capabilities.includes(capability));
}
