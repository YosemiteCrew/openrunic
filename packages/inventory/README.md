# `@openrunic/inventory`

What is on the shelf, which lot it comes from, and what leaves it.

| Question                                               | Entry point                                          |
| ------------------------------------------------------ | ---------------------------------------------------- |
| Which lots may I draw from, soonest to expire first?   | `fefo(lots, asOf)`                                   |
| Why can I not use this one?                            | `unusableReason(lot, asOf)`                          |
| How much is on hand, per lot and in total?             | `balancesByLot(...)`, `itemBalance(...)`             |
| Which lots do I take this quantity from?               | `allocate(lots, movements, itemId, qty, asOf, opts)` |
| How many tablets does this prescription actually need? | `courseTotal({ perDose, dosesPerDay, days })`        |
| The count disagrees with the book - what do I post?    | `countVariance(counted, expected)`                   |
| How much could I actually dispense right now?          | `usableBalance(lots, movements, itemId, asOf)`       |
| What runs out in the next month?                       | `expiringWithin(lots, asOf, days)`                   |

Pure and IO-free: no clock, no socket, no database. Every function that cares about time takes the
date to judge against, so a back-dated correction is judged against the date of the event rather
than the date somebody got round to entering it, and a test asserts the same thing every day it
runs.

## Everything fails closed

Date comparisons here are lexicographic, which is correct for `YYYY-MM-DD` and silently wrong for
anything else - `'2026-8-01' < '2026-09-01'` is false, so a lot that expired in August reads as
usable in September. `IsoDate` is an alias for `string` and stops nothing arriving from a form or a
column, which is where a non-canonical date comes from, so dates are validated at the point a
usability or balance decision is made.

`signedQuantity` throws on a movement kind it does not recognise rather than treating it as
outbound. A misspelled `RECIEPT` deserialised from a column would otherwise subtract on the way in
and produce a plausible balance with no error anywhere. A thrown error on a corrupt row is a bad
afternoon; a confidently wrong balance is stock ordered against a number nobody can reproduce.

`exactlyThisManyStockUnits` checks before it brands. The brand's promise is "this is a total", and a
cast that accepted anything would make that a promise about where the number was typed. A negative
allocated as completely filled having moved nothing, and `NaN` survived `Math.min` into the posted
movements.

Quantities are carried to six decimal places and sums rounded back to it, because some units are
fractional: receive 0.3 mL, remove 0.1 and 0.2, and raw floating point leaves -2.78e-17, which
`negativeBalances` reported as a loss and `countVariance` turned into a variance against a shelf
that was correct.

Lots are deduplicated by id before allocation. A join returning a lot twice gave each copy the
lot's full balance, so ten units passed twice satisfied a request for twenty.

## On-hand is derived, never stored

There is no quantity column, and that is the whole design. A column can be set, and once it can be
set it will be, by a well-meant repair of a number that looked wrong - leaving no trace of what was
wrong or who decided it. For a controlled substance that is precisely what an audit exists to
detect, and a system that cannot tell "somebody fixed a typo" from "somebody removed a hundred
tablets and adjusted the count" is not one a practice can defend.

So the ledger is append-only. A mistake is corrected by a compensating movement carrying
`correctsMovementId` and a reason; both rows stay. The balance moves, the history does not.

A movement's quantity is always positive and its direction comes from its kind, which makes
`{ kind: 'RECEIPT', quantity: -40 }` - a removal wearing the word "receipt" - unrepresentable rather
than merely discouraged. It is also why a count variance is two kinds: stock found and stock missing
are not one event with a sign.

## The dose is not the quantity

"One tablet twice daily for ten days" shows three numbers and the quantity that leaves the shelf is
none of them. Deducting the dose hands over a bottle of twenty and records that one tablet left,
which throws nothing, logs nothing, and is found weeks later at a count with no way to tell which of
four hundred dispenses was the bad one.

`allocate` therefore does not take a `number`. It takes a `DispensedQuantity`, which can only come
from `courseTotal` - which does the multiplication - or from `exactlyThisManyStockUnits`, whose name
is the point: passing a per-dose figure now means typing a phrase that says it is not one.

## First expired, not first in

The two orderings agree only when stock arrives in the order it expires, which is exactly what does
not happen. A delivery of short-dated stock arriving after a long-dated one is routine, and FIFO
holds the short-dated box behind it until it expires on the shelf. The waste is invisible in the
code and obvious in the bin.

Lots that cannot expire sort last - there is never a reason to spend something that keeps ahead of
something that does not. Ties break on receipt date and then on id, so the order is total and a
second run of the same numbers reconciles against the first.

Two clocks govern a lot, and the shorter wins: the manufacturer's expiry, and the beyond-use window
that starts when a multi-dose vial is first pierced. The second usually runs out first and is the
one a practice forgets, because it is not printed on anything.

## Divisibility is the caller's call

Thirty tablets may come from two lots. A single 0.5 mL injection may not. The unit does not settle
it - `mL` is divisible when filling a bottle and indivisible within one injection - so `allocate`
requires the answer and has no default, because a wrong guess draws half a dose from each of two
vials and no test that only counts totals would notice.

When enough stock exists but no single lot holds enough, the allocation says
`blockedByIndivisibility` rather than reporting a plain shortage. That is the state that makes
people distrust a system: the screen says there is no stock, the fridge visibly has some, and both
are true.

## What this package does not do

Persistence, identifiers and authorisation. `allocate` decides what to take; `movementsFor` builds
the rows that record it; posting them is the caller's, because deciding and recording are different
acts and a fused version posts the ledger for a dispense that then fails at the counter.
