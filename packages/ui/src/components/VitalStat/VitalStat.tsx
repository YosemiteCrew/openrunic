import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { ICON_STROKE_WIDTH, resolveLucideIcon } from '../../lib/lucide';
import type { IconSlug, StatusTone } from '../../types';

/** Icon sizes from the readout specimen: 14px beside the overline, 13px beside the state. */
const LABEL_ICON_SIZE = 14;
const STATE_ICON_SIZE = 13;

/** The state's Lucide slug. The shape differs per state, so the icon is a second signal. */
const STATE_ICON: Record<StatusTone, IconSlug> = {
  success: 'check',
  neutral: 'minus',
  danger: 'triangle-alert',
};

export interface VitalStatProps extends HTMLAttributes<HTMLElement> {
  label: string;
  value: ReactNode;
  unit?: string;
  /** olive = in range, hazelnut = informational, red = out of range. */
  state?: StatusTone;
  /** Required whenever state is meaningful - never colour alone. */
  stateLabel?: string;
  /** Lucide icon slug beside the label. */
  icon?: IconSlug;
  /** e.g. 'Today, 07:12'. */
  capturedAt?: string;
}

/**
 * A single vital or lab readout: label, value, unit, and an explicitly worded range state.
 *
 * The state colour is decoration on top of `stateLabel`, never a substitute for it. Pass no
 * `stateLabel` and the state row disappears entirely rather than leaving a bare colour.
 */
export function VitalStat({
  label,
  value,
  unit,
  state = 'neutral',
  stateLabel,
  icon,
  capturedAt,
  className,
  ...rest
}: VitalStatProps) {
  const LabelIcon = icon ? resolveLucideIcon(icon) : undefined;
  const StateIcon = resolveLucideIcon(STATE_ICON[state]);

  return (
    <div className={cx('or-vital-stat', `or-vital-stat--${state}`, className)} {...rest}>
      <span className="or-vital-stat__label">
        {LabelIcon ? (
          <LabelIcon
            className="or-vital-stat__label-icon"
            size={LABEL_ICON_SIZE}
            strokeWidth={ICON_STROKE_WIDTH}
            aria-hidden="true"
          />
        ) : null}
        {label}
      </span>
      <span className="or-vital-stat__reading">
        <span className="or-vital-stat__value">{value}</span>
        {unit ? <span className="or-vital-stat__unit">{unit}</span> : null}
      </span>
      {stateLabel ? (
        <span className="or-vital-stat__state">
          {StateIcon ? (
            <StateIcon
              className="or-vital-stat__state-icon"
              size={STATE_ICON_SIZE}
              strokeWidth={ICON_STROKE_WIDTH}
              aria-hidden="true"
            />
          ) : null}
          {stateLabel}
        </span>
      ) : null}
      {capturedAt ? <span className="or-vital-stat__captured">{capturedAt}</span> : null}
    </div>
  );
}
