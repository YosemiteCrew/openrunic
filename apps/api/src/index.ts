import { serve } from '@hono/node-server';

import { createApp, type CreateAppOptions } from './app.js';
import { createOidcPrincipalResolver } from './auth/oidc-resolver.js';
import { oidcSettings, parseEnv } from './env.js';

const env = parseEnv();
const oidc = oidcSettings(env);

/**
 * The real token verifier is installed when, and only when, the deployment
 * configured an issuer. Without one the app falls back to its development
 * defaults, and `createApp` refuses those under `NODE_ENV=production`, so a
 * production process either verifies signed tokens or fails to start.
 */
const options: CreateAppOptions =
  oidc === undefined
    ? {}
    : {
        principalResolver: createOidcPrincipalResolver({
          issuer: oidc.issuer,
          audience: oidc.audience,
          jwksUri: oidc.jwksUri,
          clockSkewSeconds: oidc.clockSkewSeconds,
        }),
      };

const app = createApp(options);

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`openrunic-api listening on port ${String(info.port)}`);
});
