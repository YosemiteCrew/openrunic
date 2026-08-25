/**
 * The two helpers, from the package that now holds them.
 *
 * They moved to `@openrunic/i18n` when `apps/portal` needed the first of them:
 * the alternative was a third copy, and the header on the original is a note
 * about the second. This file stays so the fifty call sites in this application
 * keep their import path, and so the move was one file rather than fifty.
 */
export { counted, searchWords } from '@openrunic/i18n';
export type { CountedMessage } from '@openrunic/i18n';
