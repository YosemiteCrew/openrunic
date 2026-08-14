import { PillarCard } from './PillarCard';
import { otherPillars } from './links';
import type { PublicRoute } from './links';
import { Section } from './Section';

export interface OtherAudiencesProps {
  /** The page being read, which is the one card this section leaves out. */
  current: PublicRoute;
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
export function OtherAudiences({ current, tone = 'cream' }: Readonly<OtherAudiencesProps>) {
  return (
    <Section
      id="other-audiences"
      title="The other audiences"
      lead="The same system, described for the people on the other side of it."
      tone={tone}
    >
      <div className="or-mk-grid">
        {otherPillars(current).map((pillar) => (
          <PillarCard key={pillar.href} pillar={pillar} />
        ))}
      </div>
    </Section>
  );
}
