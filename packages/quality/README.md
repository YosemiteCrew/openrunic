# `@openrunic/quality`

Electronic clinical quality measures: what a practice did, and what this will not claim it did.

| Question                                  | Entry point                                     |
| ----------------------------------------- | ----------------------------------------------- |
| How did the practice do on this measure?  | `evaluateMeasure(measure, subjects, period, …)` |
| Can this measure be computed here at all? | `isComputable(outcome)`                         |
| Which measures does this build carry?     | `MEASURES`, `measureById(id)`                   |

Pure and IO-free. It reads no clock, opens no socket and knows no database: the measurement period
is passed in, which is what makes a report reproducible when somebody asks a year later why a number
was what it was.

## A patient with no reading is not a patient who passed

This is the defect that inflates every quality score that has ever been reported wrongly, and it is
easy to write by accident. "Blood pressure under 140/90" implemented as `!(systolic >= 140)` counts
a patient with no blood pressure recorded at all as controlled. The number goes up, nothing throws,
and the practice believes it is doing better than it is, which is the exact opposite of what a
quality measure is for.

So numerator criteria answer three ways, not two: met, not met, or **unknown**. Unknown never counts
towards the numerator, and it is reported separately as `numeratorUnknown` so a practice can see how
much of its score is unmeasured rather than unachieved. Those two call for completely different
work: one is a data-capture problem, the other is a care problem.

Both count against the rate, which is correct. An unrecorded result is not a result.

## The measure logic is public; the code lists are not

CMS publishes the specifications. The value sets they reference live in VSAC and need a UMLS
licence, and this project does not redistribute licensed terminology (see `packages/terminology`).

So a measure declares which value sets it reads, by canonical VSAC URL, and the deployment supplies
them. A measure whose value sets are not loaded reports that it **cannot be computed**, naming
exactly which ones are missing.

It does not compute a rate from a partial code list. A denominator built from half a value set is a
smaller, wronger denominator, and it looks exactly like a real one.

## Exclusions and exceptions are different things

An **exclusion** means the measure was never about this patient: they are pregnant, or on dialysis,
or receiving hospice care. An **exception** means it was, and a clinician documented a valid reason
not to act.

They are reported separately and both are subtracted from the denominator, never from the numerator.
Subtracting from the numerator is a real implementation mistake, and it moves the rate in the
flattering direction, which is how it survives review.

## Higher is not always better

`CMS122` counts patients whose diabetes is poorly controlled, so a lower rate is a better practice.
Every measure carries `higherIsBetter`, because a dashboard that sorted them all one way would show
a practice its worst measure as its best.

`CMS122` also has the one inverted rule in this package: a patient with no HbA1c result counts as
poor control, per the specification. A year with no test is a year of unmonitored diabetes, and the
measure refuses to let an absent result look like a good one. It is still reported in
`numeratorUnknown` so the practice can see how much of the number is untested.

## What is not here

No persistence, no scheduling, no submission. This module says what the numbers are; `apps/api`
supplies the population and records the report.

Nothing here submits to CMS. MIPS reporting is built on top of these numbers and is a separate
concern.
