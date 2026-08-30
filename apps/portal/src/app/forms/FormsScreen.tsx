'use client';

/**
 * Forms: questionnaires, built for a phone first.
 *
 * One question per row, full-width controls, and answers held in local state so a patient
 * can put the phone down mid-question without losing anything. Saving is explicit and its
 * confirmation says the thing that matters: you can come back to this.
 *
 * Nothing here is required. A form that refuses to save until every box is filled is a form
 * people abandon, and a partial answer is more use to a clinician than none.
 */

import { useCallback, useState } from 'react';
import { Badge, Button, Card, EmptyState, Radio } from '@openrunic/ui';
import { AsyncBoundary } from '@/components/AsyncBoundary';
import { PageHeader } from '@/components/PageHeader';
import { ProgressMeter } from '@/components/ProgressMeter';
import { getPortalApi } from '@/lib/api';
import type { FormQuestion, FormStatus, FormTask, PortalApi } from '@/lib/api/types';
import { useTranslator } from '@/lib/i18n/messages';
import { formatDate, formatProgress } from '@/lib/format';
import { useAction, useAsync } from '@/lib/useAsync';

export interface FormsScreenProps {
  api?: PortalApi;
}

/*
 * Keys as the map's values, which is the shape the drift test reaches by
 * checking the catalogue against the source rather than the source against the
 * catalogue: the property name is the status, not `somethingKey`.
 */
const STATUS_LABEL_KEYS: Record<FormStatus, string> = {
  'not-started': 'portal.forms.status.notStarted',
  'in-progress': 'portal.forms.status.inProgress',
  submitted: 'portal.forms.status.submitted',
};

/**
 * The two choices on a yes/no question, as a stored value and the words shown
 * for it.
 *
 * The value is what goes back to the practice as the answer, so it is fixed.
 * Translating it would translate the answer: a patient reading Spanish would
 * save `Sí`, and the same question would come back holding two different values
 * depending on which language it happened to be answered in. Only the label
 * follows the reader.
 *
 * Every other question's options arrive from the questionnaire, already worded
 * by whoever wrote it, and are shown as they arrived.
 */
const YES_NO = [
  { value: 'Yes', labelKey: 'portal.forms.yes' },
  { value: 'No', labelKey: 'portal.forms.no' },
] as const;

interface QuestionFieldProps {
  question: FormQuestion;
  value: string;
  onChange: (value: string) => void;
}

