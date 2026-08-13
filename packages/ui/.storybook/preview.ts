import type { Preview } from '@storybook/react-vite';
import '../src/styles/index.css';

/* Literal hexes only because the backgrounds addon needs a resolved colour, not a custom
   property. They are --bone, --cream and --espresso from tokens/colors.css; if those ever
   change, change these with them. */
const BONE = '#F5EFE6';
const CREAM = '#EDE4D3';
const ESPRESSO = '#2E211A';

const preview: Preview = {
  parameters: {
    layout: 'padded',
    /* 'error' turns an axe violation into a failing story test rather than a panel someone
       has to remember to open. Every story is checked; a story that needs an exception says
       so in its own `a11y.config.rules` entry with the reason, never here. */
    a11y: { test: 'error' },
    backgrounds: {
      options: {
        bone: { name: 'Bone (page)', value: BONE },
        cream: { name: 'Cream (card)', value: CREAM },
        espresso: { name: 'Espresso (band)', value: ESPRESSO },
      },
    },
    viewport: {
      options: {
        mobile: { name: 'Mobile (375)', styles: { width: '375px', height: '812px' } },
        tablet: { name: 'Tablet (768)', styles: { width: '768px', height: '1024px' } },
        desktop: { name: 'Desktop (1440)', styles: { width: '1440px', height: '900px' } },
      },
    },
    controls: { expanded: true },
  },
  initialGlobals: {
    backgrounds: { value: 'bone' },
    viewport: { value: 'desktop', isRotated: false },
  },
};

export default preview;
