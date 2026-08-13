import { err, ok } from '@openrunic/types';
import type { Result } from '@openrunic/types';

import { definitionContentHash } from './canonical.js';
import { compileDefinition } from './compile.js';
import type { CompileOptions, CompiledForm } from './compiled.js';
import type { FormDefinition } from './definition.js';
import type { FormCompileError } from './errors.js';

/**
 * Publishing: the moment a definition stops being editable.
 *
 * Immutability here is not a style preference, it is what makes a stored
 * submission mean anything. A submission is one JSON document plus a pointer to
 * the definition version it was taken against. If that version could be edited
 * afterwards, then adding a required field would retroactively invalidate five
 * years of completed intakes, renaming a key would orphan their answers, and
 * removing an option would leave stored answers that the form says are
 * impossible. None of those are recoverable, because the form the patient
 * actually saw would no longer exist anywhere.
 *
 * So a published `(key, version)` is frozen, and a change is a new version. The
 * database's unique constraint stops a second row from existing; the content
 * hash is what distinguishes an idempotent retry of the same publish, which
 * must succeed, from a quiet edit under the same version number, which must not.
 */

/** A definition that is now immutable, with its compiled artifacts. */
export interface PublishedFormDefinition {
  readonly key: string;
  readonly version: number;
  readonly status: 'PUBLISHED';
  /** `sha256:<hex>` over the authored document, in canonical key order. */
  readonly contentHash: string;
  /** Deep-frozen. Writing through it throws in strict mode. */
  readonly definition: FormDefinition;
  readonly compiled: CompiledForm;
}

/** What the caller knows about versions already published for a key. */
export interface PublishedVersionRecord {
  readonly key: string;
  readonly version: number;
  readonly contentHash: string;
}

/**
 * Decides whether a draft may take a `(key, version)` pair, and returns the
 * content hash the caller should store if it may.
 *
 * Republishing byte-identical content is allowed on purpose. A publish is a
 * multi-step write, and a retry after a failed step must be able to converge
 * rather than dead-end on a uniqueness error the operator cannot clear.
 *
 * The draft is compiled first, so a definition that cannot run can never be
 * recorded as published, whatever its version history looks like.
 */
export function assertPublishable(
  existingVersions: readonly PublishedVersionRecord[],
  draft: FormDefinition,
  options: CompileOptions = {}
): Result<string, FormCompileError[]> {
  const compiled = compileDefinition(draft, options);
  if (!compiled.ok) {
    return err(compiled.error);
  }

  const draftHash = definitionContentHash(draft);
  for (const record of existingVersions) {
    if (record.key !== draft.key || record.version !== draft.version) {
      continue;
    }
    if (record.contentHash !== draftHash) {
      return err([
        {
          code: 'versionAlreadyPublished',
          definitionKey: draft.key,
          version: draft.version,
          publishedHash: record.contentHash,
          draftHash,
          message:
            'This version is already published with different content. Publish a new version instead.',
        },
      ]);
    }
  }

  return ok(draftHash);
}

/**
 * Compiles a draft, freezes it, and stamps it PUBLISHED with its content hash.
 *
 * The freeze is deep and the wrapper is frozen too, so neither the definition
 * nor the status nor the hash can be moved afterwards. The compiled zod schema
 * is deliberately left alone; see {@link freezeDeep} for why.
 */
export function publishDefinition(
  draft: FormDefinition,
  options: CompileOptions = {}
): Result<PublishedFormDefinition, FormCompileError[]> {
  const compiled = compileDefinition(draft, options);
  if (!compiled.ok) {
    return err(compiled.error);
  }

  return ok(
    Object.freeze({
      key: compiled.value.key,
      version: compiled.value.version,
      status: 'PUBLISHED' as const,
      contentHash: definitionContentHash(compiled.value.definition),
      definition: compiled.value.definition,
      compiled: compiled.value,
    })
  );
}
