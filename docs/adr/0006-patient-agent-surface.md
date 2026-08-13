# 0006. A patient-facing assistant surface, bound to one chart and to retrieval only

## Status

Accepted

Discharges [ADR-0005](0005-agentic-layer.md) rule 7, which reserved this decision for its own
record. ADR-0005 is not amended and remains Accepted in full.

## Date

2026-08-13

## Context

ADR-0005 shipped an assistant for clinic staff and deliberately stopped there:

> **The patient surface is a separate decision.** A patient-facing agent is gated behind its own
> flag and its own ADR (ADR-0006, not written). ADR-0004 already graded patient-facing
> interpretation as "the weakest position of all"; shipping staff and patient behind one switch
> would silently adopt ADR-0004's own worst case.

The product's stated audience is clinics, hospitals **and patients**, so leaving the reservation
open indefinitely is not neutral: it ships a two-tier product where the people whose records these
are get the least. This ADR takes the decision.

The thing that makes a patient surface different is not the user interface. It is that on the staff
surface there is a trained reader between the model and the consequence, and here there is not.
Every property ADR-0005 argues for therefore has to hold more tightly, not less:

| ADR-0005 property                 | On the staff surface                                     | On this surface                                                                     |
| --------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Compartment                       | The chart the clinician has open, which they may change. | The one chart on the reader's own token. There is no "change".                      |
| Retrieval, not generation         | A clinician can spot an unsourced claim.                 | Nobody can. An unsourced answer is not shown at all.                                |
| Never rank by clinical risk       | Ranking is forbidden.                                    | Ranking is forbidden, and the grades that would enable it are not projected either. |
| No interpretation of results      | Out of scope for v1.                                     | Out of scope, and enforced by granting no capability that returns a measured value. |
| The honest "I cannot answer that" | A clinician knows what to do next.                       | The surface has to say who to ask, and hand over the route.                         |

ADR-0004's judgement stands and is the reason the grants below are as narrow as they are: patient
facing interpretation is the weakest position this project could take, so the surface is built so
that it has no way to take it.

## Decision

We will ship a patient-facing assistant surface in `apps/portal`, granted three read-only
capabilities, bound to the reader's own chart, and off unless a deployer has configured an
inference endpoint.

### The three capabilities, and why only three

| Capability    | Reads                                              | Permission         |
| ------------- | -------------------------------------------------- | ------------------ |
| `record.list` | Conditions, medicines, allergies and vaccinations. | `encounter.read`   |
| `visits.list` | Appointments, before or after today.               | `appointment.read` |
| `bills.list`  | Statements and what is left to pay.                | `payment.read`     |

Each is `READ`, `reader`, `approval: 'never'`, `compartmentBound: true`, and requires only a
permission the API's `patient-portal` role already holds. Three that are certainly safe beat ten
that are arguable, so the list is what a person opens a portal to ask - what does my record say,
when am I next in, what do I owe - and stops.

**What is deliberately not granted, and why.**

- **Results.** Retrieval of a measured value is arguably not interpretation. The argument is close
  enough that this surface does not have to win it, and ADR-0005 records patient-facing result
  interpretation as out of scope. The portal's own health-record screen shows results with the
  curated code-to-plain-language mapping ADR-0004 specified, by code no model has touched.
- **Severity and criticality.** The record grades an allergy `HIGH` or `LOW` and a problem by a
  severity code. A model choosing which rows to list while attaching a grade to each is one step
  from ordering them by how bad they are, which ADR-0004 rule 3 forbids. Those fields are not
  projected at all; the portal screen shows them with the practice's own plain label.
- **Clinician free text.** Note bodies and row comments are not projected. Routing clinician prose
  through a model turns it into model prose the first time it is paraphrased, and the reader cannot
  tell which one they received.
- **Messages and forms.** Both are defensible and neither is needed to prove the surface works.
  They can be argued for separately once this one has been used.
- **Anything that writes.** Booking, cancelling, replying and paying stay on the portal's own
  screens. ADR-0005 requires every agent-reachable capability to have a deterministic non-agent
  path; the cheapest way to satisfy that is to make none of them agent-reachable.

### The compartment, made checkable rather than assumed

Three mechanisms, and the third is the one that is new.

1. **No capability names a patient.** Every one calls a collection endpoint with no identifier and
   no patient filter. The API narrows every repository it hands a portal request to the chart on the
   verified token, so the scoping is done by middleware the browser path already exercises. A filter
   added in the tool layer would be a second implementation of the same rule, and the second one is
   the one that goes wrong. `defineTool` already refuses a patient-surface tool whose input schema
   mentions `patientId`, `patientMrn` or `mrn`.
2. **A turn with no chart bound reads nothing.** The surface sends the reader's own chart with every
   question. It can only ever narrow: the API scopes by the token whatever the request says, so a
   client that sent somebody else's identifier would receive its own rows and then fail the check
   below. A capability asked to read with no chart bound refuses before it calls the API, because a
   read whose result cannot be checked is not a smaller answer, it is an unchecked one.
3. **Every row names the chart it came from.** This is the change from the staff shape. A staff
   record card carries no `patientId`, so the boundary re-check in `compartment.ts` - which walks a
   payload for keys naming a compartment - has nothing to look at and passes trivially. On this
   surface every row carries its chart, the re-check compares it against the chart bound to the
   turn, and a mismatch aborts the whole turn rather than filtering the row out. A silent filter
   hides the fault that produced it, and the fault that produced it is somebody else's record
   arriving in a patient's transcript.

`packages/agent-tools/src/patient-surface.test.ts` asserts all three **against the allowlist rather
than against a list of names**, so a capability added to the patient grants is covered by every case
the moment it is added, and fails the suite by name if it does not carry the property.

