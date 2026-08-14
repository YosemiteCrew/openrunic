# @openrunic/forms-engine

The runtime behind Openrunic's no-code forms. A clinical form is authored as data, compiled once
when it is published, and then run unchanged by the server, the browser, the printer and the FHIR
API.

This package is pure. No database, no network, no clock, no React. Everything it exports is a
function of its arguments, which is what lets the same code decide what a patient's browser draws
and what the API accepts, with no risk of the two disagreeing.

## What this package owns

- **The field catalogue.** Fifteen types, closed. `shortText`, `longText`, `number` (a quantity when
  it declares a unit), `date`, `datetime`, `singleSelect`, `multiSelect`, `boolean`, `scale`,
  `signature`, `fileReference`, `sectionHeader`, `staticText`, `codedValue`, and `repeatingGroup`.
- **The compiler.** One definition in, five artifacts out: a zod validator, a render tree, a print
  layout, a FHIR Questionnaire, and a promotion manifest.
- **The condition interpreter.** A pure, single-pass evaluator over a closed boolean grammar.
- **Validation.** The compiled schema plus the conditional-requirement pass.
- **Promotion.** The projection from one JSON document into indexed, typed values.
- **Versioning.** Content hashing, publishing, and the immutability rules that go with them.

What it does not own: storage, tenancy, identity and audit (`@openrunic/database`), the React
components that walk the render tree (`packages/ui`, `apps/web`, `apps/portal`), and the full FHIR
resource surface (`@openrunic/fhir`).

## Public interface

```ts
import {
  publishDefinition,
  compileDefinition,
  evaluateConditions,
  validateResponse,
  promote,
  toPromotionManifest,
  toQuestionnaireResponse,
  fromQuestionnaireResponse,
  assertPublishable,
  definitionContentHash,
} from '@openrunic/forms-engine';
```

The usual path through it:

```ts
// 1. Publish once. The result is frozen and carries its own content hash.
const published = publishDefinition(draft);
if (!published.ok) return renderBuilderErrors(published.error);
const compiled = published.value.compiled;

// 2. Draw. The render tree is plain JSON; the state map says what is on screen.
const states = evaluateConditions(compiled, values);

// 3. Accept or refuse. Errors carry fieldKey, repeatIndex and a machine code.
const checked = validateResponse(compiled, values);
if (!checked.ok) return renderFieldErrors(checked.error);

// 4. Store the document, then project it. promotableValues has hidden answers
//    removed; that projection is what the database package promotes.
const rows = promote(compiled, checked.value.promotableValues);

// 5. Leave the building as FHIR, and come back the same way.
const response = toQuestionnaireResponse(compiled, { values, status: 'COMPLETED' });
const restored = fromQuestionnaireResponse(compiled, response);
```

Expected failures come back as `Result`, never as exceptions. A form that will not compile is the
ordinary outcome of an administrator building a form, and a submission that will not validate is the
ordinary outcome of a patient filling one in. Both arrive as a full list attached to specific fields,
because an exception can only carry the first problem and a person filling in a form deserves to see
all of them at once.

## Why compile once, at publish time

A `FormDefinition` is versioned and immutable once published. Everything the product needs to run it
is derived at that moment and stored in `FormDefinition.compiled`; nothing is generated per request.

The obvious reason is cost. A busy practice renders the same intake form a few hundred times a day
and validates it as many times again, and re-deriving five artifacts from an immutable input on every
one of those requests is work that cannot change the answer.

The reason that matters more is stability. Because the artifacts are pinned to a definition that
cannot change, "does this submission validate" has the same answer next year as it does today, on
whatever engine version happens to be deployed. If the schema were derived per request, a deploy
could quietly start rejecting submissions that were accepted an hour earlier, and the only evidence
would be a support ticket.

Immutability is what makes a stored submission mean anything at all. A submission is one JSON
document plus a pointer to the definition version it was taken against. If that version could be
edited afterwards, adding a required field would retroactively invalidate years of completed intakes,
renaming a key would orphan their answers, and removing an option would leave stored answers the form
says are impossible. None of that is recoverable, because the form the patient actually saw would no
longer exist anywhere. So a published `(key, version)` is deep-frozen, and a change is a new version.
`assertPublishable` allows republishing byte-identical content, so a publish that failed halfway can
be retried, and refuses a quiet edit under a version number submissions already point at.

One artifact is rebuilt rather than stored: the zod schema, because a schema is not JSON. It is
regenerated by `compileDefinition` from the same immutable definition, so it cannot drift from the
artifacts beside it.

## Why conditions are data, not expressions

A condition is a small closed tree. Never a string to evaluate, never a callback:

```ts
{
  effect: 'show',
  when: {
    kind: 'all',
    of: [
      { kind: 'compare', field: 'pregnant', operator: 'equals', value: true },
      { kind: 'ordering', field: 'weeks', operator: 'greaterThanOrEqual', value: 20 },
    ],
  },
}
```

