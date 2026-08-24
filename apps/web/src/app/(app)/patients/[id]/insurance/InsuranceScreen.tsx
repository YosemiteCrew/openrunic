'use client';

import { formatCount } from '@openrunic/i18n';
import type { Translator } from '@openrunic/i18n';
import { Badge, Button, Card, Toast } from '@openrunic/ui';
import type { ToastTone } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import type { Command } from '@/components/command';
import { ScreenCommands } from '@/components/command';
import {
  CoverageCard,
  moveItem,
  presentEligibility,
  PRIORITY_COPY,
  priorityForIndex,
  useCoverages,
} from '@/components/insurance';
import { clinicNow } from '@/components/schedule';
import { AppShell } from '@/components/shell';
import { AsyncBoundary } from '@/components/state';
import { IS_MOCK_MODE, mockVerifyEligibility, usePatient } from '@/lib/api';
import type { MockCoverage, MockEligibilityResult } from '@/lib/api';
import { formatAge, formatDate, formatMrn, formatName } from '@/lib/format';
import { counted, searchWords } from '@/lib/i18n/counted';
import type { CountedMessage } from '@/lib/i18n/counted';
import { useTranslator } from '@/lib/i18n/messages';

/**
 * FD-08 Insurance and eligibility.
 *
 * Coverage cards in priority order, each carrying its own live eligibility
 * answer and a one-click check. Every outcome the adapter can give is a
 * designed state: active, terminated, member not found, and the payer simply
 * not answering, which is a partner outage and says so rather than blaming the
 * front desk or blocking the visit.
 *
 * Priority is reordered with buttons rather than a drag, because a drag alone
 * is unreachable from a keyboard and this list is short. Drag-to-reorder can be
 * added on top of the same handler when a Drawer and a drag primitive land in
 * the library.
 */

export interface InsuranceScreenProps {
  patientId: string;
}

interface ToastMessage {
  tone: ToastTone;
  title: string;
  message: string;
}

const NO_RESULTS: readonly MockEligibilityResult[] = [];

/** Toast tone per outcome: a refusal interrupts, an outage waits for a pause. */
function toneFor(result: MockEligibilityResult): ToastTone {
  if (result.outcome === 'ACTIVE') return 'success';
  if (result.outcome === 'UNAVAILABLE') return 'info';
  return 'danger';
}

/**
 * How the batch went, as one sentence rather than three clauses joined by a
 * comma.
 *
 * A summary assembled from fragments gets the English right and the word order
 * wrong everywhere else, and a translator handed "needing attention" on its own
 * has no sentence to agree with. Four whole messages, one per shape the answer
 * can take, and the branch picks between literal keys the drift test can see.
 */
const SUMMARY = {
  cleanKey: 'insurance.verifyAll.summaryClean',
  problemsKey: 'insurance.verifyAll.summaryProblems',
  queuedKey: 'insurance.verifyAll.summaryQueued',
  bothKey: 'insurance.verifyAll.summaryBoth',
} as const;

function verifyAllSummary(
  counts: Readonly<{ active: number; problems: number; unavailable: number }>,
  t: Translator
): string {
  /* Digits through `formatCount`, the way `counted` does it: the plural form
     and the numerals are two separate locale decisions, and a sentence that got
     the grammar right and the numerals wrong would still be wrong. */
  const active = formatCount(counts.active, t.locale);
  const problems = formatCount(counts.problems, t.locale);
  const unavailable = formatCount(counts.unavailable, t.locale);
  if (counts.problems > 0 && counts.unavailable > 0) {
    return t(SUMMARY.bothKey, { active, problems, unavailable });
  }
  if (counts.problems > 0) return t(SUMMARY.problemsKey, { active, problems });
  if (counts.unavailable > 0) return t(SUMMARY.queuedKey, { active, unavailable });
  return t(SUMMARY.cleanKey, { active });
}

/** "2 coverages checked", in the reader's language and its own plural rule. */
const VERIFIED_TITLE: CountedMessage = {
  oneKey: 'insurance.verifyAll.titleOne',
  otherKey: 'insurance.verifyAll.titleOther',
};

