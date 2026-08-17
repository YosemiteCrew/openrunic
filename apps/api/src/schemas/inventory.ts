import { STOCK_LOT_STATUSES, STOCK_MOVEMENT_KINDS, STOCK_POSTING_KINDS } from '@openrunic/database';
import { z } from 'zod';

import { toIsoDate } from '../inventory/marshal.js';
import { STOCK_UNITS } from '../inventory/units.js';
import type {
  StockItemCreateInput,
  StockItemListQuery,
  StockItemUpdateInput,
  StockLotListQuery,
} from '../repositories/specs/inventory.js';
import type { ScopedRow } from '../repositories/types.js';

import { paginationQueryFields, sortOrderField } from './pagination.js';

/**
 * The wire contracts for the stockroom.
 *
 * Two rules run through all of them.
 *
 * **Every schema is a `strictObject.`** A mistyped filter is a 400 and a
 * mistyped body field is a 422, rather than a request that quietly ignored what
 * the client thought it was saying. That matters more here than elsewhere: the
 * fields a client would most plausibly invent are `postedById`, `actorId` and
 * `witnessedBy: 'me'`, and every one of them names who did something.
 *
 * **Nothing that names who did it is in a body at all.** `postedById` and every
 * movement's `actorId` come from the verified principal. `apps/api/AGENTS.md`
 * records what happened the one time this repository took an author from a
 * request body: the client obligingly sent somebody else's id, and a permanent
 * clinical record was stored under the wrong clinician's name with nothing
 * failing. A stock ledger has the same shape and worse consequences, because a
 * removal of a controlled drug attributed to the wrong person is
 * indistinguishable from a diversion.
 *
 * `witnessedById` is the one exception, and it is not one: the witness is a
 * second person who is by definition not the caller, so it has to be named. It
 * is resolved against this organisation's users before it is stored.
 */

/** A day, as the ledger and the package both understand one. */
const dayField = z.iso.date();

/** A free-text field that must actually say something. */
const prose = (max: number): z.ZodType<string> => z.string().trim().min(1).max(max);

/**
 * A quantity, positive and with no upper bound.
 *
 * Deliberately unbounded. The package refuses a figure it cannot carry at six
 * decimal places - `toStockPrecision` multiplies by a million, and a value that
 * was finite going in can come back `Infinity` - and that refusal is reported as
 * a 422 naming the field. Capping it here instead would move the answer from
 * "this number is too large to be a stock quantity" to "this number is larger
 * than an arbitrary limit somebody chose", which is a worse sentence and hides
 * the reason.
 */
/**
 * A stock quantity, bounded by what actually stores it.
 *
 * Three separate ceilings had to agree and did not. `DECIMAL(18,6)` caps the
 * integer part at twelve digits and silently rounds anything finer than six
 * decimal places to something else. `@openrunic/inventory` refuses a figure
 * whose grid steps leave safe-integer range, at about nine billion. And this
 * field used to accept any positive number at all.
 *
 * The gap between them was not theoretical. A receipt of 1e308 passed every
 * check here, was accepted by `movementProblems`, and then made every balance
 * read for the whole site throw - permanently, because UPDATE and DELETE are
 * revoked on the ledger, so the row cannot be taken back out. A quantity of
 * 4e-7 rounded to zero in the column and produced a ledger row the package
 * then refused on every subsequent read.
 *
 * So the bound is the column's, and the grid is enforced here rather than
 * discovered later: a figure that cannot be stored unchanged is refused where
 * the client can still be told which field is wrong.
 */
const MAX_STOCK_QUANTITY = 999_999_999_999;

const quantityField = z
  .number()
  .positive()
  .max(MAX_STOCK_QUANTITY)
  .refine(
    // Arithmetic, not `toStockPrecision`. That function throws above the
    // safe-integer bound, and a throw inside a Zod check escapes the validator
    // and renders as a bare 500 - so a quantity of 1e300 produced an internal
    // error rather than the 422 naming the field this schema exists to produce.
    // A validator must not be able to fail in the way it is meant to report,
    // and `.max` above does not save it, because Zod runs every check.
    (value) => Math.round(value * 1e6) / 1e6 === value,
    {
      message: 'must be a whole number of six-decimal stock units',
    }
  );

