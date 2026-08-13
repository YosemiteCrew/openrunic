import { restoreSession } from './client';
import { IDLE_TIMEOUT_MS } from './session';

/**
 * The idle timeout, measured from the last time somebody was actually there.
 *
 * ## The bug this exists to fix
 *
 * The idle window used to run from the last *document load*. `lastSeenAt` was
 * re-stamped by `GET /session`, and nothing calls `GET /session` except a page
 * that has just loaded, so a clinician who signed in and then worked inside the
 * application - which is a single page that navigates on the client - was
 * signed out about fifteen minutes later no matter how busy they had been. The
 * next click through the rail went to a sign-in form, and an unsaved note went
 * with it. That is worse than having no timeout: a timeout that fires on people
 * who are present teaches them to keep a second tab signed in, or a second
 * browser, which is the opposite of what it was for.
 *
 * ## What counts as somebody being there
 *
 * Human input in the tab: `pointerdown`, `keydown`, `wheel`. Between them they
 * cover clicking, typing, tapping and scrolling a long note, which is the whole
 * of what reading and writing a chart looks like. Navigation is covered because
 * a navigation in this application is a click or a key press first.
 *
 * Two candidates are deliberately excluded.
 *
 * `pointermove` is not activity. A mouse nudged by a passing trolley or a
 * cleaner's cloth would hold a chart open on an empty workstation, which is
 * precisely the person the timeout is written for. Moving a mouse without
 * pressing anything is also not something a working clinician does for fifteen
 * minutes.
 *
 * A request in flight is not activity either, and this is the important one.
 * Refetching, polling and a background retry all happen with nobody in the
 * room; counting them would mean the first screen that adds a refresh interval
 * silently disables the idle timeout for every screen. The timeout is about a
 * person, so it is measured from a person. The cost of that choice is that a
 * long-running action with no input - watching an import finish, say - can time
 * out while somebody watches it, and the honest answer to that is a screen that
 * asks whether they are still there, not a rule that counts machines as people.
 *
 * ## The trade-off in the refresh interval
 *
 * Telling the server on every keystroke would be a request per keystroke, so
 * the refresh is throttled: the first activity after {@link ACTIVITY_REFRESH_MS}
 * has passed re-stamps the clock, and everything in between is free. The cost
 * is that the server's idle clock trails the person by up to that interval, so
 * a session ends between fourteen and fifteen minutes after the last real
 * action rather than at exactly fifteen.
 *
 * That error is deliberately in the safe direction - the window can come up
 * short, never long - and a minute out of fifteen is small enough that nobody
 * notices, while an active clinician is never signed out at all, because a
 * minute of continuous work produces at least one refresh.
 *
 * ## Two clocks that agree
 *
 * The tab's countdown restarts when a refresh is sent, not on every event. Both
 * clocks therefore run from the same instant, and the tab cannot end up showing
 * a chart that the proxy has already decided is over, or holding a screen open
 * a minute after the server considers the session finished.
 *
 * ## What this does not handle
 *
 * Two tabs. Each runs its own countdown, so a second tab left open on a chart
 * ends the session for both after fifteen minutes even while the first is being
 * worked in. It fails in the safe direction - a session can only be ended early,
 * never extended - and fixing it properly means the tabs agreeing on one clock
 * between them, which is a change of its own rather than a line here.
 */

/**
 * The events that mean a person is at the workstation. Registered on `window`,
 * so anything that bubbles counts wherever on the screen it happened.
 */
export const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const;

/**
 * How stale the server's idle clock is allowed to get while somebody works.
 *
 * It has to stay well below {@link IDLE_TIMEOUT_MS} or an active session would
 * lapse between refreshes; `idle.test.ts` holds that relationship, because the
 * number likely to change is the timeout.
 */
export const ACTIVITY_REFRESH_MS = 60 * 1000;

export interface IdleWatchOptions {
  /** Run when the workstation has been quiet for the whole idle window. */
  readonly onIdle: () => void;
  /**
   * Injectable for tests. `restoreSession` is what re-stamps the server's idle
   * clock: the handler answers a page load and a keep-alive with the same
   * refresh, so there is nothing else for this to be.
   */
  readonly refresh?: () => Promise<unknown>;
}

/**
 * Starts watching, and returns the function that stops.
 *
 * Call it when a session enters the store and not before. That moment is always
 * an answer from `/session` - a sign-in or a restore - so the server's clock has
 * just been stamped, which is what makes `Date.now()` the right starting point
 * for the countdown rather than an assumption.
 */
export function watchForIdleness({
  onIdle,
  refresh = restoreSession,
}: Readonly<IdleWatchOptions>): () => void {
  let stampedAt = Date.now();
  let timer = 0;

  const countdown = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(onIdle, IDLE_TIMEOUT_MS);
  };

  const onActivity = (): void => {
    const at = Date.now();
    if (at - stampedAt < ACTIVITY_REFRESH_MS) return;

    // Stamped before the request rather than after it, so that a second event
    // arriving while this one is in flight does not send a second refresh.
    stampedAt = at;
    countdown();
    void refresh();
  };

  countdown();
  for (const event of ACTIVITY_EVENTS) {
    window.addEventListener(event, onActivity, { passive: true });
  }

  return () => {
    window.clearTimeout(timer);
    for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, onActivity);
  };
}
