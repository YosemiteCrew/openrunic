import '@testing-library/jest-dom/vitest';

// jsdom does no layout, so it ships no `scrollIntoView`. The combobox surfaces
// call it to keep the active option visible while the arrow keys move, and
// without a stub every one of those key presses would throw.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {};
}
