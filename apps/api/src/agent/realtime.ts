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
 * A short-lived credential for a hosted realtime transcription service, minted
 * here so that the service's own key never reaches a browser.
 *
 * The voice package's realtime capture adapter (`@openrunic/voice`) holds the
 * rules for what a session may carry once it is open: transcript events only,
 * nothing the service says on its own. This file holds the rules for whether a
 * session may be opened at all, and they are the checks the rest of the product
 * already makes, applied before the credential exists rather than after:
 *
 * - **Default off, twice over.** Nothing is mounted unless the assistant itself
 *   is enabled AND a deployer has supplied a minter AND the environment names
 *   the endpoint and the agreement that covers it. Dictation fills the
 *   assistant's box; without the assistant there is no box to fill.
 * - **Named egress (ADR-0005 rule 6).** The endpoint and a separate
 *   acknowledgement naming the executed agreement and the responsible party.
 *   One variable must not be able to start a patient's voice travelling.
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
 *   this process and degrades dictation to unavailable while typing, and every
 *   clinical workflow, carries on.
 *
 * Which vendor, which model, which transport: none of it is here. A minter is
 * the deployer's code, holding the deployer's key.
 */

export const REALTIME_ENV = {
  endpoint: 'OPENRUNIC_REALTIME_ENDPOINT',
  agreement: 'OPENRUNIC_REALTIME_PHI_EGRESS_AGREEMENT',
  responsibleParty: 'OPENRUNIC_REALTIME_PHI_EGRESS_RESPONSIBLE_PARTY',
  languages: 'OPENRUNIC_REALTIME_LANGUAGES',
  turnDetection: 'OPENRUNIC_REALTIME_TURN_DETECTION',
  maxTtlSeconds: 'OPENRUNIC_REALTIME_MAX_TTL_SECONDS',
  dailySessions: 'OPENRUNIC_REALTIME_DAILY_SESSIONS',
} as const;

export const DEFAULT_REALTIME_MAX_TTL_SECONDS = 60;
export const DEFAULT_REALTIME_DAILY_SESSIONS = 500;
/** Ten minutes. Past that a credential is not short-lived, whatever the deployer set. */
const CEILING_TTL_SECONDS = 600;

export interface RealtimeConfig {
  endpoint: string;
  agreement: string;
  responsibleParty: string;
  languages: readonly string[];
  turnDetection: 'server' | 'manual';
  maxTtlSeconds: number;
  dailySessions: number;
}

export type RealtimeSubsystem =
  | { status: 'disabled'; reason: string }
  | { status: 'misconfigured'; reason: string }
  | { status: 'enabled'; config: RealtimeConfig };

/** What a minter is told. Deliberately nothing that identifies a person or a record. */
export interface RealtimeMintRequest {
  language: string;
  surface: 'staff' | 'patient';
  /** The longest the credential may live. A minter may choose shorter, never longer. */
  expiresInSeconds: number;
}

export interface MintedRealtimeSession {
  /** Opaque to this API, handed to the browser once and never stored or logged. */
  credential: string;
  expiresAt: Date;
}

/** The deployer's half: holds the vendor key, asks the vendor for a scoped session. */
export interface RealtimeSessionMinter {
  mint(request: RealtimeMintRequest): Promise<MintedRealtimeSession>;
}

/**
 * Reads the realtime configuration. Total, like the assistant's: a broken
 * dictation setting reports a state, it does not stop the API starting.
 */
