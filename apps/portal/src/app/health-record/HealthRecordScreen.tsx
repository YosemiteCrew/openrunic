'use client';

/**
 * Health record: the same facts the practice holds, written so they can be understood.
 *
 * Two rules shape every row. A stored plain-language gloss sits beside its coded term. A
 * measured value never appears alone: it carries its unit, its usual range and a
 * labelled verdict, plus an explicit way to ask about it. A patient should never be left
 * looking at a red number with no way to find out what it means.
 *
 * Clinical terms and patient wording render as recorded. Finite workflow
 * statuses are translated by the interface so storage codes never reach the
 * patient unchanged.
 */

import { useCallback, useState } from 'react';
import { Badge, Button, Card, EmptyState } from '@openrunic/ui';
import { AsyncBoundary } from '@/components/AsyncBoundary';
import { PageHeader } from '@/components/PageHeader';
import { PlainTerm } from '@/components/PlainTerm';
import { RangeBadge } from '@/components/RangeBadge';
import { getPortalApi } from '@/lib/api';
import type { HealthRecord, PortalApi, Result } from '@/lib/api/types';
import { useTranslator } from '@/lib/i18n/messages';
import type { DocumentKind } from '@/lib/format';
import { documentKind, formatDate, formatFileSize, formatMeasurement } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';

export interface HealthRecordScreenProps {
  api?: PortalApi;
}

const RANGE_LABEL_KEYS: Record<Result['range'], string> = {
  'in-range': 'portal.healthRecord.results.range.inRange',
  'out-of-range': 'portal.healthRecord.results.range.outOfRange',
  unknown: 'portal.healthRecord.results.range.unknown',
};

/**
 * Every kind has a label, and `documentKind` answers with one of these and nothing else, so
 * a media type the practice starts storing tomorrow renders as `File` rather than as itself.
 */
const DOCUMENT_KIND_KEYS: Record<DocumentKind, string> = {
  pdf: 'portal.healthRecord.documents.kind.pdf',
  image: 'portal.healthRecord.documents.kind.image',
  document: 'portal.healthRecord.documents.kind.document',
  spreadsheet: 'portal.healthRecord.documents.kind.spreadsheet',
  text: 'portal.healthRecord.documents.kind.text',
  other: 'portal.healthRecord.documents.kind.other',
};

const PROBLEM_STATUS_KEYS: Record<HealthRecord['problems'][number]['status'], string> = {
  active: 'portal.healthRecord.problems.status.active',
  recurrence: 'portal.healthRecord.problems.status.recurrence',
  relapse: 'portal.healthRecord.problems.status.relapse',
  inactive: 'portal.healthRecord.problems.status.inactive',
  remission: 'portal.healthRecord.problems.status.remission',
  resolved: 'portal.healthRecord.problems.status.resolved',
};

const ALLERGY_SEVERITY_KEYS: Record<
  NonNullable<HealthRecord['allergies'][number]['severity']>,
  string
