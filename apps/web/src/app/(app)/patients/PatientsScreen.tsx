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
 *
 * Everything a person reads comes from the catalogue, including the names of
 * the saved views, which `savedViews.ts` carries as keys so the words stay
 * reviewable in one place. What a patient record carries with it is rendered by
 * `PatientTable` as it arrived.
 */

export interface PatientsScreenProps {
  /** Injectable for tests. Defaults to the app's `api`. */
  client?: ApiClient;
}

/** How many people the current view holds, in the reader's own plural form. */
const PATIENT_COUNT: CountedMessage = {
  oneKey: 'patients.list.countOne',
  otherKey: 'patients.list.countOther',
};

/**
 * The table's caption names the view, and the search term when there is one, so
 * a screen reader hears what the rows below were narrowed by.
 *
 * One message with both parts interpolated rather than the view label glued to
 * a translated fragment: word order differs by language, and a sentence
 * assembled from pieces cannot be translated correctly.
 */
function tableCaption(t: Translator, viewLabel: string, search: string): string {
  const term = search.trim();
  if (!term) return viewLabel;
  return t('patients.list.captionSearch', { view: viewLabel, term });
}

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

  const commands = useMemo<Command[]>(
    () => [
      ...SAVED_VIEWS.map((saved): Command => ({
        id: `patients.view.${saved.id}`,
        group: 'actions',
        label: t('patients.list.command.showView', {
          /* Lower-cased with the reader's own rules: the word is a translated
             one, and the runtime default is wrong for Turkish. */
          view: t(saved.labelKey).toLocaleLowerCase(t.locale),
        }),
        keywords: [...searchWords(t('patients.list.command.showViewKeywords')), saved.id],
        icon: 'list-filter',
        perform: () => setViewId(saved.id),
      })),
      {
        id: 'patients.clear-search',
        group: 'actions',
        label: t('patients.list.command.clearSearch'),
        keywords: searchWords(t('patients.list.command.clearSearchKeywords')),
        icon: 'x',
        perform: () => setSearch(''),
      },
    ],
    [t]
  );

  return (
    <AppShell
      title={t('patients.list.title')}
      description={t('patients.list.description')}
      actions={
        <Button iconLeft="user-plus" href="/patients/new">
          {t('patients.list.registerNew')}
        </Button>
      }
    >
      <ScreenCommands commands={commands} />

      <Card overline={t('patients.list.searchOverline')} title={t('patients.list.searchTitle')}>
        <Input
          label={t('patients.list.searchLabel')}
          hint={t('patients.list.searchHint')}
          iconLeft="search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('patients.list.searchPlaceholder')}
        />

        <fieldset className="or-roster__views" aria-label={t('patients.list.savedViews')}>
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
        subject={t('patients.list.subject')}
        loadingRows={8}
        isEmpty={isEmptyList}
        empty={{
          title: search.trim()
            ? t('patients.list.empty.searchTitle')
            : t('patients.list.empty.title'),
          message: search.trim()
            ? t('patients.list.empty.searchMessage')
            : t('patients.list.empty.message'),
          icon: 'user-search',
          action: (
            <Button iconLeft="user-plus" href="/patients/new">
              {t('patients.list.registerNew')}
            </Button>
          ),
        }}
      >
        {(page) => (
          <>
            <PatientTable
              patients={page.data}
              asOf={asOf}
              caption={tableCaption(t, t(view.labelKey), search)}
            />
            <p className="or-caption or-roster__count">
              {counted(t, PATIENT_COUNT, page.page.total)}
            </p>
          </>
        )}
      </AsyncBoundary>
    </AppShell>
  );
}
