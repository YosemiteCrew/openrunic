import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/*
 * Story tests, kept in their own config on purpose.
 *
 * vitest.config.ts is the jsdom unit suite that carries the coverage floors; this one runs
 * every CSF3 story in a real Chromium through Storybook's Vitest addon. Two runners, two
 * environments, one shared component tree. Merging them into a single `projects` config would
 * fold story files into the coverage denominator and move the floors for reasons that have
 * nothing to do with test quality.
 *
 * `test.include` is deliberately absent: the addon derives it from the `stories` glob in
 * .storybook/main.ts and warns if a config overrides it, so the story set can never drift
 * between the workshop and the suite.
 */
const configDir = fileURLToPath(new URL('./.storybook', import.meta.url));

export default defineConfig({
  plugins: [storybookTest({ configDir, storybookUrl: 'http://localhost:6007' })],
  test: {
    name: 'storybook',
    setupFiles: ['./.storybook/vitest.setup.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      // One pinned browser, one fixed viewport. The desktop viewport matches the
      // `initialGlobals` in .storybook/preview.ts, so a story renders the same width in the
      // suite as it does in the workshop, and stories that set their own viewport global
      // still override it per story.
      instances: [{ browser: 'chromium', viewport: { width: 1440, height: 900 } }],
    },
  },
});
