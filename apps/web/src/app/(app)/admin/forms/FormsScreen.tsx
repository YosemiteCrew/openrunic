'use client';

import {
  Badge,
  Button,
  Card,
  Checkbox,
  Icon,
  Input,
  Select,
  Switch,
  Tag,
  Toast,
} from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import { adminArea, adminBreadcrumb, ConfirmDialog } from '@/components/admin';
import type { Command } from '@/components/command';
import { ScreenCommands } from '@/components/command';
import { AppShell } from '@/components/shell';
import { AsyncBoundary } from '@/components/state';
import { useAdminClientOption, useFormDefinitions, useFormFieldTypes } from '@/lib/api';
import type { AdminClient, FormDefinition, FormField, FormFieldType, FormSection } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { searchWords } from '@/lib/i18n/counted';
import { useTranslator } from '@/lib/i18n/messages';

/**
 * AD-03 Form builder.
 *
 * The crown jewel, and the screen with the sharpest legacy failure to avoid:
 * LBF was powerful and hostile, configured through cryptic option strings with
 * no preview and an EAV store underneath. Here every capability is a visible
 * control, the preview is always one toggle away, a published version is
 * immutable and says so, and publishing states its consequence before it
 * happens.
 *
 * Three panes at 1440: the field catalogue, the canvas, the properties of the
 * selected field. Below 1280 they stack in that order, so the canvas is never
 * the thing that disappears.
 */

export interface FormsScreenProps {
  client?: AdminClient;
}

const PURPOSE_KEY: Record<FormDefinition['purpose'], string> = {
  DEMOGRAPHICS: 'admin.forms.purpose.demographics',
  ENCOUNTER: 'admin.forms.purpose.encounter',
  PORTAL_INTAKE: 'admin.forms.purpose.portalIntake',
  REFERRAL: 'admin.forms.purpose.referral',
};

/**
 * The version number the next publish will carry.
 *
 * A published form is immutable, so editing it starts the next version; a draft
 * is still the version it already claims to be. Nothing loaded yet publishes
 * as version 1.
 */
function nextVersionOf(definition: FormDefinition | null): number {
  if (!definition) return 1;
  return definition.status === 'PUBLISHED' ? definition.version + 1 : definition.version;
}

/**
 * A field added from the catalogue starts sensible and editable, never blank.
 *
 * The label and the first option are the record's own content rather than this
 * screen's copy: they are written into the form definition and read back by
 * every later render, so they are not translated here. The label comes from the
 * field type the API described; "Option 1" is the placeholder the author is
 * expected to replace before publishing.
 */
function newField(type: FormFieldType, sectionId: string, index: number): FormField {
  return {
    id: `new-${type.id}-${index}`,
    sectionId,
    label: type.label,
    type: type.id,
    required: false,
    portalVisible: true,
    graphable: type.id === 'number' || type.id === 'scale',
    writeOnce: false,
    helpText: null,
    options: type.id === 'single-select' || type.id === 'multi-select' ? ['Option 1'] : [],
    condition: null,
  };
}

/**
 * What one field on the canvas is, in words.
 *
 * Separate from the canvas because the canvas is about arrangement and this is
 * about meaning: the label a patient reads, whether an answer is required, and
 * whether a later visit is allowed to reuse it.
 */
function FieldProperties({
  selectedField,
  onEdit,
}: Readonly<{
  selectedField: FormField | null;
  onEdit: (patch: Partial<FormField>) => void;
}>): ReactElement {
  const t = useTranslator();

  return (
    <Card className="or-builder__pane" title={t('admin.forms.properties.title')}>
      {selectedField ? (
        <div className="or-stack">
          <Input
            label={t('admin.forms.properties.label')}
            value={selectedField.label}
            onChange={(event) => onEdit({ label: event.target.value })}
          />
          <Input
            label={t('admin.forms.properties.helpText')}
            value={selectedField.helpText ?? ''}
            hint={t('admin.forms.properties.helpTextHint')}
            onChange={(event) => onEdit({ helpText: event.target.value })}
          />
          <Checkbox
            label={t('admin.forms.properties.required')}
            checked={selectedField.required}
            onChange={() => onEdit({ required: !selectedField.required })}
          />
          <Checkbox
            label={t('admin.forms.properties.portalVisible')}
            checked={selectedField.portalVisible}
            onChange={() => onEdit({ portalVisible: !selectedField.portalVisible })}
          />
          <Checkbox
            label={t('admin.forms.properties.graphable')}
            hint={t('admin.forms.properties.graphableHint')}
            checked={selectedField.graphable}
            onChange={() => onEdit({ graphable: !selectedField.graphable })}
          />
          <Checkbox
            label={t('admin.forms.properties.askOnce')}
            hint={t('admin.forms.properties.askOnceHint')}
            checked={selectedField.writeOnce}
            onChange={() => onEdit({ writeOnce: !selectedField.writeOnce })}
          />
          <Input
            label={t('admin.forms.properties.showWhen')}
            value={selectedField.condition ?? ''}
            hint={t('admin.forms.properties.showWhenHint')}
            onChange={(event) => onEdit({ condition: event.target.value || null })}
          />
        </div>
      ) : (
        <p className="or-body">{t('admin.forms.properties.empty')}</p>
      )}
    </Card>
  );
}

