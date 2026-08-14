/**
 * A small caching reader for a JWKS document.
 *
 * Verifying a signed token means holding the issuer's public key, and the only
 * supported way to learn that key is to fetch the key set over the network.
 * That makes the cache a security control rather than a performance tweak: it
 * sits between an unauthenticated request and an outbound HTTP call, so every
 * refetch it allows is a request an attacker can cause. The rules below are
 * written from that side of the problem.
 *
 * The transport is injectable so the suite, and any offline deployment, can run
 * without a network.
 */

export interface Jwk {
  readonly kty: string;
  readonly kid?: string;
  readonly alg?: string;
  readonly use?: string;
  readonly n?: string;
  readonly e?: string;
  readonly crv?: string;
  readonly x?: string;
  readonly y?: string;
}

export interface JwksCacheOptions {
  readonly jwksUri: string;
  /** Injectable so the suite never touches the network. */
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  /** How long a fetched key set is trusted. Default 300000 ms. */
  readonly cacheTtlMs?: number;
  /**
   * Floor on how often an unknown `kid` may trigger a refetch, so a stream of
   * tokens with fabricated key ids cannot be used to hammer the provider.
   * Default 10000 ms.
   */
  readonly minRefetchIntervalMs?: number;
}

export interface JwksCache {
  /** Resolves the signing key for a `kid`, refetching once if it is unknown. */
  keyFor(kid: string | undefined): Promise<Jwk | null>;
  /** Number of times the key set was actually fetched. For tests and metrics. */
  readonly fetchCount: number;
}

const DEFAULT_CACHE_TTL_MS = 300_000;
const DEFAULT_MIN_REFETCH_INTERVAL_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** Present-and-string members only, so an absent member stays absent. */
function stringMember(source: Record<string, unknown>, key: string): Record<string, string> {
  const value = source[key];
  return typeof value === 'string' ? { [key]: value } : {};
}

/**
 * Copies the members a public signing key is made of, and nothing else. A key
 * set that carries private material or vendor extensions cannot smuggle either
 * into the verifier, because only these names survive the trip.
 */
function toJwk(value: unknown): Jwk | null {
  if (!isRecord(value)) return null;

  const kty = value.kty;
  if (typeof kty !== 'string' || kty === '') return null;

  return {
    kty,
    ...stringMember(value, 'kid'),
    ...stringMember(value, 'alg'),
    ...stringMember(value, 'use'),
    ...stringMember(value, 'n'),
    ...stringMember(value, 'e'),
    ...stringMember(value, 'crv'),
    ...stringMember(value, 'x'),
    ...stringMember(value, 'y'),
  };
}

export function createJwksCache(options: JwksCacheOptions): JwksCache {
  const { jwksUri } = options;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const minRefetchIntervalMs = options.minRefetchIntervalMs ?? DEFAULT_MIN_REFETCH_INTERVAL_MS;

  let keys: readonly Jwk[] | null = null;
  let fetchedAt = 0;
  let fetchCount = 0;
  let inFlight: Promise<readonly Jwk[]> | null = null;

  async function fetchKeys(): Promise<readonly Jwk[]> {
    fetchCount += 1;
    const response = await fetchImpl(jwksUri, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`JWKS request to ${jwksUri} returned HTTP ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error(`JWKS request to ${jwksUri} returned a body that is not JSON`);
    }

    if (!isRecord(body) || !isUnknownArray(body.keys)) {
      throw new Error(`JWKS request to ${jwksUri} returned a document with no "keys" array`);
    }

    const parsed: Jwk[] = [];
    for (const entry of body.keys) {
      const jwk = toJwk(entry);
      if (jwk !== null) parsed.push(jwk);
    }
    return parsed;
  }

  /**
   * Fetches, or joins the fetch already running. Joining matters because a
   * burst of requests arriving on a cold cache would otherwise each open their
   * own connection to the provider, which is a self-inflicted outage on the
   * busiest possible moment.
   *
   * A failed fetch leaves the previous key set in place and does not stamp
   * `fetchedAt`: an empty set cached for the whole TTL would turn one bad
   * response into five minutes of universal 401s.
   */
  async function load(): Promise<readonly Jwk[]> {
    if (inFlight !== null) return inFlight;

    const request = fetchKeys();
    inFlight = request;
    try {
      const loaded = await request;
      keys = loaded;
      fetchedAt = now();
      return loaded;
    } finally {
      inFlight = null;
    }
  }

  function cachedKeys(): readonly Jwk[] | null {
    if (keys === null) return null;
    return now() - fetchedAt < cacheTtlMs ? keys : null;
  }

  /**
   * With a `kid`, the choice is exact. Without one, a single-key set is
   * unambiguous and anything larger is not: picking a key for the token would
   * let the token's author pick it too, which is how an attacker gets a key of
   * their choosing applied to bytes of their choosing.
   */
  function selectKey(available: readonly Jwk[], kid: string | undefined): Jwk | null {
    if (kid !== undefined) return available.find((jwk) => jwk.kid === kid) ?? null;

    const [only, second] = available;
    return only !== undefined && second === undefined ? only : null;
  }

  return {
    async keyFor(kid: string | undefined): Promise<Jwk | null> {
      const available = cachedKeys() ?? (await load());

      const selected = selectKey(available, kid);
      if (selected !== null) return selected;

      // Key rotation is the reason a second attempt exists; a fabricated `kid`
      // is the reason it is rate limited. An absent `kid` never earns one,
      // because a refetch cannot resolve an ambiguity in the token.
      if (kid === undefined) return null;
      if (now() - fetchedAt < minRefetchIntervalMs) return null;

      return selectKey(await load(), kid);
    },

    get fetchCount(): number {
      return fetchCount;
    },
  };
}
