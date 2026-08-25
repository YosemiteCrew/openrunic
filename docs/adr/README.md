# Architecture Decision Records

This directory records the significant architectural decisions made in openrunic, in the
[ADR](https://adr.github.io/) style. ADRs exist so that future contributors (human or agent) can
understand not just what was decided, but why, and what alternatives were rejected.

## Process

- ADRs are numbered sequentially: `NNNN-short-title.md` (four digits). **Numbers are never
  reused**, even if an ADR is rejected or superseded.
- Start from [template.md](template.md). Keep it honest: record the alternatives that were
  genuinely considered and the real downsides of the chosen option.
- A new ADR enters as **Proposed** in its PR and becomes **Accepted** when the PR merges to `dev`.
- Decisions are immutable history. When a decision is reversed or replaced, do not delete or
  rewrite the old ADR; mark it **Superseded by ADR-NNNN** and write a new one.
- If a code change reverses or significantly extends a recorded decision, the PR must include the
  corresponding ADR.

## Statuses

| Status     | Meaning                                         |
| ---------- | ----------------------------------------------- |
| Proposed   | Under discussion in an open PR                  |
| Accepted   | Merged; this is how we do it                    |
| Superseded | Replaced by a later ADR (which it must link to) |
| Rejected   | Considered and turned down; kept for the record |

## Index

| ADR                                               | Title                                                                        | Status   |
| ------------------------------------------------- | ---------------------------------------------------------------------------- | -------- |
| [0001](0001-monorepo-pnpm-turbo-node22.md)        | Monorepo with pnpm, Turborepo, and Node 22                                   | Accepted |
| [0002](0002-relational-postgres-fhir-boundary.md) | Relational Postgres as source of truth, FHIR R4 at the API boundary          | Accepted |
| [0003](0003-branch-model-main-dev.md)             | Branch model: main plus dev with a single aggregate check                    | Accepted |
| [0004](0004-no-ml-runtime-in-core.md)             | No ML runtime in the core deployment                                         | Accepted |
| [0005](0005-agentic-layer.md)                     | An optional agentic layer over a deployer-configured inference endpoint      | Accepted |
| [0006](0006-patient-agent-surface.md)             | A patient-facing assistant surface, bound to one chart and to retrieval only | Accepted |
| [0007](0007-care-relationship-authorisation.md)   | A patient read is authorised by a care relationship, not by knowing the id   | Proposed |

ADR-0005 supplements ADR-0004 and amends one clause of it. An amendment is not a supersession: both
are Accepted, and ADR-0004 carries a note at the top naming the clause that moved.

ADR-0006 discharges ADR-0005 rule 7, which reserved the patient surface for its own record. It
amends nothing: ADR-0005 stands in full.

ADR-0007 is Proposed rather than Accepted: it decides a shape, and the shape has a schema change and
a migration behind it. It does not amend ADR-0002; it decides one question ADR-0002's boundary makes
harder, which is that the same rule has to hold at the FHIR surface and the BFF. #139 is the recorded
instance of those two drifting apart on exactly this question.
