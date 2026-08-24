'use client';

import { formatCount, plural } from '@openrunic/i18n';
import type { Interpolations, Translator } from '@openrunic/i18n';
import { Badge, Button, Card, Modal, Select, Table, Tag, Toast } from '@openrunic/ui';
import type { SelectOption, TableColumn } from '@openrunic/ui';
import { useCallback, useId, useMemo, useReducer, useRef, useState } from 'react';
import type { ChangeEvent, ReactElement, ReactNode, RefObject } from 'react';

import { ScreenCommands } from '@/components/command';
import type { Command } from '@/components/command';
import {
  DraftOrders,
  OrderPicker,
  ORDER_PRIORITY_LABELS,
  OrderWarnings,
} from '@/components/orders';
import type { DraftOrder } from '@/components/orders';
import { AppShell } from '@/components/shell';
import { AsyncBoundary, isEmptyList } from '@/components/state';
import { MOCK_NOW, patientProblems, rankCatalog, usePatients, warningsFor } from '@/lib/api';
import type {
  ApiClient,
  ListResponse,
  OrderCatalogEntry,
  OrderWarning,
  Patient,
  PatientProblem,
} from '@/lib/api';
import { formatAge, formatDate, formatMrn, formatName } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

import { EMPTY_COMPOSITION, reduceComposition } from './composition';

/**
 * OR-01 Order composer: labs, imaging and procedures on one surface.
 *
 * The screen is keyboard-first because ordering happens mid-sentence: the
 * catalogue field is a combobox that never loses focus, every favourite is a
 * palette command, and the review step is reachable without a pointer.
 *
 * The shape of it is build, then review and sign. Building is forgiving:
 * everything predictable is pre-filled and nothing blocks. Signing is
 * deliberate: it states what will happen, it lists anything standing in the way
 * in words, and a critical alert holds the signature until a reason is chosen.
 * That split is the answer to alert fatigue, which is what kills computerised
 * ordering when every warning is a wall.
 *
 * The legacy procedure order form was requisition paperwork first, with no
 * favourites and no ranking, so ordering began with remembering what the test
 * was called. Here the catalogue is ranked against the patient's problem list
 * before a single character is typed.
 *
 * Every sentence a person reads is a catalogue key. Everything an order brings
 * with it - its name, its code, its specimen, its destination, its turnaround,
 * the problems it is justified by - stays as it arrived, because those are
 * coded values that already have a name.
 */

/** Signed orders leave the composer. This is what the toast says they became. */
interface Completion {
  title: string;
  message: string;
}

/**
 * A message that has a form per count, as the pair of keys that hold them.
 *
 * Both forms are looked up and `plural` picks between them with the reader's
 * own rules, rather than `count === 1`. English has two forms and is the reason
 * everybody writes the comparison; a fork translating into Polish needs four,
 * and the failure of guessing is a sentence that reads as broken only to
 * somebody who speaks the language.
 */
interface CountedMessage {
  readonly oneKey: string;
  readonly otherKey: string;
}

const REVIEW_HEADING: CountedMessage = {
  oneKey: 'orders.new.review.headingOne',
  otherKey: 'orders.new.review.headingOther',
};

const SIGN_ACTION: CountedMessage = {
  oneKey: 'orders.new.signOne',
  otherKey: 'orders.new.signOther',
};

const PENDED_TITLE: CountedMessage = {
  oneKey: 'orders.new.pended.titleOne',
  otherKey: 'orders.new.pended.titleOther',
};

const SIGNED_TITLE: CountedMessage = {
  oneKey: 'orders.new.signed.titleOne',
  otherKey: 'orders.new.signed.titleOther',
};

const CONFIRM_BODY: CountedMessage = {
  oneKey: 'orders.new.confirm.bodyOne',
  otherKey: 'orders.new.confirm.bodyOther',
};

/**
 * The form the reader's language picks for this count.
 *
 * `formatCount` rather than the raw number, because the form and the digits are
 * two separate locale decisions and a message that got the grammar right and
 * the numerals wrong would still be wrong.
 */
function counted(
  t: Translator,
  message: CountedMessage,
  count: number,
  values: Interpolations = {}
): string {
  const filled = { ...values, count: formatCount(count, t.locale) };
  return plural(
    { one: t(message.oneKey, filled), other: t(message.otherKey, filled) },
    count,
    t.locale
  );
}

