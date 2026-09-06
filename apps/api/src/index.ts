import { serve } from '@hono/node-server';
import { AdapterRegistry } from '@openrunic/adapters';

import { createApp, type CreateAppOptions } from './app.js';
import { createOidcPrincipalResolver } from './auth/oidc-resolver.js';
import { oidcSettings, parseEnv, smartLaunchSettings } from './env.js';
import {
  announceAuthentication,
  buildServerWiring,
  parseWiringEnv,
  type ServerWiring,
} from './server/wiring.js';

const env = parseEnv();
const oidc = oidcSettings(env);

/**
 * Read outside the wiring branch below because it is not a production concern.
 * A developer pointing a SMART app at a local API needs the launch published
 * just as much as a real install does, and the document is the only place an
 * app can learn where to go.
 */
const smartLaunch = smartLaunchSettings(env);

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
 * this repository, granting full access to the seeded tenant. The boot log says
 * so - announced below rather than by the wiring, because the wiring builds
 * that resolver whether or not this file goes on to use it.
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
    ? { smartLaunch }
    : {
        smartLaunch,
        // Empty, and that is a real answer rather than a gap: this deployment
        // does not do video, so every telehealth route says 501 rather than
        // opening a room at an address that can never resolve. `createApp`
        // refuses to fall back to its development registry under
        // NODE_ENV=production, which is why this is passed explicitly. A
        // deployment with a vendor registers it here and awaits its `init`
        // before `serve` is called.
        adapters: new AdapterRegistry(),
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

/**
 * Announce which resolver is in force. The choice itself lives in
 * `announceAuthentication` so that it is reachable from a test - see the comment
 * there, and #307, which was a defect of composition rather than of any layer.
 */
announceAuthentication(wiring, oidc?.issuer);

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
