# `@openrunic/growth`

Growth percentiles, from the CDC 2000 growth charts.

| Question                       | Entry point                            |
| ------------------------------ | -------------------------------------- |
| Where is this child?           | `percentileFor(query)`                 |
| What does the curve look like? | `curveFor(measure, sex, percentile)`   |
| The maths, on its own          | `zScore` / `valueAtZ` / `percentileOf` |

A measurement on its own says nothing about a child. Ten kilograms is a thriving one-year-old and a
four-year-old in trouble, and the only way to tell is against a reference - which is why a paediatric
chart without percentiles is a list of numbers nobody can act on.

## Where the numbers come from, and why you can trust them

The reference data is the CDC's own published LMS parameters. It is not typed in and not adjusted.
`scripts/fetch-reference.mjs` downloads the CDC files, records the source URL and a SHA-256 of each,
and writes the tables out.

Then it does the thing that matters: the CDC publishes precomputed percentile columns beside the LMS
parameters, and the generator recomputes **every one of them** from the L, M and S it is about to
write. It refuses to emit a table whose parameters do not reproduce the CDC's published values.
15,361 percentiles are checked on each run, so a transcription error cannot reach the repository -
the generator stops instead.

A sample of those published values travels with the tests, so the same agreement is asserted on
every CI run rather than only at generation time. That is deliberately not a snapshot: a snapshot
proves the code still does what it did last week, and this proves it does what the CDC says.

```bash
pnpm --filter @openrunic/growth run reference:build   # needs network; CI never runs it
```

## Which charts these are, and which they are not

These are the CDC 2000 charts. The CDC itself recommends the **WHO** standards below 24 months,
because those describe how breastfed children in optimal conditions _do_ grow rather than how a
mixed American sample _did_. This package uses the CDC birth-to-36-month charts there instead, and
names the table on every result, because a percentile whose reference is unstated is one a clinician
cannot weigh. Adding WHO is the same shape of work: a second set of LMS parameters and a selection
rule.

## The 24-month overlap

The infant charts run to 36 months and the child charts start at 24, and they disagree by design -
infant charts use recumbent length, child charts standing height, and a child measures about a
centimetre shorter standing up.

For four of the six measures the caller has already answered which chart they want by naming what
they measured: `length-for-age` is taken lying down, `stature-for-age` standing. Head circumference
is charted to 36 months and not past it; BMI is not used below 24. `weight-for-age` is the one the
name does not settle, and there the rule is the CDC's - infant below 24 months, child from 24.

## What it refuses

A percentile computed off the end of a reference is not a cautious estimate; it is a number with
nothing behind it, printed beside numbers that have. So an age outside the charts, a measure not
charted at that age, and a measurement that is not a positive number all return a refusal naming the
reason - and where there is a right question to ask instead ("stature-for-age is the standing
measurement"), the refusal says so, because that is the only useful thing to tell somebody holding a
tape measure.

Both a z-score and a percentile come back. Percentiles compress at the extremes: a child at z -3.4
and one at z -5.1 both read as the 0th percentile and are in quite different situations.
