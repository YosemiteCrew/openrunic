import type { BaseQuery, CollectionSpec } from '../repositories/collection.js';
import { patientOf } from '../repositories/memory.js';
import type { PrismaModelName, ScopedRow } from '../repositories/rows.js';
import { COLLECTION_SPECS } from '../repositories/specs/index.js';
import type { CollectionKey } from '../repositories/types.js';

/**
 * The chart a stored row belongs to, derived from its collection's spec.
 *
 * One derivation, shared by both boundaries. The FHIR resource module and the
 * BFF CRUD seam each need to know which patient a row is about before they can
 * ask whether the reader may see that patient, and a per-boundary accessor
 * would be two chances to get the one special case wrong: for `Patient` the
 * chart is the row's own id, not a column. `patientOf` holds that special case;
 * this looks the spec up by collection key so a caller needs only the key.
 *
 * `undefined` when the row names no chart - a resource whose spec declares no
 * `patientColumn`. Callers gate only when it is present, so a non-chart
 * resource is never refused for want of a relationship it could not have.
 */
export function chartIdOf(key: CollectionKey, row: unknown): string | undefined {
  const spec = COLLECTION_SPECS[key] as CollectionSpec<
    PrismaModelName,
    unknown,
    unknown,
    BaseQuery
  >;
  return patientOf(spec, row as ScopedRow<PrismaModelName>).patientId;
}
