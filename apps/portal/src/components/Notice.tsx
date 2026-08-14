'use client';

/**
 * A caution panel: caramel wash, espresso ink, an icon beside the words.
 *
 * Used for the standing safety notes a patient has to read before acting, such as the one
 * above the message compose box. It is not a status indicator and never carries terracotta,
 * olive or red - those belong to actions and to clinical range states.
 */

import type { ReactNode } from 'react';
import { Icon } from '@openrunic/ui';

export interface NoticeProps {
  /** The heading of the caution, in sentence case. */
  title: string;
  children: ReactNode;
}

export function Notice({ title, children }: NoticeProps) {
  return (
    <aside className="portal-notice" aria-label={title}>
      <Icon className="portal-notice__icon" name="triangle-alert" size={20} />
      <div className="portal-notice__body">
        <p className="portal-notice__title">{title}</p>
        <p className="or-small portal-notice__text">{children}</p>
      </div>
    </aside>
  );
}