/**
 * The synonyms a tired person types instead of the label, as the navigation
 * table already carries its own: one comma-separated message per command, so a
 * translator replaces the whole set rather than a word of it. The lookup stays
 * at the call site so the key is a literal `catalogue-drift.test.ts` can find.
 */
function searchWords(words: string): string[] {
  return words
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word !== '');
}

export interface NewOrderScreenProps {
  /** Injectable for tests. Defaults to the app's client. */
  client?: ApiClient;
  /** Fixed "now", so elapsed values and ages match the fixtures in a test. */
  now?: string;
}

export function NewOrderScreen({
  client,
  now = MOCK_NOW,
}: Readonly<NewOrderScreenProps>): ReactElement {
  const t = useTranslator();
  const patients = usePatients({ active: true, pageSize: 50 }, { client });
  const page = patients.status === 'success' ? patients.data : null;

  /**
   * The composer's own shell carries actions and a right rail that cannot exist
   * until a patient is loaded, so `Composer` renders it. Every state before that
   * needs a shell of its own: a loading, empty or error page with no `<h1>`, no
   * navigation and nothing for the skip link to land on is an orphan the
   * keyboard cannot leave. Every other screen in the app puts its boundary
   * inside the shell; this one had it wrapped around the outside.
   */
  if (page !== null && !isEmptyList(page)) {
    return <Composer patients={page} now={now} />;
  }

  return (
    <AppShell title={t('orders.new.title')} description={t('orders.new.description')}>
      <AsyncBoundary
        state={patients}
        subject={t('orders.new.patients.subject')}
        isEmpty={isEmptyList}
        loadingVariant="cards"
        loadingRows={3}
        empty={{
          title: t('orders.new.patients.emptyTitle'),
          message: t('orders.new.patients.emptyMessage'),
          icon: 'users',
          action: (
            <Button href="/patients" iconLeft="user-plus">
              {t('orders.new.patients.emptyAction')}
            </Button>
          ),
        }}
      >
        {() => null}
      </AsyncBoundary>
    </AppShell>
  );
}

interface ComposerProps {
  patients: ListResponse<Patient>;
  now: string;
}

/** The review table's columns, as catalogue keys. See `OrdersScreen` for why. */
const REVIEW_COLUMNS: readonly (Omit<TableColumn, 'header'> & { headerKey: string })[] = [
  { key: 'order', headerKey: 'orders.new.review.column.order' },
  { key: 'code', headerKey: 'orders.new.review.column.code', mono: true },
  { key: 'priority', headerKey: 'orders.new.review.column.priority' },
  { key: 'specimen', headerKey: 'orders.new.review.column.specimen' },
  { key: 'diagnosis', headerKey: 'orders.new.review.column.diagnosis' },
  { key: 'destination', headerKey: 'orders.new.review.column.destination' },
];

/**
 * The build step: pick orders, answer their warnings, then go to review.
 *
 * Its own component so the composer reads as two steps rather than one long
 * conditional. It owns no state: everything it shows comes from the
 * composition, and everything it does is an action on it.
 */
function BuildStep({
  problems,
  drafts,
  warnings,
  cleared,
  searchInputId,
  onAdd,
  onUpdateDraft,
  onRemoveDraft,
  onClearWarning,
  onRestoreWarning,
  onReview,
}: Readonly<{
  problems: readonly PatientProblem[];
  drafts: readonly DraftOrder[];
  warnings: readonly OrderWarning[];
  cleared: Record<string, string>;
  searchInputId: string;
  onAdd: (entry: OrderCatalogEntry) => void;
  onUpdateDraft: (key: string, patch: Partial<DraftOrder>) => void;
  onRemoveDraft: (key: string) => void;
  onClearWarning: (warningId: string, reason: string) => void;
  onRestoreWarning: (warningId: string) => void;
  onReview: () => void;
}>): ReactElement {
  const t = useTranslator();

  return (
    <>
      <Card tone="cream" title={t('orders.new.build.addCard')}>
        <OrderPicker
          problems={[...problems]}
          draftedCodes={drafts.map((draft) => draft.entry.code)}
          onAdd={onAdd}
          searchInputId={searchInputId}
        />
      </Card>

      {drafts.length === 0 ? (
        <Card tone="cream" title={t('orders.new.build.emptyCard')}>
          <p className="or-body">{t('orders.new.build.emptyBody')}</p>
        </Card>
      ) : (
        <>
          <OrderWarnings
            warnings={[...warnings]}
            cleared={cleared}
            onClear={onClearWarning}
            onRestore={onRestoreWarning}
          />
          <DraftOrders
            drafts={[...drafts]}
            problems={[...problems]}
            onChange={onUpdateDraft}
            onRemove={onRemoveDraft}
          />
          <div className="or-cluster">
            <Button variant="secondary" iconRight="arrow-right" onClick={onReview}>
              {t('orders.new.build.review')}
            </Button>
          </div>
        </>
      )}
    </>
  );
}

