import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ACTIVITY_EVENTS, ACTIVITY_REFRESH_MS, watchForIdleness } from '@/lib/auth/idle';
import { IDLE_TIMEOUT_MS } from '@/lib/auth/session';

/**
 * The idle window, from both directions.
 *
 * The bug these are written against: the window used to run from the last
 * document load rather than from the last time somebody was at the keyboard, so
 * a clinician working inside a chart was signed out about fifteen minutes after
 * signing in. Both halves matter and neither is enough alone - a window that
 * only extends never fires, and a window that only fires is the bug.
 */

const NOON = Date.parse('2026-08-13T12:00:00Z');

const onIdle = vi.fn();
const refresh = vi.fn(async () => undefined);

function watch(): () => void {
  return watchForIdleness({ onIdle, refresh });
}

/** A person doing something. Any of the three; they are equivalent by design. */
function activity(event: (typeof ACTIVITY_EVENTS)[number] = 'keydown'): void {
  window.dispatchEvent(new Event(event));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOON);
  onIdle.mockClear();
  refresh.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('somebody working', () => {
  it('keeps the session for a whole shift of steady use', () => {
    const stop = watch();

    // Ten minutes past the idle window, touching the keyboard once a minute.
    for (let minute = 1; minute <= 25; minute += 1) {
      vi.advanceTimersByTime(60_000);
      activity();
    }

    expect(onIdle).not.toHaveBeenCalled();
    stop();
  });

  it('tells the server, so the cookie agrees with the tab', () => {
    const stop = watch();

    vi.advanceTimersByTime(ACTIVITY_REFRESH_MS);
    activity();

    // Re-stamping `lastSeenAt` on the server is the whole fix: without it the
    // proxy bounces the next navigation however busy the clinician has been.
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it('counts a click, a key and a scroll alike', () => {
    const stop = watch();

    for (const event of ACTIVITY_EVENTS) {
      vi.advanceTimersByTime(ACTIVITY_REFRESH_MS);
      activity(event);
    }

    expect(refresh).toHaveBeenCalledTimes(ACTIVITY_EVENTS.length);
    stop();
  });

  it('does not send a request per keystroke', () => {
    const stop = watch();

    vi.advanceTimersByTime(ACTIVITY_REFRESH_MS);
    for (let keystroke = 0; keystroke < 50; keystroke += 1) {
      vi.advanceTimersByTime(100);
      activity();
    }

    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it('counts activity from just before the window closes', () => {
    const stop = watch();

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1);
    activity();
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1);

    expect(onIdle).not.toHaveBeenCalled();
    stop();
  });
});

describe('a workstation nobody is at', () => {
  it('ends the session when the window closes', () => {
    const stop = watch();

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS);

    expect(onIdle).toHaveBeenCalledTimes(1);
    stop();
  });

  it('is not held open by a mouse being nudged', () => {
    const stop = watch();

    // `pointermove` is deliberately not activity: a trolley knocking a desk
    // would otherwise keep a chart on screen in an empty room, which is the
    // person this timeout is written for.
    for (let nudge = 0; nudge < 30; nudge += 1) {
      vi.advanceTimersByTime(30_000);
      window.dispatchEvent(new Event('pointermove'));
    }

    expect(onIdle).toHaveBeenCalled();
    stop();
  });

  it('is not held open by requests the application makes on its own', () => {
    const stop = watch();

    // Nothing polls today. When something does, it must not count as a person:
    // a refresh interval that reset this timer would silently disable the idle
    // timeout for every screen in the application.
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS);

    expect(refresh).not.toHaveBeenCalled();
    expect(onIdle).toHaveBeenCalledTimes(1);
    stop();
  });

  it('ends the session no later than the window, even having been busy before', () => {
    const stop = watch();

    vi.advanceTimersByTime(ACTIVITY_REFRESH_MS);
    activity();
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS);

    expect(onIdle).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('after the watch stops', () => {
  it('does not end a session that has already gone', () => {
    // The gate stops watching when the session leaves the store. A timer still
    // running after that would sign somebody out of the session they have just
    // signed into.
    watch()();

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS * 2);

    expect(onIdle).not.toHaveBeenCalled();
  });

  it('stops listening, so a later click refreshes nothing', () => {
    watch()();

    vi.advanceTimersByTime(ACTIVITY_REFRESH_MS);
    activity();

    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('the two numbers', () => {
  it('leaves room for at least one refresh inside the window', () => {
    // The relationship, not the values. If the idle timeout were ever tuned
    // down towards the refresh interval, an active session would lapse between
    // refreshes and the original bug would be back.
    expect(ACTIVITY_REFRESH_MS * 5).toBeLessThanOrEqual(IDLE_TIMEOUT_MS);
  });
});