### What the surface refuses to draw

- **An answer without its records.** ADR-0005 rule 2 asks that the source be displayed. Here, prose
  whose source ledger never arrived is not shown at all and the page says why.
- **A draft change.** The page asks for `read` on every turn, so the half of the loop that drafts
  changes never runs. A proposal arriving anyway is treated as a failure, not rendered: a patient
  must never be handed a proposed change to their own chart that nobody at the practice has seen.
- **A record identifier in a link.** The portal has no per-record page, so a citation is a link to
  the section that holds the row. There is no route that takes an id, so the citation resolver has
  no way to build a link into any chart, including the reader's own.

### Escalation, as a route rather than as a disclaimer

When the honest answer is "ask your care team", the page says so and links to the messages screen.
Every way a turn can end without a checkable answer - nothing found, something broken, words without
records, a question the surface does not carry - offers the same panel with the same words. The
uniformity is the point: a surface that varied its tone by what went wrong would be telling somebody
how worried to be, which is not something it knows.

A question that asks for a judgement rather than for a record - "should I", "is this normal", "what
does this mean" - is answered locally and **never sent anywhere**. That check matches on the shape of
the request and never on what it is about: it holds no list of conditions and no notion of how
serious anything is, and every match goes to the same place. It is defence in depth and not the
control, exactly as ADR-0005 says of detection generally. The control is that no granted capability
returns a measured value and every sentence must carry a citation to a stored row.

### Off by default, and 404 rather than disabled

`apps/api` mounts no agent router without a configured endpoint, so `/bff/v0/agent/tools` answers
404 through the ordinary not-found handler. The portal asks once per app load and treats every
answer other than a clear yes - 404, 401, a 500, a dead socket, an unreadable body - as absent.

- While the probe is in flight the page renders **nothing**: no spinner, no skeleton. Guessing
  present would flash a working assistant at a practice that has none; guessing absent would answer
  404 on every first load of a practice that has one.
- Once the probe has answered absent, the route is a **404**, the same answer any address that is
  not part of the portal gets. There is no disabled state and no explanatory empty screen, because a
  page that exists only to say a feature does not is still a feature.
- The navigation gains its seventh entry only where an assistant exists. ADR-0005 asks that no
  screen reserve layout space for the agent, and a tab that appears and then disappears is space
  reserved.

## Consequences

### Good

- The people whose records these are can ask questions of them in their own words, with every answer
  traceable to a row they can open.
- The compartment is now checked on the way out of every capability rather than inferred from which
  endpoints were called, which is a stronger property than the staff surface has today.
- A practice that configured nothing has exactly the portal it had before, down to the number of
  tabs.
- The narrow grant list means the surface can be reasoned about in one sitting: three capabilities,
  all read, all bound to one chart, none returning a measured value.

### Bad, accepted

- The assistant will often have to say "ask your care team", and some of those questions have
  answers it could plausibly have produced. That is the trade being made deliberately: a plausible
  answer with nobody to check it is the failure mode this surface exists to avoid.
- Bills are named as a figure without a currency symbol, because the stored statement carries minor
  units and no currency code. The portal's bills screen holds the practice's currency and every
  citation opens it. Naming an amount without a currency is a gap; it is a smaller one than naming
  the wrong currency.
- Appointment times are passed through as stored instants rather than formatted, because formatting
  them server-side would apply the wrong timezone to a reader who is somewhere else. The reader gets
  the right time from the appointments screen, which the citation opens.
- Patient questions are health data, and on a remote endpoint they are egress, exactly as staff
  questions are. The page says so in plain words above the box rather than in a settings screen,
  because the person whose words are being sent is the one reading it.
- Two apps now hold a near-identical assistant transport and transcript. That duplication is
  deliberate for now - `@openrunic/agent` is a server package and neither browser bundle may depend
  on it - and it is on the list of primitives to reconcile once both surfaces have settled.

### Not in v1, and why

- **Result retrieval and anything resembling interpretation.** The device line, ADR-0004 rule 4, and
  ADR-0005's own exclusion.
- **Reading message threads.** Defensible, and it ingests the largest body of untrusted free text
  the portal holds. It can be argued separately.
- **Any write.** Booking, cancelling, replying, paying and form submission stay deterministic.
- **Telling a reader anything is urgent, serious, or a priority.** Hard-disabled by having no
  capability that could produce it and no vocabulary that could express it; asserted by test over
  both the capability strings and the rendered page.

## Alternatives considered

**Leave the patient surface unbuilt.** The honest default, and the one ADR-0005 chose while the
question was open. Rejected now because it is no longer neutral: the product claims patients as an
audience, and an indefinite reservation is a decision made by not making it.

**Ship the staff capabilities to patients with a compartment applied.** Cheapest, and it is exactly
what ADR-0005 rule 7 forbids. `chart.search` accepts a family name and a date of birth; a patient has
no business naming either, and a capability designed for somebody who legitimately reads many charts
is the wrong starting point for somebody who may read one.

**Let the surface interpret results with a disclaimer under the answer.** Rejected. A disclaimer
under an answer is read after the answer, and ADR-0004 already graded this the weakest position
available. The curated code-to-plain-language mapping on the portal's own screens is the sanctioned
path and it needs no model.

**Detect worrying questions and route them differently.** Rejected outright: that is an urgency
determination, which ADR-0005 hard-disables in every jurisdiction profile. The check that does ship
routes every question it declines to the same place with the same words, and knows nothing about
what any of them are about.

**Render "no assistant configured" as an empty state on a real page.** Rejected. It is a feature in
the interface whose only content is that a feature is missing, and it would mean the portal looked
different at practices that had made no decision at all.
