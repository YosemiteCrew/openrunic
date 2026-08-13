'use client';

import { Badge, Button, Tag } from '@openrunic/ui';
import type { ReactElement, ReactNode } from 'react';

import { AssistantLauncher } from '@/components/assistant';
import { useCommandPalette } from '@/components/command';
import { IS_MOCK_MODE, MOCK_FACILITY } from '@/lib/api';
import { endSession } from '@/lib/auth/client';
import { signInUrl } from '@/lib/auth/routes';
import { useSession } from '@/lib/auth/useSession';

/**
 * The product's top bar: where you are, what you are looking at it as, who you
 * are looking at it as, and the one control that reaches everything else.
 *
 * The command control is a real button with a visible label, not a hover-only
 * affordance or a bare icon: the palette is the app's primary navigation for
 * keyboard users and for agents, so it must be discoverable by reading the
 * screen rather than by knowing a shortcut.
 *
 * The name and the sign-out control sit in the bar itself rather than inside a
 * menu behind an avatar, and both reasons are about shared workstations. The
 * name has to be readable without a click, because the most expensive mistake
 * in this application is writing a note as the person who forgot to sign out;
 * and signing out has to be one press, because a control hidden in a menu is a
 * control that a clinician leaving the room does not use.
 *
 * Neither appears when there is no session. That is not access control - the
 * screen does not exist without one, which is `proxy.ts`'s job - it is
 * honesty. A name in the corner is a claim about who is signed in.
 */

export interface TopBarProps {
  /** The rail area currently open, so the bar says where you are at 1024px. */
  area?: string;
  /**
   * Injectable for tests. Signing out is a document navigation rather than a
   * router push, because leaving the chart mounted behind a client transition
   * keeps the record on the screen, and in the tab's memory, after the person
   * it belongs to has gone.
   */
  navigate?: (url: string) => void;
  /** Screen-specific controls, right of the command control. Keep it to two. */
  children?: ReactNode;
}

function documentNavigate(url: string): void {
  window.location.assign(url);
}

export function TopBar({
  area,
  navigate = documentNavigate,
  children,
}: Readonly<TopBarProps>): ReactElement {
  const { open } = useCommandPalette();
  const session = useSession();

  async function signOut(): Promise<void> {
    await endSession();
    navigate(signInUrl());
  }

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
        {/* Renders nothing at all unless the API reported a configured
            assistant, which by default it does not. */}
        <AssistantLauncher />
        <button type="button" className="or-topbar__command" onClick={open}>
          <span className="or-topbar__command-label">Search or run a command</span>
          <kbd className="or-topbar__kbd" aria-hidden="true">
            Cmd K
          </kbd>
        </button>
        {session === null ? null : (
          <>
            <span className="or-topbar__user">{session.identity.displayName}</span>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              Sign out
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
