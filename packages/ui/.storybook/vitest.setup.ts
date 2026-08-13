import * as a11yAddonAnnotations from '@storybook/addon-a11y/preview';
import { setProjectAnnotations } from '@storybook/react-vite';
import { beforeAll } from 'vitest';
import previewAnnotations from './preview';

/*
 * Setup for the story suite (vitest.storybook.config.ts).
 *
 * The a11y addon's annotations have to come first so its axe run wraps every story; the
 * preview annotations then apply the same decorators, globals and parameters the workshop
 * uses, which is what makes a passing story test mean "this is how it looks in Storybook".
 */
const annotations = setProjectAnnotations([a11yAddonAnnotations, previewAnnotations]);

beforeAll(annotations.beforeAll);
