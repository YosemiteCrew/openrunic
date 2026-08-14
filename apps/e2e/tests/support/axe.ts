import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';

/**
 * Accessibility assertions, run on every screen the drill visits.
 *
 * A violation is reported as the element and the fix, not as a rule id. An
 * accessibility failure that reads `landmark-unique` sends the reader to a
 * search engine; one that quotes the offending HTML and says what to do sends
 * them to the file.
 */

/** WCAG 2.1 AA, which is the level the product commits to. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

export interface ScanOptions {
  /**
   * Rules to record but not fail on.
   *
   * Every entry needs a reason and an owner. This is a list of things known to
   * be wrong that someone has decided not to fix yet - it is not a place to put
   * a violation because it is inconvenient, and a scan with an empty list is
   * the goal.
   */
  readonly allow?: readonly string[];
}

export async function scanForAccessibility(
  page: Page,
  screen: string,
  testInfo: TestInfo,
  options: ScanOptions = {}
): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

  const allowed = new Set(options.allow ?? []);
  const failures = results.violations.filter((violation) => !allowed.has(violation.id));
  const tolerated = results.violations.filter((violation) => allowed.has(violation.id));

  // Attached whether or not the scan passed, so the trend is visible in the
  // report even while a known issue is still on the allow list.
  await testInfo.attach(`axe-${screen.replace(/\W+/g, '-')}.json`, {
    body: JSON.stringify(
      { screen, violations: results.violations, tolerated: tolerated.map((v) => v.id) },
      null,
      2
    ),
    contentType: 'application/json',
  });

  if (failures.length === 0) return;

  const report = failures
    .map((violation) => {
      const nodes = violation.nodes
        .slice(0, 3)
        .map((node) => `      ${node.html.slice(0, 160)}\n        ${node.failureSummary ?? ''}`)
        .join('\n');
      return [
        `  ${violation.impact ?? 'unknown'}: ${violation.help}`,
        `    rule ${violation.id}  (${String(violation.nodes.length)} element(s))`,
        nodes,
      ].join('\n');
    })
    .join('\n\n');

  // Soft, deliberately. A hard assertion here stops the test at the first
  // screen, so a contrast regression hides every clinical step behind it and
  // the run reports an accessibility problem as though the workflow were
  // broken. Soft failures still fail the test - they just let it finish first,
  // so one run tells you everything that is wrong rather than the first thing.
  expect
    .soft(
      failures,
      `Accessibility violations on "${screen}":\n\n${report}\n\nEach one is a person who cannot use this screen.`
    )
    .toEqual([]);
}
