import Link from 'next/link';
import type { ReactElement } from 'react';

/**
 * Breadcrumbs exist ONLY outside the chart: Admin and Reports, where a screen
 * really is nested ("Admin / Form builder / Intake v3"). Inside the chart the
 * context rail and the tab row say where you are, and a breadcrumb there would
 * be a third answer to a question already answered twice.
 */

export interface BreadcrumbItem {
  label: string;
  /** Omit on the last item: the current page is not a link to itself. */
  href?: string;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps): ReactElement | null {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="or-breadcrumb">
      <ol className="or-breadcrumb__list">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="or-breadcrumb__item">
              {item.href && !isLast ? (
                <Link href={item.href} className="or-breadcrumb__link">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={isLast ? 'page' : undefined}>{item.label}</span>
              )}
              {isLast ? null : (
                <span className="or-breadcrumb__separator" aria-hidden="true">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
