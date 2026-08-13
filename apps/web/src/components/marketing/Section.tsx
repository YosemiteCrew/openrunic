import type { ReactNode } from 'react';

export interface SectionProps {
  /**
   * Anchors the heading and names the section through `aria-labelledby`, so the
   * landmark list a screen reader builds says what each band is rather than
   * repeating "region".
   */
  id: string;
  /** The `<h2>`. Sentence case, no full stop. */
  title: string;
  /** One or two lines under the heading. Optional. */
  lead?: string;
  /** `bone` is the page paper; `cream` sets a band off from its neighbours. */
  tone?: 'bone' | 'cream';
  children: ReactNode;
}

/**
 * One band of a public page: a heading, an optional lead, and its content on a
 * measured column.
 *
 * Every band is level 2. Pages own their single `<h1>` and the components
 * inside a band own level 3, which keeps the outline descending one level at a
 * time on all four pages without any of them having to think about it.
 */
export function Section({ id, title, lead, tone = 'bone', children }: Readonly<SectionProps>) {
  return (
    <section className={`or-mk-section or-mk-section--${tone}`} aria-labelledby={id}>
      <div className="or-mk-section__inner">
        <div className="or-mk-section__head">
          <h2 className="or-h2" id={id}>
            {title}
          </h2>
          {lead ? <p className="or-body-lg or-mk-section__lead">{lead}</p> : null}
        </div>
        {children}
      </div>
    </section>
  );
}
