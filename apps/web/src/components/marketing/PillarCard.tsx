import Link from 'next/link';

import type { Pillar } from './links';

export interface PillarCardProps {
  pillar: Pillar;
}

/**
 * One audience, on a bone card: who it is for, what they get today, and the
 * page that says more.
 *
 * The link is labelled with the audience rather than "Read more", because three
 * identically named links are three identical rows in a screen reader's link
 * list. The chevron is a text character in a decorative span rather than an
 * icon: `@openrunic/ui`'s `Icon` cannot cross the server-component boundary,
 * and a single glyph is not worth doing so.
 */
export function PillarCard({ pillar }: Readonly<PillarCardProps>) {
  return (
    <article className="or-card or-mk-pillar">
      <h3 className="or-h3">{pillar.title}</h3>
      <p className="or-body">{pillar.summary}</p>
      <ul className="or-mk-pillar__points">
        {pillar.points.map((point) => (
          <li className="or-small" key={point}>
            {point}
          </li>
        ))}
      </ul>
      <Link className="or-mk-pillar__link" href={pillar.href}>
        openrunic for {pillar.title.toLowerCase()}
        <span aria-hidden="true"> &rarr;</span>
      </Link>
    </article>
  );
}
