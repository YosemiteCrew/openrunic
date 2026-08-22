import { describe, expect, it } from 'vitest';

import { PUBLISHED_PERCENTILES } from './__fixtures__/published.js';
import {
  CHILD_CHART_FROM_MONTHS,
  curveFor,
  isRefusal,
  OLDEST_MONTHS,
  percentileFor,
  REFERENCE_TABLES,
  type GrowthQuery,
  type GrowthRefusal,
  type GrowthResult,
} from './index.js';
import { lmsAt, percentileOf, valueAtZ, zScore } from './lms.js';

/**
 * The test that matters here is not that the code does what it did last week.
 * It is that it agrees with the CDC.
 *
 * The reference files carry precomputed percentile columns beside the LMS
 * parameters, so a measurement equal to the published 5th percentile must read
 * back as the 5th - and if it does not, either the parameters were transcribed
 * wrong or the arithmetic is. Both are the kind of wrong that produces a
 * plausible number on a chart somebody acts on.
 */

function resultOf(value: GrowthResult | ReturnType<typeof percentileFor>): GrowthResult {
  if (isRefusal(value)) throw new Error(`expected a result, got ${value.reason}: ${value.detail}`);
  return value;
}

describe('agreement with the published charts', () => {
  /**
   * Every sampled row, in both directions. The tolerance is a tenth of a
   * percentile, which is finer than a chart is read to and coarse enough for the
   * five significant figures the CDC publishes.
   */
  it('reads each published percentile back as the percentile it is', () => {
    expect(PUBLISHED_PERCENTILES.length).toBeGreaterThan(100);

    for (const row of PUBLISHED_PERCENTILES) {
      const query =
        row.measure === 'weight-for-length'
          ? { measure: row.measure, sex: row.sex, value: row.value, lengthCm: row.index }
          : { measure: row.measure, sex: row.sex, value: row.value, ageMonths: row.index };

      const result = resultOf(percentileFor(query));

      expect(
        Math.abs(result.percentile - row.percentile),
        `${row.measure} ${row.sex} at ${String(row.index)}: expected P${String(row.percentile)}, read P${String(result.percentile)}`
      ).toBeLessThan(0.1);
    }
  });

  it('covers both sexes, both sides of the seam, and every measure', () => {
    const measures = new Set(PUBLISHED_PERCENTILES.map((row) => row.measure));
    const sexes = new Set(PUBLISHED_PERCENTILES.map((row) => row.sex));

    expect(measures.size).toBe(6);
    expect(sexes).toEqual(new Set(['male', 'female']));
    expect(PUBLISHED_PERCENTILES.some((row) => row.infant)).toBe(true);
    expect(PUBLISHED_PERCENTILES.some((row) => !row.infant)).toBe(true);
  });

  it('names the chart it used and where the numbers came from', () => {
    const result = resultOf(
      percentileFor({ measure: 'weight-for-age', sex: 'female', value: 12, ageMonths: 24 })
    );

    expect(result.reference).toBe('weightForAge');
    expect(result.source).toContain('cdc.gov');
    expect(result.unit).toBe('kg');
  });
});

