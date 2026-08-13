import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  stories: ['../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs'],
  typescript: {
    // Prop tables come from the exported prop interfaces, so every story page documents
    // the real typed API rather than a hand-written copy of it.
    reactDocgen: 'react-docgen-typescript',
  },
};

export default config;
