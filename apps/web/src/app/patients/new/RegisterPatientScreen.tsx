'use client';

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
  validateRegistration,
} from '@/components/patients';
import type { FieldErrors, RegistrationDraft, RegistrationField } from '@/components/patients';
import { clinicNow } from '@/components/schedule';
import { AppShell } from '@/components/shell';
import { ADMINISTRATIVE_GENDERS, IS_MOCK_MODE, SENSITIVITY_CLASSES, usePatients } from '@/lib/api';
import type { AdministrativeGender, ApiClient, Patient, SensitivityClass } from '@/lib/api';
import { formatEnumLabel } from '@/lib/format';

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

const FIELD_LABEL: Record<string, string> = {
  given: 'Given name',
  family: 'Family name',
  birthDate: 'Date of birth',
  phoneMobile: 'Mobile number',
  email: 'Email',
};

/**
 * Everything a fieldset needs to render and report one field.
 *
 * Passed as one object rather than four props because the four always travel
 * together: a fieldset that can write a value but not mark it touched would
 * show its error at the wrong moment.
 */
interface FieldBindings {
  draft: RegistrationDraft;
  set: <K extends RegistrationField>(field: K, value: RegistrationDraft[K]) => void;
  markTouched: (field: RegistrationField) => void;
  showError: (field: RegistrationField) => string | undefined;
}

function IdentityFields({ fields }: Readonly<{ fields: FieldBindings }>): ReactElement {
  const { draft, set, markTouched, showError } = fields;
  return (
    <Card overline="Required" title="Identity">
      <div className="or-fd-form-grid">
        <Input
          id={fieldId('given')}
          label="Given name"
          required
          value={draft.given}
          error={showError('given')}
          onChange={(event) => set('given', event.target.value)}
          onBlur={() => markTouched('given')}
          autoComplete="off"
        />
        <Input
          id={fieldId('family')}
          label="Family name"
          required
          value={draft.family}
          error={showError('family')}
          onChange={(event) => set('family', event.target.value)}
          onBlur={() => markTouched('family')}
          autoComplete="off"
        />
        <Input
          id={fieldId('preferred')}
          label="Preferred name"
          hint="What the patient is called. Shown everywhere instead of the given name."
          value={draft.preferred}
          onChange={(event) => set('preferred', event.target.value)}
        />
        <Input
          id={fieldId('birthDate')}
          label="Date of birth"
          required
          mono
          placeholder="YYYY-MM-DD"
          value={draft.birthDate}
          error={showError('birthDate')}
          onChange={(event) => set('birthDate', event.target.value)}
          onBlur={() => markTouched('birthDate')}
        />
        <Select
          id={fieldId('sexAtBirth')}
          label="Sex at birth"
          hint="Recorded for clinical decision support. Gender identity is captured on the profile."
          value={draft.sexAtBirth}
          onChange={(event) => set('sexAtBirth', event.target.value as AdministrativeGender | '')}
          options={[
            { value: '', label: 'Not recorded' },
            ...ADMINISTRATIVE_GENDERS.map((option) => ({
              value: option,
              label: formatEnumLabel(option),
            })),
          ]}
        />
        <Input
          id={fieldId('pronouns')}
          label="Pronouns"
          placeholder="she/her"
          value={draft.pronouns}
          onChange={(event) => set('pronouns', event.target.value)}
        />
      </div>
    </Card>
  );
}

