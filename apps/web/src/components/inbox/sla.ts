import { slaState } from '@/lib/api';
import { formatDateTime, formatElapsed } from '@/lib/format';

/** The SLA sentence, without the badge around it. Screens read it into row labels. */
export function slaLabel(dueAt: string, now: string): string {
  const state = slaState(dueAt, now);
  if (state === 'OVERDUE') return `Overdue by ${formatElapsed(dueAt, now)}`;
  if (state === 'DUE_SOON') return `Due in ${formatElapsed(now, dueAt)}`;
  return `Due ${formatDateTime(dueAt, 'dense')}`;
}
