import { z } from 'zod';

/**
 * Primitives shared by every aggregate's input schema.
 *
 * All of these are pure Zod with no dependency on the generated Prisma client,
 * so the API can validate a request before it has a database connection, and
 * so this package's tests run before `prisma generate` has ever executed.
 *
 * Two conventions hold across every schema in this directory:
 *
 *   * They are `strictObject`s. An unexpected key is a client bug or an
 *     attempted mass-assignment, and either way it should fail loudly rather
 *     than be dropped.
 *   * They never accept `id`, `tenantId`, `createdAt` or `updatedAt`. Ids come
 *     from `uuidv7()`, the tenant comes from the request principal via
 *     `createTenantClient`, and the timestamps come from the database. A client
 *     that could name its own tenant would make the isolation layer decorative.
 */

/** A UUIDv7 primary key or foreign key. */
export const uuid = z.uuid();

/** An instant. Accepts a Date or an ISO 8601 string; rejects anything else. */
export const timestamp = z.preprocess(
  (value) => (typeof value === 'string' ? new Date(value) : value),
  z.date()
);

/**
 * A calendar date with no time component, for the `@db.Date` columns (birth
 * date, service date, onset). Accepts `YYYY-MM-DD` or a Date; a bare
 * `YYYY-MM-DD` is read as UTC midnight so a clinic's timezone can never shift a
 * date of birth by a day.
 *
 * The `format` metadata is what the published OpenAPI document reads. Both this
 * and `timestamp` are a `z.preprocess` around `z.date()`, so the document
 * generator sees the same inner node for each and cannot tell a calendar date
 * from an instant. Without the tag every one of these published as
 * `date-time`, and a client generated from the document sent an RFC 3339
 * date-time that the route then refused - see `apps/api/src/openapi/spec.ts`.
 */
export const localDate = z
  .preprocess(
    (value) =>
      typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T00:00:00.000Z`)
        : value,
    z.date()
  )
  .meta({ format: 'date' });

/** Money, always integer minor units. Signed, because ledgers reverse. */
export const cents = z.int();

/** Money that cannot be negative: a charge, a price, a balance owed. */
export const positiveCents = z.int().nonnegative();

/** A code drawn from a terminology. Never validated against a code list here. */
export const code = z.string().min(1).max(64);

/**
 * The URI naming a code's terminology, e.g. `http://loinc.org`. A plain string
 * rather than a URL, because local and legacy systems use bare names.
 */
export const codeSystem = z.string().min(1).max(255);

/** Human-readable label for a code, cached so a missing code set degrades display only. */
export const display = z.string().min(1).max(512);

/** A short free-text label. */
export const shortText = z.string().min(1).max(256);

/** A long free-text field: a note, a narrative, a reason. */
export const longText = z.string().min(1).max(20_000);

/** A JSON object column. Bare scalars and arrays are rejected on purpose. */
export const jsonObject = z.record(z.string(), z.unknown());

/** A repeating coded field, e.g. reaction manifestations or diagnosis codes. */
export const codeList = z.array(code).max(64);

/** A postal address, inlined on the models that carry exactly one. */
export const addressFields = {
  addressLine1: z.string().min(1).max(256).optional(),
  addressLine2: z.string().min(1).max(256).optional(),
  city: z.string().min(1).max(128).optional(),
  state: z.string().min(1).max(64).optional(),
  postalCode: z.string().min(1).max(16).optional(),
  /** ISO 3166-1 alpha-2. */
  country: z.string().length(2).optional(),
};

/** Contact points, inlined on the models that carry exactly one set. */
export const telecomFields = {
  email: z.email().max(320).optional(),
  phone: z.string().min(3).max(32).optional(),
};
