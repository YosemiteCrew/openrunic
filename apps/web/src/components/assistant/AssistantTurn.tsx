'use client';

import type { Translator } from '@openrunic/i18n';
import { Icon, Tag } from '@openrunic/ui';
import Link from 'next/link';
import type { ReactElement } from 'react';

import { Alert } from '@/components/state';
import type { AgentSource } from '@/lib/agent';
import { useTranslator } from '@/lib/i18n/messages';

import { citationHref, citationTypeLabel } from './citations';
import { describeFailure } from './failure';
import type { AssistantDraft, AssistantTurn as Turn, WithheldReason } from './transcript';

/**
 * One question and what came back.
 *
 * The order on screen is the order the work happened: what was read, then what
 * it says, then what it was drawn from. The sources sit under the prose rather
 * than beside it because they are the thing a clinician checks the prose
 * against, and a citation in a margin is a citation nobody opens.
 */

/** Why nothing is shown, when the turn produced prose that is not on screen. */
const WITHHELD_KEY: Record<Exclude<WithheldReason, 'none'>, { labelKey: string }> = {
  unsourced: { labelKey: 'assistant.withheld.unsourced' },
  incomplete: { labelKey: 'assistant.withheld.incomplete' },
};

export interface AssistantTurnProps {
  turn: Turn;
  /** True while this turn is the one still arriving. */
  streaming: boolean;
}

export function AssistantTurnView({ turn, streaming }: Readonly<AssistantTurnProps>): ReactElement {
  const t = useTranslator();
  const paragraphs = turn.answer.split(/\n{2,}/).filter((piece) => piece.trim() !== '');

  return (
    <li className="or-assistant__turn">
      <p className="or-assistant__question">
        {/* The space is written here rather than inside the message, because a
            catalogue value with a trailing space is one an editor or a
            translation tool silently trims. */}
        <span className="or-visually-hidden">{t('assistant.turn.youAsked')} </span>
        {turn.question}
      </p>

      {turn.steps.length > 0 ? (
        <ul className="or-assistant__steps">
          {turn.steps.map((step) => (
            <li key={step.key} className="or-assistant__step" data-done={step.done || undefined}>
              <Icon
                name={step.done ? 'check' : 'ellipsis'}
                size={14}
                className="or-assistant__step-icon"
              />
              {/* The state is in the word as well as the glyph, because a
                  screen reader announces neither the icon nor the data
                  attribute. The label is the server's own word for the step, so
                  it is a value inside the message rather than part of it. */}
              <span>
                {step.done
                  ? t('assistant.turn.stepDone', { step: step.label })
                  : t('assistant.turn.stepRunning', { step: step.label })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {paragraphs.map((paragraph) => (
        <p key={paragraph} className="or-body or-assistant__answer">
          {paragraph}
        </p>
      ))}

      {turn.withheld === 'none' ? null : (
        <p className="or-assistant__withheld or-body">{t(WITHHELD_KEY[turn.withheld].labelKey)}</p>
      )}

      {turn.drafts.map((draft) => (
        <DraftCard key={draft.proposalId} draft={draft} t={t} />
      ))}

      {turn.deferrals.map((deferral) => (
        <p key={deferral.toolId} className="or-caption or-assistant__deferred">
          {t('assistant.turn.deferred', { tool: deferral.toolId, reason: deferral.reason })}
        </p>
      ))}

      {turn.failures.map((failure) => {
        const explanation = describeFailure(t, failure);
        return (
          <Alert
            key={`${failure.code}-${failure.toolId ?? 'turn'}`}
            tone="caution"
            title={explanation.title}
            message={explanation.message}
            className="or-assistant__failure"
          />
        );
      })}

      {turn.sources.length > 0 ? <SourceList sources={turn.sources} t={t} /> : null}

      {turn.outcome === 'stopped' ? (
        <p className="or-caption or-assistant__stopped">{t('assistant.turn.stopped')}</p>
      ) : null}

      {streaming ? (
        <span className="or-visually-hidden">{t('assistant.turn.stillAnswering')}</span>
      ) : null}
    </li>
  );
}

function SourceList({
  sources,
  t,
}: Readonly<{ sources: readonly AgentSource[]; t: Translator }>): ReactElement {
  return (
    <div className="or-assistant__sources">
      <p className="or-overline">{t('assistant.sources.heading')}</p>
      <ul>
        {sources.map((source) => (
          <li key={`${source.resourceType}-${source.resourceId}`} className="or-assistant__source">
            <SourceLink source={source} t={t} />
            {source.untrusted ? (
              // Patient-authored and outside text is marked wherever it is
              // shown. It is the input class ADR-0005 treats as untrusted, and
              // the person reading is the only control left at this point.
              <Tag className="or-assistant__source-tag">{t('assistant.sources.untrusted')}</Tag>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourceLink({ source, t }: Readonly<{ source: AgentSource; t: Translator }>): ReactElement {
  const href = citationHref(source);
  const type = citationTypeLabel(t, source);

  if (href === null) {
    return (
      <span className="or-assistant__source-ref">
        {type} {source.label}
        <span className="or-mono or-assistant__source-id"> {source.resourceId}</span>
      </span>
    );
  }

  return (
    <Link href={href} className="or-assistant__source-link">
      {type} {source.label}
    </Link>
  );
}

/**
 * A change the server proposed, rendered with no way to accept it.
 *
 * This surface runs every turn in read mode, so the writer half of the loop
 * never runs and no proposal can originate here. It is rendered anyway, because
 * a client that crashes on an event its server can emit is a client that breaks
 * the day someone enables the other mode. What it deliberately does not have is
 * a commit control: ADR-0005 requires a confirmation surface to re-read the
 * affected rows from the API before it renders the effect, and that surface is
 * a separate piece of work.
 */
function DraftCard({ draft, t }: Readonly<{ draft: AssistantDraft; t: Translator }>): ReactElement {
  return (
    <div className="or-assistant__draft">
      <p className="or-overline">{t('assistant.draft.heading')}</p>
      <dl className="or-assistant__draft-fields">
        {draft.effect.map((field) => (
          <div key={field.label}>
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
      <p className="or-caption">{t('assistant.draft.note')}</p>
      {draft.derivedFromUntrusted ? (
        <p className="or-caption">{t('assistant.draft.untrusted')}</p>
      ) : null}
    </div>
  );
}
