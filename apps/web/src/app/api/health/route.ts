import { NextResponse } from 'next/server';

import { IS_MOCK_MODE } from '@/lib/api';

/**
 * Same-origin health probe for the downtime banner.
 *
 * The browser must not probe the API directly. The API is on a different
 * origin (`localhost:3000` to `localhost:4000` in the default self-host
 * layout), it sends no CORS headers, and a cross-origin fetch that the browser
 * blocks is indistinguishable from a server that is down. The result was a
 * permanent "cannot reach openrunic" banner on a completely healthy stack -
 * caught by running it, not by reading it.
 *
 * A banner that is always on is worse than no banner: staff stop reading it,
 * and then it is still there on the day it is telling the truth.
 *
 * So the check runs here instead. This route is server-side, inside the
 * cluster, and reaches the API by its internal name - no browser, no origin, no
 * CORS. It also answers a more useful question than the browser could: whether
 * the web server can reach the API, which is the path every real request takes.
 */

/** Never prerendered or cached: a cached health check is not a health check. */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Where the API lives, from inside the deployment.
 *
 * NEXT_PUBLIC_API_BASE_URL is the browser's address for the API and is wrong
 * here, so this is a separate, server-only variable. docker-compose.yml sets
 * it on the web service.
 *
 * There is deliberately no fallback. A guessed address is a probe against a
 * host that may not exist, which fails, which turns the banner on and leaves it
 * on - the exact permanently-lit banner this whole route was written to remove.
 * An unset variable is a deployment that has not been configured, and the honest
 * answer to "can the web tier reach the API" is then "no", with the reason in
 * the server log where an operator can fix it.
 */
function apiBaseUrl(): string {
  const configured = process.env.OPENRUNIC_API_INTERNAL_URL;
  if (configured === undefined || configured === '') {
    throw new Error('OPENRUNIC_API_INTERNAL_URL is not set; the API address is unknown');
  }
  return configured.replace(/\/$/, '');
}

export async function GET(): Promise<NextResponse> {
  // Mock mode has no API to reach, so there is nothing here that can be down.
  //
  // The probe exists to answer "can the web tier reach the API". A build
  // reading fixtures does not have one, and asking anyway means
  // OPENRUNIC_API_INTERNAL_URL is unset, which throws, which answers 502,
  // which lights the downtime banner and leaves it lit. That is the
  // permanently-on banner this whole route was written to remove, reintroduced
  // through the one configuration where the question is meaningless - and it is
  // the configuration a hosted demonstration runs in.
  //
  // Answering ok is the honest answer rather than a convenient one: the
  // question behind the banner is whether this page can serve clinical data,
  // and a fixtures build always can.
  if (IS_MOCK_MODE) {
    return NextResponse.json(
      { status: 'ok', mode: 'mock' },
      { status: 200, headers: { 'cache-control': 'no-store' } }
    );
  }

  try {
    // /readyz, not /healthz. Liveness only proves the API process is running,
    // and a process whose database has gone is running perfectly while being
    // unable to answer a single clinical question. Readiness is the difference
    // between a banner that appears during an outage and one that never does.
    const response = await fetch(`${apiBaseUrl()}/readyz`, {
      cache: 'no-store',
      // Shorter than the client's own timeout so this route always answers
      // first, and the banner reflects a decision rather than a hung request.
      signal: AbortSignal.timeout(4_000),
    });

    if (!response.ok) {
      // 503 means precisely one thing to the client: the API answered and said
      // it cannot serve data. That is a database outage, and it is the state
      // where staff must be told to keep paper notes rather than told the
      // system is unreachable.
      return NextResponse.json(
        { status: 'degraded', api: response.status },
        { status: 503, headers: { 'cache-control': 'no-store' } }
      );
    }

    return NextResponse.json(
      { status: 'ok' },
      { status: 200, headers: { 'cache-control': 'no-store' } }
    );
  } catch (error) {
    // 502, not 503, and the difference carries the whole message. 503 is "the
    // API answered and cannot serve"; 502 is "the API did not answer at all".
    // The first tells staff their notes will not save, the second tells them
    // nothing will load. Collapsing both into 503 makes the banner say
    // "read-only" during a total outage, which is wrong and misleading.
    //
    // The reason goes to the server log and nowhere else. It is the only copy,
    // so it is worth writing: a missing OPENRUNIC_API_INTERNAL_URL and a
    // refused connection produce the same 502, and only this line tells the
    // operator which one they have.
    console.error('openrunic: the web tier could not reach the API', error);

    // Deliberately no detail in the body. A connection error in a
    // browser-readable response describes the internal topology to anyone who
    // asks and tells staff nothing they can act on.
    return NextResponse.json(
      { status: 'unreachable' },
      { status: 502, headers: { 'cache-control': 'no-store' } }
    );
  }
}
