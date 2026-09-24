import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { applySessionCookie, clearSessionCookie } from '@/lib/auth/cookie';
import { SESSION_FETCH_HEADER, SESSION_FETCH_MARKER } from '@/lib/auth/routes';
import { sealSessionCookie, sessionSealKey, unsealSessionCookie } from '@/lib/auth/seal';
import { SESSION_COOKIE, sessionIsActive, touchSessionRecord } from '@/lib/auth/session';
import { upstreamUrl } from '@/lib/auth/upstream';

const PORTAL_READS = new Set([
  'portal/patient',
  'portal/home',
  'portal/health-record',
  'portal/messages',
  'portal/appointments',
  'portal/forms',
  'portal/statements',
  'bff/v0/agent/tools',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function upstreamPath(method: string, path: readonly string[]): string | null {
  const joined = path.join('/');
  if (method === 'GET' && PORTAL_READS.has(joined)) {
    return joined.startsWith('portal/') ? `/bff/v0/${joined}` : `/${joined}`;
  }
  if (
    method === 'POST' &&
    path.length === 4 &&
    path[0] === 'portal' &&
    path[1] === 'messages' &&
    UUID.test(path[2] ?? '') &&
    path[3] === 'replies'
  ) {
    return `/bff/v0/portal/messages/${path[2]}/replies`;
  }
  if (
    method === 'POST' &&
    path.length === 4 &&
    path[0] === 'bff' &&
    path[1] === 'v0' &&
    path[2] === 'agent' &&
    path[3] === 'turns'
  ) {
    return '/bff/v0/agent/turns';
  }
  if (method === 'POST' && path.join('/') === 'bff/v0/agent/realtime/sessions') {
    return '/bff/v0/agent/realtime/sessions';
  }
  return null;
}

async function forward(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  if (request.headers.get(SESSION_FETCH_HEADER) !== SESSION_FETCH_MARKER) {
    return NextResponse.json({ error: 'This route is called by the portal.' }, { status: 403 });
  }
  const key = sessionSealKey();
  if (key === null)
    return NextResponse.json({ error: 'Portal session is unavailable.' }, { status: 503 });
  const record = await unsealSessionCookie(request.cookies.get(SESSION_COOKIE)?.value, key);
  const now = Date.now();
  if (record === null || !sessionIsActive(record, now)) {
    return clearSessionCookie(
      NextResponse.json({ error: 'A patient session is required.' }, { status: 401 })
    );
  }
  const path = upstreamPath(request.method, (await context.params).path);
  if (path === null)
    return NextResponse.json({ error: 'No such portal operation.' }, { status: 404 });
  const url = upstreamUrl(path);
  if (url === null)
    return NextResponse.json({ error: 'Portal API is unavailable.' }, { status: 503 });
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: request.method,
      headers: {
        accept: request.headers.get('accept') ?? 'application/json',
        authorization: `Bearer ${record.token}`,
        ...(request.method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      ...(request.method === 'POST' ? { body: await request.text() } : {}),
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch {
    return NextResponse.json({ error: 'Portal API is unavailable.' }, { status: 502 });
  }
  const response = new NextResponse(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    },
  });
  if (upstream.status === 401) return clearSessionCookie(response);
  const touched = touchSessionRecord(record, now);
  return applySessionCookie(response, await sealSessionCookie(touched, key));
}

export function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  return forward(request, context);
}

export function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  return forward(request, context);
}
