# 0007. A patient read is authorised by a care relationship, not by knowing the id

## Status

Accepted, with the amendments recorded under "What was built" below.

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

## What was built

Implemented in #247, which closes #169. Three of the five decisions above landed as written. Two
did not, and this section says so rather than leaving the ADR describing a system that does not
exist.

### Kept as decided

**Registration and duplicate-search are exempt by shape.** An addressed read is gated; a search
that describes a patient is not. `_id`, `identifier` and `patient` name one chart and are gated with
the read, because `Condition?patient=Patient/{id}` is the chart's problem list however it is
spelled. Searching by name and birth date is untouched.

What decision 3 also asked for and did not land: the duplicate-search projection is still the full
resource rather than a match result of name, birth date and MRN. The exemption is therefore wider
than the ADR intended, and narrowing it is outstanding.

**Break-glass is the only way past a refusal, and it costs something.** A reason, recorded on both
the row and the audit event; a window that expires; a ceiling of ten charts held open at once,
enforced by a database trigger under a per-user advisory lock rather than by the handler alone,
because the handler's check-and-write is defeated by two requests arriving together.

It costs more than the ADR said it would. It needs its own permission, `patient.breakGlass`, which
the read-only bundle does not hold: gating a privilege-granting route on the privilege it grants
makes it self-service, and the seeded `read-only` role could otherwise have taken every chart in the
tenant one request at a time.

**One function, both surfaces.** `findCareRelationship` is the only answer, and
`policy.care-relationship.test.ts` runs every case against the BFF and the FHIR boundary from one
table, because #139 is the recorded instance of those two drifting apart on this question.

### Amended

**The relationship is derived on every read, not written to a `CareRelationship` table.**
Decision 1 called for a row written by the events that create one. The implementation computes the
answer from those same rows instead.

The reason is the failure mode, not the cost. A materialised relationship is only as good as every
write path that maintains it, and a path that forgets does not fail loudly: it locks a clinician
out of a chart they are treating, at the moment they need it. Derivation cannot go stale. The price
is a handful of indexed lookups on a chart open, which is not a hot loop, and the expiry the ADR
wanted becomes a property of the evidence rather than a configured interval - a membership with a
closed period stops counting, a withdrawn encounter never counted.

**The check is called by the seam, not inherited from the repository layer.**
Decision 5 said the rule should live beside the compartment, where a new route cannot forget it,
and gave the reason plainly: "not in middleware that a new route can forget to apply".

It landed as a call the handler makes, and the ADR was right. Inside the pull request that
introduced it, two routes forgot: `/patients/:id/ccd` and `/patients/:id/growth` both took the same
id and returned more of the chart than the gated read. Both were found in review rather than by
anything failing.

What stands in for the ADR's property, for now, is enumeration rather than inheritance.
`bff.chart-routes.test.ts` walks the route files and requires every `/patients/:id/...` path to
call the check or name itself in an exemption list with a reason. `fhir.chart-gate.test.ts` does
the same for the FHIR surface, requiring every module whose collection declares a patient column to
declare where its chart comes from.

That gets the property - a new route cannot quietly skip the check - without the move. It does not
get the ADR's stronger version, where the check is structurally impossible to skip because it lives
under the data access rather than above it. Moving it there remains the better answer and is not
done.

**The gate reaches the generic BFF CRUD resources, not only `/patients/:id`.**
The check first landed on the FHIR boundary, on `/patients/:id`, and on the two patient sub-routes.
It did not reach the aggregates the BFF serves through `defineCrud` - problems, observations,
medications, results, claims, coverage, tasks, and the rest - so `GET /bff/v0/problems/:id` returned
a chart the matching `GET /fhir/Condition/{id}` refused, to any reader holding the plain read
permission, a different facility's chart included, because a condition carries no facility of its
own. This was the same id-knowledge access the whole ADR is against, left open on the surface the
practice's own UI uses.

It is now closed where the ADR wanted it: in the seam. `crud.ts` gates every read, list, and
amendment on the care relationship, keyed off a `chartFrom` each chart-bearing aggregate declares. `bff.chart-crud-gate.test.ts` fails the build if an aggregate whose spec has a
`patientColumn` omits it, so the gate cannot be forgotten for a new resource. This is closer to the
ADR's "under the data access" than the per-handler call the patient routes still use, though the
repository layer itself is still unaware of the relationship.

