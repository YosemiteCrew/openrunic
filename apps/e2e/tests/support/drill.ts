import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { scanForAccessibility } from './axe.js';

/**
 * The drill's narration.
 *
 * This suite is the acceptance test for the whole product, which means the
 * person reading a failure is usually not the person who wrote the test, and
 * often not the person who wrote the code either. So every step announces the
 * clinical act it performs - "check the patient in", not "click button #4" -
 * and a failure says which act broke and what the screen was showing instead.
 */

export interface StepContext {
  readonly page: Page;
  readonly testInfo: TestInfo;
}

/**
 * Runs one step of the clinical day.
 *
 * Wraps the body in a Playwright step so the trace reads as a clinical
 * narrative, and rewrites any failure to name the act rather than the selector.
 */
export async function clinicalStep(
  name: string,
  context: StepContext,
  body: () => Promise<void>
): Promise<void> {
  await test.step(name, async () => {
    try {
      await body();
    } catch (error) {
      const url = context.page.url();
      const heading = await context.page
        .getByRole('heading', { level: 1 })
        .first()
        .textContent()
        .catch(() => null);

      throw new Error(
        [
          '',
          `THE CLINICAL DAY BROKE AT: ${name}`,
          '',
          `  screen   ${url}`,
          `  heading  ${heading ?? '(no level-1 heading rendered)'}`,
          '',
          '  Underlying failure:',
          `  ${error instanceof Error ? error.message : String(error)}`,
          '',
        ].join('\n'),
        { cause: error }
      );
    }
  });
}

/**
 * Navigates to a screen and asserts it is accessible before doing anything.
 *
 * The scan happens on arrival rather than at the end, so a violation is
 * attributed to the screen that has it rather than to whatever the drill was
 * doing when it finally ran out of patience.
 */
export async function visit(
  context: StepContext,
  path: string,
  screenName: string,
  allow: readonly string[] = []
): Promise<void> {
  await context.page.goto(path);
  // Screens are client-rendered and paint a skeleton first. Waiting for the
  // loading status to go rather than for a timeout keeps this fast when the app
  // is fast and correct when it is slow.
  await expect(context.page.getByRole('status').filter({ hasText: /^Loading/ })).toHaveCount(0, {
    timeout: 20_000,
  });
  await scanForAccessibility(context.page, screenName, context.testInfo, { allow });
}

/**
 * Opens the navigation on viewports where it is collapsed.
 *
 * Below 1024 CSS width the rail is display:none until the Menu button is
 * pressed, and while it is open the panel is a dialog rather than a nav. A
 * drill that only ever ran at desktop width would never touch that code path,
 * which is exactly where a mobile regression would hide.
 */
export async function openNavigation(page: Page): Promise<void> {
  const menu = page.getByRole('button', { name: 'Menu' });
  if ((await menu.count()) === 0) return;
  if (!(await menu.isVisible())) return;
  await menu.click();
}

/** Confirms a toast said what the workflow was supposed to have done. */
export async function expectToast(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.getByRole('status').filter({ hasText: text }).first()).toBeVisible();
}

/**
 * Picks a `<select>` option by the text it shows.
 *
 * `selectOption({ label })` takes only an exact string, and several of these
 * pickers compose their labels from data ("Patientsson, Tess (OR-100482)",
 * "Patientsson, Tess  $38.00"). Hardcoding the full string couples the drill to
 * a balance or an MRN that fixture edits are free to change, and produces a
 * failure that reads as a broken workflow rather than a moved label. Matching
 * the option and selecting by its value avoids both.
 */
export async function selectOptionByText(
  page: Page,
  selectLabel: string,
  optionText: string | RegExp
): Promise<void> {
  const select = page.getByLabel(selectLabel, { exact: true });
  const option = select.locator('option').filter({ hasText: optionText }).first();

  await expect(
    option,
    `No option matching ${String(optionText)} in the "${selectLabel}" picker.`
  ).toHaveCount(1);

  const value = await option.getAttribute('value');
  await select.selectOption(value ?? (await option.innerText()));
}
