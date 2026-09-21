'use client';

/**
 * The page going out of sight, as the one event that says so.
 *
 * Both halves of the voice surface stop when this fires, and they stop for one
 * reason rather than two: what is audible has to be on the screen beside it,
 * and what is being captured has to be visibly being captured. A page nobody is
 * looking at can honour neither. An answer read aloud into a room the reader
 * has walked away from is a record spoken to whoever is left in it; a
 * microphone still open after the phone went into a pocket is the background
 * recording this surface is not allowed to do, whatever the browser would go on
 * permitting. The permission outlives the visit, which is exactly why leaving
 * cannot be the reader's job to remember.
 *
 * **`visibilitychange` alone, rather than it and `pagehide` and `blur`.** The
 * case this exists for is the page that is still alive and no longer seen -
 * another tab, another app, a screen that locked - and that is the only event
 * for it. A discarded page is a different thing: the document goes and the
 * sound goes with it. And `blur` is a different question again, because a page
 * that lost focus to a dialog is still in front of the reader, so stopping
 * there would cut an answer off for a notification.
 *
 * The listener is registered once and never re-registered, because the callback
 * is read through a ref. Re-subscribing whenever it changed would leave a
 * window - short, but real - in which the page could hide unheard.
 */

import { useEffect, useRef } from 'react';

export function usePageHidden(onHidden: () => void): void {
  const notify = useRef(onHidden);
  useEffect(() => {
    notify.current = onHidden;
  }, [onHidden]);

  useEffect(() => {
    const read = () => {
      /* Asked of the document rather than taken from the event, which carries
         nothing: one event fires in both directions and the state is the only
         thing that says which of the two this was. */
      if (document.visibilityState === 'hidden') notify.current();
    };

    document.addEventListener('visibilitychange', read);
    return () => {
      document.removeEventListener('visibilitychange', read);
    };
  }, []);
}
