import type { Translator } from '@openrunic/i18n';

import { PillarCard } from './PillarCard';
import { otherPillars } from './links';
import type { PublicRoute } from './links';
import { Section } from './Section';

export interface OtherAudiencesProps {
  /** The page being read, which is the one card this section leaves out. */
  current: PublicRoute;
  /** The translator, handed down by the page. */
  t: Translator;
  /**
   * The band this section paints. It is a prop because the alternation of bone
   * and cream is what gives a page its rhythm, and this section lands after a
   * different number of bands on different pages.
   */
  tone?: 'bone' | 'cream';
}

/**
 * The closing band of an audience page: the two audiences it is not about.
 *
 * A practice manager who lands on the hospitals page from a search result has
 * no reason to guess that a patient page exists, and the masthead alone is a
 * thin hint. This gives each page an exit into the rest of the site.
 */
export function OtherAudiences({ current, t, tone = 'cream' }: Readonly<OtherAudiencesProps>) {
  return (
    <Section
      id="other-audiences"
      title={t('marketing.otherAudiences.title')}
      lead={t('marketing.otherAudiences.lead')}
      tone={tone}
    >
      <div className="or-mk-grid">
        {otherPillars(current).map((pillar) => (
          <PillarCard key={pillar.href} pillar={pillar} t={t} />
        ))}
      </div>
    </Section>
  );
}
