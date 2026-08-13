import { serve } from '@hono/node-server';

import { createApp, type CreateAppOptions } from './app.js';
import { createOidcPrincipalResolver } from './auth/oidc-resolver.js';
import { oidcSettings, parseEnv } from './env.js';
import { buildServerWiring, parseWiringEnv, type ServerWiring } from './server/wiring.js';

const env = parseEnv();
const oidc = oidcSettings(env);

/**
 * Development keeps `createApp`'s defaults - an in-memory store and the demo
 * token table - so the API runs with no database at all. Production has to say
 * what it talks to, and `createApp` refuses to start if it does not.
 */
const wiring: ServerWiring | null =
  env.NODE_ENV === 'production' ? buildServerWiring(parseWiringEnv()) : null;

/**
 * Which verifier checks the token, and why the order is this way round.
 *
 * `buildServerWiring` always supplies a principal resolver, but in the absence
 * of an issuer that resolver is the demo one: a short list of tokens printed in
 * this repository, granting full access to the seeded tenant. It announces
 * itself in the boot log for exactly that reason.
 *
 * So a configured issuer takes precedence over it. A deployment that set one
 * gets real signature verification even though the wiring offered a resolver of
 * its own, and a deployment that set none keeps the loud demo resolver rather
 * than silently getting a stricter one. The two were merged in the wrong order
 * once during a rebase, which would have replaced token verification with the
 * demo table on every production install.
 */
const options: CreateAppOptions =
  wiring === null
    ? {}
    : {
        repositories: wiring.repositories,
        auditSink: wiring.auditSink,
        readiness: wiring.readiness,
        principalResolver:
          oidc === undefined
            ? wiring.principalResolver
            : createOidcPrincipalResolver({
                issuer: oidc.issuer,
                audience: oidc.audience,
                jwksUri: oidc.jwksUri,
                clockSkewSeconds: oidc.clockSkewSeconds,
              }),
      };

const app = createApp(options);

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`openrunic-api listening on port ${String(info.port)}`);
});

/**
 * Graceful shutdown.
 *
 * A container runtime sends SIGTERM and then waits a fixed grace period before
 * SIGKILL. Without this the process dies mid-request on every deploy and every
 * `docker compose restart` - and for this API that means a write whose audit
 * event is already committed but whose response never reached the caller.
 */
const shutdown = (signal: string): void => {
  console.log(`openrunic-api received ${signal}, shutting down`);
  server.close(() => {
    void (wiring?.close() ?? Promise.resolve()).finally(() => {
      process.exit(0);
    });
  });
};

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
