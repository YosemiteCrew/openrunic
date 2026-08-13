import { describe, expect, it } from 'vitest';

import * as terminology from './index.js';
import type {
  CodeNotFoundError,
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
  ExpandValueSetRequest,
  ExpansionTooLargeError,
  InMemoryTerminologyOptions,
  InvalidCodeVerdict,
  InvalidManifestError,
  InvalidRowsError,
  InvalidValueSetError,
  LoadCodeSystemRequest,
  LookupRequest,
  MissingAttestationError,
  RowCountMismatchError,
  SearchRequest,
  SortOrder,
  StoreTerminologyContext,
  StoreUnavailableError,
  SystemNotFoundError,
  TerminologyCodeCountArgs,
  TerminologyCodeFindFirstArgs,
  TerminologyCodeFindManyArgs,
  TerminologyCodeInput,
  TerminologyCodeOrderBy,
  TerminologyCodeRow,
  TerminologyCodeSelect,
  TerminologyCodeStore,
  TerminologyCodeWhere,
  TerminologyConcept,
  TerminologyError,
  TerminologyService,
  TerminologyStringFilter,
  ValidCodeVerdict,
  ValidateRequest,
  ValidationReason,
  ValidationVerdict,
  ValueSetDefinition,
  ValueSetExpansion,
  ValueSetNotFoundError,
  ValueSetRule,
} from './index.js';

/**
 * The package's public surface, asserted rather than assumed.
 *
 * Consumers of a leaf library depend on its exports the way they depend on a
 * schema, so adding one should be a deliberate act and removing one should
 * break here before it breaks somebody else's build. The runtime list below
 * catches value exports; the type list catches type exports, which leave no
 * trace at runtime, by naming every one of them in a shape the compiler has to
 * resolve.
 */

/** One property per exported type. A renamed or deleted type fails type-check, not this assertion. */
type ExportedTypes = {
  codeNotFoundError: CodeNotFoundError;
  codeSystemContentReader: CodeSystemContentReader;
  codeSystemFormat: CodeSystemFormat;
  codeSystemLicenceAttestation: CodeSystemLicenceAttestation;
  codeSystemLoad: CodeSystemLoad;
  codeSystemLoadError: CodeSystemLoadError;
  codeSystemManifest: CodeSystemManifest;
  codeSystemRowIssue: CodeSystemRowIssue;
  codeSystemRowIssueKind: CodeSystemRowIssueKind;
  contentHashMismatchError: ContentHashMismatchError;
  emptyContentError: EmptyContentError;
  expandValueSetRequest: ExpandValueSetRequest;
  expansionTooLargeError: ExpansionTooLargeError;
  inMemoryTerminologyOptions: InMemoryTerminologyOptions;
  invalidCodeVerdict: InvalidCodeVerdict;
  invalidManifestError: InvalidManifestError;
  invalidRowsError: InvalidRowsError;
  invalidValueSetError: InvalidValueSetError;
  loadCodeSystemRequest: LoadCodeSystemRequest;
  lookupRequest: LookupRequest;
  missingAttestationError: MissingAttestationError;
  rowCountMismatchError: RowCountMismatchError;
  searchRequest: SearchRequest;
  sortOrder: SortOrder;
  storeTerminologyContext: StoreTerminologyContext;
  storeUnavailableError: StoreUnavailableError;
  systemNotFoundError: SystemNotFoundError;
  terminologyCodeCountArgs: TerminologyCodeCountArgs;
  terminologyCodeFindFirstArgs: TerminologyCodeFindFirstArgs;
  terminologyCodeFindManyArgs: TerminologyCodeFindManyArgs;
  terminologyCodeInput: TerminologyCodeInput;
  terminologyCodeOrderBy: TerminologyCodeOrderBy;
  terminologyCodeRow: TerminologyCodeRow;
  terminologyCodeSelect: TerminologyCodeSelect;
  terminologyCodeStore: TerminologyCodeStore;
  terminologyCodeWhere: TerminologyCodeWhere;
  terminologyConcept: TerminologyConcept;
  terminologyError: TerminologyError;
  terminologyService: TerminologyService;
  terminologyStringFilter: TerminologyStringFilter;
  validCodeVerdict: ValidCodeVerdict;
  validateRequest: ValidateRequest;
  validationReason: ValidationReason;
  validationVerdict: ValidationVerdict;
  valueSetDefinition: ValueSetDefinition;
  valueSetExpansion: ValueSetExpansion;
  valueSetNotFoundError: ValueSetNotFoundError;
  valueSetRule: ValueSetRule;
};

describe('public API surface', () => {
  it('exports exactly these values', () => {
    expect(Object.keys(terminology).sort()).toStrictEqual([
      'CODE_SYSTEM_FORMATS',
      'CONTENT_HASH_PATTERN',
      'CONTENT_HASH_PREFIX',
      'DEFAULT_EXPANSION_LIMIT',
      'DEFAULT_MAX_EXPANSION_SIZE',
      'DEFAULT_SEARCH_LIMIT',
      'MAX_PAGE_SIZE',
      'MAX_REPORTED_ROW_ISSUES',
      'TSV_COLUMNS',
      'codeSystemManifestSchema',
      'conceptInValueSet',
      'conceptMatchesRule',
      'createInMemoryTerminologyService',
      'createStoreTerminologyService',
      'hashCodeSystemContent',
      'loadCodeSystem',
      'parseValueSetDefinition',
      'valueSetDefinitionSchema',
    ]);
  });

  it('exports exactly these types', () => {
    const surface: ExportedTypes | null = null;
    expect(surface).toBeNull();
  });

  it('ships no terminology content of its own', () => {
    // The package's central promise. Nothing exported here is a code, a
    // display, or a list of either: the only data it carries is its own
    // configuration constants.
    expect(terminology.CODE_SYSTEM_FORMATS).toStrictEqual(['ndjson', 'tsv']);
    expect(terminology.TSV_COLUMNS).toStrictEqual([
      'system',
      'code',
      'display',
      'version',
      'parentCode',
      'isActive',
    ]);
  });
});
