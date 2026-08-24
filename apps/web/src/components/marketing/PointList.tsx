import type { Translator } from '@openrunic/i18n';

export interface Point {
  readonly title: string;
  readonly body: string;
}

/**
 * One point before it has a language.
 *
 * The bands on the public pages are declared at module scope, where there is no
 * reader and therefore no translator. They carry keys in this shape and go
 * through {@link resolvePoints} at render.
 */
export interface PointKeys {
  readonly titleKey: string;
  readonly bodyKey: string;
}

/** The keys a page declared, in the language the page resolved. */
export function resolvePoints(keys: readonly PointKeys[], t: Translator): Point[] {
  return keys.map((point) => ({ title: t(point.titleKey), body: t(point.bodyKey) }));
}

export interface PointListProps {
  points: readonly Point[];
}

/**
 * A band's content as titled paragraphs: what the thing is, then what it means,
 * two or three sentences at a time.
 *
 * The titles are real `<h3>` headings rather than bold text, because they are
 * how someone navigating by heading moves through a long page. They sit under
 * the band's `<h2>`, so the outline descends one level.
 *
 * It takes words rather than keys, so it stays a presentational component with
 * no opinion about where its copy came from. The page translates.
 */
export function PointList({ points }: Readonly<PointListProps>) {
  return (
    <div className="or-mk-points">
      {points.map((point) => (
        <div className="or-mk-point" key={point.title}>
          <h3 className="or-h3">{point.title}</h3>
          <p className="or-body">{point.body}</p>
        </div>
      ))}
    </div>
  );
}
