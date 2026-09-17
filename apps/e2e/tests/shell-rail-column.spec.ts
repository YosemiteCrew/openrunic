import { expect, test } from '@playwright/test';

/**
 * A SCREEN WITHOUT A CONTEXT RAIL GETS THE RAIL'S WIDTH
 *
 * The shell's right rail is optional: `AppShell` renders the `aside` only when
 * a screen passes one, and the admin screens pass none. The stylesheet used to
 * reserve its column anyway, so those screens laid out inside a track that was
 * 320px narrower than the landmark they were in - width spent on an element
 * that was never rendered. On the form builder that took the canvas, the pane
 * you are actually building, down to 203px between two reference panes of 260px
 * and 300px.
 *
 * The invariant is not about the rail's width or the breakpoint, either of
 * which is free to change. It is that the page occupies the landmark it is in
 * unless something else is in there with it.
 */

/**
 * Sub-pixel rounding and the odd fractional gutter, nothing more. A reserved
 * rail is 320px, so this cannot pass one by accident.
 */
const ROUNDING_SLACK_PX = 2;

test('a screen with no context rail is not laid out around one', async ({ page }) => {
  await page.goto('/admin/forms');

  await expect(page.getByRole('status').filter({ hasText: /^Loading/ })).toHaveCount(0, {
    timeout: 20_000,
  });

  const measured = await page.evaluate(() => {
    const main = document.querySelector('main');
    const rail = main?.querySelector(':scope > .or-app__rail') ?? null;
    const pageColumn = main?.querySelector(':scope > .or-app__page') ?? null;
    if (main === null || pageColumn === null) return null;

    const style = getComputedStyle(main);
    const contentWidth =
      main.getBoundingClientRect().width -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight);

    return {
      hasRail: rail !== null,
      contentWidth,
      pageWidth: pageColumn.getBoundingClientRect().width,
      tracks: style.gridTemplateColumns,
    };
  });

  expect(
    measured,
    'the shell markup moved: no main landmark or no page column, so this test is blind'
  ).not.toBeNull();

  // The screen under test is chosen because it passes no rail. If it starts
  // passing one, this is measuring something else and should be pointed at a
  // screen that still does not.
  expect(measured?.hasRail, 'the form builder now renders a context rail').toBe(false);

  expect(
    Math.round(measured?.pageWidth ?? 0),
    `the page has ${String(Math.round(measured?.pageWidth ?? 0))}px of a ${String(
      Math.round(measured?.contentWidth ?? 0)
    )}px landmark with no rail in it. Tracks: ${measured?.tracks ?? '(none)'}`
  ).toBeGreaterThanOrEqual(Math.round((measured?.contentWidth ?? 0) - ROUNDING_SLACK_PX));
});
