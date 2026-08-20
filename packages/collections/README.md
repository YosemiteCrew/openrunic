# `@openrunic/collections`

When to ask a patient for money again, and when to stop asking.

| Question                                       | Entry point                        |
| ---------------------------------------------- | ---------------------------------- |
| What should happen to this balance today?      | `nextAction(state, policy, today)` |
| How overdue is it, and what should happen?     | `ageBalance(state, policy, today)` |
| Which ageing bucket is this?                   | `agingBucket(daysOverdue)`         |
| Is this practice's dunning policy well formed? | `validateDunningPolicy(policy)`    |

Pure and IO-free: it reads no clock, opens no socket and knows no database. The date it works from
is passed in, which is what makes a decision reproducible six months later when a patient asks why
they were sent a third notice.

## One place decides

A practice chasing a balance has three honest options: wait, ask again, or stop asking. This module
is the only thing that picks between them. The alternative is that the answer differs between the
screen a biller reads, the job that sends the notices, and the report the practice manager trusts,
and nobody finds out until the three are compared in front of a patient.

The API consults it on every notice rather than trusting the caller. A route that took the cycle
number from the request would let a retried job or a double-clicked button place a patient anywhere
on the schedule, including at the final notice on the first letter.

## The policy belongs to the practice

How hard to chase somebody for medical debt is not a technical question. Statutes of limitation,
state rules on medical debt, and what a practice is willing to do to the people it treats all vary,
and none of them belong hard-coded in an EMR. What the software owes is that the configured policy
is applied evenly, that nobody is chased faster than the practice said, and that the decision can be
explained afterwards.

`minimumNoticeGapDays` is a floor, not a second schedule. It can only ever push a notice later. It
exists because backfilling old statements, replaying a job, or an operator clicking twice all
produce a second notice far sooner than the schedule intended, and the patient experiences that as
being chased twice in a day for the same money.

## Two things that are easy to get backwards

**A small balance still gets one bill.** The write-off threshold applies once the notices are
exhausted, never before. It is the chasing that costs more than it recovers; a practice that never
asked has not chased.

**Written off is not void.** Void means the statement should never have been sent. Written off means
the debt was real and the practice stopped pursuing it. A practice that cannot tell those apart
cannot report its bad debt and cannot tell a billing problem from a collections one. The two are
separate states in the schema for that reason.

## What is not here

No persistence, no notice rendering, no delivery. This module says what should happen; `apps/api`
records that it did.
