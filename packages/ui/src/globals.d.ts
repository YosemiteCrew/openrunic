/* Stylesheets are side-effect imports resolved by Vite, not by TypeScript. Only
   src/index.ts imports one; component modules register their CSS in
   src/components/_index.css instead. */
declare module '*.css';

/* Brand SVGs are imported as source text and encoded into data URIs by src/assets/brand.ts,
   so the mark travels inside the bundle and no component ever fetches one at runtime. The
   `?raw` suffix is deliberate: a plain asset import would leave the inlining decision to
   Vite's per-environment size heuristic. Only src/assets/brand.ts imports these. */
declare module '*.svg?raw' {
  const source: string;
  export default source;
}
