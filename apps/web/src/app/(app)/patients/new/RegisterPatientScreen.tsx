'use client';

import type { Translator } from '@openrunic/i18n';
import { Button, Card, Input, Modal, Select, Switch } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import { Toast } from '@/components/state';
import type { Command } from '@/components/command';
import { ScreenCommands } from '@/components/command';
import {
  DuplicatePanel,
  EMPTY_DRAFT,
  findDuplicates,
  isBlocking,
  proposeMrn,
  toPatientCreateBody,
  validateRegistration,
} from '@/components/patients';
import type { FieldErrors, RegistrationDraft, RegistrationField } from '@/components/patients';
import { clinicNow } from '@/components/schedule';
import { AppShell } from '@/components/shell';
import {
  ADMINISTRATIVE_GENDERS,
  api,
  SENSITIVITY_CLASSES,
  useMutation,
  usePatients,
} from '@/lib/api';
import type { AdministrativeGender, ApiClient, Patient, SensitivityClass } from '@/lib/api';
import { SENSITIVITY_LABELS, SEX_AT_BIRTH_LABELS } from '@/components/patients/labels';
import { formatMrn } from '@/lib/format';
import { searchWords } from '@/lib/i18n/counted';
import { useTranslator } from '@/lib/i18n/messages';

/**
 * FD-06 Register a patient: four required fields, and no duplicate.
 *
 * The screen is built around the one thing that goes wrong at a front desk,
 * which is registering a person who is already in the practice. So the
 * duplicate check runs while the name is being typed, a strong match blocks the
 * save rather than warning about it, and the override is an explicit statement
 * rather than a second click on the same button.
 *
 * Everything else is deliberately optional. Legacy registration demanded fields the
 * workflow did not need and the front desk typed rubbish into them; a walk-in
 * here becomes bookable with a name, a date of birth and a phone number.
 *
 * Registration posts to `/patients` and the toast names the record the server
 * answered with, not the one that was typed. The difference matters: the MRN in
 * the confirmation is the one the practice now files this patient under, and a
 * refused save leaves the form exactly as it was rather than clearing it and
 * claiming success.
 */

export interface RegisterPatientScreenProps {
  /** Injectable for tests. Defaults to the app's `api`. */
  client?: ApiClient;
}

const NO_PATIENTS: readonly Patient[] = [];

/** Field ids are explicit so the error summary can link straight to the field. */
function fieldId(field: RegistrationField): string {
  return `register-${field}`;
}

/**
 * The label each field is named by in the error summary, as a catalogue key.
 *
 * Only the fields that can carry an error appear here, and each key is the same
 * one the field's own label uses: an error summary that named a field
 * differently from the field it links to would send somebody looking for a
 * control that is not there.
 */
const FIELD_LABEL_KEY: Record<string, string> = {
  mrn: 'patients.field.mrn',
  given: 'patients.field.given',
  family: 'patients.field.family',
  birthDate: 'patients.field.birthDate',
  phoneMobile: 'patients.field.phoneMobile',
  email: 'patients.field.email',
};

/**
 * What the error summary calls a field.
 *
 * Falls back to the field's own name, which is what the summary did before any
 * of this was translated: an unnamed link would be worse than a technical one.
 */
function fieldLabel(field: RegistrationField, t: Translator): string {
  const key = FIELD_LABEL_KEY[field];
  return key === undefined ? field : t(key);
}

/**
 * The languages a record can carry, as data.
 *
 * The tag is the stored value and is not copy; the label is. Kept as a table so
 * the four options are reviewable together rather than spelled out in JSX.
 */
const LANGUAGE_OPTIONS: readonly { value: string; labelKey: string }[] = [
  { value: 'en-US', labelKey: 'patients.language.enUS' },
  { value: 'es-US', labelKey: 'patients.language.esUS' },
  { value: 'de-DE', labelKey: 'patients.language.deDE' },
  { value: 'sv-SE', labelKey: 'patients.language.svSE' },
];

/**
 * Everything a fieldset needs to render and report one field.
 *
 * Passed as one object rather than five props because they always travel
 * together: a fieldset that can write a value but not mark it touched would
 * show its error at the wrong moment.
 */
