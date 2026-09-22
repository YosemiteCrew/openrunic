import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { applySessionCookie, clearSessionCookie } from '@/lib/auth/cookie';
import { SESSION_FETCH_HEADER, SESSION_FETCH_MARKER } from '@/lib/auth/routes';
import { sealSessionCookie, sessionSealKey, unsealSessionCookie } from '@/lib/auth/seal';
import {
  SESSION_COOKIE,
  readSessionToken,
  sessionIsActive,
  startSessionRecord,
  toSessionState,
  touchSessionRecord,
} from '@/lib/auth/session';
import { upstreamUrl } from '@/lib/auth/upstream';

function fromApplication(request: NextRequest): boolean {
  return request.headers.get(SESSION_FETCH_HEADER) === SESSION_FETCH_MARKER;
}

function readToken(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  return readSessionToken((value as { token?: unknown }).token);
}

function refuse(): NextResponse {
  return clearSessionCookie(
    NextResponse.json({ error: 'The credential was not accepted.' }, { status: 401 })
  );
}

function unavailable(): NextResponse {
  return clearSessionCookie(
    NextResponse.json({ error: 'Patient sign-in is unavailable.' }, { status: 503 })
  );
}

function notOurRequest(): NextResponse {
  return NextResponse.json(
    { error: 'This endpoint is called by the application, not navigated to.' },
    { status: 403 }
  );
}

async function tokenNamesPatient(token: string): Promise<boolean | null> {
  const url = upstreamUrl('/bff/v0/portal/patient');
  if (url === null) return null;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch {
    return null;
  }
  if (response.status === 401 || response.status === 403) return false;
  if (!response.ok) return null;
  try {
    const patient = (await response.json()) as Record<string, unknown>;
    const valid =
      typeof patient.id === 'string' &&
      typeof patient.name === 'string' &&
      typeof patient.mrn === 'string' &&
      typeof patient.dateOfBirth === 'string';
    return valid ? true : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!fromApplication(request)) return notOurRequest();
  const key = sessionSealKey();
  if (key === null) return unavailable();
  let token: string | null;
  try {
    token = readToken(await request.json());
  } catch {
    token = null;
  }
  if (token === null) return refuse();
  const accepted = await tokenNamesPatient(token);
  if (accepted === null) return unavailable();
  if (!accepted) return refuse();
  const record = startSessionRecord(token, Date.now());
  return applySessionCookie(
    NextResponse.json(toSessionState(record)),
    await sealSessionCookie(record, key)
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!fromApplication(request)) return notOurRequest();
  const key = sessionSealKey();
  if (key === null) return unavailable();
  const record = await unsealSessionCookie(request.cookies.get(SESSION_COOKIE)?.value, key);
  const now = Date.now();
  if (record === null || !sessionIsActive(record, now)) return refuse();
  const touched = touchSessionRecord(record, now);
  return applySessionCookie(
    NextResponse.json(toSessionState(touched)),
    await sealSessionCookie(touched, key)
  );
}

export function DELETE(request: NextRequest): NextResponse {
  if (!fromApplication(request)) return notOurRequest();
  return clearSessionCookie(new NextResponse(null, { status: 204 }));
}
