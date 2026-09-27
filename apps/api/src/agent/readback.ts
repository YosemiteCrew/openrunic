import { Hono, type Context } from 'hono';
import { z } from 'zod';

import type { Principal } from '../auth/principal.js';
import type { AppEnv } from '../context.js';
import { ApiError } from '../errors.js';
import { problemDocumentSchema } from '../http/problem.js';
import { parseJsonBody } from '../http/validate.js';
import { assertCareRelationship } from '../middleware/policy.js';
import type { RouteContract } from '../openapi/registry.js';

/**
 * A short-lived credential for a hosted text-to-speech service, minted
 * here so that the service's own key never reaches a browser.
 *
 * The voice package's hosted readback adapter (`@openrunic/voice`) holds the
 * rules for what a session may carry once it is open: audio playback only,
 * nothing the service says on its own. This file holds the rules for whether a
 * session may be opened at all, and they are the checks the rest of the product
 * already makes, applied before the credential exists rather than after:
 *
 * - **Default off, twice over.** Nothing is mounted unless the assistant itself
 *   is enabled AND a deployer has supplied a minter AND the environment names
 *   the endpoint and the agreement that covers it. Readback fills the
 *   assistant's box; without the assistant there is no box to fill.
 * - **Named egress (ADR-0005 rule 6).** The endpoint and a separate
 *   acknowledgement naming the executed agreement and the responsible party.
 *   One variable must not be able to start a patient's data travelling.
 * - **The minter is told a language, a surface and a lifetime.** Not who is
 *   asking, not whose chart is open, and not a tool list: the request type has
 *   no field a tool could travel in, so a minter cannot be handed one, and the
 *   body schema is strict, so a client that asks for one - tools, instructions,
 *   a model, a voice - is refused rather than quietly ignored.
 * - **Short-lived, enforced here.** A minter that hands back a credential
 *   living longer than the configured ceiling, or one already expired, is a
 *   misconfigured minter and the credential is not passed on.
 * - **A per-tenant daily ceiling on sessions.** Every session is metered audio
 *   on someone's account. Like the assistant's own budget, the ceiling lives in
 *   this process and degrades readback to unavailable while typing, and every
 *   clinical workflow, carries on.
 */

export const READBACK_ENV = {
  endpoint: 'OPENRUNIC_READBACK_ENDPOINT',
  agreement: 'OPENRUNIC_READBACK_PHI_EGRESS_AGREEMENT',
  responsibleParty: 'OPENRUNIC_READBACK_PHI_EGRESS_RESPONSIBLE_PARTY',
  languages: 'OPENRUNIC_READBACK_LANGUAGES',
  maxTtlSeconds: 'OPENRUNIC_READBACK_MAX_TTL_SECONDS',
  dailySessions: 'OPENRUNIC_READBACK_DAILY_SESSIONS',
} as const;

export const DEFAULT_READBACK_MAX_TTL_SECONDS = 300;
export const DEFAULT_READBACK_DAILY_SESSIONS = 500;
/** Ten minutes. Past that a credential is not short-lived, whatever the deployer set. */
const CEILING_TTL_SECONDS = 600;

export interface ReadbackConfig {
  endpoint: string;
  agreement: string;
  responsibleParty: string;
  languages: readonly string[];
  maxTtlSeconds: number;
  dailySessions: number;
}

export type ReadbackSubsystem =
  | { status: 'disabled'; reason: string }
  | { status: 'misconfigured'; reason: string }
  | { status: 'enabled'; config: ReadbackConfig };

/** What a minter is told. Deliberately nothing that identifies a person or a record. */
export interface ReadbackMintRequest {
  language: string;
  surface: 'staff' | 'patient';
  /** The longest the credential may live. A minter may choose shorter, never longer. */
  expiresInSeconds: number;
}

export interface MintedReadbackSession {
  /** Opaque to this API, handed to the browser once and never stored or logged. */
  credential: string;
  expiresAt: Date;
}

/** The deployer's half: holds the vendor key, asks the vendor for a scoped session. */
export interface ReadbackSessionMinter {
  mint(request: ReadbackMintRequest): Promise<MintedReadbackSession>;
}

/**
 * Reads the readback configuration. Total, like the assistant's: a broken
 * readback setting reports a state, it does not stop the API starting.
 */
