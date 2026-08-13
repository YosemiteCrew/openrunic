/**
 * `@openrunic/terminology`: bring-your-own code systems.
 *
 * This package ships loaders, a service contract and two implementations of it.
 * It ships NO terminology content, and it never will: the clinically useful
 * code systems are licensed, per country and per deployment, and redistributing
 * them would be making somebody else's licensing decision for them. The
 * deployer supplies their own files, `loadCodeSystem` verifies them, and the
 * manifest records who attested to the licence.
 *
 * Nothing here depends on a database driver, a filesystem or a network. It is a
 * leaf library on `@openrunic/types` and `zod`, so a mapper, a form definition,
 * an API handler and a test can all import it without inheriting anything.
 */

export {
  DEFAULT_EXPANSION_LIMIT,
  DEFAULT_MAX_EXPANSION_SIZE,
  DEFAULT_SEARCH_LIMIT,
  MAX_PAGE_SIZE,
} from './service.js';
export type {
  CodeNotFoundError,
  ExpandValueSetRequest,
  ExpansionTooLargeError,
  InvalidCodeVerdict,
  LookupRequest,
  SearchRequest,
  StoreUnavailableError,
  SystemNotFoundError,
  TerminologyConcept,
  TerminologyError,
  TerminologyService,
  ValidCodeVerdict,
  ValidateRequest,
  ValidationReason,
  ValidationVerdict,
  ValueSetExpansion,
  ValueSetNotFoundError,
} from './service.js';

export {
  conceptInValueSet,
  conceptMatchesRule,
  parseValueSetDefinition,
  valueSetDefinitionSchema,
} from './value-set.js';
export type { InvalidValueSetError, ValueSetDefinition, ValueSetRule } from './value-set.js';

export { createInMemoryTerminologyService } from './in-memory.js';
export type { InMemoryTerminologyOptions } from './in-memory.js';

export { createStoreTerminologyService } from './store.js';
export type {
  SortOrder,
  StoreTerminologyContext,
  TerminologyCodeCountArgs,
  TerminologyCodeFindFirstArgs,
  TerminologyCodeFindManyArgs,
  TerminologyCodeOrderBy,
  TerminologyCodeRow,
  TerminologyCodeSelect,
  TerminologyCodeStore,
  TerminologyCodeWhere,
  TerminologyStringFilter,
} from './store.js';

export {
  CONTENT_HASH_PATTERN,
  CONTENT_HASH_PREFIX,
  hashCodeSystemContent,
} from './content-hash.js';

export {
  CODE_SYSTEM_FORMATS,
  MAX_REPORTED_ROW_ISSUES,
  TSV_COLUMNS,
  codeSystemManifestSchema,
  loadCodeSystem,
} from './loader.js';
export type {
  CodeSystemContentReader,
  CodeSystemFormat,
  CodeSystemLicenceAttestation,
  CodeSystemLoad,
  CodeSystemLoadError,
  CodeSystemManifest,
  CodeSystemRowIssue,
  CodeSystemRowIssueKind,
  ContentHashMismatchError,
  EmptyContentError,
  InvalidManifestError,
  InvalidRowsError,
  LoadCodeSystemRequest,
  MissingAttestationError,
  RowCountMismatchError,
  TerminologyCodeInput,
} from './loader.js';
