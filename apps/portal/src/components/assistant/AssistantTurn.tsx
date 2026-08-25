'use client';

/**
 * One question and what came back.
 *
 * The order on screen is the order the work happened: what was looked at, then
 * what it says, then which records it came from. The records sit under the
 * words rather than beside them, because they are the thing a reader checks the
 * words against, and a citation in a margin is a citation nobody opens.
 *
 * Every path that does not end in a checkable answer ends in the same panel
 * offering the same route to the care team. That uniformity is the point: a
 * surface that varied its tone by what went wrong would be telling a patient
 * how worried to be, which is not something it knows.
 */

import type { Translator } from '@openrunic/i18n';
import Link from 'next/link';
import { Icon } from '@openrunic/ui';
import type { AssistantSource } from '@/lib/assistant';
import { useTranslator } from '@/lib/i18n/messages';
import { citationDestination, citationHref, citationName } from './citations';
import { explainFailure } from './failure';
import { offersCareTeam } from './transcript';
import type { AssistantTurn as Turn, WithheldReason } from './transcript';

/** Why nothing is shown, when a turn produced words that are not on screen. */
const WITHHELD_KEYS: Record<Exclude<WithheldReason, 'none'>, string> = {
  unsourced: 'portal.assistant.withheld.unsourced',
  incomplete: 'portal.assistant.withheld.incomplete',
  'care-team': 'portal.assistant.withheld.careTeam',
};

/** What a step says about itself in words, beside what its icon says. */
const STEP_STATE_KEYS = {
  done: 'portal.assistant.step.done',
  stillGoing: 'portal.assistant.step.stillGoing',
  notFinished: 'portal.assistant.step.notFinished',
} as const;

export interface AssistantTurnViewProps {
  turn: Turn;
  /** True while this is the turn still arriving. */
  answering: boolean;
}

export function AssistantTurnView({ turn, answering }: Readonly<AssistantTurnViewProps>) {
  const t = useTranslator();
  const paragraphs = turn.answer.split(/\n{2,}/).filter((piece) => piece.trim() !== '');

  return (
    <li className="portal-assistant__turn">
      <p className="portal-assistant__question">
        <span className="portal-visually-hidden">{t('portal.assistant.turn.youAsked')} </span>
        {turn.question}
      </p>

      {turn.steps.length > 0 ? (
        <ul className="portal-assistant__steps">
          {turn.steps.map((step) => (
            <li className="portal-assistant__step" key={step.key}>
              {/* The state is in the words as well as the icon: a screen reader
                  announces neither the icon nor a colour. */}
              <Icon
                className="portal-assistant__step-icon"
                name={step.done ? 'check' : 'ellipsis'}
                size={16}
              />
              <span>
                {step.label}
                {t(stepStateKey(step, turn.outcome))}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {paragraphs.map((paragraph) => (
        <p className="portal-assistant__answer" key={paragraph}>
          {paragraph}
        </p>
      ))}

      {turn.withheld === 'none' ? null : (
        <p className="portal-assistant__withheld">{t(WITHHELD_KEYS[turn.withheld])}</p>
      )}

      {turn.deferrals.map((reason) => (
        <p className="portal-assistant__withheld" key={reason}>
          {t('portal.assistant.deferral', { reason })}
        </p>
      ))}

      {turn.failures.map((code) => (
        <p className="portal-assistant__withheld" key={code} role="alert">
          {explainFailure(t, code)}
        </p>
      ))}

      {turn.sources.length > 0 ? <SourceList sources={turn.sources} t={t} /> : null}

      {offersCareTeam(turn) ? <CareTeamRoute t={t} /> : null}

      {answering ? (
        <span className="portal-visually-hidden">{t('portal.assistant.turn.stillLooking')}</span>
      ) : null}
    </li>
  );
}

/**
 * What a step says about itself, once in words and once in an icon.
 *
 * A step the turn never came back to is the ordinary shape of a turn that was
 * aborted or cut short, and leaving it reading "still going" would tell somebody
 * work is happening on a question that has already ended.
 */
function stepStateKey(step: Turn['steps'][number], outcome: Turn['outcome']): string {
  if (step.done) return STEP_STATE_KEYS.done;
  return outcome === null ? STEP_STATE_KEYS.stillGoing : STEP_STATE_KEYS.notFinished;
}

/**
 * The route out, drawn identically every time it is drawn.
 *
 * It is a link to the messages screen rather than an instruction to "contact
 * your practice": the whole reason this page can decline to answer without
 * leaving somebody stuck is that the next step is one tap away.
 */
function CareTeamRoute({ t }: Readonly<{ t: Translator }>) {
  return (
    <div className="portal-assistant__care-team">
      <Icon className="portal-assistant__care-team-icon" name="message-square" size={20} />
      <p className="portal-assistant__care-team-text">
        {t('portal.assistant.careTeam.text')}{' '}
        <Link href="/messages">{t('portal.assistant.careTeam.link')}</Link>.
      </p>
    </div>
  );
}

function SourceList({
  sources,
  t,
}: Readonly<{ sources: readonly AssistantSource[]; t: Translator }>) {
  return (
    <div className="portal-assistant__sources">
      <p className="or-overline portal-assistant__sources-head">
        {t('portal.assistant.sources.head')}
      </p>
      <ul className="portal-assistant__source-list">
        {sources.map((source) => (
          <li
            className="portal-assistant__source"
            key={`${source.resourceType}-${source.resourceId}`}
          >
            <SourceLine source={source} t={t} />
            {source.untrusted ? (
              /* Text the reader or somebody outside the practice wrote, marked
                 wherever it is shown. It is the input class ADR-0005 treats as
                 untrusted, and by this point the person reading is the only
                 check left. */
              <span className="portal-assistant__source-note">
                {t('portal.assistant.sources.untrusted')}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourceLine({ source, t }: Readonly<{ source: AssistantSource; t: Translator }>) {
  const href = citationHref(source);
  const name = citationName(t, source);

  if (href === null) {
    return <span>{t('portal.assistant.sources.line', { name, label: source.label })}</span>;
  }

  /*
   * Two whole messages, and the dash between them belongs to the first one
   * rather than to this file. It is punctuation this language happens to use
   * where these two clauses meet, and a language that puts the citation after
   * the link, or uses no dash at all, has nowhere to say so if the mark is
   * spelled here.
   */
  return (
    <span>
      {t('portal.assistant.sources.lineBeforeLink', { name, label: source.label })}{' '}
      <Link href={href}>
        {t('portal.assistant.sources.seeIn', { destination: citationDestination(t, href) })}
      </Link>
    </span>
  );
}