/** A boolean carried in a query string, where everything is a string. */
const booleanFlag = z.enum(['true', 'false']).optional();

function flag(value: 'true' | 'false' | undefined): boolean | undefined {
  return value === undefined ? undefined : value === 'true';
}

/** A stored day column on the wire, or null when the column is empty. */
function dayOrNull(value: Date | null): string | null {
  return value === null ? null : toIsoDate(value);
}

/* ------------------------------------------------------------- stock items */

export const stockItemDtoSchema = z.strictObject({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  unit: z.string(),
  rxnormCode: z.string().nullable(),
  ndcCode: z.string().nullable(),
  cvxCode: z.string().nullable(),
  packSize: z.number().nullable(),
  reorderLevel: z.number().nullable(),
  controlled: z.boolean(),
  controlledSchedule: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type StockItemDto = z.infer<typeof stockItemDtoSchema>;

export function toStockItemDto(row: ScopedRow<'StockItem'>): StockItemDto {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    unit: row.unit,
    rxnormCode: row.rxnormCode,
    ndcCode: row.ndcCode,
    cvxCode: row.cvxCode,
    packSize: row.packSize,
    reorderLevel: row.reorderLevel,
    controlled: row.controlled,
    controlledSchedule: row.controlledSchedule,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const stockItemCreateSchema = z.strictObject({
  sku: prose(64),
  name: prose(200),
  /**
   * Closed against `STOCK_UNITS`, which is proved against the package's own
   * union in `inventory/units.ts`. This is where that value set is enforced: the
   * column is a `String`, because three of the nine values are UCUM codes and
   * `schema.prisma` never bakes a terminology in.
   */
  unit: z.enum(STOCK_UNITS),
  rxnormCode: prose(32).optional(),
  ndcCode: prose(32).optional(),
  cvxCode: prose(16).optional(),
  packSize: quantityField.optional(),
  /** Zero is a real reorder level: "tell me when the shelf is empty". */
  reorderLevel: z.number().min(0).optional(),
  controlled: z.boolean().optional(),
  controlledSchedule: prose(8).optional(),
  active: z.boolean().optional(),
});

export type StockItemCreateBody = z.infer<typeof stockItemCreateSchema>;

export function toStockItemCreateInput(body: StockItemCreateBody): StockItemCreateInput {
  return body;
}

/**
 * The amend contract, which is narrower than the create contract in exactly two
 * places: `sku` and `unit`.
 *
 * The sku is the catalogue key the practice orders against. The unit is what
 * every quantity already in the ledger *means*, so changing it from tablets to
 * boxes would silently reinterpret every movement ever posted. Because the
 * object is strict, sending either is a 422 rather than a field that looked
 * accepted and was dropped.
 */
export const stockItemPatchSchema = z
  .strictObject({
    name: prose(200).optional(),
    rxnormCode: prose(32).optional(),
    ndcCode: prose(32).optional(),
    cvxCode: prose(16).optional(),
    packSize: quantityField.optional(),
    reorderLevel: z.number().min(0).optional(),
    controlled: z.boolean().optional(),
    controlledSchedule: prose(8).optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'the patch must change at least one field',
  });

export type StockItemPatchBody = z.infer<typeof stockItemPatchSchema>;

export function toStockItemPatchInput(body: StockItemPatchBody): StockItemUpdateInput {
  return body;
}

export const stockItemListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  /** Free text over the sku and the name, which is how a clerk looks. */
  q: prose(100).optional(),
  active: booleanFlag,
  controlled: booleanFlag,
  unit: z.enum(STOCK_UNITS).optional(),
  sort: z.enum(['name', 'sku', 'createdAt']).default('name'),
  order: sortOrderField,
});

export type StockItemListQueryInput = z.infer<typeof stockItemListQuerySchema>;

export function toStockItemListQuery(input: StockItemListQueryInput): StockItemListQuery {
  const active = flag(input.active);
  const controlled = flag(input.controlled);
  return {
    page: input.page,
    pageSize: input.pageSize,
    sort: input.sort,
    order: input.order,
    ...(input.q === undefined ? {} : { q: input.q }),
    ...(active === undefined ? {} : { active }),
    ...(controlled === undefined ? {} : { controlled }),
    ...(input.unit === undefined ? {} : { unit: input.unit }),
  };
}

/* -------------------------------------------------------------- stock lots */

export const stockLotDtoSchema = z.strictObject({
  id: z.string(),
  itemId: z.string(),
  facilityId: z.string(),
  lotNumber: z.string(),
  status: z.enum(STOCK_LOT_STATUSES),
  expiresOn: z.string().nullable(),
  openedOn: z.string().nullable(),
  beyondUseDays: z.number().nullable(),
  manufacturer: z.string().nullable(),
  ndcCode: z.string().nullable(),
  receivedOn: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type StockLotDto = z.infer<typeof stockLotDtoSchema>;

export function toStockLotDto(row: ScopedRow<'StockLot'>): StockLotDto {
  return {
    id: row.id,
    itemId: row.itemId,
    facilityId: row.facilityId,
    lotNumber: row.lotNumber,
    status: row.status,
    expiresOn: dayOrNull(row.expiresOn),
    openedOn: dayOrNull(row.openedOn),
    beyondUseDays: row.beyondUseDays,
    manufacturer: row.manufacturer,
    ndcCode: row.ndcCode,
    receivedOn: toIsoDate(row.receivedOn),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const stockLotListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  /**
   * Required, and the reason is not tidiness. `facilityColumn` on a spec is an
   * audit stamp and narrows nothing, and the generic list route never asks
   * `assertFacilityAccess`. Naming the site is what lets this route ask it, so a
   * principal without `facility.all` cannot list another site's lots by guessing
   * its id.
   */
  facilityId: z.uuid(),
  itemId: z.uuid().optional(),
  status: z.enum(STOCK_LOT_STATUSES).optional(),
  lotNumber: prose(64).optional(),
  /** Exclusive. A lot that cannot expire is outside every bounded window. */
  expiringBefore: dayField.optional(),
  sort: z.enum(['expiresOn', 'receivedOn', 'lotNumber', 'createdAt']).default('expiresOn'),
  order: sortOrderField,
});

export type StockLotListQueryInput = z.infer<typeof stockLotListQuerySchema>;

export function toStockLotListQuery(
  input: StockLotListQueryInput,
  expiringBefore: Date | undefined
): StockLotListQuery {
  return {
    page: input.page,
    pageSize: input.pageSize,
    sort: input.sort,
    order: input.order,
    facilityId: input.facilityId,
    ...(input.itemId === undefined ? {} : { itemId: input.itemId }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.lotNumber === undefined ? {} : { lotNumber: input.lotNumber }),
    ...(expiringBefore === undefined ? {} : { expiringBefore }),
  };
}

/* ---------------------------------------------------------- the ledger DTO */

export const stockMovementDtoSchema = z.strictObject({
  id: z.string(),
  postingId: z.string(),
  lotId: z.string(),
  itemId: z.string(),
  facilityId: z.string(),
  kind: z.enum(STOCK_MOVEMENT_KINDS),
  quantity: z.number(),
  occurredOn: z.string(),
  actorId: z.string(),
  reason: z.string().nullable(),
  correctsMovementId: z.string().nullable(),
  lotSeq: z.number(),
  createdAt: z.string(),
});

export type StockMovementDto = z.infer<typeof stockMovementDtoSchema>;

export function toStockMovementDto(row: ScopedRow<'StockMovement'>): StockMovementDto {
  return {
    id: row.id,
    postingId: row.postingId,
    lotId: row.lotId,
    itemId: row.itemId,
    facilityId: row.facilityId,
    kind: row.kind,
    quantity: row.quantity,
    occurredOn: toIsoDate(row.occurredOn),
    actorId: row.actorId,
    reason: row.reason,
    correctsMovementId: row.correctsMovementId,
    lotSeq: row.lotSeq,
    createdAt: row.createdAt.toISOString(),
  };
}

export const stockPostingDtoSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(STOCK_POSTING_KINDS),
  facilityId: z.string(),
  patientId: z.string().nullable(),
  encounterId: z.string().nullable(),
  prescriptionId: z.string().nullable(),
  immunizationId: z.string().nullable(),
  occurredOn: z.string(),
  postedById: z.string(),
  witnessedById: z.string().nullable(),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
  /** The lines this act produced, which is the half that moved the balance. */
  movements: z.array(stockMovementDtoSchema),
});

export type StockPostingDto = z.infer<typeof stockPostingDtoSchema>;

export function toStockPostingDto(
  row: ScopedRow<'StockPosting'>,
  movements: readonly ScopedRow<'StockMovement'>[]
): StockPostingDto {
  return {
    id: row.id,
    kind: row.kind,
    facilityId: row.facilityId,
    patientId: row.patientId,
    encounterId: row.encounterId,
    prescriptionId: row.prescriptionId,
    immunizationId: row.immunizationId,
    occurredOn: toIsoDate(row.occurredOn),
    postedById: row.postedById,
    witnessedById: row.witnessedById,
    reference: row.reference,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    movements: movements.map(toStockMovementDto),
  };
}

/* ----------------------------------------------------------- write bodies */

/**
 * The fields every stockroom write carries.
 *
 * `occurredOn` is required rather than defaulted to today, which is the one
 * ergonomic cost in this module and is deliberate. The gap between when
 * something happened and when it was typed is what a back-dated entry is made
 * of, and it is the gap `negativeBalances` exists to surface - a receipt
 * defaulted to today because a clerk booking in yesterday's delivery did not
 * think to override it is a wrong `occurredOn` that nothing can distinguish
 * from a right one afterwards. Asking is cheap; guessing is permanent.
 */
const postingFields = {
  facilityId: z.uuid(),
  occurredOn: dayField,
  note: prose(500).optional(),
};

const receiptLineFields = {
  itemId: z.uuid(),
  lotNumber: prose(64),
  /** Absent means this item cannot expire, which is not a far-future date. */
  expiresOn: dayField.optional(),
  beyondUseDays: z.int().min(1).max(3650).optional(),
  manufacturer: prose(200).optional(),
  ndcCode: prose(32).optional(),
  /** Defaults to the posting's own day: the delivery arrived when it arrived. */
  receivedOn: dayField.optional(),
};

/**
 * A delivery line says its quantity exactly one way.
 *
 * A union of two strict objects rather than one object with two optional fields
 * and a refinement, because the difference has to survive into the handler:
 * `packs` is multiplied by the item's pack size and `quantity` is not, so a
 * shape where both could be present is a shape where the handler has to guess.
 * Both members being strict is what refuses a body carrying both.
 */
export const receiptLineSchema = z.union([
  z.strictObject({
    ...receiptLineFields,
    /** Supplier packs, converted once by `packsToUnits` and never twice. */
    packs: quantityField,
  }),
  z.strictObject({
    ...receiptLineFields,
    /** Stock units, when the delivery is counted in them already. */
    quantity: quantityField,
  }),
]);

export const receiptSchema = z.strictObject({
  ...postingFields,
  /** The supplier's packing slip. Free text: it is their identifier, not ours. */
  reference: prose(120).optional(),
  lines: z.array(receiptLineSchema).min(1).max(100),
});

export type ReceiptBody = z.infer<typeof receiptSchema>;

const courseSchema = z.strictObject({
  /** Stock units per administration - the 1 in "one tablet". */
  perDose: quantityField,
  /** Administrations per day - the "twice". */
  dosesPerDay: quantityField,
  /** How many days it runs - the "ten". */
  days: quantityField,
});

/**
 * Whether the quantity may be drawn from more than one lot.
 *
 * No default, mirroring the package: `mL` is divisible when filling a bottle and
 * indivisible within one injection, so a default would be wrong half the time
 * and silent every time.
 */
const divisibleField = z.boolean();

const dispenseFields = {
  ...postingFields,
  divisible: divisibleField,
  itemId: z.uuid(),
  /** Stock that left the shelf with nobody's name on it is the shape of a diversion. */
  patientId: z.uuid(),
  prescriptionId: z.uuid().optional(),
  encounterId: z.uuid().optional(),
};

/**
 * What leaves the shelf, said one of the two ways the package accepts.
 *
 * Exactly one of them, never both and never neither, and a union of strict
 * objects is what makes that true rather than merely checked. "One tablet twice
 * daily for ten days" and "twenty tablets" are the same twenty, and a body
 * carrying both is a client that does not know which it means - which is the
 * failure `@openrunic/inventory` is shaped around, one layer out.
 */
export const dispenseSchema = z.union([
  z.strictObject({ ...dispenseFields, course: courseSchema }),
  z.strictObject({ ...dispenseFields, quantity: quantityField }),
]);

export type DispenseBody = z.infer<typeof dispenseSchema>;

const administrationFields = {
  ...postingFields,
  divisible: divisibleField,
  itemId: z.uuid(),
  patientId: z.uuid(),
  encounterId: z.uuid().optional(),
  /**
   * The immunisation record this dose was drawn for, when there is one. This
   * route does not create it: that aggregate owns its own row, and writing two
   * aggregates in one request is how half of each ends up written.
   */
  immunizationId: z.uuid().optional(),
};

export const administrationSchema = z.union([
  z.strictObject({ ...administrationFields, course: courseSchema }),
  z.strictObject({ ...administrationFields, quantity: quantityField }),
]);

export type AdministrationBody = z.infer<typeof administrationSchema>;

/**
 * Wasting names a lot, not an item, and there is no allocation.
 *
 * You discard the remainder of the vial you drew from. Letting the system choose
 * one would file the waste against a sealed box and leave the opened one on the
 * shelf reading as full.
 */
export const wastageSchema = z.strictObject({
  ...postingFields,
  lotId: z.uuid(),
  quantity: quantityField,
  /** Required by the package for a WASTE, and named here so the client hears it first. */
  reason: prose(500),
  /** The patient the dose was drawn for, when it was drawn for one. */
  patientId: z.uuid().optional(),
  /** The second person on the destruction of a controlled substance. */
  witnessedById: z.uuid().optional(),
});

export type WastageBody = z.infer<typeof wastageSchema>;

export const countSchema = z.strictObject({
  ...postingFields,
  /** The count sheet. */
  reference: prose(120).optional(),
  /** Required: a ledger that moved for a reason nobody wrote down is the entry an auditor asks about. */
  reason: prose(500),
  lines: z
    .array(
      z.strictObject({
        lotId: z.uuid(),
        /** What is physically on the shelf. Zero is a real count. */
        counted: z.number().min(0),
      })
    )
    .min(1)
    .max(200)
    // A lot named twice is not two counts, it is one count entered twice - and
    // the route reads each lot's balance before writing any of this posting's
    // lines, so the second line's `expected` does not include the first's
    // variance and the same discrepancy is applied twice. On an append-only
    // ledger the only repair is a third correction, against an audit trail
    // showing two shortfalls that never happened.
    //
    // Refused rather than merged: two different figures for one lot is a
    // disagreement about what is on the shelf, and picking either would decide
    // it silently.
    .refine((lines) => new Set(lines.map((line) => line.lotId)).size === lines.length, {
      message: 'each lot may be counted once',
    }),
});

export type CountBody = z.infer<typeof countSchema>;

/* ----------------------------------------------------------- read contracts */

/** The window a computed read was taken through. */
const asOfQuery = {
  facilityId: z.uuid(),
  /** Defaults to today where the stock physically is; see `todayAt`. */
  asOf: dayField.optional(),
};

export const itemStockQuerySchema = z.strictObject(asOfQuery);

export type ItemStockQueryInput = z.infer<typeof itemStockQuerySchema>;

export const expiringQuerySchema = z.strictObject({
  ...asOfQuery,
  itemId: z.uuid().optional(),
  days: z.coerce.number().int().min(0).max(365).default(30),
});

export type ExpiringQueryInput = z.infer<typeof expiringQuerySchema>;

export const reorderQuerySchema = z.strictObject(asOfQuery);

export type ReorderQueryInput = z.infer<typeof reorderQuerySchema>;

/** One lot on a balance report: what it is, and how much of it is left. */
export const lotBalanceDtoSchema = z.strictObject({
  lotId: z.string(),
  lotNumber: z.string(),
  status: z.enum(STOCK_LOT_STATUSES),
  expiresOn: z.string().nullable(),
  openedOn: z.string().nullable(),
  receivedOn: z.string(),
  onHand: z.number(),
  /** The earlier of the printed expiry and the beyond-use window, or null. */
  lastUsableDay: z.string().nullable(),
  /** Why it cannot be drawn from, in the words a person would say. */
  unusableReason: z.string().nullable(),
});

export const itemStockDtoSchema = z.strictObject({
  itemId: z.string(),
  facilityId: z.string(),
  asOf: z.string(),
  /**
   * What is physically present, expired and quarantined stock included. A
   * disposal report needs it and an ordering decision must not use it.
   */
  onHand: z.number(),
  /** What could actually be dispensed today, which is what `allocate` would hand out. */
  usable: z.number(),
  /** Judged against `usable`, deliberately. See `needsReorder` in the package. */
  needsReorder: z.boolean(),
  /** Drawable lots, soonest-expiring first: the order stock would leave in. */
  lots: z.array(lotBalanceDtoSchema),
  /** The rest, each carrying the reason it is not on the list above. */
  unusable: z.array(lotBalanceDtoSchema),
});

export const expiringDtoSchema = z.strictObject({
  asOf: z.string(),
  /** The horizon the report was run to, so the answer carries its own question. */
  through: z.string(),
  data: z.array(lotBalanceDtoSchema.extend({ itemId: z.string() })),
});

/**
 * What an administration answers with.
 *
 * The posting alone names lot ids, and a nurse filling in an immunisation record
 * needs the carton. `Immunization.lotNumber` and `expirationDate` are free
 * strings, so without this the number gets retyped off the box - and a retyped
 * lot number is the one a recall notice will fail to match.
 */
export const administrationResultSchema = z.strictObject({
  posting: stockPostingDtoSchema,
  lots: z.array(
    z.strictObject({
      lotId: z.string(),
      lotNumber: z.string(),
      expiresOn: z.string().nullable(),
      quantity: z.number(),
    })
  ),
});

export type AdministrationResult = z.infer<typeof administrationResultSchema>;

/**
 * What a count answers with.
 *
 * The lines that agreed are listed as well as the ones that did not. Proving the
 * shelf was right is most of what a count is for, and a response carrying only
 * the problems makes a clean count indistinguishable from a count nobody ran.
 */
export const countResultSchema = z.strictObject({
  posting: stockPostingDtoSchema,
  variances: z.array(
    z.strictObject({
      lotId: z.string(),
      counted: z.number(),
      /** What the ledger thought was there, which is what makes it investigable. */
      expected: z.number(),
      kind: z.enum(['COUNT_SURPLUS', 'COUNT_SHORTFALL']),
      quantity: z.number(),
    })
  ),
  agreed: z.array(z.strictObject({ lotId: z.string(), counted: z.number(), expected: z.number() })),
});

export type CountResult = z.infer<typeof countResultSchema>;

export const reorderDtoSchema = z.strictObject({
  asOf: z.string(),
  data: z.array(
    z.strictObject({
      itemId: z.string(),
      sku: z.string(),
      name: z.string(),
      unit: z.string(),
      reorderLevel: z.number(),
      /** Both figures, because the gap between them is itself the finding. */
      onHand: z.number(),
      usable: z.number(),
    })
  ),
});
