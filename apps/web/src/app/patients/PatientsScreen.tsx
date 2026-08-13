'use client';

import { Button, Card, Input } from '@openrunic/ui';
import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import type { Command } from '@/components/command';
import { ScreenCommands } from '@/components/command';
import { DEFAULT_VIEW_ID, PatientTable, SAVED_VIEWS, viewById } from '@/components/patients';
import { clinicNow } from '@/components/schedule';
import { AppShell } from '@/components/shell';
import { AsyncBoundary, isEmptyList } from '@/components/state';
import { usePatients } from '@/lib/api';
import type { ApiClient } from '@/lib/api';

/**
 * FD-06 Patient search: find the person, or find out they are not here yet.
 *
 * One dominant field searching name, preferred name and MRN together, and four
 * saved views that are named questions rather than four different search forms.
 * The zero-result state is the whole point of the screen: it does not shrug, it
 * offers registration, which is the only thing left to do.
 */

export interface PatientsScreenProps {
  /** Injectable for tests. Defaults to the app's `api`. */
  client?: ApiClient;
}

export function PatientsScreen({ client }: PatientsScreenProps = {}): ReactElement {
  const [search, setSearch] = useState('');
  const [viewId, setViewId] = useState<string>(DEFAULT_VIEW_ID);
  const [asOf] = useState<Date>(() => clinicNow());

  const view = viewById(viewId);
  const query = useMemo(
    () => ({ ...view.query, q: search.trim() || undefined, pageSize: 100 }),
    [search, view]
  );
  const state = usePatients(query, { client });

  const commands = useMemo<Command[]>(
    () => [
      ...SAVED_VIEWS.map((saved): Command => ({
        id: `patients.view.${saved.id}`,
        group: 'actions',
        label: `Show ${saved.label.toLowerCase()}`,
        keywords: ['roster', 'view', 'filter', saved.id],
        icon: 'list-filter',
        perform: () => setViewId(saved.id),
      })),
      {
        id: 'patients.clear-search',
        group: 'actions',
        label: 'Clear the patient search',
        keywords: ['reset', 'empty search'],
        icon: 'x',
        perform: () => setSearch(''),
      },
    ],
    []
  );

  return (
    <AppShell
      title="Patients"
      description="Find a patient, or register a new one without creating a duplicate."
      actions={
        <Button iconLeft="user-plus" href="/patients/new">
          Register new patient
        </Button>
      }
    >
      <ScreenCommands commands={commands} />

      <Card overline="Search" title="Find a patient">
        <Input
          label="Name, preferred name or MRN"
          hint="Searches as you type. Try a family name or an OR- number."
          iconLeft="search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Patientsson, Tess, OR-100482"
        />

        <div className="or-roster__views" role="group" aria-label="Saved views">
          {SAVED_VIEWS.map((saved) => (
            <Button
              key={saved.id}
              size="sm"
              variant={saved.id === viewId ? 'secondary' : 'ghost'}
              aria-pressed={saved.id === viewId}
              onClick={() => setViewId(saved.id)}
            >
              {saved.label}
            </Button>
          ))}
        </div>
        <p className="or-caption or-roster__view-note">{view.description}</p>
      </Card>

      <AsyncBoundary
        state={state}
        subject="the patient list"
        loadingRows={8}
        isEmpty={isEmptyList}
        empty={{
          title: search.trim() ? 'No patient matches that search' : 'No patients in this view',
          message: search.trim()
            ? 'Check the spelling, or search by MRN. If this person is new to the practice, register them.'
            : 'Nothing matches this saved view yet. Register a patient, or switch to all patients.',
          icon: 'user-search',
          action: (
            <Button iconLeft="user-plus" href="/patients/new">
              Register new patient
            </Button>
          ),
        }}
      >
        {(page) => (
          <>
            <PatientTable
              patients={page.data}
              asOf={asOf}
              caption={`${view.label}${search.trim() ? ` matching "${search.trim()}"` : ''}`}
            />
            <p className="or-caption or-roster__count">
              {page.page.total} {page.page.total === 1 ? 'patient' : 'patients'} in this view
            </p>
          </>
        )}
      </AsyncBoundary>
    </AppShell>
  );
}
