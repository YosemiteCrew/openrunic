'use client';

/**
 * Health record: the same facts the practice holds, written so they can be understood.
 *
 * Two rules shape every row. A coded term never appears alone - the plain-language gloss
 * sits beside it, so "Hypothyroidism, E03.9" is always read as "Underactive thyroid". And a
 * measured value never appears alone either: it carries its unit, its usual range and a
 * labelled verdict, plus an explicit way to ask about it. A patient should never be left
 * looking at a red number with no way to find out what it means.
 */

import { useCallback, useState } from 'react';
import { Badge, Button, Card, EmptyState } from '@openrunic/ui';
import { AsyncBoundary } from '@/components/AsyncBoundary';
import { PageHeader } from '@/components/PageHeader';
import { PlainTerm } from '@/components/PlainTerm';
import { RangeBadge } from '@/components/RangeBadge';
import { getPortalApi } from '@/lib/api';
import type { HealthRecord, PortalApi, Result } from '@/lib/api/types';
import { formatDate, formatMeasurement } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';

export interface HealthRecordScreenProps {
  api?: PortalApi;
}

function isRecordEmpty(record: HealthRecord): boolean {
  return (
    record.results.length === 0 &&
    record.problems.length === 0 &&
    record.medications.length === 0 &&
    record.allergies.length === 0 &&
    record.immunisations.length === 0 &&
    record.documents.length === 0
  );
}

/**
 * One result, with the way out of it.
 *
 * The explainer is a disclosure rather than a link straight to the message box: a patient
 * reading an unexpected number usually wants to know what to do before deciding to write,
 * and the panel says that in plain words before offering the message box.
 */
function ResultRow({ result }: { result: Result }) {
  const [askOpen, setAskOpen] = useState(false);
  const panelId = `result-${result.id}-ask`;

  return (
    <li className="portal-record">
      <div className="portal-record__head">
        <PlainTerm term={result.name} plain={result.plain} />
        <RangeBadge range={result.range} label={result.rangeLabel} />
      </div>

      <p className="portal-record__reading">
        <span className="portal-record__value">{formatMeasurement(result.value, result.unit)}</span>
        <span className="portal-record__meta">
          {result.referenceRange === ''
            ? 'No usual range was recorded for this test.'
            : `Usual range: ${result.referenceRange}`}
        </span>
      </p>

      <p className="portal-record__meta">Taken on {formatDate(result.takenOn)}</p>

      <div className="portal-actions">
        <Button
          variant="secondary"
          iconLeft="circle-help"
          aria-expanded={askOpen}
          aria-controls={panelId}
          onClick={() => setAskOpen((open) => !open)}
        >
          Ask about this result
        </Button>
      </div>

      {askOpen ? (
        <div className="portal-explainer" id={panelId}>
          <p className="portal-explainer__title">What to do about this number</p>
          <p className="or-small">
            A single result is one moment, not a diagnosis. Your care team reads it alongside
            everything else they know about you. If you want it explained, send them a message and
            quote the test name and the date.
          </p>
          <div className="portal-actions">
            <Button href="/messages" iconLeft="message-square">
              Message your care team
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function HealthRecordScreen({ api = getPortalApi() }: HealthRecordScreenProps) {
  const load = useCallback(() => api.getHealthRecord(), [api]);
  const { state, reload } = useAsync(load);

  return (
    <>
      <PageHeader
        overline="Your record"
        title="Health record"
        lede="Everything your care team has written down, with a plain-language explanation beside each clinical term."
      />

      <AsyncBoundary
        state={state}
        what="your health record"
        onRetry={reload}
        isEmpty={isRecordEmpty}
        empty={
          <EmptyState
            icon="heart-pulse"
            title="Your record has nothing in it yet."
            message="Results, conditions, medicines and documents appear here after your first appointment."
          />
        }
      >
        {(record) => (
          <div className="portal-stack">
            <Card overline="Results" title="Recent test results" tone="cream">
              {record.results.length === 0 ? (
                <p className="or-body">No results have been added to your record.</p>
              ) : (
                <ul className="portal-inline-list">
                  {record.results.map((result) => (
                    <ResultRow key={result.id} result={result} />
                  ))}
                </ul>
              )}
            </Card>

            <Card overline="Conditions" title="Problems on your record">
              {record.problems.length === 0 ? (
                <p className="or-body">No conditions are recorded.</p>
              ) : (
                <ul className="portal-inline-list">
                  {record.problems.map((problem) => (
                    <li className="portal-record" key={problem.id}>
                      <div className="portal-record__head">
                        <PlainTerm term={problem.term} code={problem.code} plain={problem.plain} />
                        <Badge tone="neutral">{problem.status}</Badge>
                      </div>
                      <p className="portal-record__meta">
                        Recorded on {formatDate(problem.recordedOn)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card overline="Medicines" title="What you have been prescribed">
              {record.medications.length === 0 ? (
                <p className="or-body">No medicines are recorded.</p>
              ) : (
                <ul className="portal-inline-list">
                  {record.medications.map((medication) => (
                    <li className="portal-record" key={medication.id}>
                      <div className="portal-record__head">
                        <PlainTerm term={medication.name} plain={medication.plain} />
                        <span className="portal-record__value">
                          {formatMeasurement(medication.strength, medication.unit)}
                        </span>
                      </div>
                      <p className="or-body">{medication.instruction}</p>
                      <p className="portal-record__meta">
                        Prescribed by {medication.prescribedBy}, started{' '}
                        {formatDate(medication.startedOn)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card overline="Allergies" title="What to avoid">
              {record.allergies.length === 0 ? (
                <p className="or-body">No allergies are recorded.</p>
              ) : (
                <ul className="portal-inline-list">
                  {record.allergies.map((allergy) => (
                    <li className="portal-record" key={allergy.id}>
                      <div className="portal-record__head">
                        <PlainTerm term={allergy.substance} plain={allergy.plain} />
                        <Badge tone={allergy.severity === 'Severe' ? 'danger' : 'neutral'}>
                          {allergy.severity}
                        </Badge>
                      </div>
                      <p className="or-body">What happened: {allergy.reaction}</p>
                      <p className="portal-record__meta">
                        Recorded on {formatDate(allergy.recordedOn)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card overline="Vaccinations" title="Immunisations you have had">
              {record.immunisations.length === 0 ? (
                <p className="or-body">No vaccinations are recorded.</p>
              ) : (
                <ul className="portal-inline-list">
                  {record.immunisations.map((immunisation) => (
                    <li className="portal-record" key={immunisation.id}>
                      <div className="portal-record__head">
                        <PlainTerm term={immunisation.vaccine} plain={immunisation.plain} />
                        <Badge tone="success">{immunisation.doseLabel}</Badge>
                      </div>
                      <p className="portal-record__meta">
                        Given on {formatDate(immunisation.givenOn)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card overline="Documents" title="Letters and reports">
              {record.documents.length === 0 ? (
                <p className="or-body">No documents have been added.</p>
              ) : (
                <ul className="portal-inline-list">
                  {record.documents.map((document) => (
                    <li className="portal-record" key={document.id}>
                      <div className="portal-record__head">
                        <PlainTerm term={document.title} plain={document.plain} />
                        <Badge tone="ink" icon="file-text">
                          {document.format}
                        </Badge>
                      </div>
                      <p className="portal-record__meta">Added on {formatDate(document.addedOn)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </AsyncBoundary>
    </>
  );
}
