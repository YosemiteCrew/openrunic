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

| ADR                                               | Title                                                               | Status   |
| ------------------------------------------------- | ------------------------------------------------------------------- | -------- |
| [0001](0001-monorepo-pnpm-turbo-node22.md)        | Monorepo with pnpm, Turborepo, and Node 22                          | Accepted |
| [0002](0002-relational-postgres-fhir-boundary.md) | Relational Postgres as source of truth, FHIR R4 at the API boundary | Accepted |
| [0003](0003-branch-model-main-dev.md)             | Branch model: main plus dev with a single aggregate check           | Accepted |
