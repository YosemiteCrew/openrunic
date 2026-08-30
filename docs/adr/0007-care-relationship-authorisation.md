# 0007. A patient read is authorised by a care relationship, not by knowing the id

## Status

Proposed

## Date

2026-08-25

## Context

Nothing in the API asks whether a caller is involved in a patient's care.

A read of `/patients/{id}` is refused unless three things hold: the token carries
`patient.read`, the row is in the caller's tenant, and, for a patient-scoped token, the id matches
the compartment the token is pinned to. A list is narrowed further, to the caller's facilities.
An addressed read is not.

So the residual position is that a member of staff holding `patient.read` who knows or guesses a
patient id can open that chart: name, MRN, birth date, contact details, address. It is bounded by
the tenant and by the role, and every read is written to the audit trail. It is not prevented.

[ADR-0002](0002-relational-postgres-fhir-boundary.md) put FHIR at the boundary over a relational
core, which means this decision has to be made once and hold at both surfaces. #139 already showed
they can drift on exactly this question.

### What #139 decided, and what it deliberately left

#139 examined making `primaryFacilityId` refuse an addressed read and rejected it. The reasoning is
recorded on the `Patient` spec in `apps/api/src/repositories/specs/core.ts` and is not reopened
here: `primaryFacilityId` is attribution, the site that registered somebody, not containment.
Narrowing a list on it keeps a work queue local. Refusing an addressed read on it hides the chart
from the clinician holding the patient's wristband, while still showing a chart registered here to
somebody who has never treated them. It fails in both directions at once.

That spec says what is missing in its own words:

> What this is NOT is a care-relationship model. Nothing here asks whether the caller is treating
> this patient; it asks whether they know the id.

This ADR is that model.

### What already exists

Three things are further along than they look, and the design should not reinvent them.

**Break-glass is already recorded.** `Principal` carries `breakglass?: boolean` and
`purposeOfUse`. The audit middleware writes both onto every event, `audit-query.ts` filters on
them, and the admin audit screen surfaces them. What break-glass does not have is anything to be
an exception _to_: nothing refuses, so nothing needs overriding. The loud half is built and the
quiet half is missing.

**The compartment is already a binding on data access, not a check in a handler.** A
patient-scoped token carries `compartmentPatientId`, and the tenant-scope middleware passes it to
the repository registry. A patient reading their own record is the one relationship the system can
be certain of, and it is expressed in the one place a handler cannot forget.

**The evidence is already in the schema.** No new source of truth is needed to know who is
involved in a patient's care:

| Table           | Column                     | The relationship it evidences |
| --------------- | -------------------------- | ----------------------------- |
| `Appointment`   | `providerId`               | Booked to see them            |
| `Encounter`     | `providerId`, `signedById` | Saw them, or signed the note  |
| `Task`          | `assigneeUserId`           | Holds work about them         |
| `Referral`      | `referredById`             | Sent them on                  |
| `ConsentGrant`  | `recordedById`             | Took their consent            |
| `MessageThread` | (participants)             | In correspondence about them  |

What is missing is not the facts. It is a single place that answers the question from them, and a
refusal that consults it.

### The two cases that break a naive rule

**Registration.** Somebody creating a patient who does not exist yet has no relationship with
them, and cannot have one. Neither can somebody searching to avoid creating a duplicate. Duplicate
records are themselves a patient-safety hazard, so a rule that makes duplicate-search harder makes
the system less safe, not more.

**The front desk.** A receptionist checking somebody in is involved in their care and holds no
clinical relationship to them at all. `Appointment.providerId` names the clinician, not the person
at the desk. Any rule derived only from clinical tables locks out the people who make the clinic
run, and the first thing a locked-out receptionist does is ask a clinician to open the chart for
them, which is worse than what it replaced.

## Decision

We will authorise an addressed patient read on a **care relationship**, resolved by one function,
consulted by one seam, with three ways to hold one and one way to proceed without one.

**1. A care relationship is derived, and cached, not hand-maintained.**

A `CareRelationship` row is written by the events that create one - an appointment booked, an
encounter opened, a task assigned, a referral sent - rather than by an administrator maintaining a
list. Hand-maintained access lists go stale in one direction only: they accumulate. The derivation
is the same `childRows` hook pattern the repositories already use, so the row is written inside the
transaction that created the evidence and cannot disagree with it.

It carries an expiry. A relationship created by an appointment lapses a defined interval after that
appointment ends; one created by an encounter lasts as long as the record needs working. The
interval is configuration, not a constant in a handler.

**2. A facility-scoped operational grant covers the front desk.**

