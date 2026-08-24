'use client';

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
  priorityForIndex,
  PRIORITY_LABEL,
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
 *
 * Everything a person reads comes from the catalogue. What a coverage carries -
 * the payer's name, the plan, the member id, and the sentence the payer sent
 * back - is rendered as it arrived, and so is everything on the patient record
 * in the rail.
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

/*
 * What the verify-all toast says, as pairs of keys rather than sentences.
 *
 * The title counts what was asked. The body is a list of the answers, and each
 * entry is a whole phrase rather than a fragment of a sentence, because which
 * entries appear at all depends on what came back from the payers.
 */
const CHECKED: CountedMessage = {
  oneKey: 'insurance.screen.checkedOne',
  otherKey: 'insurance.screen.checkedOther',
};

const ACTIVE: CountedMessage = {
  oneKey: 'insurance.screen.activeOne',
  otherKey: 'insurance.screen.activeOther',
};

const ATTENTION: CountedMessage = {
  oneKey: 'insurance.screen.attentionOne',
  otherKey: 'insurance.screen.attentionOther',
};

const UNAVAILABLE: CountedMessage = {
  oneKey: 'insurance.screen.unavailableOne',
  otherKey: 'insurance.screen.unavailableOther',
};

/** Toast tone per outcome: a refusal interrupts, an outage waits for a pause. */
function toneFor(result: MockEligibilityResult): ToastTone {
  if (result.outcome === 'ACTIVE') return 'success';
  if (result.outcome === 'UNAVAILABLE') return 'info';
  return 'danger';
}

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
          // The payer's own sentence, carried through rather than restated.
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
        title: counted(t, CHECKED, all.length),
        /* A list of whole phrases rather than one sentence, because which
           entries appear depends on what came back. The comma and the full stop
           stay here as punctuation: a catalogue message may not be blank, so a
           separator cannot be one, and each entry is already a complete phrase
           in whatever language it was written. */
        message: [
          counted(t, ACTIVE, active),
          problems > 0 ? counted(t, ATTENTION, problems) : null,
          unavailable > 0 ? counted(t, UNAVAILABLE, unavailable) : null,
        ]
          .filter(Boolean)
          .join(', ')
          .concat('.'),
      });
    });
  }, [ordered, t, verify]);

  const move = (coverage: MockCoverage, direction: -1 | 1) => {
    const from = ordered.findIndex((entry) => entry.id === coverage.id);
    const next = moveItem(ordered, from, from + direction);
    setOrder(next.map((entry) => entry.id));
    const slot = priorityForIndex(next.findIndex((entry) => entry.id === coverage.id));
    setToast({
      tone: 'info',
      title: t('insurance.screen.priorityChanged'),
      message: t('insurance.screen.priorityMessage', {
        payer: coverage.payerName,
        /* Lower-cased with the reader's own rules: the word is a translated
           one, and the runtime default is wrong for Turkish. */
        priority: t(PRIORITY_LABEL[slot].labelKey).toLocaleLowerCase(t.locale),
      }),
    });
  };

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'insurance.verify-all',
        group: 'actions',
        label: t('insurance.screen.command.verifyAll'),
        keywords: searchWords(t('insurance.screen.command.verifyAllKeywords')),
        icon: 'shield-check',
        perform: verifyAll,
      },
      {
        id: 'insurance.open-chart',
        group: 'navigate',
        label: t('insurance.screen.command.openChart'),
        keywords: searchWords(t('insurance.screen.command.openChartKeywords')),
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
            title: t('insurance.screen.noPatient.title'),
            message: t('insurance.screen.noPatient.message'),
          }}
        >
          {(record) => (
            <Card overline={t('insurance.screen.patientOverline')} title={formatName(record.name)}>
              <p className="or-small">
                <span className="or-mono">{formatMrn(record.mrn)}</span>
                {' · '}
                {formatAge(record.birthDate, asOf)}
                {' · '}
                {t('insurance.screen.born', { date: formatDate(record.birthDate) })}
              </p>
              {/* The patient's own pronouns, as recorded. */}
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
        subject={t('insurance.screen.subject')}
        loadingVariant="cards"
        loadingRows={2}
        isEmpty={(rows) => rows.length === 0}
        empty={{
          title: t('insurance.screen.empty.title'),
          message: t('insurance.screen.empty.message'),
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
