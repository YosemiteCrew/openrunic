import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { isLiveMode } from '@/lib/api/config';
import { clearSessionCookie } from '@/lib/auth/cookie';
import { SIGN_IN_PATH, signInUrl } from '@/lib/auth/routes';
import { sessionSealKey, unsealSessionCookie } from '@/lib/auth/seal';
import { SESSION_COOKIE, sessionIsActive } from '@/lib/auth/session';

function redirect(request: NextRequest, path: string): NextResponse {
  const target = new URL(path, 'https://portal.invalid');
  const location = new URL(`${target.pathname}${target.search}`, request.nextUrl.origin);
  return new NextResponse(null, {
    status: 307,
    headers: { location: location.href },
  });
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  if (!isLiveMode()) return NextResponse.next();
  const key = sessionSealKey();
  const sealed = request.cookies.get(SESSION_COOKIE)?.value;
  const record = key === null ? null : await unsealSessionCookie(sealed, key);
  const active = record !== null && sessionIsActive(record, Date.now());
  if (active) {
    return request.nextUrl.pathname === SIGN_IN_PATH ? redirect(request, '/') : NextResponse.next();
  }
  if (request.nextUrl.pathname === SIGN_IN_PATH) return NextResponse.next();
  const target = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const response = redirect(request, signInUrl(target, 'expired'));
  return sealed === undefined ? response : clearSessionCookie(response);
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|assets|fonts|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
