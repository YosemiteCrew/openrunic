import { expect, test } from '@playwright/test';

/**
 * THE INBOX ROW KEEPS A COLUMN YOU CAN READ
 *
 * The inbox row is a grid: a stream label, the reading column (patient,
 * subject, preview, received), the state chips, and the row's action. Three of
 * those four are sized to their content or to a fixed width, and the reading
 * column takes what is left - so it is the one that gets starved, and it is the
 * one carrying the words.
 *
 * This existed: the four-track rule was switched on by a viewport media query
 * while the row's width is decided by its CONTAINER, and in this shell the
 * navigation and the page-context rail take about 550px before the list gets
 * any. A 1440px window left the reading column 133px and a 1024px window left
 * it 69px, which broke patient names mid-word - and because the rule engaged at
 * 1024px and never fitted at any width this shell produces, the screen got
 * worse as the window got wider. Below 1024px, where the row stacked, it was
 * fine.
 *
 * So the invariant is about the column rather than about the rule that sizes
 * it: whatever the layout does at this viewport, the reading column is either
 * at least as wide as a sentence, or it is the whole row (the stacked layout,
 * where there is nothing beside it to starve it). Both are correct; a 133px
 * ribbon beside 588px of fixed columns is not.
 *
 * Runs at every viewport in the config, which is the point - the failure this
 * catches is a desktop failure, and a suite that only checked the narrow end
 * would have called it green.
 */

/**
 * What a sentence needs. Not a design token: it is the floor the row's own
 * `minmax()` declares, restated here so this test fails when the layout stops
 * honouring it rather than when someone edits the number in two places.
 */
const READING_FLOOR_PX = 272;

interface RowMeasurement {
  readonly rowWidth: number;
  readonly readingWidth: number | null;
  readonly tracks: string;
}

test('the inbox reading column is never starved by the columns beside it', async ({ page }) => {
  await page.goto('/inbox');

  // Client-rendered: wait for the skeleton to go rather than for a timeout.
  await expect(page.getByRole('status').filter({ hasText: /^Loading/ })).toHaveCount(0, {
    timeout: 20_000,
  });

  // By role, not by class: a renamed row class then finds nothing and the count
  // assertion below fails loudly, rather than this passing over zero rows.
  const rows = page.getByRole('list', { name: 'Inbox items' }).getByRole('listitem');
  await expect(rows.first()).toBeVisible();

  const measurements = await rows.evaluateAll((elements): RowMeasurement[] =>
    elements.map((element) => {
      const reading = element.querySelector('.or-inbox__body');
      return {
        rowWidth: element.getBoundingClientRect().width,
        readingWidth: reading === null ? null : reading.getBoundingClientRect().width,
        tracks: getComputedStyle(element).gridTemplateColumns,
      };
    })
  );

  expect(measurements.length, 'the inbox rendered no rows, so this proved nothing').toBeGreaterThan(
    0
  );

  for (const [index, row] of measurements.entries()) {
    expect(
      row.readingWidth,
      `row ${String(index)} has no reading column; the markup moved and this test is now blind`
    ).not.toBeNull();

    // Stacked rows are narrower than the floor and correct: there is nothing
    // beside the column to take width from it.
    const floor = Math.min(READING_FLOOR_PX, Math.floor(row.rowWidth));

    expect(
      Math.round(row.readingWidth ?? 0),
      `row ${String(index)} reads in ${String(Math.round(row.readingWidth ?? 0))}px of a ${String(
        Math.round(row.rowWidth)
      )}px row. Tracks: ${row.tracks}`
    ).toBeGreaterThanOrEqual(floor);
  }
});
