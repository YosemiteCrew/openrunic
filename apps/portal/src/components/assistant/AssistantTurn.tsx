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

import Link from 'next/link';
import { Icon } from '@openrunic/ui';
import type { AssistantSource } from '@/lib/assistant';
import { citationDestination, citationHref, citationName } from './citations';
import { explainFailure } from './failure';
import { offersCareTeam } from './transcript';
import type { AssistantTurn as Turn, WithheldReason } from './transcript';

/** Why nothing is shown, when a turn produced words that are not on screen. */
const WITHHELD: Record<Exclude<WithheldReason, 'none'>, string> = {
  unsourced:
    'The answer came back without the records it was based on, so it is not shown. An answer you cannot check against your own record is not one to rely on.',
  incomplete: 'You stopped this before it finished a sentence, so there is nothing to show.',
  'care-team':
    'This one is for a person, not for this page. It can look things up in your record; it cannot tell you what something means, whether it matters, or what to do.',
};

export interface AssistantTurnViewProps {
  turn: Turn;
  /** True while this is the turn still arriving. */
  answering: boolean;
}

export function AssistantTurnView({ turn, answering }: AssistantTurnViewProps) {
  const paragraphs = turn.answer.split(/\n{2,}/).filter((piece) => piece.trim() !== '');

  return (
    <li className="portal-assistant__turn">
      <p className="portal-assistant__question">
        <span className="portal-visually-hidden">You asked: </span>
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
                {step.done ? ', done' : ', still going'}
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
        <p className="portal-assistant__withheld">{WITHHELD[turn.withheld]}</p>
      )}

      {turn.deferrals.map((reason) => (
        <p className="portal-assistant__withheld" key={reason}>
          The assistant did not go ahead with part of this: {reason}
        </p>
      ))}

      {turn.failures.map((code) => (
        <p className="portal-assistant__withheld" key={code} role="alert">
          {explainFailure(code)}
        </p>
      ))}

      {turn.sources.length > 0 ? <SourceList sources={turn.sources} /> : null}

      {offersCareTeam(turn) ? <CareTeamRoute /> : null}

      {answering ? <span className="portal-visually-hidden">Still looking.</span> : null}
    </li>
  );
}

/**
 * The route out, drawn identically every time it is drawn.
 *
 * It is a link to the messages screen rather than an instruction to "contact
 * your practice": the whole reason this page can decline to answer without
 * leaving somebody stuck is that the next step is one tap away.
 */
function CareTeamRoute() {
  return (
    <div className="portal-assistant__care-team">
      <Icon className="portal-assistant__care-team-icon" name="message-square" size={20} />
      <p className="portal-assistant__care-team-text">
        Ask your care team. They can see the same record and they can answer questions this page
        cannot. <Link href="/messages">Write to your care team</Link>.
      </p>
    </div>
  );
}

function SourceList({ sources }: { sources: readonly AssistantSource[] }) {
  return (
    <div className="portal-assistant__sources">
      <p className="or-overline portal-assistant__sources-head">Where this came from</p>
      <ul className="portal-assistant__source-list">
        {sources.map((source) => (
          <li
            className="portal-assistant__source"
            key={`${source.resourceType}-${source.resourceId}`}
          >
            <SourceLine source={source} />
            {source.untrusted ? (
              /* Text the reader or somebody outside the practice wrote, marked
                 wherever it is shown. It is the input class ADR-0005 treats as
                 untrusted, and by this point the person reading is the only
                 check left. */
              <span className="portal-assistant__source-note">
                Written by you or by someone outside the practice
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourceLine({ source }: { source: AssistantSource }) {
  const href = citationHref(source);
  const name = citationName(source);

  if (href === null) {
    return (
      <span>
        {name}: {source.label}
      </span>
    );
  }

  return (
    <span>
      {name}: {source.label} - <Link href={href}>see it in {citationDestination(href)}</Link>
    </span>
  );
}