export function loadRealtimeSubsystem(
  env: Readonly<Record<string, string | undefined>>
): RealtimeSubsystem {
  const endpoint = trimmed(env[REALTIME_ENV.endpoint]);
  if (endpoint === undefined) {
    return {
      status: 'disabled',
      reason: 'No realtime transcription endpoint is configured. This is the default.',
    };
  }

  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' && url.protocol !== 'wss:') {
      return {
        status: 'misconfigured',
        reason: `${REALTIME_ENV.endpoint} must be https or wss: audio does not travel in the clear.`,
      };
    }
  } catch {
    return { status: 'misconfigured', reason: `${REALTIME_ENV.endpoint} is not a URL.` };
  }

  const agreement = trimmed(env[REALTIME_ENV.agreement]);
  const responsibleParty = trimmed(env[REALTIME_ENV.responsibleParty]);
  if (agreement === undefined || responsibleParty === undefined) {
    return {
      status: 'misconfigured',
      reason: `Sending audio to ${endpoint} requires ${REALTIME_ENV.agreement} and ${REALTIME_ENV.responsibleParty}. One variable must not be able to start health data flowing.`,
    };
  }

  const languages = (trimmed(env[REALTIME_ENV.languages]) ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
  if (languages.length === 0) {
    return {
      status: 'misconfigured',
      reason: `${REALTIME_ENV.languages} must name the languages the configured service transcribes.`,
    };
  }

  const turnDetection = trimmed(env[REALTIME_ENV.turnDetection]) ?? 'server';
  if (turnDetection !== 'server' && turnDetection !== 'manual') {
    return {
      status: 'misconfigured',
      reason: `${REALTIME_ENV.turnDetection} must be server or manual.`,
    };
  }

  const maxTtlSeconds = readPositive(
    env[REALTIME_ENV.maxTtlSeconds],
    DEFAULT_REALTIME_MAX_TTL_SECONDS
  );
  if (maxTtlSeconds === undefined || maxTtlSeconds > CEILING_TTL_SECONDS) {
    return {
      status: 'misconfigured',
      reason: `${REALTIME_ENV.maxTtlSeconds} must be a whole number of seconds from 1 to ${String(CEILING_TTL_SECONDS)}.`,
    };
  }

  const dailySessions = readPositive(
    env[REALTIME_ENV.dailySessions],
    DEFAULT_REALTIME_DAILY_SESSIONS
  );
  if (dailySessions === undefined) {
    return {
      status: 'misconfigured',
      reason: `${REALTIME_ENV.dailySessions} must be a positive whole number.`,
    };
  }

  return {
    status: 'enabled',
    config: {
      endpoint,
      agreement,
      responsibleParty,
      languages,
      turnDetection,
      maxTtlSeconds,
      dailySessions,
    },
  };
}

const sessionBodySchema = z.strictObject({
  /** BCP-47. Matched on its primary subtag, the same rule the capture adapter uses. */
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
  turnDetection: z.enum(['server', 'manual']),
  /** What the client's capture adapter requires before it will open anything. */
  agreement: z.string(),
});

export const realtimeRouteContracts: RouteContract[] = [
  {
    method: 'post',
    path: '/bff/v0/agent/realtime/sessions',
    operationId: 'mintRealtimeSession',
    summary: 'Mint a short-lived credential for hosted realtime transcription.',
    description:
      'Transcription only. The request may name a language and the open chart and nothing else; a request for tools, instructions or a model is refused. The credential is short-lived and is not stored.',
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
        description: "This practice's daily dictation allowance is spent.",
        schema: problemDocumentSchema,
      },
      { status: 422, description: 'The body failed validation.', schema: problemDocumentSchema },
      {
        status: 502,
        description: 'The transcription service did not issue a usable credential.',
        schema: problemDocumentSchema,
      },
    ],
  },
];

export interface RealtimeRoutesOptions {
  config: RealtimeConfig;
  minter: RealtimeSessionMinter;
  now: () => Date;
}

export function realtimeRoutes(options: RealtimeRoutesOptions): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  const { config, minter, now } = options;
  const ledger = new Map<string, { day: string; count: number }>();

  router.post('/agent/realtime/sessions', async (c) => {
    const principal = requirePrincipal(c);
    const body = await parseJsonBody(c, sessionBodySchema);

    const language = config.languages.find(
      (tag) => primarySubtag(tag) === primarySubtag(body.language)
    );
    if (language === undefined) {
      throw ApiError.validation('The configured service does not transcribe this language.', [
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
        action: 'agent.realtimeSession',
        targetType: 'RealtimeSession',
        metadata: { reason: 'daily-session-budget-exhausted' },
      });
      throw ApiError.conflict(
        "This practice's dictation allowance for today is spent. Typing still works.",
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
    let minted: MintedRealtimeSession;
    try {
      minted = await minter.mint({ language, surface, expiresInSeconds: config.maxTtlSeconds });
    } catch {
      giveBack();
      // The vendor's message is not passed on: it can name the account, the
      // model or the key, none of which a browser has any business reading.
      throw ApiError.badGateway('The transcription service did not issue a session.');
    }

    const lifetimeMs = minted.expiresAt.getTime() - instant.getTime();
    if (
      typeof minted.credential !== 'string' ||
      minted.credential === '' ||
      !(lifetimeMs > 0) ||
      lifetimeMs > config.maxTtlSeconds * 1000
    ) {
      giveBack();
      throw ApiError.badGateway(
        'The transcription service issued a session this API will not pass on.'
      );
    }

    await c.get('audit')?.write({
      action: 'agent.realtimeSession',
      targetType: 'RealtimeSession',
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
      turnDetection: config.turnDetection,
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
