import { createHash, timingSafeEqual } from 'node:crypto';

import { developmentCredentials } from './directory';
import type { Identity } from './session';

/**
 * Turning a submitted access token into an identity, on the server only.
 *
 * It is a module of its own rather than a function in `directory.ts` because it
 * imports `node:crypto`, and `directory.ts` is read by the sign-in screen to
 * render its list of development principals. One file holding both would drag a
 * Node built-in into the browser bundle, and the failure would be a build
 * error on whichever change happened to be in flight rather than on this one.
 *
 * ## Why the comparison is not `===`
 *
 * A string comparison stops at the first differing byte, so how long it takes
 * says how much of the secret was right. That is how a bearer token gets
 * guessed one character at a time by somebody who can measure a response.
 *
 * Today it is genuinely not exploitable: the tokens this checks are the API's
 * public fixtures, so there is nothing to learn, and a production build has no
 * credentials to compare against at all. It is written properly anyway, because
 * this function is precisely the seam where a real secret arrives - the OIDC
 * implementation verifies a signature here instead - and a comparison that was
 * safe only because the data was worthless is a trap for whoever changes the
 * data.
 *
 * Two details carry the property. Both sides are hashed to a fixed width first,
 * because `timingSafeEqual` throws on inputs of different lengths and that
 * throw would itself leak the length of the credential. And the loop runs to
 * the end of the table rather than returning on the first match, because
 * stopping early would tell an observer which entry matched, and with it how
 * far down the list a valid token sits.
 */

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function sameCredential(candidate: string, expected: string): boolean {
  return timingSafeEqual(digest(candidate), digest(expected));
}

/**
 * The identity this build recognises the token as, or null.
 *
 * Neither argument is read from `process.env` here, so that the two answers that
 * matter - production has no identity, a demonstration build has these ones -
 * are both cases a test can actually run. See `directory.ts` for what opens the
 * door and `build.ts` for the two conditions that have to hold before it can.
 */
export function identityForAccessToken(
  token: string,
  nodeEnv: string | undefined,
  demoBuild = false
): Identity | null {
  let matched: Identity | null = null;

  for (const credential of developmentCredentials(nodeEnv, demoBuild)) {
    if (sameCredential(token, credential.token)) matched = credential.identity;
  }

  return matched;
}
