# @openrunic/agent-tools

The tool registry for openrunic's optional assistant ([ADR-0005](../../docs/adr/0005-agentic-layer.md)).

One rule governs this package:

> **Tools call the existing HTTP API with the end user's own credentials.** No tool receives a
> database client, no tool imports Prisma, and no tool has a privileged path.

That is the single most important security decision in the design. It means tenant scoping, consent
evaluation, policy checks and hash-chained audit writes are enforced by middleware that already
exists and is already tested, so the agent path and the browser path cannot become two doors with
different locks. It is enforced twice: by an ESLint rule in `eslint.config.mjs`, and by
`src/registry.no-database-import.test.ts`, which checks the source, the built output and the
declared dependencies. A lint rule can be skipped; a test in CI cannot.

## What a tool declares

Every tool is built through `defineTool`, and there is no other way to make one. It declares:

| Field              | Meaning                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| `id`               | `aggregate.verb`. Stable, because it appears in the audit chain.               |
| `tier`             | `READ`, `DRAFT` or `EXECUTE_BOUNDED`.                                          |
| `trustClass`       | `reader` may see untrusted text and holds no write; `writer` never sees prose. |
| `approval`         | `always` for every write in v1. `never` is only reachable from `READ`.         |
| `requiredScopes`   | Permissions the delegating human must independently hold.                      |
| `surfaces`         | `staff`, and (from ADR-0006) `patient`. Nothing is granted to `patient` in v1. |
| `input` / `output` | zod schemas, validated on the way in and on the way out.                       |
| `maxResultRows`    | Minimum necessary. Exceeding it is a scope violation, not a truncation.        |
| `compartmentBound` | True when a tool may only return rows for the chart the caller has open.       |

`defineTool` refuses at import time anything the ladder forbids: an unapproved write, a `READ` tool
claiming to be a writer, a schema that names a tenant or an organisation, a patient identifier on a
patient-facing tool, or an id that looks like outbound communication. A tool that breaks an
invariant cannot ship, because the process that loads it fails.

## The v1 catalogue, in ship order

| #   | Tool                          | Tier  | R/W | Roles                 | Approval |
| --- | ----------------------------- | ----- | --- | --------------------- | -------- |
| 1   | `chart.search`                | READ  | R   | clinician, biller     | never    |
| 2   | `denial.triage`               | READ  | R   | biller                | never    |
| 3   | `denial.draftAppeal`          | DRAFT | W   | biller                | always   |
| 4   | `priorauth.assemblePacket`    | DRAFT | W   | biller, clinician     | always   |
| 5   | `forms.draftDefinition`       | DRAFT | W   | admin                 | always   |
| 6   | `inbox.classify`              | DRAFT | W   | front desk, clinician | always   |
| 7   | `audit.query`                 | READ  | R   | admin, compliance     | never    |
| 8   | `appointments.findSlots`      | READ  | R   | front desk, clinician | never    |
| 9   | `appointments.propose`        | DRAFT | W   | front desk, clinician | always   |
| 10  | `documents.extractCandidates` | DRAFT | W   | clinician, front desk | always   |
| 11  | `messages.draftReply`         | DRAFT | W   | clinician             | always   |
| 12  | `coding.suggest`              | DRAFT | W   | biller                | always   |

Chart search ships first because its failure mode is a visible null result, which is the only task
on the list with that property. Coding suggestion ships last because its failure mode is systematic
upcoding: a statistical signature across thousands of encounters that no single review would catch.

`audit.query` is registered but currently unreachable: it declares an `audit.query` scope the API's
permission catalogue does not yet have, so no principal holds it and the tool is invisible to every
caller. That is deny-by-default working, not a gap being hidden, and it becomes reachable the day
the platform grows the permission and the `/bff/v0/audit-events` route.

## Deny by default

A tool is unreachable unless `allowlist.ts` grants it to the caller's surface **and** role, and
unless the caller independently holds every scope it names. An ungranted tool resolves to
`undefined`, exactly as a tool that does not exist does, and callers must not distinguish the two: a
refusal is a disclosure.

There are two enforcement points and they are not redundant. Filtering at advertise time is an
accuracy and prompt-budget win. Re-checking at execute time, against the caller's own session, is
the actual control.

## What is not here, and will not be

No outbound-communication tool of any kind: no email, SMS, fax, webhook, URL fetch, file attach or
external message create. Access to private data plus exposure to untrusted content plus the ability
to communicate externally is the exfiltration trifecta; an EMR assistant has the first two by
definition, so the third is made structurally impossible. `defineTool` refuses an id that looks like
one, and `catalogue.test.ts` asserts the registry holds none.
