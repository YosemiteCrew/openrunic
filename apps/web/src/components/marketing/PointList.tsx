export interface Point {
  readonly title: string;
  readonly body: string;
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
