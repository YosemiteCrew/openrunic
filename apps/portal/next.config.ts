import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typedRoutes: true,
  // `next dev` otherwise writes its own AGENTS.md and CLAUDE.md into this directory on
  // every run. The repo keeps one pair of those files at the root and requires them to
  // stay in sync; a second, app-local pair saying something different is worse than none.
  agentRules: false,
  // @openrunic/ui ships untranspiled ES modules with a side-effect stylesheet; Next has
  // to compile it in the app's own pipeline rather than treat it as a prebuilt dependency.
  transpilePackages: ['@openrunic/ui'],
};

export default nextConfig;
