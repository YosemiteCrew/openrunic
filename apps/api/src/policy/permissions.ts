/**
 * The permission catalogue and the system role bundles.
 *
 * Permissions are atomic capabilities, one per aggregate per direction. They
 * are data rather than code so that the `Permission` table in
 * `packages/database` can carry the same list, tenants can fork the system
 * roles, and plugins can register their own capabilities later without a
 * change here becoming a schema change.
 *
 * The split is by aggregate rather than by screen. A permission that meant
 * "can open the billing screen" would have to be re-decided the first time a
 * charge appeared anywhere else, and the second place is always the one that
 * gets it wrong.
 */

export const PERMISSIONS = [
  'patient.read',
  'patient.write',
  /**
   * Taking deliberate access to a chart you have no relationship with.
   *
   * Separate from `patient.read` on purpose, and the separation is the control.
   * Gating break-glass on the permission it defeats makes it self-service: every
   * role that may read a chart could grant itself every chart, and the only
   * thing standing in the way would be the audit record, which is detection
   * rather than prevention.
   *
   * It also does not end in `.read`, so the `read-only` bundle below never picked
   * it up even before the bundle learned to exclude supervisory reads by name
   * (see `SUPERVISORY_READS`). Either mechanism keeps it out; an account that may
   * only look at things must not be able to decide what it may look at.
   */
  'patient.breakGlass',
  'appointment.read',
  'appointment.write',
  /**
   * Minting a credential that admits its bearer to a clinical video room.
   *
   * Separate from `appointment.read` because a billing role needs the schedule
   * to collect for a visit but has no reason to enter its consultation. The
   * front desk does: reception admits participants from the waiting room.
   */
  'telehealth.join',
  'encounter.read',
  'encounter.write',
  'document.read',
  'document.write',
  'order.read',
  'order.write',
  'result.read',
  'result.write',
  'message.read',
  'message.write',
  'coverage.read',
  'coverage.write',
  'charge.read',
  'charge.write',
  'claim.read',
  'claim.write',
  'payment.read',
  'payment.write',
  'task.read',
  'task.write',
  'form.read',
  'form.write',
  'user.read',
  'user.write',
  'role.read',
  'role.write',
  'facility.read',
  'facility.write',
  'terminology.read',
  'terminology.write',
  /** The catalogue, the lots, the postings and the ledger, all read-only. */
  'inventory.read',
  /**
   * The stockroom's ordinary day: booking in a delivery, dispensing against a
   * prescription, administering a dose, and discarding the remainder of a drawn
   * vial. Its own aggregate rather than a borrowed `order.write`, because a
   * role that had to hold `order.write` to put a box on a shelf would also be
   * able to prescribe.
   */
  'inventory.write',
  /**
   * The privileged half: reconciling a physical count against the ledger. What
   * makes a stock ledger defensible is that the person who dispenses is not the
   * person who reconciles the difference away, so the count is a separate grant
   * rather than more of `inventory.write`.
   *
   * A third permission on one aggregate, which the one-per-direction convention
   * above does not anticipate - for the same reason `audit.read` is its own
   * entry. Wasting a drawn dose deliberately stays under `inventory.write`:
   * it happens several times a day, and putting it here would mean fetching an
   * administrator on the first shift.
   */
  'inventory.adjust',
  /** Reading the audit log is itself privileged, and is itself audited. */
  'audit.read',
  /**
   * Organisation-wide facility access. Without it a principal reaches only the
   * facilities named in its grants, so an empty grant list denies rather than
   * permits.
   */
  'facility.all',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Reads that supervise rather than deliver care.
 *
 * `READ_EVERYTHING` is built by suffix - every permission ending in `.read` -
 * and a suffix cannot tell a clinical read from a supervisory one. `audit.read`
 * is the second kind: it does not open a chart, it says who opened which and
 * when, so a role that holds it is watching the practice rather than treating in
 * it. Swept into the general bundle it made `read-only` an audit account by
 * accident, and the audit trail doubles as a patient index and a who-saw-whom
 * log for anyone holding it.
 *
 * So the supervisory reads are named here and excluded from the bundle, and
 * granted deliberately to the roles that oversee - the same move `stock-keeper`
 * makes for `inventory.adjust`. The next `.read` that turns out to supervise
 * rather than inform joins this list, and does not quietly join every read-only
 * token in the tenant.
 */
const SUPERVISORY_READS: ReadonlySet<Permission> = new Set<Permission>(['audit.read']);

const READ_EVERYTHING: readonly Permission[] = PERMISSIONS.filter(
  (permission): permission is Permission =>
    permission.endsWith('.read') && !SUPERVISORY_READS.has(permission)
);

/**
 * The seeded system roles. A tenant may fork these into its own `Role` rows;
 * this map is the default that ships, and the only one the static resolver
 * knows.
 *
 * THE FORK IS NOT YET READ, AND THIS IS THE FILE THAT DECIDES IT.
 *
 * `buildPolicyContext` resolves a caller's permissions by looking their role
 * names up in this map, and the names come from the principal - a literal in
 * the demo tables, or a claim in a verified token. Neither the `Role` table nor
 * `RoleAssignment` is consulted anywhere in the enforcement path, so a grant
 * written through `/bff/v0/users/{id}/roles` is stored, durable, and inert.
 *
 * The six BFF role operations say so in their published descriptions
 * (`ROLE_MODEL_CAVEAT` in `routes/platform.ts`). They are kept rather than
 * withdrawn because the forked-`Role` model above is the stated forward path
 * and those routes are its only implementation. When enforcement lands it lands
 * here: this map stops being the only answer, and the caveat and this paragraph
 * come out together.
 */
export const ROLE_PERMISSIONS: Readonly<Record<string, readonly Permission[]>> = {
  admin: PERMISSIONS,
  clinician: [
    'patient.read',
    'patient.write',
    /* The role that meets the patient nobody has a record for. Break-glass is
       for the emergency in front of you, so it belongs to the people who are in
       front of it. */
    'patient.breakGlass',
    'appointment.read',
    'appointment.write',
    'telehealth.join',
    'encounter.read',
    'encounter.write',
    'document.read',
    'document.write',
    'order.read',
    'order.write',
    'result.read',
    'result.write',
    'message.read',
    'message.write',
    'coverage.read',
    'charge.read',
    'charge.write',
    'task.read',
    'task.write',
    'form.read',
    'form.write',
    'user.read',
    'facility.read',
    'terminology.read',
    // A clinician draws stock and records what left the shelf; reconciling a
    // count against the ledger is somebody else's job by design.
    'inventory.read',
    'inventory.write',
  ],
  'front-desk': [
    'patient.read',
    'patient.write',
    /* Reception meets the collapse in the waiting room before any clinician
       does, and is the one registering the patient nobody has a record for. */
    'patient.breakGlass',
    'appointment.read',
    'appointment.write',
    // Reception admits participants from the waiting room. Billing does not.
    'telehealth.join',
    'encounter.read',
    'document.read',
    'document.write',
    'message.read',
    'message.write',
    'coverage.read',
    'coverage.write',
    'task.read',
    'task.write',
    'form.read',
    'payment.read',
    'user.read',
    'facility.read',
    'terminology.read',
    // The front desk answers "have we got any left" and books nothing in.
    'inventory.read',
  ],
  biller: [
    'patient.read',
    'appointment.read',
    'encounter.read',
    'document.read',
    'coverage.read',
    'coverage.write',
    'charge.read',
    'charge.write',
    'claim.read',
    'claim.write',
    'payment.read',
    'payment.write',
    'task.read',
    'task.write',
    'user.read',
    'facility.read',
    'terminology.read',
  ],
  /**
   * The portal. It looks like a thin staff role, and the thing that makes it
   * safe is not this list: it is the launch context on the token, which binds
   * every repository the request touches to one chart.
   */
  'patient-portal': [
    'patient.read',
    'appointment.read',
    'appointment.write',
    'encounter.read',
    'document.read',
    'result.read',
    'message.read',
    'message.write',
    'coverage.read',
    'form.read',
    'form.write',
    'payment.read',
  ],
  /**
   * The person who runs the stockroom, and nothing else.
   *
   * It exists so that the monthly cycle count is not an administrative act.
   * Without this role the only bundle holding `inventory.adjust` is `admin`,
   * which holds everything - so counting the shelf would mean handing the
   * practice's most privileged token to whoever is standing in front of it, and
   * "fork a Role" would be the answer to a job every practice has.
   */
  'stock-keeper': ['inventory.read', 'inventory.write', 'inventory.adjust', 'facility.read'],
  /**
   * The person who reviews the audit trail, and nothing else.
   *
   * It exists for the same reason `stock-keeper` does: supervising the log is
   * not an administrative act, and without a role for it the only bundle holding
   * `audit.read` is `admin`, which holds everything - so reviewing who broke
   * glass would mean handing the practice's most privileged token to the privacy
   * officer.
   *
   * It carries `facility.read` and not `facility.all`, so how much of the log a
   * given auditor sees is decided by their facility grants, the same way every
   * other role is scoped. A group's organisation-wide privacy officer is this
   * role plus `facility.all`; a single site's compliance reviewer is this role
   * confined to that site. Baking `facility.all` into the role would make the
   * second impossible to express.
   */
  auditor: ['audit.read', 'facility.read'],
  'read-only': READ_EVERYTHING,
};

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/**
 * Orders permission identifiers by UTF-16 code unit.
 *
 * DELIBERATELY NOT `localeCompare`, which is the idiom everywhere else in this
 * package - and is right everywhere else, because those call sites order dates
 * and human-readable names for display inside one runtime. This one does not.
 *
 * `/bff/v0/me` sorts on the API server and the browser's generated mirror sorts
 * in the viewer's browser, and the DTO promises the two are byte-identical so a
 * client may compare them. `localeCompare` with no locale reads the RUNTIME's
 * default locale, so those are two independently configured orderings; naming a
 * locale does not fix it either, because collation also moves with the ICU data
 * the runtime was built against. Measured: `['order.Write','order.audit',
 * 'order.write']` sorts two different ways across eight locales, and
 * `['patient.Info','patient.index','patient.info']` three.
 *
 * Code-unit order is the same in every runtime and every version of one. It is
 * also what the default `.sort()` does - the comparator is written out because
 * `typescript:S2871` requires one, and because the next reader deserves to know
 * the plain form was rejected rather than forgotten.
 */
export function byPermissionId(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}
