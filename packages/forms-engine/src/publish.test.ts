import { describe, expect, it } from 'vitest';

import { definitionContentHash } from './canonical.js';
import type { FormDefinition } from './definition.js';
import { assertPublishable, publishDefinition } from './publish.js';
import type { PublishedFormDefinition, PublishedVersionRecord } from './publish.js';
import { formOf, intakeForm, mutate } from './test-support/forms.js';

function publishOrThrow(definition: FormDefinition): PublishedFormDefinition {
  const result = publishDefinition(definition);
  if (!result.ok) {
    throw new Error(`expected a clean publish, got ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

describe('definitionContentHash', () => {
  it('is a sha-256 digest of the authored document', () => {
    expect(definitionContentHash(intakeForm)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('does not depend on the order an editor wrote the JSON keys in', () => {
    const one: FormDefinition = {
      key: 'order_test',
      version: 1,
      title: 'Order test',
      bindTo: 'PATIENT',
      fields: [{ type: 'shortText', key: 'note', label: 'Note', maxLength: 10 }],
    };
    const other: FormDefinition = {
      fields: [{ maxLength: 10, label: 'Note', key: 'note', type: 'shortText' }],
      bindTo: 'PATIENT',
      title: 'Order test',
      version: 1,
      key: 'order_test',
    };
    expect(definitionContentHash(one)).toBe(definitionContentHash(other));
  });

  it('treats an absent optional key and an explicitly undefined one as the same content', () => {
    const withKey: FormDefinition = {
      key: 'undef_test',
      version: 1,
      title: 'Undefined test',
      description: undefined,
      bindTo: 'PATIENT',
      fields: [{ type: 'shortText', key: 'note', label: 'Note', helpText: undefined }],
    };
    const without: FormDefinition = {
      key: 'undef_test',
      version: 1,
      title: 'Undefined test',
      bindTo: 'PATIENT',
      fields: [{ type: 'shortText', key: 'note', label: 'Note' }],
    };
    expect(definitionContentHash(withKey)).toBe(definitionContentHash(without));
  });

  it('covers nested lists, numbers, booleans and nulls without collapsing them', () => {
    const base: FormDefinition = formOf([
      {
        type: 'multiSelect',
        key: 'tags',
        label: 'Tags',
        minSelected: 0,
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
        promote: { searchable: true, graphable: false },
      },
    ]);
    const reordered: FormDefinition = formOf([
      {
        type: 'multiSelect',
        key: 'tags',
        label: 'Tags',
        minSelected: 0,
        options: [
          { value: 'b', label: 'B' },
          { value: 'a', label: 'A' },
        ],
        promote: { searchable: true, graphable: false },
      },
    ]);
    expect(definitionContentHash(base)).toBe(definitionContentHash(base));
    expect(definitionContentHash(base)).not.toBe(definitionContentHash(reordered));
  });

  it('changes when any part of the content changes', () => {
    const before = definitionContentHash(intakeForm);
    expect(definitionContentHash({ ...intakeForm, title: 'Adult intake, revised' })).not.toBe(
      before
    );
    expect(definitionContentHash({ ...intakeForm, version: 4 })).not.toBe(before);
  });
});

describe('publishDefinition', () => {
  const published = publishOrThrow(intakeForm);

  it('stamps the status and the hash alongside the compiled artifacts', () => {
    expect(published.key).toBe('adult_intake');
    expect(published.version).toBe(3);
    expect(published.status).toBe('PUBLISHED');
    expect(published.contentHash).toBe(definitionContentHash(intakeForm));
    expect(published.compiled.questionnaire.resourceType).toBe('Questionnaire');
    expect(published.definition).toBe(published.compiled.definition);
  });

  it('refuses to publish a definition that will not compile', () => {
    const result = publishDefinition(
      formOf([{ type: 'scale', key: 'pain', label: 'Pain', min: 5, max: 1 }])
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error[0]?.code).toBe('invalidScaleRange');
  });

  it('honours compile options', () => {
    const result = publishDefinition(intakeForm, { baseUrl: 'https://clinic.invalid/fhir' });
    expect(result.ok && result.value.compiled.questionnaire.url).toBe(
      'https://clinic.invalid/fhir/Questionnaire/adult_intake'
    );
  });
});

describe('a published definition is structurally frozen', () => {
  const published = publishOrThrow(intakeForm);

  it('refuses to have its status or hash moved', () => {
    expect(() => {
      mutate(published, 'status', 'DRAFT');
    }).toThrow(TypeError);
    expect(() => {
      mutate(published, 'contentHash', 'sha256:0');
    }).toThrow(TypeError);
  });

  it('refuses edits to the definition, at every depth', () => {
    expect(() => {
      mutate(published.definition, 'title', 'Renamed');
    }).toThrow(TypeError);

    const field = published.definition.fields[0];
    expect(field).toBeDefined();
    if (field === undefined) {
      return;
    }
    expect(() => {
      mutate(field, 'label', 'Renamed');
    }).toThrow(TypeError);
    expect(() => {
      mutate(published.definition.fields, '0', field);
    }).toThrow(TypeError);
  });

  it('refuses edits to the compiled artifacts', () => {
    expect(() => {
      mutate(published.compiled.renderTree, 'title', 'Renamed');
    }).toThrow(TypeError);
    expect(() => {
      mutate(published.compiled.printLayout, 'title', 'Renamed');
    }).toThrow(TypeError);
    expect(() => {
      mutate(published.compiled.questionnaire, 'status', 'retired');
    }).toThrow(TypeError);
    expect(() => {
      mutate(published.compiled.promotionManifest, 'definitionVersion', 99);
    }).toThrow(TypeError);
    expect(() => {
      mutate(published.compiled, 'schema', null);
    }).toThrow(TypeError);
  });

  it('leaves the zod schema itself alone, so it can still parse', () => {
    expect(Object.isFrozen(published.compiled.schema)).toBe(false);
    expect(published.compiled.schema.safeParse({ preferred_name: 'Testina' }).success).toBe(true);
  });
});

describe('assertPublishable', () => {
  const history: readonly PublishedVersionRecord[] = [
    { key: 'adult_intake', version: 1, contentHash: 'sha256:aaa' },
    { key: 'adult_intake', version: 3, contentHash: definitionContentHash(intakeForm) },
    { key: 'other_form', version: 3, contentHash: 'sha256:bbb' },
  ];

  it('allows a version nobody has published', () => {
    const result = assertPublishable(history, { ...intakeForm, version: 4 });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toBe(definitionContentHash({ ...intakeForm, version: 4 }));
  });

  it('allows republishing byte-identical content, so a failed publish can be retried', () => {
    const result = assertPublishable(history, intakeForm);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toBe(definitionContentHash(intakeForm));
  });

  it('refuses a quiet edit under a version submissions already point at', () => {
    const edited: FormDefinition = { ...intakeForm, title: 'Adult intake, revised' };
    const result = assertPublishable(history, edited);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error[0]).toMatchObject({
      code: 'versionAlreadyPublished',
      definitionKey: 'adult_intake',
      version: 3,
      draftHash: definitionContentHash(edited),
    });
  });

  it('ignores history belonging to another form key or another version', () => {
    expect(assertPublishable(history, { ...intakeForm, key: 'brand_new_form' }).ok).toBe(true);
    expect(assertPublishable(history, { ...intakeForm, version: 2 }).ok).toBe(true);
  });

  it('refuses a draft that will not compile, whatever its version history', () => {
    const result = assertPublishable(
      [],
      formOf([{ type: 'singleSelect', key: 'p', label: 'P', options: [] }])
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error[0]?.code).toBe('emptyOptionList');
  });

  it('accepts compile options, so a self-hosted canonical base still validates', () => {
    expect(assertPublishable([], intakeForm, { status: 'draft' }).ok).toBe(true);
  });
});