interface FieldBindings {
  draft: RegistrationDraft;
  set: <K extends RegistrationField>(field: K, value: RegistrationDraft[K]) => void;
  markTouched: (field: RegistrationField) => void;
  /** The message for a field whose error should be showing, already rendered. */
  showError: (field: RegistrationField) => string | undefined;
  t: Translator;
}

function IdentityFields({ fields }: Readonly<{ fields: FieldBindings }>): ReactElement {
  const { draft, set, markTouched, showError, t } = fields;
  return (
    <Card overline={t('patients.section.required')} title={t('patients.section.identity')}>
      <div className="or-fd-form-grid">
        <Input
          id={fieldId('mrn')}
          label={t('patients.field.mrn')}
          mono
          hint={t('patients.field.mrnHint')}
          value={draft.mrn}
          error={showError('mrn')}
          onChange={(event) => set('mrn', event.target.value)}
          onBlur={() => markTouched('mrn')}
        />
        <Input
          id={fieldId('given')}
          label={t('patients.field.given')}
          required
          value={draft.given}
          error={showError('given')}
          onChange={(event) => set('given', event.target.value)}
          onBlur={() => markTouched('given')}
          autoComplete="off"
        />
        <Input
          id={fieldId('family')}
          label={t('patients.field.family')}
          required
          value={draft.family}
          error={showError('family')}
          onChange={(event) => set('family', event.target.value)}
          onBlur={() => markTouched('family')}
          autoComplete="off"
        />
        <Input
          id={fieldId('preferred')}
          label={t('patients.field.preferred')}
          hint={t('patients.field.preferredHint')}
          value={draft.preferred}
          onChange={(event) => set('preferred', event.target.value)}
        />
        <Input
          id={fieldId('birthDate')}
          label={t('patients.field.birthDate')}
          required
          mono
          placeholder={t('patients.field.birthDatePlaceholder')}
          value={draft.birthDate}
          error={showError('birthDate')}
          onChange={(event) => set('birthDate', event.target.value)}
          onBlur={() => markTouched('birthDate')}
        />
        {/* The gender options themselves are coded values from the API and are
            rendered through the shared enum formatter, not translated here. */}
        <Select
          id={fieldId('sexAtBirth')}
          label={t('patients.field.sexAtBirth')}
          hint={t('patients.field.sexAtBirthHint')}
          value={draft.sexAtBirth}
          onChange={(event) => set('sexAtBirth', event.target.value as AdministrativeGender | '')}
          options={[
            { value: '', label: t('patients.field.sexNotRecorded') },
            ...ADMINISTRATIVE_GENDERS.map((option) => ({
              value: option,
              label: t(SEX_AT_BIRTH_LABELS[option].labelKey),
            })),
          ]}
        />
        <Input
          id={fieldId('pronouns')}
          label={t('patients.field.pronouns')}
          placeholder={t('patients.field.pronounsPlaceholder')}
          value={draft.pronouns}
          onChange={(event) => set('pronouns', event.target.value)}
        />
      </div>
    </Card>
  );
}

function ContactFields({ fields }: Readonly<{ fields: FieldBindings }>): ReactElement {
  const { draft, set, markTouched, showError, t } = fields;
  return (
    <Card overline={t('patients.section.required')} title={t('patients.section.contact')}>
      <div className="or-fd-form-grid">
        <Input
          id={fieldId('phoneMobile')}
          label={t('patients.field.phoneMobile')}
          required
          mono
          placeholder={t('patients.field.phonePlaceholder')}
          value={draft.phoneMobile}
          error={showError('phoneMobile')}
          onChange={(event) => set('phoneMobile', event.target.value)}
          onBlur={() => markTouched('phoneMobile')}
        />
        <Input
          id={fieldId('email')}
          label={t('patients.field.email')}
          type="email"
          hint={t('patients.field.emailHint')}
          value={draft.email}
          error={showError('email')}
          onChange={(event) => set('email', event.target.value)}
          onBlur={() => markTouched('email')}
        />
      </div>
    </Card>
  );
}

