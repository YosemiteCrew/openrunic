import type { NextResponse } from 'next/server';

import { ABSOLUTE_LIFETIME_MS, SESSION_COOKIE } from './session';

function secure(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function applySessionCookie<T>(response: NextResponse<T>, sealed: string): NextResponse<T> {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: sealed,
    httpOnly: true,
    sameSite: 'lax',
    secure: secure(),
    path: '/',
    maxAge: Math.floor(ABSOLUTE_LIFETIME_MS / 1000),
  });
  return response;
}

export function clearSessionCookie<T>(response: NextResponse<T>): NextResponse<T> {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: secure(),
    path: '/',
    maxAge: 0,
  });
  return response;
}
