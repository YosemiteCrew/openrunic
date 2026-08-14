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
  useCoverages,
} from '@/components/insurance';
import { clinicNow } from '@/components/schedule';
import { AppShell } from '@/components/shell';
import { AsyncBoundary } from '@/components/state';
import { IS_MOCK_MODE, mockVerifyEligibility, usePatient } from '@/lib/api';
import type { MockCoverage, MockEligibilityResult } from '@/lib/api';
import { formatAge, formatCount, formatDate, formatMrn, formatName } from '@/lib/format';

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

export function InsuranceScreen({ patientId }: Readonly<InsuranceScreenProps>): ReactElement {
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
          title: presentEligibility(result.outcome).label,
          message: result.detail,
        });
      });
    },
    [verify]
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
        title: `${formatCount(all.length, 'coverage')} checked`,
        message: [
          `${active} active`,
          problems > 0 ? `${problems} needing attention` : null,
          unavailable > 0 ? `${unavailable} queued for a payer that did not answer` : null,
        ]
          .filter(Boolean)
          .join(', ')
          .concat('.'),
      });
    });
  }, [ordered, verify]);

  const move = (coverage: MockCoverage, direction: -1 | 1) => {
    const from = ordered.findIndex((entry) => entry.id === coverage.id);
    const next = moveItem(ordered, from, from + direction);
    setOrder(next.map((entry) => entry.id));
    setToast({
      tone: 'info',
      title: 'Coverage priority changed',
      message: `${coverage.payerName} is now the ${priorityForIndex(
        next.findIndex((entry) => entry.id === coverage.id)
      ).toLowerCase()} coverage. Claims bill in this order.`,
    });
  };

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'insurance.verify-all',
        group: 'actions',
        label: 'Verify every coverage now',
        keywords: ['eligibility', '270', '271', 'check coverage', 'benefits'],
        icon: 'shield-check',
        perform: verifyAll,
      },
      {
        id: 'insurance.open-chart',
        group: 'navigate',
        label: 'Open this chart',
        keywords: ['chart', 'summary', 'patient'],
        icon: 'folder-open',
        href: `/patients/${patientId}`,
      },
    ],
    [patientId, verifyAll]
  );

  return (
    <AppShell
      title="Insurance and eligibility"
      description="Coverage in billing order, verified against the payer in one click."
      actions={
        <Button iconLeft="shield-check" onClick={verifyAll} disabled={ordered.length === 0}>
          Verify all coverages
        </Button>
      }
      rightRail={
        <AsyncBoundary
          state={patient}
          subject="this patient"
          loadingVariant="text"
          loadingRows={4}
          empty={{
            title: 'No patient loaded',
            message: 'Open this screen from a patient record, or press Cmd-K to search.',
          }}
        >
          {(record) => (
            <Card overline="Patient" title={formatName(record.name)}>
              <p className="or-small">
                <span className="or-mono">{formatMrn(record.mrn)}</span>
                {' · '}
                {formatAge(record.birthDate, asOf)}
                {' · '}
                born {formatDate(record.birthDate)}
              </p>
              {record.pronouns ? <p className="or-small">{record.pronouns}</p> : null}

              <div className="or-coverage__summary">
                {ordered.length === 0 ? (
                  <Badge tone="neutral">No coverage on file</Badge>
                ) : (
                  ordered.map((coverage) => {
                    const latest = (results[coverage.id] ?? NO_RESULTS)[0];
                    const presented = presentEligibility(latest?.outcome ?? coverage.lastOutcome);
                    return (
                      <p key={coverage.id} className="or-small or-coverage__summary-line">
                        <Badge tone={presented.tone}>{presented.label}</Badge> {coverage.payerName}
                      </p>
                    );
                  })
                )}
              </div>

              <Button variant="secondary" iconLeft="folder-open" href={`/patients/${patientId}`}>
                Open chart
              </Button>
            </Card>
          )}
        </AsyncBoundary>
      }
    >
      <ScreenCommands commands={commands} />

      <AsyncBoundary
        state={coverages}
        subject="this patient's coverage"
        loadingVariant="cards"
        loadingRows={2}
        isEmpty={(rows) => rows.length === 0}
        empty={{
          title: 'No coverage on file',
          message:
            'This patient has no insurance recorded, so visits bill as self-pay. Add a coverage from the insurance card at check-in.',
          icon: 'shield',
          action: (
            <Button iconLeft="folder-open" href={`/patients/${patientId}`}>
              Open chart
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
        <p className="or-caption or-fd-mock-note">
          Mock mode: eligibility answers come from fixtures, and the priority order is held for this
          session only.
        </p>
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
