'use client';

import { Badge, Tag } from '@openrunic/ui';
import type { ReactElement, ReactNode } from 'react';

import { useCommandPalette } from '@/components/command';
import { IS_MOCK_MODE, MOCK_FACILITY } from '@/lib/api';

/**
 * The product's top bar: where you are, what you are looking at it as, and the
 * one control that reaches everything else.
 *
 * The command control is a real button with a visible label, not a hover-only
 * affordance or a bare icon: the palette is the app's primary navigation for
 * keyboard users and for agents, so it must be discoverable by reading the
 * screen rather than by knowing a shortcut.
 */

export interface TopBarProps {
  /** The rail area currently open, so the bar says where you are at 1024px. */
  area?: string;
  /** Signed-in user, rendered as a plain label. Auth is not wired yet. */
  user?: string;
  /** Screen-specific controls, right of the command control. Keep it to two. */
  children?: ReactNode;
}

export function TopBar({
  area,
  user = 'Dr. Okafor',
  children,
}: Readonly<TopBarProps>): ReactElement {
  const { open } = useCommandPalette();

  return (
    <header className="or-topbar">
      <div className="or-topbar__context">
        {area ? <span className="or-topbar__area">{area}</span> : null}
        <Tag className="or-topbar__facility">{MOCK_FACILITY.name}</Tag>
        {IS_MOCK_MODE ? (
          // Demo data is never silent: every screen says so, in the same place.
          <Badge tone="neutral" icon="flask-conical">
            Demo data
          </Badge>
        ) : null}
      </div>

      <div className="or-topbar__actions">
        {children}
        <button type="button" className="or-topbar__command" onClick={open}>
          <span className="or-topbar__command-label">Search or run a command</span>
          <kbd className="or-topbar__kbd" aria-hidden="true">
            Cmd K
          </kbd>
        </button>
        <span className="or-topbar__user">{user}</span>
      </div>
    </header>
  );
}
