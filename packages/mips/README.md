# `@openrunic/mips`

MIPS scoring: the categories an EMR can compute, and the one it cannot.

| Question                                       | Entry point                                    |
| ---------------------------------------------- | ---------------------------------------------- |
| What is this quality measure worth in points?  | `scoreQualityMeasure(report, benchmark)`       |
| Is this benchmark safe to score against?       | `benchmarkProblems(benchmark, higherIsBetter)` |
| How did the practice do on interoperability?   | `scorePromotingInteroperability(answers)`      |
| What is the score so far, and what is missing? | `compositeScore(results, weights)`             |

Pure and IO-free.

## Cost is not computable here, and the score says so

MIPS has four categories. This computes three.

**Cost is calculated by CMS from submitted claims across every setting a patient was seen in**,
including hospitals and specialists this practice has no record of. No EMR holds that data. One that
produced a Cost score would be inventing it.

So a composite reports the weight it covered and the weight it did not, and **it never renormalises
the three categories to 100**. A number presented as a final score that silently omits thirty per
cent of the weight is the kind of wrong that gets acted on, because it looks exactly like the real
thing and it is the number a practice plans around.

`notComputed` always contains Cost, present rather than absent, so a screen rendering this cannot
leave it out by accident.

## Unscored is not zero

This distinction runs through the whole package, and every unscored answer names why, because "no
points" has several completely different causes and a practice acts on each of them differently.

- **No benchmark**: nobody has scored this. Obtain the benchmark.
- **No rate**: the measure had an empty denominator. Nothing to score.
- **Below the case minimum**: fewer than 20 eligible patients, where one patient moves the rate by
  five points or more. The number would be noise.
- **Unattested**: nobody asked the practice. Different from a practice that answered no.
- **No eligible acts**: a practice that wrote no prescriptions did not fail to send them
  electronically. Scoring that as zero penalises a case mix.

An unscored measure is left out of the quality category's denominator rather than counted as a
failure, because reporting a practice as performing badly at something it was never measured on is
worse than reporting less.

## Benchmarks are supplied, not shipped

Decile boundaries change every performance year and differ by collection type. A build carrying last
year's benchmarks would score this year's care against them and produce a number that looks exactly
like a real one. So they are data the deployment supplies, and `benchmarkProblems` checks one before
it is trusted.

The check that matters most is direction. CMS publishes boundaries in the direction of improving
performance, which ascends for a normal measure and **descends for an inverse one**. A benchmark
loaded the wrong way round scores every practice backwards: the best performers get three points, the
worst get ten, and nothing about the output looks wrong.

## What is not here

No submission. This module says what the numbers are; sending them to CMS is a separate concern with
its own credentials and its own registry.
