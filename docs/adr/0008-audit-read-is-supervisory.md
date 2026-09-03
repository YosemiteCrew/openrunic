# 0008. Reading the audit trail is a supervisory capability, not a general read

## Status

Accepted

## Date

2026-09-03

## Context

Permissions in this system are a flat catalogue, and one convenience role, `read-only`, is built by
a filter: every permission whose name ends in `.read`. `audit.read` is one of those, so `read-only`
held it, and `GET /bff/v0/audit` admitted the role.

ADR-0007 gated a chart read behind a real care relationship. That closed the front door and made a
side one visible. The audit trail is not a chart, but most of its events carry a `patientId`, and
the log is deliberately not narrowed to a caller's own patients. So an ordinary read-only account
could page it and read two things it was never granted:

1. A patient index. Every id in the tenant, name-free but sufficient to address a chart.
2. A who-saw-whom log. That a named clinician opened a named patient's chart on a named day is
   itself sensitive, and in a small practice it is often more revealing than the chart.

ADR-0007 makes the first much less useful, because an id no longer opens a chart without a
relationship. The second does not go away, and ADR-0007 also added three event kinds that carry a
`patientId` and no `facilityId`, widening the surface slightly while it narrowed the one beside it.

The cause is the bundle, not the permission. `audit.read` is genuinely needed: a privacy officer
reviews the trail, and the whole value of break-glass is that somebody reviews it. But `read-only`
is a role assembled by a suffix, and a suffix cannot tell a clinical read from a supervisory one.
`patient.breakGlass` already dodges the same filter by not ending in `.read`, which works but is a
naming convention doing a policy's job.

## Decision

We will name the supervisory reads and exclude them from the general read bundle, and we will give
the capability its own role.

- A `SUPERVISORY_READS` list holds the `.read` permissions that supervise rather than deliver care.
  It contains `audit.read` today. `READ_EVERYTHING` is every `.read` permission that is not in it, so
  the bundle can no longer acquire a supervisory read by its suffix, and the next such permission is
  a one-line addition to a named list rather than a silent grant to every read-only token.
- An `auditor` role holds `audit.read` and `facility.read`, and nothing that treats a patient. It
  exists for the same reason `stock-keeper` does: supervising the log is not an administrative act,
  and without the role the only bundle holding `audit.read` is `admin`, which holds everything.
- Facility breadth stays a grant, not part of the role. An organisation-wide privacy officer is the
  `auditor` role plus `facility.all`; a single site's compliance reviewer is the role confined to
  that site. Baking `facility.all` into the role would make the second impossible to express, and
  the audit route already narrows a caller who lacks `facility.all` to their own sites plus the
  unsited events.

## Consequences

### Good

- The audit trail stops doubling as a patient index and a who-saw-whom log for every read-only
  account. The capability is held only by roles named to supervise.
- The bundle's failure mode is closed: a future supervisory `.read` cannot join `read-only` by
  accident. The exclusion is explicit and tested.
- Audit oversight no longer requires an admin token, which is the same separation of duties
  `stock-keeper` gives the cycle count.

### Bad

- A deployment that had leaned on `read-only` for audit access must now grant `auditor`. This is a
  behaviour change for anyone using the seeded roles as-is, and it is the point of the change rather
  than a side effect.
- `READ_EVERYTHING` is still a suffix filter with one carve-out, not an enumerated list. The carve-out
  removes the specific hazard here; whether the bundle should be enumerated like every other role is
  left open below.

## Alternatives considered

**Take `audit.read` off `read-only` and grant it only to `admin`.** Rejected for the same reason
`stock-keeper` exists: it makes a supervisory review an administrative act, and hands the practice's
most privileged token to whoever needs to read the log.

**Rely on `audit.read` not being clinical and leave the bundle alone.** Rejected because the bundle
is a suffix filter and the next `.read` that supervises would join it silently. The hazard is the
mechanism, not this one permission.

**Enumerate `READ_EVERYTHING` fully, dropping the suffix filter.** Not taken here. It is a larger
change with its own blast radius, and the carve-out closes the concrete gap without it. Recorded as
open: a bundle defined by a string suffix acquires whatever gets named next, and that is worth
deciding about on its own rather than inside this fix.

**Answer `Provenance` at the FHIR boundary.** Out of scope. ADR-0007 exempts `Provenance` from the
chart gate for a stated reason, and "exempt with a reason" is not the same as "decided". It carries
the same who-saw-whom weight as the audit trail and wants its own decision, not a clause in this one.