describe('the 24-month seam', () => {
  /**
   * The infant charts use recumbent length and the child charts standing height,
   * and a child measures about a centimetre shorter standing up - so the two
   * disagree by design. What matters is that the result says which was used.
   */
  it('uses the infant chart below 24 months and the child chart from 24', () => {
    const below = resultOf(
      percentileFor({ measure: 'weight-for-age', sex: 'male', value: 12, ageMonths: 23.5 })
    );
    const at = resultOf(
      percentileFor({ measure: 'weight-for-age', sex: 'male', value: 12, ageMonths: 24 })
    );

    expect(below.reference).toBe('weightForAgeInfant');
    expect(at.reference).toBe('weightForAge');
    expect(CHILD_CHART_FROM_MONTHS).toBe(24);
  });

  /**
   * Three of the six measures change name across the seam, and that is not a
   * naming accident: they are different measurements taken differently.
   */
  it('refuses a measure that is not charted at the age it was asked about', () => {
    const statureAsInfant = percentileFor({
      measure: 'stature-for-age',
      sex: 'male',
      value: 80,
      ageMonths: 12,
    });
    const lengthAsChild = percentileFor({
      measure: 'length-for-age',
      sex: 'male',
      value: 105,
      // Past 36 months there is no recumbent chart, and the message has to say
      // which measurement to take instead rather than only that this one failed.
      ageMonths: 48,
    });
    const bmiAsInfant = percentileFor({
      measure: 'bmi-for-age',
      sex: 'male',
      value: 17,
      ageMonths: 12,
    });
    const headAsChild = percentileFor({
      measure: 'head-circumference-for-age',
      sex: 'male',
      value: 50,
      ageMonths: 60,
    });

    for (const refusal of [statureAsInfant, lengthAsChild, bmiAsInfant, headAsChild]) {
      expect(isRefusal(refusal)).toBe(true);
      if (isRefusal(refusal)) expect(refusal.reason).toBe('not-measurable');
    }
    // Each names the measurement to take instead, which is the only useful
    // thing to say to somebody holding a tape measure.
    if (isRefusal(statureAsInfant)) expect(statureAsInfant.detail).toContain('length-for-age');
    if (isRefusal(lengthAsChild)) expect(lengthAsChild.detail).toContain('stature-for-age');
    if (isRefusal(bmiAsInfant)) expect(bmiAsInfant.detail).toContain('weight-for-length');
  });

  /**
   * The two infant charts do not end at the same month - length stops at 35.5
   * and head circumference at 36 - so the range is read off each table rather
   * than assumed to be shared. Both refusals below are honest; they differ only
   * in whether the measure is charted at all at that age or merely not that far.
   */
  it('charts length and head circumference to the end of each of their own tables', () => {
    expect(
      isRefusal(
        percentileFor({ measure: 'length-for-age', sex: 'male', value: 95, ageMonths: 35.5 })
      )
    ).toBe(false);
    expect(
      isRefusal(
        percentileFor({
          measure: 'head-circumference-for-age',
          sex: 'male',
          value: 49,
          ageMonths: 36,
        })
      )
    ).toBe(false);

    const pastLength = percentileFor({
      measure: 'length-for-age',
      sex: 'male',
      value: 95,
      ageMonths: 36,
    });
    expect(isRefusal(pastLength) && pastLength.reason).toBe('out-of-range');
  });
});

describe('what it refuses rather than guessing at', () => {
  /**
   * A percentile computed off the end of a reference is not a cautious estimate;
   * it is a number with nothing behind it, printed beside numbers that have.
   */
  it('refuses an age past the oldest chart', () => {
    const refusal = percentileFor({
      measure: 'bmi-for-age',
      sex: 'female',
      value: 22,
      ageMonths: OLDEST_MONTHS + 1,
    });

    expect(isRefusal(refusal)).toBe(true);
    if (isRefusal(refusal)) {
      expect(refusal.reason).toBe('out-of-range');
      expect(refusal.detail).toContain('bmiForAge');
    }
  });

  /**
   * The CDC's child charts run to 240.5 months, not 240, because the rows are
   * the midpoints of month-long bins. A range written from memory would have
   * refused the last row of every chart.
   */
  it('answers at the very last row of the chart', () => {
    expect(OLDEST_MONTHS).toBe(240.5);
    expect(
      isRefusal(
        percentileFor({
          measure: 'bmi-for-age',
          sex: 'female',
          value: 22,
          ageMonths: OLDEST_MONTHS,
        })
      )
    ).toBe(false);
  });

  it('refuses a negative age', () => {
    const refusal = percentileFor({
      measure: 'weight-for-age',
      sex: 'male',
      value: 3,
      ageMonths: -1,
    });

    expect(isRefusal(refusal) && refusal.reason).toBe('out-of-range');
  });

  it('refuses a query with no index to look up', () => {
    const noAge = percentileFor({ measure: 'weight-for-age', sex: 'male', value: 10 });
    const noLength = percentileFor({ measure: 'weight-for-length', sex: 'male', value: 10 });

    expect(isRefusal(noAge) && noAge.reason).toBe('missing-index');
    expect(isRefusal(noLength) && noLength.reason).toBe('missing-index');
    if (isRefusal(noLength)) expect(noLength.detail).toContain('centimetres');
  });

  it('refuses a measurement that is not a positive number', () => {
    for (const value of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const refusal = percentileFor({
        measure: 'weight-for-age',
        sex: 'male',
        value,
        ageMonths: 12,
      });

      expect(isRefusal(refusal) && refusal.reason, String(value)).toBe('not-measurable');
    }
  });

  it('refuses a length outside the weight-for-length chart', () => {
    const refusal = percentileFor({
      measure: 'weight-for-length',
      sex: 'male',
      value: 10,
      lengthCm: 20,
    });

    expect(isRefusal(refusal) && refusal.reason).toBe('out-of-range');
    if (isRefusal(refusal)) expect(refusal.detail).toContain('weightForLengthInfant');
  });
});

