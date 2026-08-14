export { screenAgainstAllergies } from './allergy.js';
export type {
  AllergyCriticality,
  AllergyMatchKind,
  ProposedMedication,
  RecordedAllergy,
  SafetyAction,
  SafetyFinding,
  ScreenResult,
} from './allergy.js';
export { createBuiltInSafetyPort, missingCapabilities } from './port.js';
export type { MedicationSafetyPort, SafetyCapability, ScreenRequest } from './port.js';
export { screenForDuplicates } from './allergy.js';
export type { DuplicateFinding } from './allergy.js';
