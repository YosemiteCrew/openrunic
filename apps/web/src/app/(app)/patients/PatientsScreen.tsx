'use client';

import type { Translator } from '@openrunic/i18n';
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
import { counted, searchWords } from '@/lib/i18n/counted';
import type { CountedMessage } from '@/lib/i18n/counted';
import { useTranslator } from '@/lib/i18n/messages';

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

/**
 * The table's caption names the view, and the search term when there is one, so
 * a screen reader hears what the rows below were narrowed by.
 */
function tableCaption(viewLabel: string, search: string, t: Translator): string {
  const term = search.trim();
  if (!term) return viewLabel;
  return t('patients.roster.captionFiltered', { view: viewLabel, term });
}

/** "1 patient in this view", in the reader's language and its own plural rule. */
const ROSTER_COUNT: CountedMessage = {
  oneKey: 'patients.roster.countOne',
  otherKey: 'patients.roster.countOther',
};

export function PatientsScreen({ client }: Readonly<PatientsScreenProps>): ReactElement {
  const t = useTranslator();
  const [search, setSearch] = useState('');
  const [viewId, setViewId] = useState<string>(DEFAULT_VIEW_ID);
  const [asOf] = useState<Date>(() => clinicNow());

  const view = viewById(viewId);
  const query = useMemo(
    () => ({ ...view.query, q: search.trim() || undefined, pageSize: 100 }),
    [search, view]
  );
  const state = usePatients(query, { client });

  /* The command id is built from the view's own id and never from its label: an
     id derived from translated words changes when the reader's language does,
     and anything keyed on it stops matching. The keywords are per-language,
     with the view id appended because a stable token is worth typing too. */
  const commands = useMemo<Command[]>(
    () => [
      ...SAVED_VIEWS.map((saved): Command => ({
        id: `patients.view.${saved.id}`,
        group: 'actions',
        label: t(saved.commandKey),
        keywords: [...searchWords(t('patients.command.viewKeywords')), saved.id],
        icon: 'list-filter',
        perform: () => setViewId(saved.id),
      })),
      {
        id: 'patients.clear-search',
        group: 'actions',
        label: t('patients.command.clearSearch'),
        keywords: searchWords(t('patients.command.clearSearch.keywords')),
        icon: 'x',
        perform: () => setSearch(''),
      },
    ],
    [t]
  );

  return (
    <AppShell
      title={t('patients.roster.title')}
      description={t('patients.roster.description')}
      actions={
        <Button iconLeft="user-plus" href="/patients/new">
          {t('patients.roster.register')}
        </Button>
      }
    >
      <ScreenCommands commands={commands} />

      <Card overline={t('patients.roster.searchOverline')} title={t('patients.roster.searchTitle')}>
        <Input
          label={t('patients.roster.searchLabel')}
          hint={t('patients.roster.searchHint')}
          iconLeft="search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('patients.roster.searchPlaceholder')}
        />

        <fieldset className="or-roster__views" aria-label={t('patients.roster.savedViews')}>
          {SAVED_VIEWS.map((saved) => (
            <Button
              key={saved.id}
              size="sm"
              variant={saved.id === viewId ? 'secondary' : 'ghost'}
              aria-pressed={saved.id === viewId}
              onClick={() => setViewId(saved.id)}
            >
              {t(saved.labelKey)}
            </Button>
          ))}
        </fieldset>
        <p className="or-caption or-roster__view-note">{t(view.descriptionKey)}</p>
      </Card>

      <AsyncBoundary
        state={state}
        subject={t('patients.roster.subject')}
        loadingRows={8}
        isEmpty={isEmptyList}
        empty={{
          title: search.trim()
            ? t('patients.roster.emptySearchTitle')
            : t('patients.roster.emptyViewTitle'),
          message: search.trim()
            ? t('patients.roster.emptySearchMessage')
            : t('patients.roster.emptyViewMessage'),
          icon: 'user-search',
          action: (
            <Button iconLeft="user-plus" href="/patients/new">
              {t('patients.roster.register')}
            </Button>
          ),
        }}
      >
        {(page) => (
          <>
            <PatientTable
              patients={page.data}
              asOf={asOf}
              caption={tableCaption(t(view.labelKey), search, t)}
            />
            <p className="or-caption or-roster__count">
              {counted(t, ROSTER_COUNT, page.page.total)}
            </p>
          </>
        )}
      </AsyncBoundary>
    </AppShell>
  );
}
