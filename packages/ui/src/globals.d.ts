/* Stylesheets are side-effect imports resolved by Vite, not by TypeScript. Only
   src/index.ts imports one; component modules register their CSS in
   src/components/_index.css instead. */
declare module '*.css';