> = {
  mild: 'portal.healthRecord.allergies.severity.mild',
  moderate: 'portal.healthRecord.allergies.severity.moderate',
  severe: 'portal.healthRecord.allergies.severity.severe',
};

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
function ResultRow({ result }: Readonly<{ result: Result }>) {
  const t = useTranslator();
  const [askOpen, setAskOpen] = useState(false);
  const panelId = `result-${result.id}-ask`;

  return (
    <li className="portal-record">
      <div className="portal-record__head">
        <PlainTerm term={result.name} plain={result.plain} />
        <RangeBadge range={result.range} label={t(RANGE_LABEL_KEYS[result.range])} />
      </div>

      <p className="portal-record__reading">
        <span className="portal-record__value">
          {formatMeasurement(t, result.value, result.unit)}
        </span>
        <span className="portal-record__meta">
          {result.referenceRange === ''
            ? t('portal.healthRecord.results.noRange')
            : t('portal.healthRecord.results.usualRange', { range: result.referenceRange })}
        </span>
      </p>

      <p className="portal-record__meta">
        {t('portal.healthRecord.results.takenOn', { date: formatDate(t, result.takenOn) })}
      </p>

      <div className="portal-actions">
        <Button
          variant="secondary"
          iconLeft="circle-help"
          aria-expanded={askOpen}
          aria-controls={panelId}
          onClick={() => setAskOpen((open) => !open)}
        >
          {t('portal.healthRecord.results.ask')}
        </Button>
      </div>

      {askOpen ? (
        <div className="portal-explainer" id={panelId}>
          <p className="portal-explainer__title">
            {t('portal.healthRecord.results.explainer.title')}
          </p>
          <p className="or-small">{t('portal.healthRecord.results.explainer.body')}</p>
          <div className="portal-actions">
            <Button href="/messages" iconLeft="message-square">
              {t('portal.healthRecord.results.explainer.action')}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function HealthRecordScreen({ api = getPortalApi() }: Readonly<HealthRecordScreenProps>) {
  const t = useTranslator();
  const load = useCallback(() => api.getHealthRecord(), [api]);
  const { state, reload } = useAsync(load);

  return (
    <>
      <PageHeader
        overline={t('portal.healthRecord.overline')}
        title={t('portal.healthRecord.title')}
        lede={t('portal.healthRecord.lede')}
      />

      <AsyncBoundary
        state={state}
        loadingKey="portal.healthRecord.async.loading"
        errorKey="portal.healthRecord.async.error"
        onRetry={reload}
        isEmpty={isRecordEmpty}
        empty={
          <EmptyState
            icon="heart-pulse"
            title={t('portal.healthRecord.empty.title')}
            message={t('portal.healthRecord.empty.message')}
          />
        }
      >
        {(record) => (
          <div className="portal-stack">
            <Card
              overline={t('portal.healthRecord.results.overline')}
              title={t('portal.healthRecord.results.title')}
              tone="cream"
            >
              {record.results.length === 0 ? (
                <p className="or-body">{t('portal.healthRecord.results.none')}</p>
              ) : (
                <ul className="portal-inline-list">
                  {record.results.map((result) => (
                    <ResultRow key={result.id} result={result} />
                  ))}
                </ul>
              )}
            </Card>

            <Card
              overline={t('portal.healthRecord.problems.overline')}
              title={t('portal.healthRecord.problems.title')}
            >
              {record.problems.length === 0 ? (
                <p className="or-body">{t('portal.healthRecord.problems.none')}</p>
              ) : (
                <ul className="portal-inline-list">
                  {record.problems.map((problem) => (
                    <li className="portal-record" key={problem.id}>
                      <div className="portal-record__head">
                        <PlainTerm term={problem.term} code={problem.code} plain={problem.plain} />
                        <Badge tone="neutral">{t(PROBLEM_STATUS_KEYS[problem.status])}</Badge>
                      </div>
                      <p className="portal-record__meta">
                        {t('portal.healthRecord.problems.recordedOn', {
                          date: formatDate(t, problem.recordedOn),
                        })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              overline={t('portal.healthRecord.medications.overline')}
              title={t('portal.healthRecord.medications.title')}
            >
              {record.medications.length === 0 ? (
                <p className="or-body">{t('portal.healthRecord.medications.none')}</p>
              ) : (
                <ul className="portal-inline-list">
                  {record.medications.map((medication) => (
                    <li className="portal-record" key={medication.id}>
                      <div className="portal-record__head">
                        <PlainTerm term={medication.name} plain={medication.plain} />
                        {medication.strength === null || medication.unit === null ? null : (
                          <span className="portal-record__value">
                            {formatMeasurement(t, medication.strength, medication.unit)}
                          </span>
                        )}
                      </div>
                      {medication.instruction === null ? null : (
                        <p className="or-body">{medication.instruction}</p>
                      )}
                      <p className="portal-record__meta">
                        {medication.prescribedBy === null
                          ? t('portal.healthRecord.medications.startedOn', {
                              date: formatDate(t, medication.startedOn),
                            })
                          : t('portal.healthRecord.medications.prescribedBy', {
                              clinician: medication.prescribedBy,
                              date: formatDate(t, medication.startedOn),
                            })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              overline={t('portal.healthRecord.allergies.overline')}
              title={t('portal.healthRecord.allergies.title')}
            >
              {record.allergies.length === 0 ? (
                <p className="or-body">{t('portal.healthRecord.allergies.none')}</p>
              ) : (
                <ul className="portal-inline-list">
                  {record.allergies.map((allergy) => (
                    <li className="portal-record" key={allergy.id}>
                      <div className="portal-record__head">
                        <PlainTerm term={allergy.substance} plain={allergy.plain} />
                        {allergy.severity === null ? null : (
                          <Badge tone={allergy.severity === 'severe' ? 'danger' : 'neutral'}>
                            {t(ALLERGY_SEVERITY_KEYS[allergy.severity])}
                          </Badge>
                        )}
                      </div>
                      {allergy.reaction === null ? null : (
                        <p className="or-body">
                          {t('portal.healthRecord.allergies.reaction', {
                            reaction: allergy.reaction,
                          })}
                        </p>
                      )}
                      <p className="portal-record__meta">
                        {t('portal.healthRecord.allergies.recordedOn', {
                          date: formatDate(t, allergy.recordedOn),
                        })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              overline={t('portal.healthRecord.immunisations.overline')}
              title={t('portal.healthRecord.immunisations.title')}
            >
              {record.immunisations.length === 0 ? (
                <p className="or-body">{t('portal.healthRecord.immunisations.none')}</p>
              ) : (
                <ul className="portal-inline-list">
                  {record.immunisations.map((immunisation) => (
                    <li className="portal-record" key={immunisation.id}>
                      <div className="portal-record__head">
                        <PlainTerm term={immunisation.vaccine} plain={immunisation.plain} />
                      </div>
                      {/*
                        The dose reads on the meta line rather than in a badge. A badge is
                        `white-space: nowrap` because a status pill is the size of its text,
                        and a dose is not a status: its unit is free text on the record, so
                        `0.5 millilitre per dose` in a pill widens the page (#507).
                      */}
                      {immunisation.doseQuantity === null ||
                      immunisation.doseUnit === null ? null : (
                        <p className="portal-record__meta">
                          {t('portal.healthRecord.immunisations.dose', {
                            dose: formatMeasurement(
                              t,
                              immunisation.doseQuantity,
                              immunisation.doseUnit
                            ),
                          })}
                        </p>
                      )}
                      <p className="portal-record__meta">
                        {t('portal.healthRecord.immunisations.givenOn', {
                          date: formatDate(t, immunisation.givenOn),
                        })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              overline={t('portal.healthRecord.documents.overline')}
              title={t('portal.healthRecord.documents.title')}
            >
              {record.documents.length === 0 ? (
                <p className="or-body">{t('portal.healthRecord.documents.none')}</p>
              ) : (
                <ul className="portal-inline-list">
                  {record.documents.map((document) => (
                    <li className="portal-record" key={document.id}>
                      <div className="portal-record__head">
                        <PlainTerm term={document.title} plain={document.plain} />
                        <Badge tone="ink" icon="file-text">
                          {t(DOCUMENT_KIND_KEYS[documentKind(document.contentType)])}
                        </Badge>
                      </div>
                      <p className="portal-record__meta">
                        {t('portal.healthRecord.documents.addedOn', {
                          date: formatDate(t, document.addedOn),
                          size: formatFileSize(t, document.byteSize),
                        })}
                      </p>
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