describe('interpolation between rows', () => {
  /**
   * The tables are at half-month steps and a child is measured on the day they
   * are measured. Snapping to the nearest row would move a percentile by more
   * than the measurement error the chart exists to see through.
   */
  it('lands between the rows that bracket the age', () => {
    const table = REFERENCE_TABLES.weightForAge;
    expect(table).toBeDefined();

    const low = lmsAt(table!, 'male', 36.5);
    const high = lmsAt(table!, 'male', 37.5);
    const middle = lmsAt(table!, 'male', 37);

    expect(middle?.m).toBeGreaterThan(low?.m ?? 0);
    expect(middle?.m).toBeLessThan(high?.m ?? 0);
    // Halfway between, because the interpolation is linear.
    expect(middle?.m).toBeCloseTo(((low?.m ?? 0) + (high?.m ?? 0)) / 2, 6);
  });

  it('returns a row exactly when the index is one', () => {
    const table = REFERENCE_TABLES.weightForAgeInfant;
    expect(table).toBeDefined();
    const row = table!.male[10];

    expect(lmsAt(table!, 'male', row![0])).toEqual({ l: row![1], m: row![2], s: row![3] });
  });

  it('answers nothing outside the table', () => {
    const table = REFERENCE_TABLES.weightForAgeInfant;

    expect(lmsAt(table!, 'male', -1)).toBeUndefined();
    expect(lmsAt(table!, 'male', 500)).toBeUndefined();
  });
});

describe('the arithmetic itself', () => {
  it('reads the median as the 50th percentile and a z of zero', () => {
    const lms = { l: -0.3, m: 12.5, s: 0.1 };

    expect(zScore(12.5, lms)).toBeCloseTo(0, 10);
    expect(percentileOf(0)).toBeCloseTo(50, 5);
  });

  /**
   * L of exactly zero is the lognormal case and occurs in the published tables.
   * Dividing by it is the bug the branch exists to prevent.
   */
  it('handles an L of exactly zero without dividing by it', () => {
    const lms = { l: 0, m: 10, s: 0.2 };

    expect(zScore(10, lms)).toBe(0);
    expect(zScore(10 * Math.exp(0.2), lms)).toBeCloseTo(1, 10);
    expect(valueAtZ(1, lms)).toBeCloseTo(10 * Math.exp(0.2), 10);
  });

  it('inverts itself, for both L cases', () => {
    for (const lms of [
      { l: -1.6, m: 16.5, s: 0.08 },
      { l: 0, m: 10, s: 0.2 },
      { l: 1.8, m: 3.5, s: 0.15 },
    ]) {
      for (const z of [-3, -1, 0, 1.5, 2.7]) {
        expect(zScore(valueAtZ(z, lms), lms), `${String(lms.l)} at z=${String(z)}`).toBeCloseTo(
          z,
          8
        );
      }
    }
  });

  it('matches the normal distribution at the landmarks', () => {
    expect(percentileOf(-1.96)).toBeCloseTo(2.5, 1);
    expect(percentileOf(-1)).toBeCloseTo(15.87, 1);
    expect(percentileOf(1)).toBeCloseTo(84.13, 1);
    expect(percentileOf(1.96)).toBeCloseTo(97.5, 1);
  });

  it('refuses to score a measurement that is not positive', () => {
    expect(() => zScore(0, { l: 1, m: 10, s: 0.1 })).toThrow(/positive/);
  });

  /**
   * The percentile compresses at the extremes and the z-score does not, which is
   * why both are returned: a child at z -3.4 and one at z -5.1 read as the same
   * percentile and are in quite different situations.
   */
  it('keeps the z-score distinct where the percentile has collapsed', () => {
    const low = resultOf(
      percentileFor({ measure: 'weight-for-age', sex: 'male', value: 5, ageMonths: 60 })
    );
    const lower = resultOf(
      percentileFor({ measure: 'weight-for-age', sex: 'male', value: 4, ageMonths: 60 })
    );

    expect(low.percentile).toBe(lower.percentile);
    expect(low.z).toBeGreaterThan(lower.z);
  });
});