function AddressFields({ fields }: Readonly<{ fields: FieldBindings }>): ReactElement {
  const { draft, set, t } = fields;
  return (
    <Card overline={t('patients.section.optional')} title={t('patients.section.address')}>
      <div className="or-fd-form-grid">
        <Input
          id={fieldId('line1')}
          label={t('patients.field.line1')}
          value={draft.line1}
          onChange={(event) => set('line1', event.target.value)}
        />
        <Input
          id={fieldId('city')}
          label={t('patients.field.city')}
          value={draft.city}
          onChange={(event) => set('city', event.target.value)}
        />
        <Input
          id={fieldId('state')}
          label={t('patients.field.state')}
          value={draft.state}
          onChange={(event) => set('state', event.target.value)}
        />
        <Input
          id={fieldId('postalCode')}
          label={t('patients.field.postalCode')}
          mono
          value={draft.postalCode}
          onChange={(event) => set('postalCode', event.target.value)}
        />
      </div>
    </Card>
  );
}

function AccessFields({ fields }: Readonly<{ fields: FieldBindings }>): ReactElement {
  const { draft, set, t } = fields;
  return (
    <Card overline={t('patients.section.optional')} title={t('patients.section.access')}>
      <div className="or-fd-form-grid">
        <Select
          id={fieldId('languageCode')}
          label={t('patients.field.language')}
          value={draft.languageCode}
          onChange={(event) => set('languageCode', event.target.value)}
          options={LANGUAGE_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.labelKey),
          }))}
        />
        {/* Sensitivity classes are coded values the API defines, so they keep
            the one name the enum formatter gives them everywhere. */}
        <Select
          id={fieldId('sensitivityClass')}
          label={t('patients.field.sensitivity')}
          hint={t('patients.field.sensitivityHint')}
          value={draft.sensitivityClass}
          onChange={(event) => set('sensitivityClass', event.target.value as SensitivityClass)}
          options={SENSITIVITY_CLASSES.map((option) => ({
            value: option,
            label: t(SENSITIVITY_LABELS[option].labelKey),
          }))}
        />
        <Switch
          label={t('patients.field.portal')}
          hint={t('patients.field.portalHint')}
          checked={draft.portalEnabled}
          onChange={() => set('portalEnabled', !draft.portalEnabled)}
        />
      </div>
    </Card>
  );
}

/** What the toast says once the record exists, taken from the server's answer. */
interface Registered {
  id: string;
  name: string;
  mrn: string;
}

