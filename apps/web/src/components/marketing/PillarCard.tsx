import { appCatalogue, createTranslator } from '@openrunic/i18n';
import Link from 'next/link';

import { localisedPath } from '@/lib/auth/routes';

import type { Pillar } from './links';

export interface PillarCardProps {
  pillar: Pillar;
  /**
   * The language segment this card is being prerendered under.
   *
   * A prop rather than a hook because the public pages are server components:
   * there is no provider above them, and reaching for one would pull the whole
   * client runtime onto the page a stranger loads first.
   *
   * It reaches the card's address as well as its words. `Pillar.href` is the
   * unprefixed route, `/for/hospitals`, which no page answers on any more:
   * `proxy.ts` matches it against `UNPREFIXED_MARKETING_PATHS` and redirects to
   * whatever the reader's cookie or `Accept-Language` asks for. So a reader on
   * `/es` who clicked one of these cards was bounced out of the language they
   * were visibly reading, into the one their browser had asked for months ago.
   */
  locale: string;
}

/**
 * One audience, on a bone card: who it is for, what they get today, and the
 * page that says more.
 *
 * The link is labelled with the audience rather than "Read more", because three
 * identically named links are three identical rows in a screen reader's link
 * list. It is one whole message rather than a prefix joined to the card's
 * title: the English reads as "openrunic for" plus a noun, and no other
 * language has agreed to that order. The chevron is a text character in a
 * decorative span rather than an icon: `@openrunic/ui`'s `Icon` cannot cross
 * the server-component boundary, and a single glyph is not worth doing so.
 */
export function PillarCard({ pillar, locale }: Readonly<PillarCardProps>) {
  const t = createTranslator(appCatalogue, locale);

  return (
    <article className="or-card or-mk-pillar">
      <h3 className="or-h3">{t(pillar.titleKey)}</h3>
      <p className="or-body">{t(pillar.summaryKey)}</p>
      <ul className="or-mk-pillar__points">
        {pillar.pointKeys.map((point) => (
          <li className="or-small" key={point.labelKey}>
            {t(point.labelKey)}
          </li>
        ))}
      </ul>
      <Link className="or-mk-pillar__link" href={localisedPath(pillar.href, locale)}>
        {t(pillar.linkKey)}
        <span aria-hidden="true"> &rarr;</span>
      </Link>
    </article>
  );
}
