import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/*
 * WHY THE TWO NOTICES CANNOT BE IMPORTED FROM THE DESIGN SYSTEM DIRECTLY.
 *
 * `Alert` and `Toast` say three words of their own: the dismiss control's
 * accessible name and, per tone, the word a screen reader hears before the body.
 * `packages/ui` has no translator, so it defaults them to English and takes them
 * as props. `components/state/Notices.tsx` is the one place that supplies them
 * from the catalogue.
 *
 * A screen importing the component straight from `@openrunic/ui` gets those
 * English defaults back. That failure is silent in the worst way: `.or-alert__tone`
 * is clipped to 1x1, so the wrong word is invisible to a sighted reviewer and to
 * every screenshot, and the only reader who meets it is the one it exists for -
 * announced in English inside whatever `lang` the page carries. #312.
 *
 * The wrapper's docblock already claimed this property ("a new notice cannot be
 * added without the label coming with it"). It was true by convention and nothing
 * enforced it, so this rule is that sentence made checkable.
 *
 * NAMES, NOT THE MODULE. `AlertTone`, `ToastTone`, `AlertProps` and `ToastProps`
 * are types with no words in them, and screens legitimately import `ToastTone` to
 * hold a tone in state. Banning the module would break three call sites that are
 * doing nothing wrong.
 */
const NOTICE_COMPONENTS_VIA_WRAPPER = {
  name: '@openrunic/ui',
  importNames: ['Alert', 'Toast'],
  message:
    'Import Alert and Toast from @/components/state, which supplies closeLabel and toneLabel from the catalogue. Imported from here they announce English to a screen reader on every page. See #312. (Types like ToastTone are fine from @openrunic/ui.)',
};

const eslintConfig = [
  { ignores: ['.next/**', 'coverage/**', 'node_modules/**', 'next-env.d.ts'] },
  ...nextVitals,
  ...nextTs,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { paths: [NOTICE_COMPONENTS_VIA_WRAPPER] }],
    },
  },
  {
    // The wrapper is the exception it exists to create: it is the one module that
    // must reach the design system directly, because it is what adds the words.
    files: ['src/components/state/Notices.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  },
];

export default eslintConfig;