function ContactFields({ fields }: Readonly<{ fields: FieldBindings }>): ReactElement {
  const { draft, set, markTouched, showError } = fields;
  return (
    <Card overline="Required" title="Contact">
      <div className="or-fd-form-grid">
        <Input
          id={fieldId('phoneMobile')}
          label="Mobile number"
          required
          mono
          placeholder="+1 555 0142 118"
          value={draft.phoneMobile}
          error={showError('phoneMobile')}
          onChange={(event) => set('phoneMobile', event.target.value)}
          onBlur={() => markTouched('phoneMobile')}
        />
        <Input
          id={fieldId('email')}
          label="Email"
          type="email"
          hint="Needed only for portal access and email reminders."
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
  const { draft, set } = fields;
  return (
    <Card overline="Optional" title="Address">
      <div className="or-fd-form-grid">
        <Input
          id={fieldId('line1')}
          label="Street address"
          value={draft.line1}
          onChange={(event) => set('line1', event.target.value)}
        />
        <Input
          id={fieldId('city')}
          label="City"
          value={draft.city}
          onChange={(event) => set('city', event.target.value)}
        />
        <Input
          id={fieldId('state')}
          label="State"
          value={draft.state}
          onChange={(event) => set('state', event.target.value)}
        />
        <Input
          id={fieldId('postalCode')}
          label="Postal code"
          mono
          value={draft.postalCode}
          onChange={(event) => set('postalCode', event.target.value)}
        />
      </div>
    </Card>
  );
}

function AccessFields({ fields }: Readonly<{ fields: FieldBindings }>): ReactElement {
  const { draft, set } = fields;
  return (
    <Card overline="Optional" title="Access and privacy">
      <div className="or-fd-form-grid">
        <Select
          id={fieldId('languageCode')}
          label="Preferred language"
          value={draft.languageCode}
          onChange={(event) => set('languageCode', event.target.value)}
          options={[
            { value: 'en-US', label: 'English (US)' },
            { value: 'es-US', label: 'Spanish (US)' },
            { value: 'de-DE', label: 'German' },
            { value: 'sv-SE', label: 'Swedish' },
          ]}
        />
        <Select
          id={fieldId('sensitivityClass')}
          label="Record sensitivity"
          hint="Restricted records are visible only to the care team."
          value={draft.sensitivityClass}
          onChange={(event) => set('sensitivityClass', event.target.value as SensitivityClass)}
          options={SENSITIVITY_CLASSES.map((option) => ({
            value: option,
            label: formatEnumLabel(option),
          }))}
        />
        <Switch
          label="Invite to the patient portal"
          hint="Sends an invitation to the email address above."
          checked={draft.portalEnabled}
          onChange={() => set('portalEnabled', !draft.portalEnabled)}
        />
      </div>
    </Card>
  );
}

export function RegisterPatientScreen({
  client,
}: Readonly<RegisterPatientScreenProps>): ReactElement {
  const [draft, setDraft] = useState<RegistrationDraft>(EMPTY_DRAFT);
  const [touched, setTouched] = useState<ReadonlySet<RegistrationField>>(
    () => new Set<RegistrationField>()
  );
  const [submitted, setSubmitted] = useState(false);
  const [overridden, setOverridden] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [registered, setRegistered] = useState<string | null>(null);
  const [asOf] = useState<Date>(() => clinicNow());

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

  const fields: FieldBindings = { draft, set, markTouched, showError };

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
    setDraft(EMPTY_DRAFT);
    setTouched(new Set<RegistrationField>());
    setSubmitted(false);
    setOverridden(false);
  }, []);

  const confirmRegistration = () => {
    const name = `${draft.preferred || draft.given} ${draft.family}`.trim();
    setConfirming(false);
    setRegistered(name);
    reset();
  };

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'patients.new.register',
        group: 'actions',
        label: 'Register this patient',
        keywords: ['save', 'create patient', 'submit registration'],
        icon: 'user-plus',
        perform: submit,
      },
      {
        id: 'patients.new.clear',
        group: 'actions',
        label: 'Clear the registration form',
        keywords: ['reset', 'start again', 'empty form'],
        icon: 'eraser',
        perform: reset,
      },
    ],
    [reset, submit]
  );

  return (
    <AppShell
      title="Register patient"
      description="Four fields make a record bookable. Everything else can wait."
      actions={
        <>
          <Button variant="ghost" iconLeft="arrow-left" href="/patients">
            Back to patients
          </Button>
          <Button iconLeft="user-plus" onClick={submit}>
            Register patient
          </Button>
        </>
      }
    >
      <ScreenCommands commands={commands} />

      {submitted && errorList.length > 0 ? (
        <Card className="or-register__errors" title="Fix these before registering">
          <div role="alert">
            <ul className="or-register__error-list">
              {errorList.map(([field, message]) => (
                <li key={field}>
                  <a href={`#${fieldId(field)}`}>{FIELD_LABEL[field] ?? field}</a>: {message}
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
        <output className="or-body or-register__blocked">
          Registration is held until the possible duplicate above is resolved.
        </output>
      ) : null}

      {IS_MOCK_MODE ? (
        <p className="or-caption or-fd-mock-note">
          Mock mode: registration is not written to a database yet.
        </p>
      ) : null}

      {confirming ? (
        <Modal
          open
          role="alertdialog"
          width={520}
          title="Register this patient"
          description={`Create a record for ${draft.preferred || draft.given} ${draft.family}, born ${draft.birthDate}. An MRN is assigned on save and the record becomes bookable immediately.`}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button onClick={confirmRegistration}>Register patient</Button>
            </>
          }
        />
      ) : null}

      {registered ? (
        <div className="or-fd-toast-host">
          <Toast
            tone="success"
            title="Patient registered"
            message={`${registered} is in the practice and can be booked.`}
            action={
              <Button variant="ghost" size="sm" href="/schedule">
                Book an appointment
              </Button>
            }
            onClose={() => setRegistered(null)}
          />
        </div>
      ) : null}
    </AppShell>
  );
}