**A set-search of chart data is gated on every chart it returns.**
The gate first fired only when a search named a chart - `patient`, `_id`, `identifier`. That closed
`?patient=` and left the widest hole behind it: a clinical resource carries a patient compartment but
no facility of its own, so `GET /fhir/Condition?code=E11.9`, or a bare `GET /fhir/Condition`, named
no chart, skipped the gate, and returned every matching row in the tenant to a reader with no
relationship to any of them - the addressed read refused, the set-search not, for the same row. The
same residue sat behind the BFF list. Both boundaries now run the gate on the rows the search
returned: a row that names no chart (an unfiled fax) has none to check and comes back; a row that
does is refused unless the reader is in that patient's care, which turns a broad clinical search into
a chart-scoped one. `Patient` is the one exception, and only for a search that names no chart, because
finding a patient by name and birth date is how registration reaches a chart there is no relationship
with yet.

**The relationship check is not audited as the reader's access.**
Deciding whether a read is allowed means querying the rows that would authorise it - an encounter, an
appointment, a task. Those queries go through the same audited repositories as the read itself, so
without care they landed in the reader's `phi.read` event, listing the appointment that authorised a
report among the things the reader read and inflating the per-patient disclosure report with rows
nobody asked for. The check now runs with read-recording suppressed; the access is recorded by its
own `chart.access` event instead. This corrected the FHIR boundary too, where the same pollution had
shipped untested.

**A task is evidence only when somebody else produced it.**
The ADR's table lists `Task.assigneeUserId` and says nothing about who wrote the row, which reads
as an oversight only once you notice that the row is the evidence. Every role that can read a chart
can also write a task, and a task names its own patient and its own assignee: the biller role holds
`task.write` and `patient.read` and nothing else it would need to file a task about any patient id
it could guess, put itself in `assigneeUserId`, and have manufactured its own relationship. No
reason recorded, no expiry, no ceiling, none of the things break-glass exists to impose.

`Task.assignedById` is therefore stamped from the authenticated writer, on the create and again on
any reassignment, and is not on the wire schema. The source counts a task only when its assigner is
somebody other than the reader. A null assigner still counts: it means no person assigned the task,
which is what the routing engine's own tasks look like, and one raised from a domain event is
trusted for the same reason the event is.

What this does not do is check that the assigner could have opened the chart themselves. That needs
their roles and their facility grants, which the reading request does not have, so the honest
statement of the rule is narrower than it could be: a reader cannot hand themselves a chart, and a
colleague can hand them one. That is the delegation an inbox is for, and it is recorded against a
name.

**Facility activity expires; a named provider's does not.**
The `facility-activity` source authorises every current member of a facility on the strength of any
activity there. Unbounded, "any activity" means any activity ever: a single visit years ago let
today's entire front desk read the chart with no break-glass and no reason, which is the "knowing of
them is enough" this whole change removes, one step out. Codex found it after the withdrawn-status
fix, which had only stopped withdrawn rows counting and left every valid historical row timeless.

The evidence now goes stale after a year. A visit inside the window is current enough that opening
the chart is routine; past it the reader falls to break-glass. It does not lock out a returning
patient, because returning is itself fresh activity - the booking made at the desk and the encounter
opened at check-in are both inside the window. The appointment half is bounded only on the past
side: a booking still to come is a live commitment however far ahead it sits, while a no-show last
year is not.

The two provider-named sources, `encounter` and `appointment`, are deliberately left unbounded. A
clinician on the record for a visit keeps the chart after the site's general access to it has gone
stale, because "I treated them" does not lapse the way "someone here saw them once" does, and it is
one named person carrying it rather than a building full of staff. That means those sources are no
longer subsumed by `facility-activity` for stale rows, which is correct: the provider keeps access,
the crowd does not.

**Break-glass has two bounds, not one.**
The ceiling on concurrent grants was the only bound when this was first written, and it counts
grants that have not expired while the caller chooses the expiry. Asking for a one-minute window
empties every slot a minute later, so the ceiling bounds how many charts are open at an instant and
not how many charts a reader can walk through in an afternoon.

A rolling bound counts declarations made in a trailing window whatever became of them, which is the
number a reviewer means and the one a short window cannot reduce. Both are enforced in the handler,
for a refusal a person can act on, and in a database trigger under an advisory lock on
`(tenant, user)`, because the handler's version is check-then-write and two requests sent together
would both pass it.

### The evidence table, as implemented

| Source              | Evidence                                                               |
| ------------------- | ---------------------------------------------------------------------- |
| `own-record`        | the token's own compartment                                            |
| `break-glass`       | an unexpired grant this reader took                                    |
| `care-team`         | membership in force, on an active team                                 |
| `encounter`         | `Encounter.providerId`, excluding withdrawn visits                     |
| `appointment`       | `Appointment.providerId`, excluding cancelled and withdrawn            |
| `assigned-task`     | `Task.assigneeUserId`, assigned by somebody else                       |
| `facility-activity` | any encounter or appointment within the last year at the reader's site |

`Referral.referredById`, `ConsentGrant.recordedById` and `MessageThread` participation are in the
ADR's table and are not implemented. Each is a real relationship and none is covered by another
source in every case, so they are a gap rather than a decision.

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