function QuestionField({ question, value, onChange }: Readonly<QuestionFieldProps>) {
  const t = useTranslator();

  if (question.kind === 'text') {
    return (
      <>
        <label className="portal-field-label" htmlFor={`q-${question.id}`}>
          {question.prompt}
        </label>
        {question.help ? <p className="portal-question__help">{question.help}</p> : null}
        <textarea
          className="portal-textarea"
          id={`q-${question.id}`}
          name={question.id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </>
    );
  }

  const options =
    question.kind === 'yes-no'
      ? YES_NO.map((choice) => ({ value: choice.value, label: t(choice.labelKey) }))
      : (question.options ?? []).map((option) => ({ value: option, label: option }));

  return (
    <fieldset className="portal-question__fieldset">
      <legend className="portal-question__legend">{question.prompt}</legend>
      {question.help ? <p className="portal-question__help">{question.help}</p> : null}
      {options.map((option) => (
        <Radio
          key={option.value}
          checked={value === option.value}
          label={option.label}
          name={question.id}
          value={option.value}
          onChange={() => onChange(option.value)}
        />
      ))}
    </fieldset>
  );
}

interface QuestionnaireProps {
  task: FormTask;
  api: PortalApi;
  onClose: () => void;
}

function Questionnaire({ task, api, onClose }: Readonly<QuestionnaireProps>) {
  const t = useTranslator();
  const [answers, setAnswers] = useState<Record<string, string>>(task.answers);
  const save = useAction((next: Record<string, string>) => api.saveForm(task.id, next));
  const submit = useAction((next: Record<string, string>) => api.submitForm(task.id, next));

  const answered = task.questions.filter((question) => {
    const answer = answers[question.id];
    return answer !== undefined && answer !== '';
  }).length;

  if (submit.status === 'done') {
    return (
      <Card overline={t('portal.forms.sent.overline')} title={t('portal.forms.sent.title')}>
        <p className="or-body">{t('portal.forms.sent.body')}</p>
        <div className="portal-actions">
          <Button variant="secondary" iconLeft="arrow-left" onClick={onClose}>
            {t('portal.forms.back')}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card overline={t('portal.forms.inProgress.overline')} title={task.title}>
      <p className="or-body">{task.purpose}</p>

      <ProgressMeter
        done={answered}
        label={formatProgress(t, answered, task.questions.length)}
        total={task.questions.length}
      />

      {task.questions.map((question) => (
        <div className="portal-question" key={question.id}>
          <QuestionField
            onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))}
            question={question}
            value={answers[question.id] ?? ''}
          />
        </div>
      ))}

      <div className="portal-actions">
        <Button variant="secondary" iconLeft="clock" onClick={() => save.run(answers)}>
          {t('portal.forms.save')}
        </Button>
        <Button iconLeft="send" onClick={() => submit.run(answers)}>
          {t('portal.forms.submit')}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t('portal.forms.back')}
        </Button>
      </div>

      {save.status === 'done' ? (
        <output className="portal-record__meta">{t('portal.forms.saved')}</output>
      ) : null}

      {save.status === 'failed' ? (
        <p className="portal-record__meta" role="alert">
          {t('portal.forms.saveFailed')}
        </p>
      ) : null}

      {submit.status === 'failed' ? (
        <p className="portal-record__meta" role="alert">
          {t('portal.forms.submitFailed')}
        </p>
      ) : null}
    </Card>
  );
}

export function FormsScreen({ api = getPortalApi() }: Readonly<FormsScreenProps>) {
  const t = useTranslator();
  const load = useCallback(() => api.getForms(), [api]);
  const { state, reload } = useAsync(load);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        overline={t('portal.forms.overline')}
        title={t('portal.forms.title')}
        lede={t('portal.forms.lede')}
      />

      <AsyncBoundary
        state={state}
        loadingKey="portal.forms.async.loading"
        errorKey="portal.forms.async.error"
        onRetry={reload}
        isEmpty={(forms) => forms.length === 0}
        empty={
          <EmptyState
            icon="clipboard-list"
            title={t('portal.forms.empty.title')}
            message={t('portal.forms.empty.message')}
          />
        }
      >
        {(forms) => {
          const open = forms.find((form) => form.id === openId);

          if (open) {
            return (
              <Questionnaire api={api} key={open.id} onClose={() => setOpenId(null)} task={open} />
            );
          }

          return (
            <div className="portal-stack">
              {forms.map((form) => (
                <Card
                  key={form.id}
                  overline={t('portal.forms.neededBy', { date: formatDate(t, form.dueOn) })}
                  title={form.title}
                >
                  <p className="or-body">{form.purpose}</p>
                  <p className="portal-record__meta">
                    <Badge tone={form.status === 'submitted' ? 'success' : 'neutral'}>
                      {t(STATUS_LABEL_KEYS[form.status])}
                    </Badge>
                  </p>
                  <div className="portal-actions">
                    <Button
                      iconLeft={form.status === 'submitted' ? 'file-check' : 'clipboard-list'}
                      variant={form.status === 'submitted' ? 'secondary' : 'primary'}
                      onClick={() => setOpenId(form.id)}
                    >
                      {t(
                        form.status === 'in-progress'
                          ? 'portal.forms.continue'
                          : 'portal.forms.open'
                      )}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          );
        }}
      </AsyncBoundary>
    </>
  );
}
