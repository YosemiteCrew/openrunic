import { createHash } from 'node:crypto';

/**
 * The content hash that makes a code-system load verifiable.
 *
 * A terminology load is the one place where a deployment imports a large,
 * opaque, externally-authored file into its clinical database, and where
 * getting the wrong file is both easy and quiet: a truncated download or last
 * year's release produces a table that looks fine and validates the wrong
 * codes. The manifest therefore states the hash of the payload it describes,
 * and the loader refuses any payload that does not match, which turns "did this
 * load work" into a question with an answer and makes a load reproducible
 * across environments.
 *
 * The algorithm is carried in the value rather than assumed, so moving off
 * SHA-256 later is a change to data and not a silent reinterpretation of every
 * manifest ever written.
 */

/** Prefix every hash carries, so the algorithm travels with the digest. */
export const CONTENT_HASH_PREFIX = 'sha256:';

/** Manifest hashes must be the prefix followed by 64 lowercase hex digits. */
export const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

/**
 * Hashes a payload exactly as delivered.
 *
 * Nothing is normalized first: no trimming, no line-ending translation, no
 * sorting. The point is that a deployer can reproduce the value with an
 * ordinary shell tool (`shasum -a 256 file`, which prints the bare hex this
 * prefixes) and get a match, which they could not do if the loader hashed some
 * cleaned-up interpretation of their file instead.
 */
export function hashCodeSystemContent(content: string): string {
  return `${CONTENT_HASH_PREFIX}${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}
