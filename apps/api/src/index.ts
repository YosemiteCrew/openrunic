import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { parseEnv } from './env.js';

const env = parseEnv();
const app = createApp();

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`openrunic-api listening on port ${String(info.port)}`);
});