Ten leaf operators (`equals`, `notEquals`, `in`, `notIn`, `greaterThan`, `greaterThanOrEqual`,
`lessThan`, `lessThanOrEqual`, `isEmpty`, `isNotEmpty`), three combinators (`all`, `any`, `not`), and
four effects (`show`, `hide`, `require`, `optional`).

A form must never be able to execute logic. Forms are authored by practice administrators in a
builder UI, stored as tenant data, and executed on both the server and the patient's browser. If a
definition could carry an expression, then "add a field to the intake form" would become "deploy code
into every tenant", and the engine would have to sandbox something. It cannot, so it does not: the
grammar is closed, and the worst a hostile definition can do is describe a form nobody wants to fill
in. The same closure is what lets the condition tree be persisted, diffed, rendered in a builder UI,
and translated into FHIR `enableWhen`, none of which is possible with an opaque string.

Four guarantees hold at evaluation, each of them a test:

1. **One deterministic pass, in a compile-time topological order.** A condition never reads a field
   whose state has not settled, and the result does not depend on the order the author listed the
   fields in. A field may reference one declared after it; the compiler reorders.
2. **Hidden fields read as unanswered.** When B tests A's answer and A is hidden, B sees nothing.
   Otherwise closing a branch would leave the questions below it stuck open on the strength of an
   answer the respondent can no longer see. This is why the ordering above is load-bearing.
3. **Hidden implies not required.** A respondent can never be blocked by a question that is not on
   the screen.
4. **A cycle is a compile error, not a runtime hang.** "A shows when B is answered, B shows when A is
   answered" has no correct answer, so it is rejected at publish. Evaluation is then a plain walk
   over a list, with no visited set, no iteration cap, and no way to hang while a patient waits.

Hidden answers are **retained in the JSONB document, and ignored by validation and promotion**.
Clearing them would destroy data on a mis-click: a patient who ticks a box, fills in three follow-up
questions, then unticks it, would lose those answers permanently rather than getting them back when
they re-tick. The cost is that a stored document can hold answers nobody can currently see, so the
two places where acting on an unreachable answer would do harm both ignore them. An unreachable
answer must never block a submission, and it must never reach a flowsheet.

Conditions inside a repeating group resolve against that same repetition's answers. They may read
top-level fields, and they may not read another repetition; rows of a medication list are independent,
and a rule that could reach across them would make row order meaningful.

## Why this is not EAV

The tempting design for a no-code form engine is entity-attribute-value: one row per answered field,
with a type column and a pile of nullable value columns. It is tempting because it needs no schema
change when an administrator adds a field. It is also how a chart query becomes an unindexable join
tree, and it is not what this package does.

**A submission stays one row with one JSON document.** `FormSubmission.values` is a single JSONB
object, validated against the definition version's generated zod schema. Reading a completed form is
one primary-key read. A form with ninety questions is one row, not ninety.

**Promotion is a derived, rebuildable projection.** Fields an author explicitly marks graphable,
searchable or reportable, and only those, are also written to `FormPromotedValue` on save: one row per
`(submission, fieldKey, repeatIndex)`, exactly one populated typed column, plus `valueCodeSystem` for
coded answers and `valueUnit` for quantities. Nothing is promoted implicitly.

The difference from EAV is not the table shape, it is what the table is for and what it costs:

- **It is an index, not the record.** The JSON document is the source of truth. Promoted rows can be
  dropped and rebuilt from it at any time, because the projection is pure. An EAV table cannot be
  rebuilt from anything, because it _is_ the data.
- **It is a subset, not everything.** Only fields somebody opted into indexing are there, so the table
  stays small enough to index well. Blank answers produce no row at all, which keeps "not answered"
  and "answered blank" distinguishable and the table sparse.
- **Queries stay a single indexed scan.** `definitionKey`, `definitionVersion` and `effectiveAt` are
  denormalized onto every row, and the composite indexes are built for the two questions the product
  actually asks: graph one field for one patient over time, and find patients whose answer to one
  field matches. Both are one index scan. In EAV, the same questions are a self-join per attribute.
- **No dynamic DDL.** One fixed table with typed columns, rather than a generated table per form. The
  upgrade discipline is expand/contract migrations only, and per-form DDL emitted at publish time
  would fight it on every release.

The seam is drawn once and deliberately. This package decides _what_ is promoted and _what the typed
value is_, because it is the only place that knows the definition, the conditions and the field types.
`@openrunic/database` owns row identity: `id`, `tenantId`, `formSubmissionId`, `formDefinitionId`,
`patientId` and `effectiveAt` are facts about a write, not about a form.

One asymmetry matters. The database's promotion executor is intentionally blind to conditions,
because a second copy of the condition interpreter inside a database write is a second thing to keep
correct. `promote()` is not blind, and drops hidden answers. The two therefore agree only when the
write path hands the database the `promotableValues` projection that `validateResponse` returns. That
is the documented write path, and skipping it produces a flowsheet containing values from branches the
respondent closed.

