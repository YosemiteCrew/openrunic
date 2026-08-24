'use client';

import type { Translator } from '@openrunic/i18n';
import { Button, Card, Input, Modal, Select, Switch, Toast } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import type { Command } from '@/components/command';
import { ScreenCommands } from '@/components/command';
import {
  DuplicatePanel,
  EMPTY_DRAFT,
  findDuplicates,
  isBlocking,
  LANGUAGE_OPTIONS,
  proposeMrn,
  SENSITIVITY_LABELS,
  SEX_AT_BIRTH_LABELS,
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
 *
 * Every word on this screen comes from the catalogue, including the validation
 * messages: `validateRegistration` is pure and returns keys, because it runs
 * before anything has rendered and cannot know who is reading. What the front
 * desk types is never translated - it is the patient's own name, number and
 * address, and it goes to the API exactly as given.
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
 * The label the error summary uses to name a field, as catalogue keys.
 *
 * Only the fields validation can fail on: everything else is optional and never
 * reaches the summary. Carried as data so the summary and the field itself are
 * guaranteed to read the same words rather than two copies of them.
 */
const FIELD_LABEL: Partial<Record<RegistrationField, { labelKey: string }>> = {
  mrn: { labelKey: 'patients.register.field.mrn' },
  given: { labelKey: 'patients.register.field.given' },
  family: { labelKey: 'patients.register.field.family' },
  birthDate: { labelKey: 'patients.register.field.birthDate' },
  phoneMobile: { labelKey: 'patients.register.field.phoneMobile' },
  email: { labelKey: 'patients.register.field.email' },
};

/**
 * The field's own label, or its name when validation has grown a rule for a
 * field the summary has no label for. The fallback is the field name rather
 * than nothing, because a summary row with no link text is a row nobody can
 * click.
 */
function fieldLabel(t: Translator, field: RegistrationField): string {
  const entry = FIELD_LABEL[field];
  return entry === undefined ? field : t(entry.labelKey);
}

/**
 * Everything a fieldset needs to render and report one field.
 *
 * Passed as one object rather than five props because they always travel
 * together: a fieldset that can write a value but not mark it touched would
 * show its error at the wrong moment. The translator rides along for the same
 * reason - a fieldset that could not look a message up would have nothing to
 * put under the input.
 */
interface FieldBindings {
  t: Translator;
  draft: RegistrationDraft;
  set: <K extends RegistrationField>(field: K, value: RegistrationDraft[K]) => void;
  markTouched: (field: RegistrationField) => void;
  /** The catalogue key of the error to show, or nothing while it is unearned. */
  showError: (field: RegistrationField) => string | undefined;
}

/** The error under a field, looked up, or nothing when there is none to show. */
function errorText(fields: FieldBindings, field: RegistrationField): string | undefined {
  const key = fields.showError(field);
  return key === undefined ? undefined : fields.t(key);
}

function IdentityFields({ fields }: Readonly<{ fields: FieldBindings }>): ReactElement {
  const { t, draft, set, markTouched } = fields;
  return (
    <Card overline={t('patients.register.required')} title={t('patients.register.identity')}>
      <div className="or-fd-form-grid">
        <Input
          id={fieldId('mrn')}
          label={t('patients.register.field.mrn')}
          mono
          hint={t('patients.register.field.mrnHint')}
          value={draft.mrn}
          error={errorText(fields, 'mrn')}
          onChange={(event) => set('mrn', event.target.value)}
          onBlur={() => markTouched('mrn')}
        />
        <Input
          id={fieldId('given')}
          label={t('patients.register.field.given')}
          required
          value={draft.given}
          error={errorText(fields, 'given')}
          onChange={(event) => set('given', event.target.value)}
          onBlur={() => markTouched('given')}
          autoComplete="off"
        />
        <Input
          id={fieldId('family')}
          label={t('patients.register.field.family')}
          required
          value={draft.family}
          error={errorText(fields, 'family')}
          onChange={(event) => set('family', event.target.value)}
          onBlur={() => markTouched('family')}
          autoComplete="off"
        />
        <Input
          id={fieldId('preferred')}
          label={t('patients.register.field.preferred')}
          hint={t('patients.register.field.preferredHint')}
          value={draft.preferred}
          onChange={(event) => set('preferred', event.target.value)}
        />
        <Input
          id={fieldId('birthDate')}
          label={t('patients.register.field.birthDate')}
          required
          mono
          placeholder={t('patients.register.field.birthDatePlaceholder')}
          value={draft.birthDate}
          error={errorText(fields, 'birthDate')}
          onChange={(event) => set('birthDate', event.target.value)}
          onBlur={() => markTouched('birthDate')}
        />
        <Select
          id={fieldId('sexAtBirth')}
          label={t('patients.register.field.sexAtBirth')}
          hint={t('patients.register.field.sexAtBirthHint')}
          value={draft.sexAtBirth}
          onChange={(event) => set('sexAtBirth', event.target.value as AdministrativeGender | '')}
          options={[
            { value: '', label: t('patients.sexAtBirth.notRecorded') },
            ...ADMINISTRATIVE_GENDERS.map((option) => ({
              value: option,
              label: t(SEX_AT_BIRTH_LABELS[option].labelKey),
            })),
          ]}
        />
        <Input
          id={fieldId('pronouns')}
          label={t('patients.register.field.pronouns')}
          placeholder={t('patients.register.field.pronounsPlaceholder')}
          value={draft.pronouns}
          onChange={(event) => set('pronouns', event.target.value)}
        />
      </div>
    </Card>
  );
}

function ContactFields({ fields }: Readonly<{ fields: FieldBindings }>): ReactElement {
  const { t, draft, set, markTouched } = fields;
  return (
    <Card overline={t('patients.register.required')} title={t('patients.register.contact')}>
      <div className="or-fd-form-grid">
        <Input
          id={fieldId('phoneMobile')}
          label={t('patients.register.field.phoneMobile')}
          required
          mono
          placeholder={t('patients.register.field.phoneMobilePlaceholder')}
          value={draft.phoneMobile}
          error={errorText(fields, 'phoneMobile')}
          onChange={(event) => set('phoneMobile', event.target.value)}
          onBlur={() => markTouched('phoneMobile')}
        />
        <Input
          id={fieldId('email')}
          label={t('patients.register.field.email')}
          type="email"
          hint={t('patients.register.field.emailHint')}
          value={draft.email}
          error={errorText(fields, 'email')}
          onChange={(event) => set('email', event.target.value)}
          onBlur={() => markTouched('email')}
        />
      </div>
    </Card>
  );
}

function AddressFields({ fields }: Readonly<{ fields: FieldBindings }>): ReactElement {
  const { t, draft, set } = fields;
  return (
    <Card overline={t('patients.register.optional')} title={t('patients.register.address')}>
      <div className="or-fd-form-grid">
        <Input
          id={fieldId('line1')}
          label={t('patients.register.field.line1')}
          value={draft.line1}
          onChange={(event) => set('line1', event.target.value)}
        />
        <Input
          id={fieldId('city')}
          label={t('patients.register.field.city')}
          value={draft.city}
          onChange={(event) => set('city', event.target.value)}
        />
        <Input
          id={fieldId('state')}
          label={t('patients.register.field.state')}
          value={draft.state}
          onChange={(event) => set('state', event.target.value)}
        />
        <Input
          id={fieldId('postalCode')}
          label={t('patients.register.field.postalCode')}
          mono
          value={draft.postalCode}
          onChange={(event) => set('postalCode', event.target.value)}
        />
      </div>
    </Card>
  );
}

function AccessFields({ fields }: Readonly<{ fields: FieldBindings }>): ReactElement {
  const { t, draft, set } = fields;
  return (
    <Card overline={t('patients.register.optional')} title={t('patients.register.access')}>
      <div className="or-fd-form-grid">
        <Select
          id={fieldId('languageCode')}
          label={t('patients.register.field.languageCode')}
          value={draft.languageCode}
          onChange={(event) => set('languageCode', event.target.value)}
          options={LANGUAGE_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.labelKey),
          }))}
        />
        <Select
          id={fieldId('sensitivityClass')}
          label={t('patients.register.field.sensitivityClass')}
          hint={t('patients.register.field.sensitivityHint')}
          value={draft.sensitivityClass}
          onChange={(event) => set('sensitivityClass', event.target.value as SensitivityClass)}
          options={SENSITIVITY_CLASSES.map((option) => ({
            value: option,
            label: t(SENSITIVITY_LABELS[option].labelKey),
          }))}
        />
        <Switch
          label={t('patients.register.field.portal')}
          hint={t('patients.register.field.portalHint')}
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

  const errors: FieldErrors = validateRegistration(draft, asOf);
  const showError = (field: RegistrationField): string | undefined =>
    submitted || touched.has(field) ? errors[field] : undefined;

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

  const fields: FieldBindings = { t, draft, set, markTouched, showError };

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
        label: t('patients.register.command.register'),
        keywords: searchWords(t('patients.register.command.registerKeywords')),
        icon: 'user-plus',
        perform: submit,
      },
      {
        id: 'patients.new.clear',
        group: 'actions',
        label: t('patients.register.command.clear'),
        keywords: searchWords(t('patients.register.command.clearKeywords')),
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
        <Card className="or-register__errors" title={t('patients.register.errors.title')}>
          <div role="alert">
            <ul className="or-register__error-list">
              {errorList.map(([field, messageKey]) => (
                <li key={field}>
                  <a href={`#${fieldId(field)}`}>{fieldLabel(t, field)}</a>: {t(messageKey)}
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
          title={t('patients.register.confirm.title')}
          /* The patient's own name and date of birth, and the number the record
             will be filed under, placed into one sentence rather than glued to
             translated fragments: word order differs by language. */
          description={t('patients.register.confirm.body', {
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
                {t('patients.register.confirm.cancel')}
              </Button>
              <Button disabled={registration.pending} onClick={confirmRegistration}>
                {registration.pending
                  ? t('patients.register.confirm.pending')
                  : t('patients.register.confirm.submit')}
              </Button>
            </>
          }
        >
          {registration.error ? (
            <p className="or-body" role="alert">
              {/* The server's own words. A problem document's detail is written
                  where the refusal happened and is not ours to rename. */}
              {registration.error.problem?.detail ?? registration.error.message}
            </p>
          ) : null}
        </Modal>
      ) : null}

      {registered ? (
        <div className="or-fd-toast-host">
          <Toast
            tone="success"
            title={t('patients.register.toast.title')}
            message={t('patients.register.toast.message', {
              name: registered.name,
              mrn: formatMrn(registered.mrn),
            })}
            action={
              <Button variant="ghost" size="sm" href={`/patients/${registered.id}`}>
                {t('patients.register.toast.openChart')}
              </Button>
            }
            onClose={() => setRegistered(null)}
          />
        </div>
      ) : null}
    </AppShell>
  );
}
