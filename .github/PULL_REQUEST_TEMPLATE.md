<!--
Title format (required, CI-enforced): type(scope): subject
  types:  build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test
  scopes: web|portal|api|database|fhir|types|ui|lib|repo|ci|docs
PRs target the dev branch.
-->

## Checklist

- [ ] PR title follows `type(scope): subject` with a scope from the allowed list
- [ ] Linked to an issue (or explained below why none exists)
- [ ] Tests pass locally (`pnpm --filter <ws> test`) and lint/type-check are clean
- [ ] No real patient data (PHI/PII) anywhere in the diff, screenshots, or logs
- [ ] No secrets or `.env` files in the diff
- [ ] Applied Prisma migrations were not edited (new migration created if schema changed)

## Current behavior

<!-- What happens today, before this PR. For new features: what is missing. -->

## New behavior

<!-- What happens after this PR, and how you verified it. -->

## Related issues

<!-- e.g. Fixes #123, Relates to #456 -->

Fixes #
