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

import { adminBreadcrumb, ConfirmDialog } from '@/components/admin';
import type { Command } from '@/components/command';
import { ScreenCommands } from '@/components/command';
import { AppShell } from '@/components/shell';
import { AsyncBoundary } from '@/components/state';
import { useAdminClientOption, useFormDefinitions, useFormFieldTypes } from '@/lib/api';
import type { AdminClient, FormDefinition, FormField, FormFieldType } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

/**
 * AD-03 Form builder.
 *
 * The crown jewel, and the screen with the sharpest OpenEMR failure to avoid:
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

const PURPOSE_LABEL: Record<FormDefinition['purpose'], string> = {
  DEMOGRAPHICS: 'Demographics',
  ENCOUNTER: 'Encounter',
  PORTAL_INTAKE: 'Portal intake',
  REFERRAL: 'Referral',
};

/** A field added from the catalogue starts sensible and editable, never blank. */
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

export function FormsScreen({ client }: FormsScreenProps = {}): ReactElement {
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
        label: 'Preview this form',
        keywords: ['see it', 'portal view', 'staff view'],
        icon: 'eye',
        perform: startPreview,
      },
      {
        id: 'admin.forms.publish',
        group: 'actions',
        label: 'Publish a new version',
        keywords: ['release', 'version', 'go live'],
        icon: 'upload',
        perform: startPublish,
      },
    ],
    [startPreview, startPublish]
  );

  const definitions = forms.data?.data ?? [];
  const definition = definitions.find((entry) => entry.id === formId) ?? definitions[0] ?? null;

  const fields: FormField[] = definition
    ? [...definition.fields, ...added].map((field) => ({ ...field, ...edits[field.id] }))
    : [];
  const selectedField = fields.find((field) => field.id === selectedFieldId) ?? null;

  const nextVersion = definition
    ? definition.status === 'PUBLISHED'
      ? definition.version + 1
      : definition.version
    : 1;
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
      title="Form builder"
      description="Build the forms behind intake, encounters, referrals and the portal. Published versions never change."
      breadcrumb={adminBreadcrumb(
        'Form builder',
        definition ? `${definition.name} v${definition.version}` : undefined
      )}
      actions={
        <>
          <Switch
            label="Preview"
            checked={preview}
            onChange={() => setPreview((value) => !value)}
          />
          <Button variant="primary" iconLeft="upload" disabled={!definition} onClick={startPublish}>
            Publish version {nextVersion}
          </Button>
        </>
      }
    >
      <ScreenCommands commands={commands} />

      <AsyncBoundary
        state={forms}
        subject="form definitions"
        isEmpty={(payload) => payload.data.length === 0}
        empty={{
          title: 'No forms yet',
          message:
            'Forms drive portal intake, encounter documentation and referrals. Build the first one and publish it to the surfaces that need it.',
          icon: 'layout-template',
          action: <Button variant="primary">Build a form</Button>,
        }}
      >
        {(payload) => {
          const current = definition ?? payload.data[0];
          if (!current) return null;

          return (
            <>
              <div className="or-builder__bar">
                <Select
                  label="Form"
                  options={payload.data.map((entry) => ({
                    value: entry.id,
                    label: `${entry.name} (${PURPOSE_LABEL[entry.purpose]})`,
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
                      ? `Version ${current.version}, published`
                      : `Version ${current.version}, draft`}
                  </Badge>
                  <Tag>{current.responseCount.toLocaleString('en-US')} responses</Tag>
                  <Tag>
                    Updated {formatDateTime(current.updatedAt, 'dense')} by {current.updatedBy}
                  </Tag>
                </div>
              </div>

              {current.status === 'PUBLISHED' ? (
                <Card className="or-notice" data-tone="info">
                  <p className="or-body">
                    <strong>Version {current.version} is published and cannot change.</strong>{' '}
                    {dirty || current.hasUnpublishedChanges
                      ? `Your edits are collecting in draft version ${nextVersion}. Responses already
                         collected stay attached to the version that captured them.`
                      : `Editing anything starts draft version ${nextVersion}. Responses already
                         collected stay attached to the version that captured them.`}
                  </p>
                </Card>
              ) : null}

              {preview ? (
                <Card title={`Preview: ${current.name}`}>
                  <div className="or-builder__preview-switch">
                    <Select
                      label="Rendered as"
                      options={[
                        { value: 'portal', label: 'Patient portal' },
                        { value: 'staff', label: 'Staff, compact' },
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
                                label={`${field.label}${field.required ? ' (required)' : ''}`}
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
                  <Card className="or-builder__pane" title="Field types">
                    <p className="or-small">
                      Adding a field puts it at the end of the first section. Select it on the
                      canvas to move or configure it.
                    </p>
                    <AsyncBoundary
                      state={fieldTypes}
                      subject="field types"
                      isEmpty={(types) => types.length === 0}
                      loadingVariant="text"
                      loadingRows={8}
                      empty={{
                        title: 'No field types available',
                        message:
                          'The form engine reports no field types, so nothing can be added. Reload the screen, and report it if the list stays empty.',
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
                                  <span className="or-body">Add {type.label}</span>
                                  <span className="or-caption">{type.hint}</span>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </AsyncBoundary>
                  </Card>

                  {/* ---- Canvas ------------------------------------------- */}
                  <Card className="or-builder__pane or-builder__canvas" title="Canvas">
                    {current.sections.map((section) => (
                      <section key={section.id} className="or-canvas__section">
                        <h3 className="or-overline">{section.title}</h3>
                        <ul className="or-canvas__fields">
                          {fields
                            .filter((field) => field.sectionId === section.id)
                            .map((field) => (
                              <li key={field.id}>
                                <button
                                  type="button"
                                  className="or-canvas__field"
                                  aria-pressed={field.id === selectedFieldId}
                                  onClick={() => setSelectedFieldId(field.id)}
                                >
                                  <span className="or-body">{field.label}</span>
                                  <span className="or-cell-chips">
                                    <Tag>{field.type.replaceAll('-', ' ')}</Tag>
                                    {field.required ? <Tag>Required</Tag> : null}
                                    {field.portalVisible ? <Tag>Portal</Tag> : null}
                                    {field.graphable ? <Tag>Graphable</Tag> : null}
                                    {field.writeOnce ? <Tag>Asked once</Tag> : null}
                                  </span>
                                  {field.condition ? (
                                    <span className="or-caption">{field.condition}</span>
                                  ) : null}
                                </button>
                              </li>
                            ))}
                        </ul>
                      </section>
                    ))}
                  </Card>

                  {/* ---- Properties --------------------------------------- */}
                  <Card className="or-builder__pane" title="Field properties">
                    {selectedField ? (
                      <div className="or-stack">
                        <Input
                          label="Label"
                          value={selectedField.label}
                          onChange={(event) => editField({ label: event.target.value })}
                        />
                        <Input
                          label="Help text"
                          value={selectedField.helpText ?? ''}
                          hint="One short sentence, in the patient's register on portal forms."
                          onChange={(event) => editField({ helpText: event.target.value })}
                        />
                        <Checkbox
                          label="Required"
                          checked={selectedField.required}
                          onChange={() => editField({ required: !selectedField.required })}
                        />
                        <Checkbox
                          label="Visible in the patient portal"
                          checked={selectedField.portalVisible}
                          onChange={() =>
                            editField({ portalVisible: !selectedField.portalVisible })
                          }
                        />
                        <Checkbox
                          label="Graphable"
                          hint="Numeric answers can be plotted on a flowsheet."
                          checked={selectedField.graphable}
                          onChange={() => editField({ graphable: !selectedField.graphable })}
                        />
                        <Checkbox
                          label="Ask once"
                          hint="Later visits read the stored answer instead of asking again."
                          checked={selectedField.writeOnce}
                          onChange={() => editField({ writeOnce: !selectedField.writeOnce })}
                        />
                        <Input
                          label="Show when"
                          value={selectedField.condition ?? ''}
                          hint="Leave empty to always show. Example: Show when Do you smoke? is Yes"
                          onChange={(event) => editField({ condition: event.target.value || null })}
                        />
                      </div>
                    ) : (
                      <p className="or-body">
                        Select a field on the canvas to change its label, whether it is required,
                        and where it appears.
                      </p>
                    )}
                  </Card>
                </div>
              )}

              <ConfirmDialog
                open={publishing}
                title={`Publish ${current.name} version ${nextVersion}`}
                consequence={`Version ${nextVersion} becomes the form every new response uses, and it can never be edited again. Responses already collected stay on the version that captured them.`}
                confirmLabel={`Publish version ${nextVersion}`}
                onCancel={() => setPublishing(false)}
                onConfirm={() => {
                  setPublishing(false);
                  setToast(
                    `${current.name} version ${nextVersion} is live on portal intake and encounters.`
                  );
                }}
              >
                <p className="or-body">
                  {fields.length} fields, {current.sections.length} sections.{' '}
                  {added.length > 0
                    ? `${added.length} added since version ${current.version}.`
                    : 'No fields added since the last version.'}
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