export function loadReadbackSubsystem(
  env: Readonly<Record<string, string | undefined>>
): ReadbackSubsystem {
  const endpoint = trimmed(env[READBACK_ENV.endpoint]);
  if (endpoint === undefined) {
    return {
      status: 'disabled',
      reason: 'No hosted readback endpoint is configured. This is the default.',
    };
  }

  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:') {
      return {
        status: 'misconfigured',
        reason: `${READBACK_ENV.endpoint} must be https: data does not travel in the clear.`,
      };
    }
  } catch {
    return { status: 'misconfigured', reason: `${READBACK_ENV.endpoint} is not a URL.` };
  }

  const agreement = trimmed(env[READBACK_ENV.agreement]);
  const responsibleParty = trimmed(env[READBACK_ENV.responsibleParty]);
  if (agreement === undefined || responsibleParty === undefined) {
    return {
      status: 'misconfigured',
      reason: `Sending text to ${endpoint} requires ${READBACK_ENV.agreement} and ${READBACK_ENV.responsibleParty}. One variable must not be able to start health data flowing.`,
    };
  }

  const languages = (trimmed(env[READBACK_ENV.languages]) ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
  if (languages.length === 0) {
    return {
      status: 'misconfigured',
      reason: `${READBACK_ENV.languages} must name the languages the configured service speaks.`,
    };
  }

  const maxTtlSeconds = readPositive(
    env[READBACK_ENV.maxTtlSeconds],
    DEFAULT_READBACK_MAX_TTL_SECONDS
  );
  if (maxTtlSeconds === undefined || maxTtlSeconds > CEILING_TTL_SECONDS) {
    return {
      status: 'misconfigured',
      reason: `${READBACK_ENV.maxTtlSeconds} must be a whole number of seconds from 1 to ${String(CEILING_TTL_SECONDS)}.`,
    };
  }

  const dailySessions = readPositive(
    env[READBACK_ENV.dailySessions],
    DEFAULT_READBACK_DAILY_SESSIONS
  );
  if (dailySessions === undefined) {
    return {
      status: 'misconfigured',
      reason: `${READBACK_ENV.dailySessions} must be a positive whole number.`,
    };
  }

  return {
    status: 'enabled',
    config: {
      endpoint,
      agreement,
      responsibleParty,
      languages,
      maxTtlSeconds,
      dailySessions,
    },
  };
}

const sessionBodySchema = z.strictObject({
  /** BCP-47. Matched on its primary subtag, the same rule the readback adapter uses. */
  language: z.string().min(2).max(35),
  /**
   * The chart the caller has open, if any. Checked, never forwarded: the minter
   * is not told it. A token that names its own chart does not need it, and a
   * different one here is refused rather than ignored.
   */
  chartPatientId: z.uuid().optional(),
});

const sessionResponseSchema = z.strictObject({
  endpoint: z.string(),
  credential: z.string(),
  expiresAt: z.string(),
  language: z.string(),
  /** What the client's readback adapter requires before it will open anything. */
  agreement: z.string(),
});

export const readbackRouteContracts: RouteContract[] = [
  {
    method: 'post',
    path: '/bff/v0/agent/readback/sessions',
    operationId: 'mintReadbackSession',
    summary: 'Mint a short-lived credential for hosted text-to-speech.',
    description:
      'Readback only. The request may name a language and the open chart and nothing else; a request for tools, instructions or a model is refused. The credential is short-lived and is not stored.',
    tags: ['agent'],
    body: sessionBodySchema,
    responses: [
      { status: 200, description: 'A session credential.', schema: sessionResponseSchema },
      { status: 401, description: 'No usable bearer token.', schema: problemDocumentSchema },
      {
        status: 404,
        description: 'The named chart is not one this caller may open.',
        schema: problemDocumentSchema,
      },
      {
        status: 409,
        description: "This practice's daily readback allowance is spent.",
        schema: problemDocumentSchema,
      },
      { status: 422, description: 'The body failed validation.', schema: problemDocumentSchema },
      {
        status: 502,
        description: 'The readback service did not issue a usable credential.',
        schema: problemDocumentSchema,
      },
    ],
  },
];

export interface ReadbackRoutesOptions {
  config: ReadbackConfig;
  minter: ReadbackSessionMinter;
  now: () => Date;
}

