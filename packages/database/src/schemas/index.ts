/**
 * Zod input schemas, one module per aggregate.
 *
 * These are the write contract for the whole system: the BFF, the FHIR
 * boundary, the seed and the CLI all validate through the same schemas, so
 * there is exactly one definition of what a valid Patient or Claim looks like.
 * They are pure Zod and import nothing from the generated Prisma client, so
 * they can be used before `prisma generate` has run and in environments with no
 * database at all.
 */

export * from './common.js';
export * from './patient.js';
export * from './encounter.js';
export * from './order.js';
export * from './claim.js';
export * from './payment.js';
export * from './form.js';
