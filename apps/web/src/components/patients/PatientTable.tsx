'use client';

import { Badge, Button, Table } from '@openrunic/ui';
import type { TableColumn } from '@openrunic/ui';
import type { ReactElement } from 'react';

import type { Patient } from '@/lib/api';
import {
  formatAge,
  formatDate,
  formatEnumLabel,
  formatMrn,
  formatName,
  NOT_RECORDED,
} from '@/lib/format';

/**
 * The roster table.
 *
 * White surface, sticky header, one line per cell, and the row action at the
 * row end. The patient's name is the link, because that is what a person aims
 * at; the MRN sits beside it in mono so it can be read out character by
 * character over the phone.
 */

export interface PatientTableProps {
  patients: readonly Patient[];
  /** The instant ages are computed against, so a fixture render is stable. */
  asOf: Date;
  caption: string;
}

const COLUMNS: TableColumn[] = [
  { key: 'name', header: 'Patient' },
  { key: 'mrn', header: 'MRN', mono: true },
  { key: 'birthDate', header: 'Date of birth' },
  { key: 'age', header: 'Age', numeric: true },
  { key: 'sex', header: 'Sex at birth' },
  { key: 'contact', header: 'Mobile' },
  { key: 'status', header: 'Record status' },
  { key: 'actions', header: 'Actions', align: 'right' },
];

function statusBadge(patient: Patient): ReactElement {
  if (patient.deceasedAt) {
    return <Badge tone="neutral">Deceased {formatDate(patient.deceasedAt, 'dense')}</Badge>;
  }
  if (!patient.active) return <Badge tone="neutral">Inactive</Badge>;
  if (patient.sensitivityClass !== 'NORMAL') {
    return <Badge tone="danger">{formatEnumLabel(patient.sensitivityClass)}</Badge>;
  }
  return <Badge tone="success">Active</Badge>;
}

export function PatientTable({ patients, asOf, caption }: PatientTableProps): ReactElement {
  const rows = patients.map((patient) => ({
    id: patient.id,
    name: (
      <a className="or-roster__link" href={`/patients/${patient.id}`}>
        {formatName(patient.name, 'listing')}
      </a>
    ),
    mrn: formatMrn(patient.mrn),
    birthDate: formatDate(patient.birthDate),
    age: formatAge(patient.birthDate, asOf),
    sex: formatEnumLabel(patient.sexAtBirth),
    contact: patient.telecom.phoneMobile ?? NOT_RECORDED,
    status: statusBadge(patient),
    actions: (
      <Button
        variant="ghost"
        size="sm"
        iconLeft="shield-check"
        href={`/patients/${patient.id}/insurance`}
        aria-label={`Insurance and eligibility for ${formatName(patient.name)}`}
      >
        Insurance
      </Button>
    ),
  }));

  return <Table caption={caption} columns={COLUMNS} rows={rows} />;
}
