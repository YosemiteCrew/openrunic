/**
 * Ids the tab strip and its panels must agree on.
 *
 * Shared rather than owned by `ChartTabs` because the screens that render the
 * panels compute the same strings to wire `aria-controls` and
 * `aria-labelledby`, and a tab pointing at a panel id nobody stamped is an
 * accessibility failure no test of either half would catch.
 */

export function tabId(prefix: string, id: string): string {
  return `${prefix}-tab-${id}`;
}

export function panelId(prefix: string, id: string): string {
  return `${prefix}-panel-${id}`;
}
