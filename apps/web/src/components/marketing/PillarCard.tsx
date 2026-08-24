import type { Translator } from '@openrunic/i18n';
import Link from 'next/link';

import type { Pillar } from './links';

export interface PillarCardProps {
  pillar: Pillar;
  /**
   * The translator, passed in rather than taken from the hook.
   *
   * The public pages are server components, and `useTranslator` is a client
   * hook; the page resolves the locale once, before the first byte, and hands
   * the translator down. See `PublicPage` for where it comes from.
   */
  t: Translator;
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
export function PillarCard({ pillar, t }: Readonly<PillarCardProps>) {
  const title = t(pillar.titleKey);

  return (
    <article className="or-card or-mk-pillar">
      <h3 className="or-h3">{title}</h3>
      <p className="or-body">{t(pillar.summaryKey)}</p>
      <ul className="or-mk-pillar__points">
        {pillar.points.map((point) => (
          <li className="or-small" key={point.labelKey}>
            {t(point.labelKey)}
          </li>
        ))}
      </ul>
      {/* One message with the audience in it rather than "openrunic for" glued
          to a title: where the audience falls in that phrase is a decision each
          language makes for itself. */}
      <Link className="or-mk-pillar__link" href={pillar.href}>
        {t('marketing.pillar.link', { audience: title.toLowerCase() })}
        <span aria-hidden="true"> &rarr;</span>
      </Link>
    </article>
  );
}
