import { appCatalogue, createTranslator } from '@openrunic/i18n';

/**
 * One titled paragraph, as catalogue keys.
 *
 * Keys rather than words because every list of these is a module-scope constant
 * in a page file, and the reader's language is not known there. Named
 * `titleKey` and `bodyKey` because `catalogue-drift.test.ts` reads
 * `somethingKey:` out of the source: a paragraph whose key is defined nowhere
 * fails the build instead of putting a message key where an argument should be.
 */
export interface PointKeys {
  readonly titleKey: string;
  readonly bodyKey: string;
}

export interface PointListProps {
  points: readonly PointKeys[];
  /** The language segment the page is prerendered under. */
  locale: string;
}

/**
 * A band's content as titled paragraphs: what the thing is, then what it means,
 * two or three sentences at a time.
 *
 * The titles are real `<h3>` headings rather than bold text, because they are
 * how someone navigating by heading moves through a long page. They sit under
 * the band's `<h2>`, so the outline descends one level.
 */
export function PointList({ points, locale }: Readonly<PointListProps>) {
  const t = createTranslator(appCatalogue, locale);

  return (
    <div className="or-mk-points">
      {points.map((point) => (
        <div className="or-mk-point" key={point.titleKey}>
          <h3 className="or-h3">{t(point.titleKey)}</h3>
          <p className="or-body">{t(point.bodyKey)}</p>
        </div>
      ))}
    </div>
  );
}