A caller holding a facility grant may read a patient with an appointment or an encounter **at that
facility**, in a defined window around it. This is not `primaryFacilityId` and does not reinstate
what #139 rejected: it asks whether the patient is being seen _here, now_, which is containment,
rather than where they were registered, which is attribution.

**3. Registration and duplicate-search are exempt, narrowly and by shape.**

Creating a patient needs no relationship. Searching for one before creating them returns a
**match result, not a chart**: name, birth date and MRN, enough to recognise a duplicate and not
enough to read a record. That is a different projection rather than a permission, so the exemption
cannot be widened by granting a role.

**4. Break-glass is the only way past a refusal, and it costs something.**

It requires a reason, as free text, recorded with the event. It is already visible in the audit
trail and filterable there. It is available to any caller who would otherwise be refused, because
a break-glass a clinician cannot reach in an emergency is a break-glass that gets designed around.

**5. The rule lives in the repository layer, beside the compartment.**

Not in a handler, and not in middleware that a new route can forget to apply. The compartment is
already a binding on data access for exactly this reason, and the care-relationship check goes in
the same place, on the same spec. A test asserts that the FHIR boundary and the BFF give the same
answer for the same principal and the same patient, because #139 is the recorded instance of those
two drifting apart on this question.

## Consequences

### Good

- The answer to "who may open this chart" stops being "whoever can name it".
- Break-glass gains a meaning. It is already recorded; this is what makes recording it worth doing.
- The evidence is already in the schema, so this is a derivation and an index, not a new source of
  truth for somebody to maintain and forget.
- Placing the check beside the compartment means a new route inherits it. Every route added since
  the compartment was introduced has inherited that, which is the argument for the location.

### Bad

- **A new table and its migration.** `CareRelationship` is derived data, so it can be rebuilt, but
  it is a table with a lifecycle and a backfill.
- **A read gains a join.** Every addressed patient read consults it. The index is on
  `(tenantId, userId, patientId)` and the lookup is a point read, but it is not free, and the
  memory port has to answer identically or every HTTP test is testing something else.
- **The expiry window is a judgement, and getting it wrong is invisible in one direction.** Too
  short locks out somebody mid-episode, which is loud. Too long is a relationship that outlived
  its reason, which nobody notices.
- **Break-glass rates become an operational signal nobody is watching yet.** A control that is
  legitimate to use and never reviewed is a control that gets used routinely. This ADR does not
  decide who reviews it or how often, and that is a gap rather than an omission.
- **It is not portable to every deployment.** A single-site clinic where everybody sees everybody
  gains friction and no safety. The facility grant covers most of it; the rest is configuration,
  and a deployment that turns it off should have to say so.

## Alternatives considered

**Reinstate `facilityScoped` on addressed patient reads.** This was #139's subject and its
reasoning is recorded in `specs/core.ts`. `primaryFacilityId` is attribution rather than
containment, so it hides the chart from the clinician holding the patient while still revealing
one registered here to somebody who has never treated them. It also broke the portal: the facility
and compartment clauses are ANDed, so an IdP that omitted `facilities` locked every patient out of
their own record. Rejected, and #169 names it as the thing not to do.

**Keep the audit trail as the control.** This is today's position, and it is worth being precise
about rather than dismissive. It is a real control: every read is recorded, the chain is verifiable,
and break-glass is already distinguishable in it. What it is not is prevention, and detection is
weaker than it sounds when nobody has been assigned to look. Rejected as the _only_ control,
retained as the one that makes break-glass workable.

**An explicit grant list, maintained by an administrator.** No derivation, no expiry, no new write
path: somebody says who may see whom. Rejected because such lists only ever grow. Nobody is
thanked for removing access, everybody is interrupted by lacking it, and the failure mode is a
list that is correct on the day it is written and permissive forever after. An explicit grant
survives as one _source_ of a relationship, alongside the derived ones, for the cases derivation
cannot reach.

**Enforce it in middleware rather than in the repository.** Simpler to read and easy to add. It
was rejected for the reason the compartment was put where it is: a check a route can forget is a
check that a route eventually forgets, and the routes added since then would each have needed to
remember. The cost is that the repository layer grows a concept that is arguably policy, which is
a real objection and is the price of the guarantee.

**Do nothing until there is a real deployment.** The position has been honestly recorded since
#139 and no real records are held yet. Rejected because the shape of this decision constrains the
schema, and deciding it after there is data to migrate is strictly more expensive than deciding it
now. Proposing an ADR is not shipping one; the cost of writing it down is low and the cost of
retrofitting it is not.
