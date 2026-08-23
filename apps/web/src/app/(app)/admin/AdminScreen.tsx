'use client';

import { Card, Icon } from '@openrunic/ui';
import Link from 'next/link';
import type { ReactElement } from 'react';

import { ADMIN_AREAS } from '@/components/admin';
import { AppShell } from '@/components/shell';

/**
 * The admin hub.
 *
 * Not a dashboard: an admin arrives here already knowing what they came to
 * change, so the screen's whole job is to name the six areas and get out of the
 * way. Each card is one sentence about what the area owns, and the heading is a
 * real link rather than a clickable box, so it is keyboard reachable,
 * middle-clickable, and announced as a link.
 */
export function AdminScreen(): ReactElement {
  return (
    <AppShell
      title="Admin"
      description="Users, facilities, forms, the audit trail and the practice's own configuration."
    >
      <ul className="or-hub">
        {ADMIN_AREAS.map((area) => (
          <li key={area.href}>
            <Card className="or-hub__card">
              <span className="or-hub__icon" aria-hidden="true">
                <Icon name={area.icon} size={20} />
              </span>
              <h2 className="or-h3 or-hub__title">
                <Link className="or-hub__link" href={area.href}>
                  {area.label}
                </Link>
              </h2>
              <p className="or-small or-hub__description">{area.description}</p>
            </Card>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