## The submission document

`FormValues` is one flat object, one key per answerable field. Presentation fields never appear.

Answers to fields inside a repeating group are stored **columnar**: one array per child field, with
one entry per repetition, rather than an array of row objects.

```ts
{
  preferred_name: 'Testina Patientsson',
  weight: 71.5,
  symptoms: ['cough', 'fever'],
  med_name: ['Amoxil-ish', 'Panadeine-ish'],
  med_dose: [500, null],
}
```

This is not an aesthetic choice. It makes `repeatIndex` on a promoted row equal to the array index in
the document, so a promoted value can always be traced back to its JSON path without a join or a scan,
and it is the shape the database package's promotion executor reads. The number of repetitions is the
longest of a group's children's arrays, derived rather than stored, so there is no second source of
truth to fall out of step with the answers. An empty repetition is an explicit `null` at that index.

## Validation

`validateResponse` runs the compiled schema first, then the conditional-requirement pass, and joins
them: a schema violation on a field the conditions have hidden is discarded rather than reported.

The static schema asserts shape (types, bounds, option membership, ISO date formats, unrecognized
keys) and the field's base `required` flag. It asserts nothing about conditional requirement, because
a `require` or `optional` rule depends on other answers and encoding it into zod would mean
regenerating the schema per request. One carve-out: a field that a `show` or `hide` rule can take off
the page may legitimately be absent, so the schema declines to demand it and the conditional pass
demands it only when the field is actually visible.

Errors carry `fieldKey`, a `repeatIndex` when the answer sits inside a repeating group, and a
machine-readable `code`. `code` is the contract; `message` is a developer-facing sentence, because
user-facing copy is keyed off `code` where the ICU catalogues live.

## FHIR

`compiled.questionnaire` is a FHIR R4 `Questionnaire`, with `enableWhen` derived from the declarative
conditions. `toQuestionnaireResponse` and `fromQuestionnaireResponse` are inverses, which is what
makes the FHIR surface a real import path rather than an export-only courtesy.

What the mapping cannot carry it says out loud, in `compiled.questionnaireGaps`. FHIR's `enableWhen`
is a flat clause list joined by one `enableBehavior`, so a nested boolean tree has no representation,
and FHIR has no conditional requirement at all. Negation is pushed down to the leaves rather than
wrapped, so a `hide` rule becomes an enable clause list over inverted operators; a `not` of a leaf
becomes the inverted leaf. Emitting a Questionnaire that quietly behaves differently from the form the
patient filled in would be worse than emitting one that admits the difference.

`toQuestionnaireResponse` exports every present answer, including answers to fields conditions
currently hide, because the resource is a faithful copy of the stored document and the accompanying
Questionnaire's `enableWhen` already tells a consumer which items are enabled.

The structural FHIR types are declared locally rather than imported from `@openrunic/fhir`. This
package emits a handful of Questionnaire elements and consumes a handful more; depending on the whole
resource surface to describe that would couple the compiler's release cycle to the FHIR package's for
no type safety the local declarations do not already give.

## Compile-time refusals

`compileDefinition` reports every problem in one pass. The `code` values are the contract:

| Code                         | Meaning                                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `invalidFieldKey`            | A key that is not an identifier, so it cannot be a JSON key, a `linkId` and an indexed column value at once |
| `duplicateFieldKey`          | Keys must be unique across the whole definition, groups included                                            |
| `nestedRepeatingGroup`       | A group inside a group; `repeatIndex` would have to become a path                                           |
| `emptyRepeatingGroup`        | A group with no fields repeats nothing                                                                      |
| `emptyOptionList`            | A select with no options is a question nobody can answer                                                    |
| `duplicateOptionValue`       | Two options sharing a value make a stored answer ambiguous                                                  |
| `invalidScaleRange`          | A scale needs `min < max`, otherwise it has no positions                                                    |
| `missingCodeSystem`          | A coded field with no bound system emits codes nothing can resolve                                          |
| `unpromotableField`          | A promoted field whose type has no indexed column                                                           |
| `unknownConditionField`      | A condition reading a field the definition does not declare                                                 |
| `conditionTargetHasNoAnswer` | A condition reading a heading, static text, or a group container                                            |
| `crossRepeatReference`       | A condition reaching into another repetition                                                                |
| `emptyConditionGroup`        | An `all`/`any` with no children is vacuously true or false, never intended                                  |
| `conditionCycle`             | Conditions form a cycle; the error names the whole path                                                     |
| `versionAlreadyPublished`    | A different content hash under an already-published `(key, version)`                                        |

## Development

```bash
pnpm --filter @openrunic/forms-engine lint
pnpm --filter @openrunic/forms-engine type-check
pnpm --filter @openrunic/forms-engine test
pnpm --filter @openrunic/forms-engine build
```

Coverage is enforced at 95% statements, lines and functions, and 90% branches. Fixtures use invented
identities only; no real patient data belongs anywhere in this package.

## Licence

AGPL-3.0-only.
