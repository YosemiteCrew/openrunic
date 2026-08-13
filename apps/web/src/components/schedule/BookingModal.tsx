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
 * OpenEMR's appointment form fought walk-ins by demanding fields the workflow
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
  reason: string;
}

export interface BookingModalProps {
  slot: OpenSlot;
  providers: readonly ScheduleProvider[];
  patients: readonly Patient[];
  onCancel: () => void;
  onConfirm: (details: BookingDetails) => void;
}

/** The visit types the fixtures use, so a booked slot matches the grid's categories. */
const VISIT_TYPES: readonly string[] = [
  'Follow-up',
  'Acute visit',
  'Chronic care',
  'Annual physical',
  'Telehealth',
];

export function BookingModal({
  slot,
  providers,
  patients,
  onCancel,
  onConfirm,
}: BookingModalProps): ReactElement {
  const [patientId, setPatientId] = useState(patients[0]?.id ?? '');
  const [visitType, setVisitType] = useState(VISIT_TYPES[0] ?? 'Follow-up');
  const [reason, setReason] = useState('');

  const providerName =
    providers.find((provider) => provider.id === slot.providerId)?.name ?? 'Unassigned';
  const patient = patients.find((candidate) => candidate.id === patientId);

  return (
    <Modal
      open
      width={560}
      title="Book appointment"
      description={`${formatTime(slot.start)} to ${formatTime(slot.end)} with ${providerName}. Booking holds the slot immediately.`}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={!patient}
            onClick={() => onConfirm({ slot, patientId, visitType, reason })}
          >
            {patient ? `Book ${givenName(patient.name)}` : 'Book appointment'}
          </Button>
        </>
      }
    >
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
          value={visitType}
          onChange={(event) => setVisitType(event.target.value)}
          options={[...VISIT_TYPES]}
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
