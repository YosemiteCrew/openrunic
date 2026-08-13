import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// eslint-config-next 16 ships flat-config arrays natively; no FlatCompat.
const eslintConfig = [
  { ignores: ['.next/**', 'coverage/**', 'node_modules/**', 'next-env.d.ts'] },
  ...nextVitals,
  ...nextTs,
];

export default eslintConfig;
