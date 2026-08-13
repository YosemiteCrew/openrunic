import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { useFieldId } from '../../lib/useFieldId';

export interface DescriptionListItem {
  /** The label, e.g. "Medical record number". */
  term: string;
  /** The value; may be a node (a Badge, a Tag, a link). */
  value: ReactNode;
  /** Render the value in Spline Sans Mono - FHIR ids, codes, identifiers. */
  mono?: boolean;
  /** Tabular figures for measurements. */
  numeric?: boolean;
}

export interface DescriptionListProps extends HTMLAttributes<HTMLElement> {
  /** Term and value pairs, read in the order given. */
  items?: DescriptionListItem[];
  /** Names the list for assistive technology. */
  caption?: string;
}

/**
 * Prefer an item's own `term` so re-ordering a list does not re-key every pair to its
 * position. A term can honestly repeat - two identifiers, two contact numbers - and a
 * repeated key would collide, so the second and later copies fall back to the index.
 */
function keyedItems(
  items: DescriptionListItem[]
): Array<{ key: string; item: DescriptionListItem }> {
  const seen = new Set<string>();
  return items.map((item, index) => {
    const key = seen.has(item.term) ? `${item.term}-${index}` : item.term;
    seen.add(item.term);
    return { key, item };
  });
}

/**
 * Label and value pairs for a single record: the patient header, a document's metadata, a
 * consent grant's detail. Where Table reads across many records, this reads down one.
 *
 * A real `<dl>`, with each pair in a `<div>` - the only element the list is allowed to hold
 * around a `<dt>` and a `<dd>`, and the one that lets the pair be a grid. Stacked below md
 * so the value gets the full width of a phone, two columns from md up. Hairlines separate
 * the pairs and never the columns: this system separates columns with space, not lines.
 *
 * The caption sits above the list rather than inside it, because nothing but a pair may
 * live in a `<dl>`; `aria-labelledby` ties the two together.
 */
export function DescriptionList({
  items = [],
  caption,
  className,
  id,
  ...rest
}: DescriptionListProps) {
  const listId = useFieldId(id);
  const captionId = `${listId}-caption`;

  return (
    <>
      {caption ? (
        <p className="or-description-list__caption" id={captionId}>
          {caption}
        </p>
      ) : null}
      <dl
        id={listId}
        className={cx('or-description-list', className)}
        aria-labelledby={caption ? captionId : undefined}
        {...rest}
      >
        {keyedItems(items).map(({ key, item }) => (
          <div key={key} className="or-description-list__pair">
            <dt className="or-description-list__term">{item.term}</dt>
            <dd
              className={cx(
                'or-description-list__value',
                item.mono && 'or-description-list__value--mono',
                item.numeric && 'or-description-list__value--numeric'
              )}
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
