import { describe, expect, it } from 'vitest';

import { NAV_AREAS } from '@/components/shell/navigation';
import {
  SIGNED_IN_HOME,
  SIGN_IN_PATH,
  isPublicPath,
  landingPath,
  safeReturnPath,
  signInQuery,
  signInUrl,
} from '@/lib/auth/routes';

describe('which pages a stranger may reach', () => {
  it('lets anyone read the marketing pages', () => {
    expect(isPublicPath('/')).toBe(true);
    expect(isPublicPath('/for/developers')).toBe(true);
    expect(isPublicPath('/for/hospitals')).toBe(true);
    expect(isPublicPath('/for/patients')).toBe(true);
  });

  it('lets anyone reach the sign-in screen and the session endpoint', () => {
    expect(isPublicPath('/sign-in')).toBe(true);
    expect(isPublicPath('/session')).toBe(true);
  });

  it('holds every clinical area back', () => {
    for (const area of NAV_AREAS) {
      expect(isPublicPath(area.href)).toBe(false);
    }
  });

  it('holds a chart back, and a route nobody has written yet', () => {
    expect(isPublicPath('/patients/0192f1a0-0000-7000-8000-00000000p001')).toBe(false);
    expect(isPublicPath('/some/area/added/next/week')).toBe(false);
  });

  it('does not treat a prefix of a public path as public', () => {
    // The list is exact matches, so a route that merely starts like a public
    // one stays protected. `/sign-in-as/somebody` is the shape of the mistake.
    expect(isPublicPath('/sign-in-as/somebody')).toBe(false);
    expect(isPublicPath('/for')).toBe(false);
  });
});

describe('the ?next parameter', () => {
  it('keeps a path on this origin, query and all', () => {
    expect(safeReturnPath('/patients/0192f1a0-0000-7000-8000-00000000p001?tab=meds')).toBe(
      '/patients/0192f1a0-0000-7000-8000-00000000p001?tab=meds'
    );
  });

  it('refuses another site, however it is spelled', () => {
    // Each of these is a browser-readable way to say "somewhere else", and each
    // one turns "sign in and continue" into a page that asks for the same
    // credential again.
    expect(safeReturnPath('https://not-openrunic.test/sign-in')).toBeNull();
    expect(safeReturnPath('//not-openrunic.test/sign-in')).toBeNull();
    expect(safeReturnPath('/\\not-openrunic.test/sign-in')).toBeNull();
    expect(safeReturnPath('javascript:alert(1)')).toBeNull();
  });

  it('refuses a value carrying a control character', () => {
    expect(safeReturnPath('/patients\r\nLocation: https://not-openrunic.test')).toBeNull();
    expect(safeReturnPath('/patients\u007f')).toBeNull();
  });

  it('refuses nothing at all', () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
  });
});

describe('the sign-in URL', () => {
  it('is bare when there is nothing to say', () => {
    expect(signInUrl()).toBe(SIGN_IN_PATH);
    expect(signInQuery()).toBe('');
  });

  it('offers the query on its own, for a redirect built on the request URL', () => {
    expect(signInQuery('/schedule', 'idle')).toBe('next=%2Fschedule&reason=idle');
  });

  it('carries where the clinician was headed and why they are here', () => {
    expect(signInUrl('/schedule?day=2026-08-13', 'idle')).toBe(
      '/sign-in?next=%2Fschedule%3Fday%3D2026-08-13&reason=idle'
    );
  });

  it('drops a return path that points back at itself', () => {
    // Otherwise signing in sends the clinician straight back to the form.
    expect(signInUrl('/sign-in?reason=idle', 'expired')).toBe('/sign-in?reason=expired');
  });

  it('drops a return path that leaves this origin', () => {
    expect(signInUrl('https://not-openrunic.test')).toBe(SIGN_IN_PATH);
  });
});

describe('where signing in lands', () => {
  it('goes to the schedule when nothing was asked for', () => {
    expect(landingPath(null)).toBe(SIGNED_IN_HOME);
    expect(SIGNED_IN_HOME).toBe('/schedule');
  });

  it('goes back to the page the clinician was trying to open', () => {
    expect(landingPath('/patients/0192f1a0-0000-7000-8000-00000000p001')).toBe(
      '/patients/0192f1a0-0000-7000-8000-00000000p001'
    );
  });

  it('never lands somewhere off this origin', () => {
    expect(landingPath('//not-openrunic.test')).toBe(SIGNED_IN_HOME);
  });

  it('never lands back on the sign-in screen', () => {
    expect(landingPath('/sign-in')).toBe(SIGNED_IN_HOME);
  });
});
