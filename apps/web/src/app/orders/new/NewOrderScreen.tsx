'use client';

import { Badge, Button, Card, Modal, Select, Table, Tag, Toast } from '@openrunic/ui';
import type { SelectOption, TableColumn } from '@openrunic/ui';
import { useCallback, useId, useMemo, useReducer, useRef, useState } from 'react';
import type { ChangeEvent, ReactElement, ReactNode, RefObject } from 'react';

import { ScreenCommands } from '@/components/command';
import type { Command } from '@/components/command';
import { DraftOrders, OrderPicker, OrderWarnings } from '@/components/orders';
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
import { formatAge, formatCount, formatDate, formatMrn, formatName } from '@/lib/format';

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
 */

/** Signed orders leave the composer. This is what the toast says they became. */
interface Completion {
  title: string;
  message: string;
}

export interface NewOrderScreenProps {
  /** Injectable for tests. Defaults to the app's client. */
  client?: ApiClient;
  /** Fixed "now", so elapsed values and ages match the fixtures in a test. */
  now?: string;
}

/** One line, used by both shells below, so the two can never drift apart. */
const COMPOSER_DESCRIPTION =
  'Labs, imaging and procedures. Build the list, then review and sign it.';

export function NewOrderScreen({
  client,
  now = MOCK_NOW,
}: Readonly<NewOrderScreenProps>): ReactElement {
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
    <AppShell title="New order" description={COMPOSER_DESCRIPTION}>
      <AsyncBoundary
        state={patients}
        subject="the patient list"
        isEmpty={isEmptyList}
        loadingVariant="cards"
        loadingRows={3}
        empty={{
          title: 'No patients to order for',
          message: 'Register a patient first; orders always belong to one chart.',
          icon: 'users',
          action: (
            <Button href="/patients" iconLeft="user-plus">
              Go to patients
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

const REVIEW_COLUMNS: TableColumn[] = [
  { key: 'order', header: 'Order' },
  { key: 'code', header: 'Code', mono: true },
  { key: 'priority', header: 'Priority' },
  { key: 'specimen', header: 'Specimen' },
  { key: 'diagnosis', header: 'Diagnosis' },
  { key: 'destination', header: 'Destination' },
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
  return (
    <>
      <Card tone="cream" title="Add an order">
        <OrderPicker
          problems={[...problems]}
          draftedCodes={drafts.map((draft) => draft.entry.code)}
          onAdd={onAdd}
          searchInputId={searchInputId}
        />
      </Card>

      {drafts.length === 0 ? (
        <Card tone="cream" title="Nothing drafted yet">
          <p className="or-body">
            Pick a favourite or search the catalogue. Specimen, destination and priority are filled
            in for you, and a diagnosis is suggested from the problem list.
          </p>
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
              Review and sign
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
 * it names the chart, the age and the problem list rather than an id.
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
  return (
    <Card tone="cream" overline="Ordering for" title={formatName(patient.name, 'full')}>
      <dl className="or-keyvalues">
        <dt className="or-small">MRN</dt>
        <dd className="or-mono">{formatMrn(patient.mrn)}</dd>
        <dt className="or-small">Age</dt>
        <dd className="or-small">
          {formatAge(patient.birthDate, now)}, born {formatDate(patient.birthDate)}
        </dd>
        <dt className="or-small">Problems</dt>
        <dd className="or-small">
          {problems.length === 0 ? (
            'No problems recorded'
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
      <p className="or-small or-muted">
        Signing transmits immediately. Pending keeps the orders in the visit tray, unsigned.
      </p>
    </Card>
  );
}

/**
 * What stands between this draft and a signature, in the order a person would
 * fix it: the criticals they must answer, then the diagnoses they must link.
 *
 * Pure, and separate from the component, because it is the rule that decides
 * whether an order can be signed. Never a disabled button with no explanation.
 */
function signBlockers(
  drafts: readonly DraftOrder[],
  warnings: readonly OrderWarning[],
  cleared: Readonly<Record<string, string>>
): string[] {
  /* `flatMap` rather than `.filter().map()`: one pass over each list, and the
     empty array is the "not a blocker" case rather than a second traversal. */
  const openCriticals = warnings.flatMap((warning) =>
    warning.tier === 'CRITICAL' && !cleared[warning.id]
      ? [`${warning.title}. Choose an override reason or remove the order.`]
      : []
  );

  const missingDiagnosis = drafts.flatMap((draft) =>
    draft.diagnosisCode ? [] : [`${draft.entry.name} has no diagnosis linked.`]
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
  return (
    <>
      <Card tone="cream" title={`Review ${countLabel(reviewRows.length)}`}>
        {reviewRows.length === 0 ? (
          <p className="or-body">
            The draft is empty. Go back and add an order from the favourites or the catalogue.
          </p>
        ) : (
          <Table
            columns={REVIEW_COLUMNS}
            rows={reviewRows}
            caption={`Orders drafted for ${patientName}`}
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
          aria-label="Before signing"
        >
          <h3 className="or-h3">Before signing</h3>
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
          Back to building
        </Button>
        <Button variant="secondary" iconLeft="inbox" onClick={onPend}>
          Pend orders
        </Button>
        <Button iconLeft="pen-line" onClick={onSign}>
          {signLabel}
        </Button>
      </div>
    </>
  );
}

function Composer({ patients, now }: Readonly<ComposerProps>): ReactElement {
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

  const warnings = useMemo(
    () =>
      warningsFor(
        patient?.id ?? null,
        drafts.map((draft) => draft.entry.code)
      ),
    [patient?.id, drafts]
  );

  const blockers = useMemo(
    () => signBlockers(drafts, warnings, cleared),
    [drafts, warnings, cleared]
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
    finish(
      `${countLabel(drafts.length)} pended`,
      'They stay unsigned in the visit tray until someone signs them.'
    );
  }, [drafts.length, finish]);

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
    finish(`${countLabel(count)} signed`, `Transmitted to ${destinations.join(' and ')}.`);
  }, [drafts, finish]);

  const changePatient = useCallback(
    (nextId: string) => {
      setPatientId(nextId);
      if (drafts.length > 0) {
        dispatch({ type: 'reset' });
        setCompletion({
          title: 'Draft cleared',
          message: 'Orders belong to one chart, so switching patients starts a new draft.',
        });
      }
    },
    [drafts.length]
  );

  const commands = useMemo<Command[]>(() => {
    const catalogueFavourites = rankCatalog('', problems)
      .filter((entry) => entry.favourite)
      .slice(0, FAVOURITE_COMMAND_LIMIT);
    return [
      {
        id: 'orders.new.search',
        group: 'actions',
        label: 'Search the order catalogue',
        keywords: ['find order', 'lab', 'imaging', 'procedure'],
        icon: 'search',
        perform: () => document.getElementById(searchInputId)?.focus(),
      },
      ...catalogueFavourites.map((entry) => ({
        id: `orders.new.add.${entry.code}`,
        group: 'actions' as const,
        label: `Order ${entry.name}`,
        keywords: entry.keywords,
        icon: 'circle-plus',
        perform: () => addOrder(entry),
      })),
      {
        id: 'orders.new.review',
        group: 'actions',
        label: 'Review the draft orders',
        keywords: ['check orders', 'before signing'],
        icon: 'list-checks',
        perform: () => dispatch({ type: 'goTo', step: 'review' }),
      },
      {
        id: 'orders.new.pend',
        group: 'actions',
        label: 'Pend the draft orders',
        keywords: ['tray', 'unsigned', 'save for later'],
        icon: 'inbox',
        perform: pend,
      },
      {
        id: 'orders.new.sign',
        group: 'actions',
        label: 'Sign the draft orders',
        keywords: ['transmit', 'send to lab', 'submit'],
        icon: 'pen-line',
        perform: requestSign,
      },
    ];
  }, [problems, searchInputId, addOrder, pend, requestSign]);

  const patientOptions: SelectOption[] = rows.map((row) => ({
    value: row.id,
    label: `${formatName(row.name, 'listing')} (${formatMrn(row.mrn)})`,
  }));

  const reviewRows = drafts.map((draft) => ({
    id: draft.key,
    order: draft.entry.name,
    code: draft.entry.code,
    priority: priorityLabel(draft),
    specimen: draft.specimen ?? 'Not applicable',
    diagnosis: draft.diagnosisCode ? (
      <Tag mono>{draft.diagnosisCode}</Tag>
    ) : (
      <Badge tone="neutral" icon="circle-alert">
        Needs a diagnosis
      </Badge>
    ),
    destination: draft.entry.destination,
  }));

  return (
    <AppShell
      title="New order"
      description={COMPOSER_DESCRIPTION}
      actions={
        <>
          <Button variant="ghost" iconLeft="inbox" onClick={pend}>
            Pend orders
          </Button>
          <Button iconLeft="pen-line" onClick={requestSign}>
            {drafts.length > 0 ? `Sign ${countLabel(drafts.length)}` : 'Sign orders'}
          </Button>
        </>
      }
      rightRail={
        patient ? <OrderingForRail patient={patient} problems={problems} now={now} /> : null
      }
    >
      <ScreenCommands commands={commands} />
      <ol className="or-steps" aria-label="Composer steps">
        <li className="or-steps__step" aria-current={step === 'build' ? 'step' : undefined}>
          1. Build the order
        </li>
        <li className="or-steps__step" aria-current={step === 'review' ? 'step' : undefined}>
          2. Review and sign
        </li>
      </ol>

      <Card tone="cream" title="Patient">
        <Select
          label="Ordering for"
          hint="Orders belong to one chart. Switching patients starts a new draft."
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
          patientName={patient ? formatName(patient.name, 'full') : 'this patient'}
          warnings={warnings}
          cleared={cleared}
          blockers={blockers}
          showBlockers={showBlockers}
          blockerRef={blockerRef}
          signLabel={`Sign ${countLabel(drafts.length)}`}
          onClearWarning={clearWarning}
          onRestoreWarning={restoreWarning}
          onBack={() => dispatch({ type: 'goTo', step: 'build' })}
          onPend={pend}
          onSign={requestSign}
        />
      )}

      <Modal
        open={confirming}
        title="Sign these orders"
        description={`Signing transmits ${countLabel(drafts.length)} for ${
          patient ? formatName(patient.name, 'full') : 'this patient'
        } immediately. Cancelling one afterwards is possible and audited.`}
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep editing
            </Button>
            <Button iconLeft="pen-line" onClick={sign}>
              Sign and transmit
            </Button>
          </>
        }
      >
        <ul className="or-plainlist or-small">
          {drafts.map((draft) => (
            <li key={draft.key}>
              {draft.entry.name}, {priorityLabel(draft).toLowerCase()}, to {draft.entry.destination}
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

/** "1 order", "3 orders". One plural rule for the whole screen. */
function countLabel(count: number): string {
  return formatCount(count, 'order');
}

/** Favourites promoted into the palette. Four keeps the group readable. */
const FAVOURITE_COMMAND_LIMIT = 4;

function priorityLabel(draft: DraftOrder): string {
  if (draft.priority === 'ROUTINE') return 'Routine';
  return draft.priority === 'URGENT' ? 'Urgent' : 'Stat';
}
