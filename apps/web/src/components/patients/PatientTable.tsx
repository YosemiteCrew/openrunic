'use client';

import type { Translator } from '@openrunic/i18n';
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
import { useTranslator } from '@/lib/i18n/messages';

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

/** A column with its header named rather than written. */
type ColumnSpec = Omit<TableColumn, 'header'> & { readonly headerKey: string };

/**
 * The columns, as data carrying their header keys.
 *
 * `key` is the row field the cell reads and is not copy; `headerKey` is what a
 * person sees. Keeping the two side by side is what stops a translated header
 * drifting away from the column it labels.
 */
const COLUMNS: readonly ColumnSpec[] = [
  { key: 'name', headerKey: 'patients.table.name' },
  { key: 'mrn', headerKey: 'patients.table.mrn', mono: true },
  { key: 'birthDate', headerKey: 'patients.table.birthDate' },
  { key: 'age', headerKey: 'patients.table.age', numeric: true },
  { key: 'sex', headerKey: 'patients.table.sex' },
  { key: 'contact', headerKey: 'patients.table.contact' },
  { key: 'status', headerKey: 'patients.table.status' },
  { key: 'actions', headerKey: 'patients.table.actions', align: 'right' },
];

/**
 * The record's own state in words, never colour alone.
 *
 * Deceased, inactive and active are the screen's own reading of `deceasedAt`
 * and `active`, so they are translated. The restricted badge beside them is
 * not: `sensitivityClass` arrives coded from the API and is rendered through
 * the shared enum formatter, and a second name on a coded value is how two
 * screens end up disagreeing about one record.
 */
function statusBadge(patient: Patient, t: Translator): ReactElement {
  if (patient.deceasedAt) {
    return (
      <Badge tone="neutral">
        {t('patients.status.deceased', { date: formatDate(patient.deceasedAt, 'dense') })}
      </Badge>
    );
  }
  if (!patient.active) return <Badge tone="neutral">{t('patients.status.inactive')}</Badge>;
  if (patient.sensitivityClass !== 'NORMAL') {
    return <Badge tone="danger">{formatEnumLabel(patient.sensitivityClass)}</Badge>;
  }
  return <Badge tone="success">{t('patients.status.active')}</Badge>;
}

export function PatientTable({
  patients,
  asOf,
  caption,
}: Readonly<PatientTableProps>): ReactElement {
  const t = useTranslator();

  const columns: TableColumn[] = COLUMNS.map(({ headerKey, ...column }) => ({
    ...column,
    header: t(headerKey),
  }));

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
    status: statusBadge(patient, t),
    actions: (
      <Button
        variant="ghost"
        size="sm"
        iconLeft="shield-check"
        href={`/patients/${patient.id}/insurance`}
        aria-label={t('patients.table.insuranceFor', { name: formatName(patient.name) })}
      >
        {t('patients.table.insurance')}
      </Button>
    ),
  }));

  return <Table caption={caption} columns={columns} rows={rows} />;
}
