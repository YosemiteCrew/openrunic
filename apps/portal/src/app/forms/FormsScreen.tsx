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
import { formatDate, formatProgress } from '@/lib/format';
import { useAction, useAsync } from '@/lib/useAsync';

export interface FormsScreenProps {
  api?: PortalApi;
}

const STATUS_LABEL: Record<FormStatus, string> = {
  'not-started': 'Not started',
  'in-progress': 'Saved, not sent',
  submitted: 'Sent',
};

interface QuestionFieldProps {
  question: FormQuestion;
  value: string;
  onChange: (value: string) => void;
}

function QuestionField({ question, value, onChange }: QuestionFieldProps) {
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

  const options = question.kind === 'yes-no' ? ['Yes', 'No'] : (question.options ?? []);

  return (
    <fieldset className="portal-question__fieldset">
      <legend className="portal-question__legend">{question.prompt}</legend>
      {question.help ? <p className="portal-question__help">{question.help}</p> : null}
      {options.map((option) => (
        <Radio
          key={option}
          checked={value === option}
          label={option}
          name={question.id}
          value={option}
          onChange={() => onChange(option)}
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

function Questionnaire({ task, api, onClose }: QuestionnaireProps) {
  const [answers, setAnswers] = useState<Record<string, string>>(task.answers);
  const save = useAction((next: Record<string, string>) => api.saveForm(task.id, next));
  const submit = useAction((next: Record<string, string>) => api.submitForm(task.id, next));

  const answered = task.questions.filter((question) => {
    const answer = answers[question.id];
    return answer !== undefined && answer !== '';
  }).length;

  if (submit.status === 'done') {
    return (
      <Card overline="Sent" title="Your form has gone to the practice">
        <p className="or-body">
          Your answers are with your care team and will be read before your appointment. You do not
          need to do anything else.
        </p>
        <div className="portal-actions">
          <Button variant="secondary" iconLeft="arrow-left" onClick={onClose}>
            Back to your forms
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card overline="In progress" title={task.title}>
      <p className="or-body">{task.purpose}</p>

      <ProgressMeter
        done={answered}
        label={formatProgress(answered, task.questions.length)}
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
          Save and finish later
        </Button>
        <Button iconLeft="send" onClick={() => submit.run(answers)}>
          Send to the practice
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Back to your forms
        </Button>
      </div>

      {save.status === 'done' ? (
        <p className="portal-record__meta" role="status">
          Your answers are saved. You can close this and come back to it later.
        </p>
      ) : null}

      {save.status === 'failed' ? (
        <p className="portal-record__meta" role="alert">
          Your answers were not saved, and they are still on this page. Check your connection, then
          save again.
        </p>
      ) : null}

      {submit.status === 'failed' ? (
        <p className="portal-record__meta" role="alert">
          Your form did not send, and your answers are still on this page. Check your connection,
          then send it again.
        </p>
      ) : null}
    </Card>
  );
}

export function FormsScreen({ api = getPortalApi() }: FormsScreenProps) {
  const load = useCallback(() => api.getForms(), [api]);
  const { state, reload } = useAsync(load);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        overline="Before your visit"
        title="Forms"
        lede="Questionnaires your care team has asked you to fill in. Save as you go and finish whenever you like."
      />

      <AsyncBoundary
        state={state}
        what="your forms"
        onRetry={reload}
        isEmpty={(forms) => forms.length === 0}
        empty={
          <EmptyState
            icon="clipboard-list"
            title="You have no forms to fill in."
            message="When your care team sends you one, it appears here with the date it is needed by."
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
                  overline={`Needed by ${formatDate(form.dueOn)}`}
                  title={form.title}
                >
                  <p className="or-body">{form.purpose}</p>
                  <p className="portal-record__meta">
                    <Badge tone={form.status === 'submitted' ? 'success' : 'neutral'}>
                      {STATUS_LABEL[form.status]}
                    </Badge>
                  </p>
                  <div className="portal-actions">
                    <Button
                      iconLeft={form.status === 'submitted' ? 'file-check' : 'clipboard-list'}
                      variant={form.status === 'submitted' ? 'secondary' : 'primary'}
                      onClick={() => setOpenId(form.id)}
                    >
                      {form.status === 'in-progress' ? 'Continue the form' : 'Open the form'}
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