/**
 * The form as it is arranged: sections, and the fields inside each one.
 *
 * Fields arrive already bucketed by section so the canvas does not rescan the
 * whole field list once per section, and every field is a button because
 * choosing one is what opens its properties.
 */
function FormCanvas({
  sections,
  fieldsBySection,
  selectedFieldId,
  onSelectField,
}: Readonly<{
  sections: readonly FormSection[];
  fieldsBySection: ReadonlyMap<string, FormField[]>;
  selectedFieldId: string | null;
  onSelectField: (id: string) => void;
}>): ReactElement {
  const t = useTranslator();

  return (
    <Card className="or-builder__pane or-builder__canvas" title={t('admin.forms.canvas.title')}>
      {sections.map((section) => (
        <section key={section.id} className="or-canvas__section">
          <h3 className="or-overline">{section.title}</h3>
          <ul className="or-canvas__fields">
            {(fieldsBySection.get(section.id) ?? []).map((field) => (
              <li key={field.id}>
                <button
                  type="button"
                  className="or-canvas__field"
                  aria-pressed={field.id === selectedFieldId}
                  onClick={() => onSelectField(field.id)}
                >
                  <span className="or-body">{field.label}</span>
                  <span className="or-cell-chips">
                    {/* The field type is the form engine's own vocabulary, read
                        back from the definition rather than named here. */}
                    <Tag>{field.type.replaceAll('-', ' ')}</Tag>
                    {field.required ? <Tag>{t('admin.forms.chip.required')}</Tag> : null}
                    {field.portalVisible ? <Tag>{t('admin.forms.chip.portal')}</Tag> : null}
                    {field.graphable ? <Tag>{t('admin.forms.chip.graphable')}</Tag> : null}
                    {field.writeOnce ? <Tag>{t('admin.forms.chip.askedOnce')}</Tag> : null}
                  </span>
                  {field.condition ? <span className="or-caption">{field.condition}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Card>
  );
}

export function FormsScreen({ client }: Readonly<FormsScreenProps>): ReactElement {
  const t = useTranslator();
  const options = useAdminClientOption(client);
  const forms = useFormDefinitions(options);
  const fieldTypes = useFormFieldTypes(options);

  const [formId, setFormId] = useState<string | null>(null);
  const [added, setAdded] = useState<FormField[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<FormField>>>({});
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [previewSurface, setPreviewSurface] = useState<'staff' | 'portal'>('portal');
  const [publishing, setPublishing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const startPreview = useCallback(() => setPreview(true), []);
  const startPublish = useCallback(() => setPublishing(true), []);

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'admin.forms.preview',
        group: 'actions',
        label: t('admin.forms.command.preview'),
        keywords: searchWords(t('admin.forms.command.preview.keywords')),
        icon: 'eye',
        perform: startPreview,
      },
      {
        id: 'admin.forms.publish',
        group: 'actions',
        label: t('admin.forms.command.publish'),
        keywords: searchWords(t('admin.forms.command.publish.keywords')),
        icon: 'upload',
        perform: startPublish,
      },
    ],
    [startPreview, startPublish, t]
  );

  const definitions = forms.data?.data ?? [];
  const definition = definitions.find((entry) => entry.id === formId) ?? definitions[0] ?? null;

  const fields: FormField[] = definition
    ? [...definition.fields, ...added].map((field) => ({ ...field, ...edits[field.id] }))
    : [];
  const selectedField = fields.find((field) => field.id === selectedFieldId) ?? null;

  /* Bucketed once rather than rescanned per section: the canvas renders every
     section and each one used to walk the whole field list looking for its own. */
  const fieldsBySection = new Map<string, FormField[]>();
  for (const field of fields) {
    const bucket = fieldsBySection.get(field.sectionId);
    if (bucket) bucket.push(field);
    else fieldsBySection.set(field.sectionId, [field]);
  }

  const nextVersion = nextVersionOf(definition);
  const dirty = added.length > 0 || Object.keys(edits).length > 0;

  const addField = (type: FormFieldType) => {
    if (!definition) return;
    const sectionId = definition.sections[0]?.id ?? 'section-1';
    const field = newField(type, sectionId, added.length + 1);
    setAdded((previous) => [...previous, field]);
    setSelectedFieldId(field.id);
    setPreview(false);
  };

  const editField = (patch: Partial<FormField>) => {
    if (!selectedField) return;
    setEdits((previous) => ({
      ...previous,
      [selectedField.id]: { ...previous[selectedField.id], ...patch },
    }));
  };

  return (
    <AppShell
      title={t(adminArea('forms').labelKey)}
      description={t('admin.forms.description')}
      breadcrumb={adminBreadcrumb(
        t,
        'forms',
        definition ? `${definition.name} v${definition.version}` : undefined
      )}
      actions={
        <>
          <Switch
            label={t('admin.forms.preview')}
            checked={preview}
            onChange={() => setPreview((value) => !value)}
          />
          <Button variant="primary" iconLeft="upload" disabled={!definition} onClick={startPublish}>
            {t('admin.forms.publishVersion', { version: nextVersion })}
          </Button>
        </>
      }
    >
      <ScreenCommands commands={commands} />

      <AsyncBoundary
        state={forms}
        subject={t('admin.forms.subject')}
        isEmpty={(payload) => payload.data.length === 0}
        empty={{
          title: t('admin.forms.empty.title'),
          message: t('admin.forms.empty.message'),
          icon: 'layout-template',
          action: <Button variant="primary">{t('admin.forms.empty.action')}</Button>,
        }}
      >
        {(payload) => {
          const current = definition ?? payload.data[0];
          if (!current) return null;

          return (
            <>
              <div className="or-builder__bar">
                <Select
                  label={t('admin.forms.formSelect')}
                  options={payload.data.map((entry) => ({
                    value: entry.id,
                    label: t('admin.forms.formOption', {
                      name: entry.name,
                      purpose: t(PURPOSE_KEY[entry.purpose]),
                    }),
                  }))}
                  value={current.id}
                  onChange={(event) => {
                    setFormId(event.target.value);
                    setAdded([]);
                    setEdits({});
                    setSelectedFieldId(null);
                  }}
                />
                <div className="or-cell-chips">
                  <Badge tone={current.status === 'PUBLISHED' ? 'success' : 'neutral'}>
                    {current.status === 'PUBLISHED'
                      ? t('admin.forms.versionPublished', { version: current.version })
                      : t('admin.forms.versionDraft', { version: current.version })}
                  </Badge>
                  <Tag>
                    {t('admin.forms.responses', {
                      count: current.responseCount.toLocaleString('en-US'),
                    })}
                  </Tag>
                  <Tag>
                    {t('admin.forms.updated', {
                      when: formatDateTime(current.updatedAt, 'dense'),
                      who: current.updatedBy,
                    })}
                  </Tag>
                </div>
              </div>

              {current.status === 'PUBLISHED' ? (
                <Card className="or-notice" data-tone="info">
                  <p className="or-body">
                    <strong>
                      {t('admin.forms.immutable.title', { version: current.version })}
                    </strong>{' '}
                    {dirty || current.hasUnpublishedChanges
                      ? t('admin.forms.immutable.dirty', { version: nextVersion })
                      : t('admin.forms.immutable.clean', { version: nextVersion })}
                  </p>
                </Card>
              ) : null}

              {preview ? (
                <Card title={t('admin.forms.previewTitle', { name: current.name })}>
                  <div className="or-builder__preview-switch">
                    <Select
                      label={t('admin.forms.renderedAs')}
                      options={[
                        { value: 'portal', label: t('admin.forms.surface.portal') },
                        { value: 'staff', label: t('admin.forms.surface.staff') },
                      ]}
                      value={previewSurface}
                      onChange={(event) =>
                        setPreviewSurface(event.target.value === 'staff' ? 'staff' : 'portal')
                      }
                    />
                  </div>
                  <div className="or-preview" data-surface={previewSurface}>
                    {current.sections.map((section) => {
                      const sectionFields = fields.filter(
                        (field) =>
                          field.sectionId === section.id &&
                          (previewSurface === 'staff' || field.portalVisible)
                      );
                      if (sectionFields.length === 0) return null;
                      return (
                        <section key={section.id} className="or-preview__section">
                          <h3 className="or-h3">{section.title}</h3>
                          {sectionFields.map((field) => (
                            <div key={field.id} className="or-preview__field">
                              <Input
                                label={
                                  field.required
                                    ? t('admin.forms.fieldLabelRequired', { label: field.label })
                                    : field.label
                                }
                                hint={field.helpText ?? undefined}
                                placeholder={
                                  field.options.length > 0 ? field.options.join(' / ') : undefined
                                }
                                readOnly
                              />
                              {field.condition ? (
                                <p className="or-caption">{field.condition}</p>
                              ) : null}
                            </div>
                          ))}
                        </section>
                      );
                    })}
                  </div>
                </Card>
              ) : (
                <div className="or-builder">
                  {/* ---- Catalogue ---------------------------------------- */}
                  <Card className="or-builder__pane" title={t('admin.forms.fieldTypes.title')}>
                    <p className="or-small">{t('admin.forms.fieldTypes.hint')}</p>
                    <AsyncBoundary
                      state={fieldTypes}
                      subject={t('admin.forms.fieldTypes.subject')}
                      isEmpty={(types) => types.length === 0}
                      loadingVariant="text"
                      loadingRows={8}
                      empty={{
                        title: t('admin.forms.fieldTypes.empty.title'),
                        message: t('admin.forms.fieldTypes.empty.message'),
                        icon: 'shapes',
                      }}
                    >
                      {(types) => (
                        <ul className="or-catalog">
                          {types.map((type) => (
                            <li key={type.id}>
                              <button
                                type="button"
                                className="or-catalog__item"
                                onClick={() => addField(type)}
                              >
                                <span className="or-catalog__icon" aria-hidden="true">
                                  <Icon name={type.icon} size={16} />
                                </span>
                                <span className="or-catalog__text">
                                  {/* The type's name and hint come from the form
                                      engine, so only the verb around them is
                                      this screen's to translate. */}
                                  <span className="or-body">
                                    {t('admin.forms.addField', { label: type.label })}
                                  </span>
                                  <span className="or-caption">{type.hint}</span>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </AsyncBoundary>
                  </Card>

                  <FormCanvas
                    sections={current.sections}
                    fieldsBySection={fieldsBySection}
                    selectedFieldId={selectedFieldId}
                    onSelectField={setSelectedFieldId}
                  />

                  <FieldProperties selectedField={selectedField} onEdit={editField} />
                </div>
              )}

              <ConfirmDialog
                open={publishing}
                title={t('admin.forms.publish.title', {
                  name: current.name,
                  version: nextVersion,
                })}
                consequence={t('admin.forms.publish.consequence', { version: nextVersion })}
                confirmLabel={t('admin.forms.publishVersion', { version: nextVersion })}
                onCancel={() => setPublishing(false)}
                onConfirm={() => {
                  setPublishing(false);
                  setToast(
                    t('admin.forms.publishedToast', {
                      name: current.name,
                      version: nextVersion,
                    })
                  );
                }}
              >
                <p className="or-body">
                  {t('admin.forms.publish.summary', {
                    fields: fields.length,
                    sections: current.sections.length,
                  })}{' '}
                  {added.length > 0
                    ? t('admin.forms.publish.added', {
                        count: added.length,
                        version: current.version,
                      })
                    : t('admin.forms.publish.noneAdded')}
                </p>
              </ConfirmDialog>
            </>
          );
        }}
      </AsyncBoundary>

      {toast ? (
        <div className="or-toast-region">
          <Toast tone="success" message={toast} onClose={() => setToast(null)} />
        </div>
      ) : null}
    </AppShell>
  );
}
