import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Sparkline } from '@/components/reports/Sparkline';

/**
 * The trend line beside a figure.
 *
 * It is decorative - `aria-hidden`, with the number it accompanies carrying the
 * meaning - so what matters is that it never renders something misleading. The
 * two cases that would are a series too short to have a direction, and a flat
 * series, whose range is zero and would divide by it.
 */

function polyline(container: HTMLElement): SVGPolylineElement | null {
  return container.querySelector('polyline');
}

describe('Sparkline', () => {
  it.each([[[] as number[]], [[5]]])('draws nothing for %j, which has no direction', (values) => {
    const { container } = render(<Sparkline values={values} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('draws a point per value, oldest first', () => {
    const { container } = render(<Sparkline values={[0, 5, 10]} width={100} />);

    const points = polyline(container)?.getAttribute('points')?.split(' ') ?? [];
    expect(points).toHaveLength(3);
    // Evenly spaced across the width, and rising, because the values rise.
    expect(points[0]?.startsWith('0.0,')).toBe(true);
    expect(points[2]?.startsWith('100.0,')).toBe(true);
    const y = points.map((p) => Number.parseFloat(p.split(',')[1] ?? '0'));
    expect(y[0]).toBeGreaterThan(y[2] as number);
  });

  it('draws a flat series as a straight line rather than dividing by zero', () => {
    /*
     * `max - min` is 0 here. Without the guard every y is NaN and the polyline
     * renders as nothing at all, so a metric that held steady would look like a
     * metric with no data - the two states a reader most needs told apart.
     */
    const { container } = render(<Sparkline values={[7, 7, 7]} />);

    const points = polyline(container)?.getAttribute('points') ?? '';
    expect(points).not.toContain('NaN');
    const y = points.split(' ').map((p) => p.split(',')[1]);
    expect(new Set(y).size).toBe(1);
  });

  it('stays out of the accessibility tree, because the figure carries the meaning', () => {
    const { container } = render(<Sparkline values={[1, 2]} />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
  });

  it('honours a caller width in both the attribute and the viewBox', () => {
    const { container } = render(<Sparkline values={[1, 2]} width={240} />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('width', '240');
    expect(svg).toHaveAttribute('viewBox', '0 0 240 32');
  });
});