export function InsuranceScreen({ patientId }: Readonly<InsuranceScreenProps>): ReactElement {
  const t = useTranslator();
  const [asOf] = useState<Date>(() => clinicNow());
  const [order, setOrder] = useState<string[] | null>(null);
  const [checking, setChecking] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [results, setResults] = useState<Record<string, MockEligibilityResult[]>>({});
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const patient = usePatient(patientId);
  const coverages = useCoverages(patientId);

  /** Stored order, unless the front desk has reordered it in this session. */
  const ordered = useMemo<MockCoverage[]>(() => {
    const rows = coverages.data ?? [];
    if (!order) return rows;
    const byId = new Map(rows.map((coverage) => [coverage.id, coverage]));
    return order
      .map((id) => byId.get(id))
      .filter((coverage): coverage is MockCoverage => coverage !== undefined);
  }, [coverages.data, order]);

  const recordResult = useCallback((result: MockEligibilityResult) => {
    setResults((previous) => ({
      ...previous,
      [result.coverageId]: [result, ...(previous[result.coverageId] ?? [])],
    }));
  }, []);

  const verify = useCallback(
    async (coverage: MockCoverage): Promise<MockEligibilityResult> => {
      setChecking((previous) => new Set(previous).add(coverage.id));
      const result = await mockVerifyEligibility(coverage.id);
      recordResult(result);
      setChecking((previous) => {
        const next = new Set(previous);
        next.delete(coverage.id);
        return next;
      });
      return result;
    },
    [recordResult]
  );

  const verifyOne = useCallback(
    (coverage: MockCoverage) => {
      void verify(coverage).then((result) => {
        setToast({
          tone: toneFor(result),
          title: t(presentEligibility(result.outcome).labelKey),
          // The payer's own sentence, relayed rather than reworded.
          message: result.detail,
        });
      });
    },
    [t, verify]
  );

  const verifyAll = useCallback(() => {
    const rows = ordered;
    if (rows.length === 0) return;
    void Promise.all(rows.map((coverage) => verify(coverage))).then((all) => {
      const active = all.filter((result) => result.outcome === 'ACTIVE').length;
      const unavailable = all.filter((result) => result.outcome === 'UNAVAILABLE').length;
      const problems = all.length - active - unavailable;
      setToast({
        tone: problems > 0 ? 'danger' : 'success',
        title: counted(t, VERIFIED_TITLE, all.length),
        message: verifyAllSummary({ active, problems, unavailable }, t),
      });
    });
  }, [ordered, t, verify]);

  const move = (coverage: MockCoverage, direction: -1 | 1) => {
    const from = ordered.findIndex((entry) => entry.id === coverage.id);
    const next = moveItem(ordered, from, from + direction);
    setOrder(next.map((entry) => entry.id));
    /* The slot decides the whole sentence rather than supplying a word to drop
       into one, because "secondary" is an adjective that agrees with its noun
       in most of the languages this will be read in. */
    const landed = priorityForIndex(next.findIndex((entry) => entry.id === coverage.id));
    setToast({
      tone: 'info',
      title: t('insurance.priority.changed'),
      message: t(PRIORITY_COPY[landed].movedKey, { payer: coverage.payerName }),
    });
  };

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'insurance.verify-all',
        group: 'actions',
        label: t('insurance.command.verifyAll'),
        keywords: searchWords(t('insurance.command.verifyAll.keywords')),
        icon: 'shield-check',
        perform: verifyAll,
      },
      {
        id: 'insurance.open-chart',
        group: 'navigate',
        label: t('insurance.command.openChart'),
        keywords: searchWords(t('insurance.command.openChart.keywords')),
        icon: 'folder-open',
        href: `/patients/${patientId}`,
      },
    ],
    [patientId, t, verifyAll]
  );

  return (
    <AppShell
      title={t('insurance.screen.title')}
      description={t('insurance.screen.description')}
      actions={
        <Button iconLeft="shield-check" onClick={verifyAll} disabled={ordered.length === 0}>
          {t('insurance.screen.verifyAll')}
        </Button>
      }
      rightRail={
        <AsyncBoundary
          state={patient}
          subject={t('insurance.screen.patientSubject')}
          loadingVariant="text"
          loadingRows={4}
          empty={{
            title: t('insurance.screen.noPatientTitle'),
            message: t('insurance.screen.noPatientMessage'),
          }}
        >
          {(record) => (
            <Card overline={t('insurance.screen.patientOverline')} title={formatName(record.name)}>
              <p className="or-small">
                <span className="or-mono">{formatMrn(record.mrn)}</span>
                {' · '}
                {formatAge(t, record.birthDate, asOf)}
                {' · '}
                {t('insurance.screen.born', { date: formatDate(t, record.birthDate) })}
              </p>
              {/* Pronouns are the patient's own words, stored as typed. */}
              {record.pronouns ? <p className="or-small">{record.pronouns}</p> : null}

              <div className="or-coverage__summary">
                {ordered.length === 0 ? (
                  <Badge tone="neutral">{t('insurance.screen.noCoverageBadge')}</Badge>
                ) : (
                  ordered.map((coverage) => {
                    const latest = (results[coverage.id] ?? NO_RESULTS)[0];
                    const presented = presentEligibility(latest?.outcome ?? coverage.lastOutcome);
                    return (
                      <p key={coverage.id} className="or-small or-coverage__summary-line">
                        <Badge tone={presented.tone}>{t(presented.labelKey)}</Badge>{' '}
                        {coverage.payerName}
                      </p>
                    );
                  })
                )}
              </div>

              <Button variant="secondary" iconLeft="folder-open" href={`/patients/${patientId}`}>
                {t('insurance.screen.openChart')}
              </Button>
            </Card>
          )}
        </AsyncBoundary>
      }
    >
      <ScreenCommands commands={commands} />

      <AsyncBoundary
        state={coverages}
        subject={t('insurance.screen.coverageSubject')}
        loadingVariant="cards"
        loadingRows={2}
        isEmpty={(rows) => rows.length === 0}
        empty={{
          title: t('insurance.screen.emptyTitle'),
          message: t('insurance.screen.emptyMessage'),
          icon: 'shield',
          action: (
            <Button iconLeft="folder-open" href={`/patients/${patientId}`}>
              {t('insurance.screen.openChart')}
            </Button>
          ),
        }}
      >
        {() => (
          <div className="or-coverages">
            {ordered.map((coverage, index) => {
              const entries = results[coverage.id] ?? NO_RESULTS;
              return (
                <CoverageCard
                  key={coverage.id}
                  coverage={coverage}
                  priority={priorityForIndex(index)}
                  checking={checking.has(coverage.id)}
                  result={entries[0] ?? null}
                  history={entries.slice(1)}
                  onVerify={verifyOne}
                  onMove={move}
                  canMoveUp={index > 0}
                  canMoveDown={index < ordered.length - 1}
                />
              );
            })}
          </div>
        )}
      </AsyncBoundary>

      {IS_MOCK_MODE ? (
        <p className="or-caption or-fd-mock-note">{t('insurance.screen.mockNote')}</p>
      ) : null}

      {toast ? (
        <div className="or-fd-toast-host">
          <Toast
            tone={toast.tone}
            title={toast.title}
            message={toast.message}
            onClose={() => setToast(null)}
          />
        </div>
      ) : null}
    </AppShell>
  );
}