export function RegisterPatientScreen({
  client,
}: Readonly<RegisterPatientScreenProps>): ReactElement {
  const t = useTranslator();
  const [asOf] = useState<Date>(() => clinicNow());
  const [draft, setDraft] = useState<RegistrationDraft>(() => ({
    ...EMPTY_DRAFT,
    mrn: proposeMrn(asOf),
  }));
  const [touched, setTouched] = useState<ReadonlySet<RegistrationField>>(
    () => new Set<RegistrationField>()
  );
  const [submitted, setSubmitted] = useState(false);
  const [overridden, setOverridden] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [registered, setRegistered] = useState<Registered | null>(null);

  function set<K extends RegistrationField>(field: K, value: RegistrationDraft[K]): void {
    setDraft((previous) => ({ ...previous, [field]: value }));
  }

  const markTouched = (field: RegistrationField) => {
    setTouched((previous) => new Set(previous).add(field));
  };

  /* The rules name their messages; the screen renders them. `errors` therefore
     holds catalogue keys, and nothing below is allowed to put one on screen
     without going through the translator. */
  const errors: FieldErrors = validateRegistration(draft, asOf);
  const showError = (field: RegistrationField): string | undefined => {
    const key = errors[field];
    if (key === undefined || !(submitted || touched.has(field))) return undefined;
    return t(key);
  };

  /* The duplicate probe searches the practice by family name, which is what the
     API's free-text search indexes; the scoring then weighs date of birth and
     phone number, which are the fields that actually identify a person. */
  const probe = draft.family.trim();
  const candidates = usePatients(
    { q: probe, pageSize: 50 },
    { client, enabled: probe.length >= 2 }
  );

  const matches = useMemo(
    () => findDuplicates(draft, candidates.data?.data ?? NO_PATIENTS),
    [candidates.data, draft]
  );
  const blocking = isBlocking(matches);
  const blocked = blocking && !overridden;

  const fields: FieldBindings = { draft, set, markTouched, showError, t };

  const errorList = Object.entries(errors) as Array<[RegistrationField, string]>;
  const hasErrors = errorList.length > 0;

  /* Both verbs are also palette commands, so they are memoised on the two
     booleans that decide what they do rather than on the whole draft. */
  const submit = useCallback(() => {
    setSubmitted(true);
    if (hasErrors || blocked) return;
    setConfirming(true);
  }, [blocked, hasErrors]);

  const reset = useCallback(() => {
    setDraft({ ...EMPTY_DRAFT, mrn: proposeMrn(asOf) });
    setTouched(new Set<RegistrationField>());
    setSubmitted(false);
    setOverridden(false);
  }, [asOf]);

  const registration = useMutation((body: Parameters<ApiClient['patients']['create']>[0]) =>
    (client ?? api).patients.create(body)
  );

  const confirmRegistration = async () => {
    const outcome = await registration.run(toPatientCreateBody(draft));
    // The form is only cleared once the record exists. A refused save leaves
    // everything typed exactly where it was, because the person at the desk
    // still has the patient in front of them.
    if (!outcome.ok) return;
    const saved = outcome.value;
    setConfirming(false);
    setRegistered({
      id: saved.id,
      name: `${saved.name.preferred ?? saved.name.given} ${saved.name.family}`.trim(),
      mrn: saved.mrn,
    });
    reset();
  };

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'patients.new.register',
        group: 'actions',
        label: t('patients.command.register'),
        keywords: searchWords(t('patients.command.register.keywords')),
        icon: 'user-plus',
        perform: submit,
      },
      {
        id: 'patients.new.clear',
        group: 'actions',
        label: t('patients.command.clearForm'),
        keywords: searchWords(t('patients.command.clearForm.keywords')),
        icon: 'eraser',
        perform: reset,
      },
    ],
    [reset, submit, t]
  );

  return (
    <AppShell
      title={t('patients.register.title')}
      description={t('patients.register.description')}
      actions={
        <>
          <Button variant="ghost" iconLeft="arrow-left" href="/patients">
            {t('patients.register.back')}
          </Button>
          <Button iconLeft="user-plus" onClick={submit}>
            {t('patients.register.submit')}
          </Button>
        </>
      }
    >
      <ScreenCommands commands={commands} />

      {submitted && errorList.length > 0 ? (
        <Card className="or-register__errors" title={t('patients.register.errorSummaryTitle')}>
          <div role="alert">
            <ul className="or-register__error-list">
              {errorList.map(([field, messageKey]) => (
                <li key={field}>
                  <a href={`#${fieldId(field)}`}>{fieldLabel(field, t)}</a>: {t(messageKey)}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      ) : null}

      {matches.length > 0 ? (
        <DuplicatePanel
          matches={matches}
          blocking={blocking}
          overridden={overridden}
          onOverrideChange={setOverridden}
          asOf={asOf}
        />
      ) : null}

      <IdentityFields fields={fields} />
      <ContactFields fields={fields} />
      <AddressFields fields={fields} />
      <AccessFields fields={fields} />

      {blocked ? (
        <output className="or-body or-register__blocked">{t('patients.register.blocked')}</output>
      ) : null}

      {confirming ? (
        <Modal
          open
          role="alertdialog"
          width={520}
          title={t('patients.register.confirmTitle')}
          description={t('patients.register.confirmBody', {
            name: `${draft.preferred || draft.given} ${draft.family}`,
            birthDate: draft.birthDate,
            mrn: formatMrn(draft.mrn),
          })}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button
                variant="secondary"
                disabled={registration.pending}
                onClick={() => setConfirming(false)}
              >
                {t('patients.register.cancel')}
              </Button>
              <Button disabled={registration.pending} onClick={confirmRegistration}>
                {registration.pending
                  ? t('patients.register.registering')
                  : t('patients.register.submit')}
              </Button>
            </>
          }
        >
          {registration.error ? (
            <p className="or-body" role="alert">
              {registration.error.problem?.detail ?? registration.error.message}
            </p>
          ) : null}
        </Modal>
      ) : null}

      {registered ? (
        <div className="or-fd-toast-host">
          <Toast
            tone="success"
            title={t('patients.register.toastTitle')}
            message={t('patients.register.toastMessage', {
              name: registered.name,
              mrn: formatMrn(registered.mrn),
            })}
            action={
              <Button variant="ghost" size="sm" href={`/patients/${registered.id}`}>
                {t('patients.register.openChart')}
              </Button>
            }
            onClose={() => setRegistered(null)}
          />
        </div>
      ) : null}
    </AppShell>
  );
}
