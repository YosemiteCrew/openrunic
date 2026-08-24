'use client';

import { Badge, Button, Table } from '@openrunic/ui';
import type { TableColumn } from '@openrunic/ui';
import { useMemo } from 'react';
import type { ReactElement } from 'react';
import type { Translator } from '@openrunic/i18n';

import type { Patient } from '@/lib/api';
import { formatAge, formatDate, formatMrn, formatName, NOT_RECORDED } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

import { SENSITIVITY_LABELS, SEX_AT_BIRTH_LABELS } from './labels';

/**
 * The roster table.
 *
 * White surface, sticky header, one line per cell, and the row action at the
 * row end. The patient's name is the link, because that is what a person aims
 * at; the MRN sits beside it in mono so it can be read out character by
 * character over the phone.
 *
 * Everything a person reads comes from the catalogue. What the record itself
 * carries - the name, the MRN, the dates, the mobile number - is rendered as it
 * arrived.
 */

export interface PatientTableProps {
  patients: readonly Patient[];
  /** The instant ages are computed against, so a fixture render is stable. */
  asOf: Date;
  caption: string;
}

/**
 * The roster's columns, carried as catalogue keys.
 *
 * Data rather than a translated constant, because the words depend on who is
 * reading and a module-scope constant is built before anybody has. The `Key`
 * suffix is also what `catalogue-drift.test.ts` reads, so a heading pointing at
 * a key nobody defined fails the build rather than appearing above a column.
 */
const COLUMNS: readonly (Omit<TableColumn, 'header'> & { headerKey: string })[] = [
  { key: 'name', headerKey: 'patients.table.column.name' },
  { key: 'mrn', headerKey: 'patients.table.column.mrn', mono: true },
  { key: 'birthDate', headerKey: 'patients.table.column.birthDate' },
  { key: 'age', headerKey: 'patients.table.column.age', numeric: true },
  { key: 'sex', headerKey: 'patients.table.column.sex' },
  { key: 'contact', headerKey: 'patients.table.column.contact' },
  { key: 'status', headerKey: 'patients.table.column.status' },
  { key: 'actions', headerKey: 'patients.table.column.actions', align: 'right' },
];

function statusBadge(t: Translator, patient: Patient): ReactElement {
  if (patient.deceasedAt) {
    return (
      <Badge tone="neutral">
        {t('patients.table.deceased', { date: formatDate(patient.deceasedAt, 'dense') })}
      </Badge>
    );
  }
  if (!patient.active) return <Badge tone="neutral">{t('patients.table.inactive')}</Badge>;
  if (patient.sensitivityClass !== 'NORMAL') {
    return <Badge tone="danger">{t(SENSITIVITY_LABELS[patient.sensitivityClass].labelKey)}</Badge>;
  }
  return <Badge tone="success">{t('patients.table.active')}</Badge>;
}

export function PatientTable({
  patients,
  asOf,
  caption,
}: Readonly<PatientTableProps>): ReactElement {
  const t = useTranslator();

  const columns = useMemo<TableColumn[]>(
    () => COLUMNS.map(({ headerKey, ...column }) => ({ ...column, header: t(headerKey) })),
    [t]
  );

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
    sex: t(SEX_AT_BIRTH_LABELS[patient.sexAtBirth].labelKey),
    contact: patient.telecom.phoneMobile ?? NOT_RECORDED,
    status: statusBadge(t, patient),
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
