# `@openrunic/pricing`

What a practice charges, and what it will actually be paid.

| Question                                                  | Entry point                             |
| --------------------------------------------------------- | --------------------------------------- |
| What goes on the claim, and what will the contract allow? | `priceFor(line, standard, contracted?)` |
| Which schedule was in force on that date?                 | `scheduleOn(schedules, date, payerId?)` |
| What does this patient without insurance owe?             | `applyScale(cents, scale, household)`   |
| Is this sliding scale well formed?                        | `validateScale(scale)`                  |

Pure and IO-free: it reads no clock, opens no socket and knows no database, so every determination
is reproducible from its inputs. That matters more here than in most places, because a patient
asking why they were charged what they were charged is entitled to an answer, and for a community
health centre the answer is a condition of funding.

## Two prices, not one

A charge has a billed amount and an allowed amount. The billed amount comes from the standard
schedule and **never** from the payer's - billing a payer its own contracted rate forfeits the
difference wherever the contract would have paid more, and it is invisible, because the remittance
balances to the penny. The gap between the two is the contractual adjustment, and a practice that
cannot see it before the remittance arrives cannot tell an underpayment from a discount it agreed
to.

An absent allowed amount is not zero. A contract that does not name a code has not agreed to pay
nothing for it.

`allowedCents` is what the contract says; `expectedPaymentCents` is what will arrive, capped at the
amount billed. They differ exactly where the standard schedule is stale, and a receivables estimate
built on the first overstates itself in the one place a practice most needs the number to be right.

## Modifiers are different services

`26` is the professional component - reading a film somebody else's machine produced - and it is
roughly a third of the global price. An entry naming modifiers the charge does not carry does not
match at all; among those that do, the one naming the most wins.

"The most" rather than "the first found" matters: a schedule holding both `26` and `26,LT` is
ordinary, and picking whichever the scan reached first made the price depend on row order, so the
same charge could be billed two different amounts on two different days with nothing in the data
having changed. It is longest-match rather than exact-match, because a schedule that prices `26` and
says nothing about `26,LT` still means to price a `26,LT` line.

## Why the poverty guideline is supplied, not embedded

The federal poverty guidelines are public data, and embedding them would be the same move this
repository makes with the CDC growth charts. It is the wrong move here:

- They change every year. A table compiled into a release silently applies last year's threshold to
  this year's patients. The growth charts have not moved since 2000.
- They are jurisdictional. Alaska and Hawaii have their own; a deployment outside the United States
  has something else or nothing.

So the practice supplies the guideline amount for the household size and this computes the
percentage. What is stored is the number the practice was given by whoever funds it.

## A nominal fee is not a discount

Most scales end in a band charging a flat small amount - twenty dollars a visit whatever the
charge. That is a different rule, not a large percentage: expressing it as one gives a different
number for every charge and none of them the twenty dollars the policy promises. It is also capped
at the charge, because a twenty-dollar nominal fee against an eight-dollar charge would bill the
patient more than the service costs.

## Refusing rather than guessing

"We could not determine a discount" and "this patient does not qualify for one" are different
answers, and only one is something a front desk should act on without asking. A household with no
guideline, a negative income, or a percentage no band covers comes back as a named refusal.

`validateScale` runs when a practice saves a scale rather than when a patient is charged: a gap
found at the desk is a patient waiting while somebody edits a policy, and the same gap found on save
is a validation message.

```bash
pnpm --filter @openrunic/pricing test
```
