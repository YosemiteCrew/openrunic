/**
 * C-CDA R2.1 Continuity of Care Document, in both directions.
 *
 * Generating one is how a chart leaves for another practice; reading one is how
 * a chart arrives from one. Neither needs a licence or a certification, which is
 * why this exists as ordinary code rather than as a seam - see
 * `docs/emr-capabilities.md` for the distinction and what it applies to.
 */

export { generateCcd, parseCcd, parseDocumentTree } from './document.js';
export { CcdaError } from './xml/errors.js';
export { DEFAULT_XML_LIMITS, parseXml } from './xml/reader.js';
export type { XmlLimits } from './xml/reader.js';
export { renderDocument, renderElement, escapeText, escapeAttribute } from './xml/writer.js';
export {
  attr,
  childNamed,
  childrenNamed,
  descendantsNamed,
  element,
  isElement,
  path,
  textOf,
} from './xml/tree.js';
export type { XmlElement, XmlNode } from './xml/tree.js';

export { CODE_SYSTEMS, DOCUMENT_TEMPLATES, ENTRY_TEMPLATES, SECTION_TEMPLATES } from './oids.js';
export type { TemplateId } from './oids.js';

export { fromHl7, hl7Date, hl7Instant, readableDate } from './time.js';

export type {
  Address,
  AdministrativeGender,
  AllergyEntry,
  Author,
  CcdDocument,
  ClinicalStatus,
  CodedValue,
  DocumentPatient,
  EncounterEntry,
  ImmunisationEntry,
  MedicationEntry,
  ObservationEntry,
  Organisation,
  PlanEntry,
  ProblemEntry,
  ResultEntry,
  SocialHistoryEntry,
} from './domain.js';
