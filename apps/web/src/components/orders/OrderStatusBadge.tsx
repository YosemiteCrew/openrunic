'use client';

import { Badge } from '@openrunic/ui';
import type { BadgeTone } from '@openrunic/ui';
import type { ReactElement } from 'react';

import type { Order, OrderStatus } from '@/lib/api';
import { formatElapsed } from '@/lib/format';

import { isStuck } from './stuck';

/**
 * The order's lifecycle state, as a word first and a colour second.
 *
 * Order status is a first-class ledger here rather than plumbing inside a lab
 * module, so "did the lab get it" is answered by looking at the row.
 */

const STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  PENDED: 'neutral',
  SIGNED: 'neutral',
  TRANSMITTED: 'neutral',
  IN_PROGRESS: 'neutral',
  RESULTED: 'success',
  CANCELLED: 'ink',
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDED: 'Pended',
  SIGNED: 'Signed',
  TRANSMITTED: 'Transmitted',
  IN_PROGRESS: 'In progress',
  RESULTED: 'Resulted',
  CANCELLED: 'Cancelled',
};

const STATUS_ICON: Record<OrderStatus, string> = {
  PENDED: 'circle-dashed',
  SIGNED: 'pen-line',
  TRANSMITTED: 'send',
  IN_PROGRESS: 'loader',
  RESULTED: 'check',
  CANCELLED: 'ban',
};

export interface OrderStatusBadgeProps {
  status: OrderStatus;
}

export function OrderStatusBadge({ status }: Readonly<OrderStatusBadgeProps>): ReactElement {
  return (
    <Badge tone={STATUS_TONE[status]} icon={STATUS_ICON[status]}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export interface OrderAgeProps {
  order: Order;
  now: string;
}

/**
 * How long the order has sat in this state. A claim is never shown without its
 * state age, and an order is no different: an unacknowledged requisition is
 * invisible until someone counts the days.
 */
export function OrderAge({ order, now }: Readonly<OrderAgeProps>): ReactElement {
  const elapsed = formatElapsed(order.lastEventAt, now);
  if (isStuck(order, now)) {
    return (
      <Badge tone="danger" icon="triangle-alert">
        {`Unacknowledged ${elapsed}`}
      </Badge>
    );
  }
  return <span className="or-small">{elapsed}</span>;
}