/**
 * Who the order is for, and what is already known about them.
 *
 * The rail is what makes a wrong-patient order visible before it is signed, so
 * it names the chart, the age and the problem list rather than an id. The
 * problems themselves keep the display and the ICD-10 code the problem list
 * holds: a translated diagnosis label would be a second name for a code.
 */
function OrderingForRail({
  patient,
  problems,
  now,
}: Readonly<{
  patient: Patient;
  problems: readonly PatientProblem[];
  now: string;
}>): ReactElement {
  const t = useTranslator();

  return (
    <Card
      tone="cream"
      overline={t('orders.new.rail.overline')}
      title={formatName(patient.name, 'full')}
    >
      <dl className="or-keyvalues">
        <dt className="or-small">{t('orders.new.rail.mrn')}</dt>
        <dd className="or-mono">{formatMrn(patient.mrn)}</dd>
        <dt className="or-small">{t('orders.new.rail.age')}</dt>
        <dd className="or-small">
          {t('orders.new.rail.ageValue', {
            age: formatAge(patient.birthDate, now),
            birthDate: formatDate(patient.birthDate),
          })}
        </dd>
        <dt className="or-small">{t('orders.new.rail.problems')}</dt>
        <dd className="or-small">
          {problems.length === 0 ? (
            t('orders.new.rail.noProblems')
          ) : (
            <ul className="or-plainlist">
              {problems.map((problem) => (
                <li key={problem.code}>
                  {problem.display} <span className="or-mono">{problem.code}</span>
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
      <p className="or-small or-muted">{t('orders.new.rail.note')}</p>
    </Card>
  );
}

/**
 * What stands between this draft and a signature, in the order a person would
 * fix it: the criticals they must answer, then the diagnoses they must link.
 *
 * Separate from the component, because it is the rule that decides whether an
 * order can be signed. Never a disabled button with no explanation.
 *
 * It takes the translator rather than returning keys, because each blocker is
 * one sentence built around a name the API or the catalogue supplied - the
 * warning's title, the order's name - and splitting that into a key and a
 * fragment would be splitting the sentence a translator has to see whole.
 */
function signBlockers(
  t: Translator,
  drafts: readonly DraftOrder[],
  warnings: readonly OrderWarning[],
  cleared: Readonly<Record<string, string>>
): string[] {
  /* `flatMap` rather than `.filter().map()`: one pass over each list, and the
     empty array is the "not a blocker" case rather than a second traversal. */
  const openCriticals = warnings.flatMap((warning) =>
    warning.tier === 'CRITICAL' && !cleared[warning.id]
      ? [t('orders.new.blocker.critical', { warning: warning.title })]
      : []
  );

  const missingDiagnosis = drafts.flatMap((draft) =>
    draft.diagnosisCode ? [] : [t('orders.new.blocker.noDiagnosis', { order: draft.entry.name })]
  );

  return [...openCriticals, ...missingDiagnosis];
}

/**
 * The review step: the draft as a table, its warnings, and what still blocks a
 * signature.
 *
 * The blockers panel is the point of the step. It is a focusable `role="alert"`
 * so a sign attempt that cannot go through moves the caret to the reason,
 * rather than leaving a disabled button and no explanation.
 */
function ReviewStep({
  reviewRows,
  patientName,
  warnings,
  cleared,
  blockers,
  showBlockers,
  blockerRef,
  signLabel,
  onClearWarning,
  onRestoreWarning,
  onBack,
  onPend,
  onSign,
}: Readonly<{
  reviewRows: Record<string, ReactNode>[];
  patientName: string;
  warnings: readonly OrderWarning[];
  cleared: Record<string, string>;
  blockers: readonly string[];
  showBlockers: boolean;
  blockerRef: RefObject<HTMLDivElement | null>;
  signLabel: string;
  onClearWarning: (warningId: string, reason: string) => void;
  onRestoreWarning: (warningId: string) => void;
  onBack: () => void;
  onPend: () => void;
  onSign: () => void;
}>): ReactElement {
  const t = useTranslator();
  const columns = useMemo<TableColumn[]>(
    () => REVIEW_COLUMNS.map(({ headerKey, ...column }) => ({ ...column, header: t(headerKey) })),
    [t]
  );
  const heading = t('orders.new.blockers.heading');

  return (
    <>
      <Card tone="cream" title={counted(t, REVIEW_HEADING, reviewRows.length)}>
        {reviewRows.length === 0 ? (
          <p className="or-body">{t('orders.new.review.empty')}</p>
        ) : (
          <Table
            columns={columns}
            rows={reviewRows}
            caption={t('orders.new.review.caption', { patient: patientName })}
          />
        )}
      </Card>

      <OrderWarnings
        warnings={[...warnings]}
        cleared={cleared}
        onClear={onClearWarning}
        onRestore={onRestoreWarning}
      />

      {showBlockers && blockers.length > 0 ? (
        <div
          ref={blockerRef}
          tabIndex={-1}
          role="alert"
          className="or-blockers"
          aria-label={heading}
        >
          <h3 className="or-h3">{heading}</h3>
          <ul className="or-blockers__list">
            {blockers.map((blocker) => (
              <li key={blocker} className="or-small">
                {blocker}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="or-cluster">
        <Button variant="ghost" iconLeft="arrow-left" onClick={onBack}>
          {t('orders.new.review.back')}
        </Button>
        <Button variant="secondary" iconLeft="inbox" onClick={onPend}>
          {t('orders.new.pend')}
        </Button>
        <Button iconLeft="pen-line" onClick={onSign}>
          {signLabel}
        </Button>
      </div>
    </>
  );
}

function Composer({ patients, now }: Readonly<ComposerProps>): ReactElement {
  const t = useTranslator();
  const rows = patients.data;
  const [patientId, setPatientId] = useState(rows[0]?.id ?? '');
  /* One composition rather than four settings: see `composition.ts` for why
     signing and switching patients have to move all of them together. */
  const [composition, dispatch] = useReducer(reduceComposition, EMPTY_COMPOSITION);
  const { drafts, cleared, step, showBlockers } = composition;
  const [confirming, setConfirming] = useState(false);
  const [completion, setCompletion] = useState<Completion | null>(null);

  const draftKeySeed = useRef(0);
  const searchInputId = useId();
  const blockerRef = useRef<HTMLDivElement>(null);

  const patient = rows.find((row) => row.id === patientId) ?? rows[0];
  const problems = useMemo(() => patientProblems(patient?.id ?? null), [patient?.id]);
  const patientName = patient ? formatName(patient.name, 'full') : t('orders.new.thisPatient');

  const warnings = useMemo(
    () =>
      warningsFor(
        patient?.id ?? null,
        drafts.map((draft) => draft.entry.code)
      ),
    [patient?.id, drafts]
  );

  const blockers = useMemo(
    () => signBlockers(t, drafts, warnings, cleared),
    [t, drafts, warnings, cleared]
  );

  const addOrder = useCallback(
    (entry: OrderCatalogEntry) => {
      draftKeySeed.current += 1;
      /* A set, because this scans every problem against every code the entry
         lists, and both grow with the patient. */
      const entryCodes = new Set(entry.problemCodes);
      const suggested = problems.find((problem) => entryCodes.has(problem.code));
      dispatch({
        type: 'add',
        draft: {
          key: `${entry.code}-${draftKeySeed.current}`,
          entry,
          priority: 'ROUTINE',
          specimen: entry.specimen,
          // Pre-fill everything predictable: one obvious diagnosis is predictable.
          diagnosisCode: suggested?.code ?? null,
        },
      });
      setCompletion(null);
    },
    [problems]
  );

  const updateDraft = useCallback((key: string, patch: Partial<DraftOrder>) => {
    dispatch({ type: 'update', key, patch });
  }, []);

  const removeDraft = useCallback((key: string) => {
    dispatch({ type: 'remove', key });
  }, []);

  const clearWarning = useCallback((warningId: string, reason: string) => {
    dispatch({ type: 'clearWarning', warningId, reason });
  }, []);

  const restoreWarning = useCallback((warningId: string) => {
    dispatch({ type: 'restoreWarning', warningId });
  }, []);

  const finish = useCallback((title: string, message: string) => {
    dispatch({ type: 'reset' });
    setConfirming(false);
    setCompletion({ title, message });
  }, []);

  const pend = useCallback(() => {
    if (drafts.length === 0) return;
    finish(counted(t, PENDED_TITLE, drafts.length), t('orders.new.pended.message'));
  }, [t, drafts.length, finish]);

  const requestSign = useCallback(() => {
    if (drafts.length === 0) return;
    dispatch({ type: 'goTo', step: 'review' });
    if (blockers.length > 0) {
      dispatch({ type: 'revealBlockers' });
      // Move the caret to the reason, not just the scroll position.
      window.requestAnimationFrame(() => blockerRef.current?.focus());
      return;
    }
    setConfirming(true);
  }, [drafts.length, blockers.length]);

  const sign = useCallback(() => {
    const count = drafts.length;
    const destinations = [...new Set(drafts.map((draft) => draft.entry.destination))];
    finish(
      counted(t, SIGNED_TITLE, count),
      t('orders.new.signed.message', {
        /* The destinations are catalogue names and stay as they are; only the
           way a language joins a list of them is a locale decision, and
           `Intl.ListFormat` is the one that knows it. */
        destinations: new Intl.ListFormat(t.locale, {
          style: 'long',
          type: 'conjunction',
        }).format(destinations),
      })
    );
  }, [t, drafts, finish]);

  const changePatient = useCallback(
    (nextId: string) => {
      setPatientId(nextId);
      if (drafts.length > 0) {
        dispatch({ type: 'reset' });
        setCompletion({
          title: t('orders.new.cleared.title'),
          message: t('orders.new.cleared.message'),
        });
      }
    },
    [t, drafts.length]
  );

  const commands = useMemo<Command[]>(() => {
    const catalogueFavourites = rankCatalog('', problems)
      .filter((entry) => entry.favourite)
      .slice(0, FAVOURITE_COMMAND_LIMIT);
    return [
      {
        id: 'orders.new.search',
        group: 'actions',
        label: t('orders.new.command.search'),
        keywords: searchWords(t('orders.new.command.searchKeywords')),
        icon: 'search',
        perform: () => document.getElementById(searchInputId)?.focus(),
      },
      ...catalogueFavourites.map((entry) => ({
        id: `orders.new.add.${entry.code}`,
        group: 'actions' as const,
        label: t('orders.new.command.add', { order: entry.name }),
        // The catalogue's own synonyms for this test, not this screen's words.
        keywords: entry.keywords,
        icon: 'circle-plus',
        perform: () => addOrder(entry),
      })),
      {
        id: 'orders.new.review',
        group: 'actions',
        label: t('orders.new.command.review'),
        keywords: searchWords(t('orders.new.command.reviewKeywords')),
        icon: 'list-checks',
        perform: () => dispatch({ type: 'goTo', step: 'review' }),
      },
      {
        id: 'orders.new.pend',
        group: 'actions',
        label: t('orders.new.command.pend'),
        keywords: searchWords(t('orders.new.command.pendKeywords')),
        icon: 'inbox',
        perform: pend,
      },
      {
        id: 'orders.new.sign',
        group: 'actions',
        label: t('orders.new.command.sign'),
        keywords: searchWords(t('orders.new.command.signKeywords')),
        icon: 'pen-line',
        perform: requestSign,
      },
    ];
  }, [t, problems, searchInputId, addOrder, pend, requestSign]);

  const patientOptions: SelectOption[] = rows.map((row) => ({
    value: row.id,
    label: `${formatName(row.name, 'listing')} (${formatMrn(row.mrn)})`,
  }));

  const reviewRows = drafts.map((draft) => ({
    id: draft.key,
    order: draft.entry.name,
    code: draft.entry.code,
    priority: t(ORDER_PRIORITY_LABELS[draft.priority].labelKey),
    specimen: draft.specimen ?? t('orders.new.review.noSpecimen'),
    diagnosis: draft.diagnosisCode ? (
      <Tag mono>{draft.diagnosisCode}</Tag>
    ) : (
      <Badge tone="neutral" icon="circle-alert">
        {t('orders.draft.needsDiagnosis')}
      </Badge>
    ),
    destination: draft.entry.destination,
  }));

  const signLabel = counted(t, SIGN_ACTION, drafts.length);

  return (
    <AppShell
      title={t('orders.new.title')}
      description={t('orders.new.description')}
      actions={
        <>
          <Button variant="ghost" iconLeft="inbox" onClick={pend}>
            {t('orders.new.pend')}
          </Button>
          <Button iconLeft="pen-line" onClick={requestSign}>
            {drafts.length > 0 ? signLabel : t('orders.new.signEmpty')}
          </Button>
        </>
      }
      rightRail={
        patient ? <OrderingForRail patient={patient} problems={problems} now={now} /> : null
      }
    >
      <ScreenCommands commands={commands} />
      <ol className="or-steps" aria-label={t('orders.new.steps.label')}>
        <li className="or-steps__step" aria-current={step === 'build' ? 'step' : undefined}>
          {t('orders.new.steps.build')}
        </li>
        <li className="or-steps__step" aria-current={step === 'review' ? 'step' : undefined}>
          {t('orders.new.steps.review')}
        </li>
      </ol>

      <Card tone="cream" title={t('orders.new.patient.card')}>
        <Select
          label={t('orders.new.patient.label')}
          hint={t('orders.new.patient.hint')}
          options={patientOptions}
          value={patient?.id ?? ''}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => changePatient(event.target.value)}
        />
      </Card>

      {step === 'build' ? (
        <BuildStep
          problems={problems}
          drafts={drafts}
          warnings={warnings}
          cleared={cleared}
          searchInputId={searchInputId}
          onAdd={addOrder}
          onUpdateDraft={updateDraft}
          onRemoveDraft={removeDraft}
          onClearWarning={clearWarning}
          onRestoreWarning={restoreWarning}
          onReview={() => dispatch({ type: 'goTo', step: 'review' })}
        />
      ) : (
        <ReviewStep
          reviewRows={reviewRows}
          patientName={patientName}
          warnings={warnings}
          cleared={cleared}
          blockers={blockers}
          showBlockers={showBlockers}
          blockerRef={blockerRef}
          signLabel={signLabel}
          onClearWarning={clearWarning}
          onRestoreWarning={restoreWarning}
          onBack={() => dispatch({ type: 'goTo', step: 'build' })}
          onPend={pend}
          onSign={requestSign}
        />
      )}

      <Modal
        open={confirming}
        title={t('orders.new.confirm.title')}
        description={counted(t, CONFIRM_BODY, drafts.length, { patient: patientName })}
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('orders.new.confirm.keepEditing')}
            </Button>
            <Button iconLeft="pen-line" onClick={sign}>
              {t('orders.new.confirm.sign')}
            </Button>
          </>
        }
      >
        <ul className="or-plainlist or-small">
          {drafts.map((draft) => (
            <li key={draft.key}>
              {t('orders.new.confirm.line', {
                order: draft.entry.name,
                /* Lower-cased with the reader's own rules, because the priority
                   word is a translated one. */
                priority: t(ORDER_PRIORITY_LABELS[draft.priority].labelKey).toLocaleLowerCase(
                  t.locale
                ),
                destination: draft.entry.destination,
              })}
            </li>
          ))}
        </ul>
      </Modal>

      {completion ? (
        <div className="or-toast-dock">
          <Toast
            tone="success"
            title={completion.title}
            message={completion.message}
            onClose={() => setCompletion(null)}
          />
        </div>
      ) : null}
    </AppShell>
  );
}

/** Favourites promoted into the palette. Four keeps the group readable. */
const FAVOURITE_COMMAND_LIMIT = 4;