export function readbackRoutes(options: ReadbackRoutesOptions): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  const { config, minter, now } = options;
  const ledger = new Map<string, { day: string; count: number }>();

  router.post('/agent/readback/sessions', async (c) => {
    const principal = requirePrincipal(c);
    const body = await parseJsonBody(c, sessionBodySchema);

    const language = config.languages.find(
      (tag) => primarySubtag(tag) === primarySubtag(body.language)
    );
    if (language === undefined) {
      throw ApiError.validation('The configured service does not speak this language.', [
        { path: 'language', message: `expected one of ${config.languages.join(', ')}` },
      ]);
    }

    if (body.chartPatientId !== undefined) await assertChart(c, principal, body.chartPatientId);

    const instant = now();
    const day = instant.toISOString().slice(0, 10);
    const spent = ledger.get(principal.tenantId);
    const count = spent?.day === day ? spent.count : 0;
    if (count >= config.dailySessions) {
      await c.get('audit')?.denial({
        action: 'agent.readbackSession',
        targetType: 'ReadbackSession',
        metadata: { reason: 'daily-session-budget-exhausted' },
      });
      throw ApiError.conflict(
        "This practice's readback allowance for today is spent. The device's voice still works.",
        { title: 'daily-session-budget-exhausted' }
      );
    }

    /* Taken now, before the first await, and given back if no credential goes
       out. Counting only after the mint let every request overlapping a slow
       vendor read the same count and pass the check together, so under load
       the ceiling held nothing. The check above and this line run with no
       await between them, which is the whole of the lock. */
    ledger.set(principal.tenantId, { day, count: count + 1 });
    const giveBack = () => {
      const held = ledger.get(principal.tenantId);
      // A slot taken yesterday is not returned to today's allowance.
      if (held?.day === day) ledger.set(principal.tenantId, { day, count: held.count - 1 });
    };

    const surface = principal.actorType === 'patient' ? 'patient' : 'staff';
    let minted: MintedReadbackSession;
    try {
      minted = await minter.mint({ language, surface, expiresInSeconds: config.maxTtlSeconds });
    } catch {
      giveBack();
      // The vendor's message is not passed on: it can name the account, the
      // model or the key, none of which a browser has any business reading.
      throw ApiError.badGateway('The readback service did not issue a session.');
    }

    /* Measured from when the credential came back, not from when it was asked
       for: a minter that grants exactly the lifetime it was told stamps the
       expiry from its own later clock, and the mint's latency would otherwise
       read as a credential outliving the ceiling. */
    const lifetimeMs = minted.expiresAt.getTime() - now().getTime();
    if (
      typeof minted.credential !== 'string' ||
      minted.credential === '' ||
      !Number.isFinite(lifetimeMs) ||
      lifetimeMs <= 0 ||
      lifetimeMs > config.maxTtlSeconds * 1000
    ) {
      giveBack();
      throw ApiError.badGateway('The readback service issued a session this API will not pass on.');
    }

    await c.get('audit')?.write({
      action: 'agent.readbackSession',
      targetType: 'ReadbackSession',
      ...(body.chartPatientId === undefined ? {} : { patientId: body.chartPatientId }),
      outcome: 'success',
      metadata: { language, surface, expiresAt: minted.expiresAt.toISOString() },
    });

    c.header('cache-control', 'no-store');
    return c.json({
      endpoint: config.endpoint,
      credential: minted.credential,
      expiresAt: minted.expiresAt.toISOString(),
      language,
      agreement: config.agreement,
    });
  });

  return router;
}

/**
 * The chart the caller says is open must be one they could open anyway.
 *
 * A token that names its own chart (a portal session, a confined launch) is
 * bound to it; a different chart in the body is a caller that believes it can
 * steer the binding, and it is refused rather than silently corrected. Anyone
 * else needs `patient.read` and a care relationship, exactly as the chart route
 * does - and records the access or the refusal the way that route does. Every refusal is a 404, because a 403 would confirm the chart exists.
 */
async function assertChart(
  c: Context<AppEnv>,
  principal: Principal,
  chartPatientId: string
): Promise<void> {
  if (principal.compartmentPatientId !== undefined) {
    if (principal.compartmentPatientId !== chartPatientId)
      throw ApiError.notFound('No such patient.');
    return;
  }
  if (c.get('policy')?.can('patient.read') !== true) throw ApiError.notFound('No such patient.');
  await assertCareRelationship(c, chartPatientId);
}

function requirePrincipal(c: Context<AppEnv>): Principal {
  const principal = c.get('principal');
  if (principal === undefined) throw ApiError.unauthenticated('A bearer token is required.');
  return principal;
}

function primarySubtag(tag: string): string {
  const dash = tag.indexOf('-');
  return (dash === -1 ? tag : tag.slice(0, dash)).toLowerCase();
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim() ?? '';
  return text === '' ? undefined : text;
}

function readPositive(value: string | undefined, fallback: number): number | undefined {
  const text = trimmed(value);
  if (text === undefined) return fallback;
  const parsed = Number.parseInt(text, 10);
  return Number.isInteger(parsed) && parsed > 0 && String(parsed) === text ? parsed : undefined;
}