describe('curves, for drawing a chart', () => {
  it('produces a point per row of the table', () => {
    const curve = curveFor('bmi-for-age', 'female', 50);
    const table = REFERENCE_TABLES.bmiForAge;

    expect(curve).toHaveLength(table!.female.length);
    expect(curve[0]?.index).toBe(table!.female[0]?.[0]);
  });

  /**
   * The forward and inverse functions have to agree, or a 50th-percentile line
   * would be drawn where a measurement on it did not read as the 50th
   * percentile.
   */
  it('draws a line every point of which reads back as its own percentile', () => {
    for (const percentile of [5, 50, 95]) {
      for (const point of curveFor('stature-for-age', 'male', percentile)) {
        const read = resultOf(
          percentileFor({
            measure: 'stature-for-age',
            sex: 'male',
            value: point.value,
            ageMonths: point.index,
          })
        );

        expect(read.percentile, `P${String(percentile)} at ${String(point.index)}mo`).toBeCloseTo(
          percentile,
          1
        );
      }
    }
  });

  it('draws the infant curve when asked for one', () => {
    const infant = curveFor('weight-for-age', 'male', 50, { infant: true });
    const child = curveFor('weight-for-age', 'male', 50);

    expect(infant[0]?.index).toBe(0);
    expect(child[0]?.index).toBe(24);
  });

  it('draws the weight-for-length curve, which has no age at all', () => {
    const curve = curveFor('weight-for-length', 'female', 50);

    expect(curve.length).toBeGreaterThan(0);
    expect(curve[0]?.index).toBeGreaterThan(40);
  });

  it('draws nothing for a measure not charted on the side asked for', () => {
    expect(curveFor('bmi-for-age', 'male', 50, { infant: true })).toEqual([]);
  });

  it('refuses a percentile that is not one', () => {
    expect(() => curveFor('bmi-for-age', 'male', 0)).toThrow(/between 0 and 100/);
    expect(() => curveFor('bmi-for-age', 'male', 100)).toThrow(/between 0 and 100/);
  });
});

describe('the reference tables themselves', () => {
  it('carries all seven, each with both sexes and a source', () => {
    const names = Object.keys(REFERENCE_TABLES);

    expect(names).toHaveLength(7);
    for (const name of names) {
      const table = REFERENCE_TABLES[name];
      expect(table?.male.length, name).toBeGreaterThan(30);
      expect(table?.female.length, name).toBeGreaterThan(30);
      expect(table?.source, name).toContain('https://www.cdc.gov/growthcharts');
    }
  });

  it('is sorted by index, which the interpolation walk depends on', () => {
    for (const [name, table] of Object.entries(REFERENCE_TABLES)) {
      for (const rows of [table.male, table.female]) {
        for (let position = 1; position < rows.length; position += 1) {
          expect(rows[position]?.[0], `${name} row ${String(position)}`).toBeGreaterThan(
            rows[position - 1]?.[0] ?? 0
          );
        }
      }
    }
  });
});

/**
 * WHAT THE TYPE PROMISES AND THE RUNTIME CANNOT.
 *
 * `GrowthQuery` says `measure` is one of six strings and `sex` is one of two,
 * and TypeScript holds every call site it compiles to that. This is a published
 * entry point though, and its callers include JavaScript, JSON that arrived over
 * a wire, and a handler that read a column - none of which are checked.
 *
 * Every one of these used to fail SILENTLY. An unrecognised sex fell through to
 * the female table, an unknown measure at a child age fell through to BMI, and a
 * non-finite age read the birth row. Each returned a plausible percentile
 * computed against the wrong reference, printed beside percentiles that were
 * right - which is worse than no answer, because nothing about it looks wrong.
 */
describe('a query whose fields the type promised and the caller did not', () => {
  const valid = { measure: 'weight-for-age', sex: 'female', value: 9, ageMonths: 12 } as const;

  const refusal = (overrides: Record<string, unknown>): GrowthResult | GrowthRefusal =>
    percentileFor({ ...valid, ...overrides } as unknown as GrowthQuery);

  it.each(['', 'weight', 'WEIGHT-FOR-AGE', 'height-for-age', null, undefined, 7])(
    'refuses a measure of %s rather than falling through to another chart',
    (measure) => {
      const answer = refusal({ measure });
      expect(answer).toHaveProperty('reason');
      expect((answer as GrowthRefusal).detail).toContain('not a measure');
    }
  );

  it.each(['', 'Female', 'F', 'other', null, undefined, 1])(
    'refuses a sex of %s rather than charting against the female tables',
    (sex) => {
      const answer = refusal({ sex });
      expect(answer).toHaveProperty('reason');
      expect((answer as GrowthRefusal).detail).toContain('sex-specific');
    }
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, null])(
    'refuses an age of %s rather than reading the birth row',
    (ageMonths) => {
      expect(refusal({ ageMonths })).toHaveProperty('reason');
    }
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    'refuses a length of %s on weight-for-length',
    (lengthCm) => {
      expect(refusal({ measure: 'weight-for-length', lengthCm })).toHaveProperty('reason');
    }
  );

  it('still answers the query it was always able to answer', () => {
    const answer = percentileFor(valid);

    expect(answer).not.toHaveProperty('reason');
    expect((answer as GrowthResult).measure).toBe('weight-for-age');
  });

  /**
   * The silent-fallthrough property, stated directly: a female query and a
   * malformed-sex query must not agree, because they used to.
   */
  it('does not answer a malformed sex the way it answers female', () => {
    expect(refusal({ sex: 'other' })).not.toEqual(percentileFor({ ...valid, sex: 'female' }));
  });
});
