'use client';

import { Button, Input, Modal, Select } from '@openrunic/ui';
import { useState } from 'react';
import type { ReactElement } from 'react';

import type { Patient } from '@/lib/api';
import { formatMrn, formatName, formatTime } from '@/lib/format';

import { givenName } from './schedule';
import type { OpenSlot } from './schedule';
import type { ScheduleProvider } from './ScheduleGrid';

/**
 * Booking into a chosen slot: three fields, everything else optional.
 *
 * The legacy appointment form fought walk-ins by demanding fields the workflow
 * did not need. Here the slot already carries the time and the provider, so
 * what is left is who and what for, and the reason line is genuinely optional.
 *
 * Library gap: this belongs in a right-side drawer (canon C17), which
 * @openrunic/ui does not have yet. It is composed on the library's Modal until
 * a Drawer primitive lands, and is flagged as a proposed addition.
 */

export interface BookingDetails {
  slot: OpenSlot;
  patientId: string;
  visitType: string;
  /** The code the visit type is booked under, carried inline on the appointment. */
  visitTypeCode: string;
  reason: string;
}

export interface BookingModalProps {
  slot: OpenSlot;
  providers: readonly ScheduleProvider[];
  patients: readonly Patient[];
  onCancel: () => void;
  onConfirm: (details: BookingDetails) => void;
  /** True while the booking is with the server. Holds the dialog open. */
  pending?: boolean;
  /** What the server said when it refused. Rendered in place, above the fields. */
  error?: string | null;
}

/**
 * The visit types the practice books, code first.
 *
 * The code travels with the appointment and the display is what the grid shows,
 * which is why both are here: an appointment records what it was booked as, and
 * renaming a catalogue entry later must not rewrite what a past visit was for.
 */
const VISIT_TYPES: readonly { code: string; display: string }[] = [
  { code: 'FOLLOWUP', display: 'Follow-up' },
  { code: 'ACUTE', display: 'Acute visit' },
  { code: 'CHRONIC', display: 'Chronic care' },
  { code: 'PHYSICAL', display: 'Annual physical' },
  { code: 'TELEHEALTH', display: 'Telehealth' },
];

const DEFAULT_VISIT_TYPE = VISIT_TYPES[0] ?? { code: 'FOLLOWUP', display: 'Follow-up' };

export function BookingModal({
  slot,
  providers,
  patients,
  onCancel,
  onConfirm,
  pending = false,
  error = null,
}: Readonly<BookingModalProps>): ReactElement {
  const [patientId, setPatientId] = useState(patients[0]?.id ?? '');
  const [visitTypeCode, setVisitTypeCode] = useState(DEFAULT_VISIT_TYPE.code);
  const [reason, setReason] = useState('');

  const providerName =
    providers.find((provider) => provider.id === slot.providerId)?.name ?? 'Unassigned';
  const patient = patients.find((candidate) => candidate.id === patientId);
  const visitType = VISIT_TYPES.find((type) => type.code === visitTypeCode) ?? DEFAULT_VISIT_TYPE;

  return (
    <Modal
      open
      width={560}
      title="Book appointment"
      description={`${formatTime(slot.start)} to ${formatTime(slot.end)} with ${providerName}. Booking holds the slot immediately.`}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={!patient || pending}
            onClick={() =>
              onConfirm({
                slot,
                patientId,
                visitType: visitType.display,
                visitTypeCode: visitType.code,
                reason,
              })
            }
          >
            {bookLabel(patient, pending)}
          </Button>
        </>
      }
    >
      {error ? (
        <p className="or-body" role="alert">
          {error}
        </p>
      ) : null}
      <div className="or-fd-form-grid">
        <Select
          label="Patient"
          value={patientId}
          onChange={(event) => setPatientId(event.target.value)}
          options={patients.map((candidate) => ({
            value: candidate.id,
            label: `${formatName(candidate.name, 'listing')} (${formatMrn(candidate.mrn)})`,
          }))}
        />
        <Select
          label="Visit type"
          hint="Drives the slot length."
          value={visitTypeCode}
          onChange={(event) => setVisitTypeCode(event.target.value)}
          options={VISIT_TYPES.map((type) => ({ value: type.code, label: type.display }))}
        />
        <Input
          label="Reason for visit"
          hint="Optional. One line the provider reads before walking in."
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
    </Modal>
  );
}

/** The verb names the patient, so the button says what it is about to do. */
function bookLabel(patient: Patient | undefined, pending: boolean): string {
  if (pending) return 'Booking...';
  return patient ? `Book ${givenName(patient.name)}` : 'Book appointment';
}
