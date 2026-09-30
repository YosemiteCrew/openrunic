import { describe, expect, it } from 'vitest';

import { FAN_OUT, inSequence, mapInBatches } from '../repositories/collection.js';

/**
 * A task that records what it was asked, how many of its calls were in flight
 * at once, and settles after a delay chosen per item, so a later item can
 * finish before an earlier one.
 */
function tracked<R>(settle: (item: number) => { after: number; value?: R; error?: Error }): {
  task: (item: number) => Promise<R | undefined>;
  started: number[];
  peak: () => number;
} {
  const started: number[] = [];
  let inFlight = 0;
  let peak = 0;
  return {
    started,
    peak: () => peak,
    task: async (item) => {
      started.push(item);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const { after, value, error } = settle(item);
      try {
        await new Promise((resolve) => setTimeout(resolve, after));
        if (error !== undefined) throw error;
        return value;
      } finally {
        inFlight -= 1;
      }
    },
  };
}

const range = (count: number): number[] => Array.from({ length: count }, (_, i) => i);

describe('mapInBatches', () => {
  it('returns results in input order, whichever settles first', async () => {
    const { task } = tracked((item) => ({ after: 10 - (item % 5) * 2, value: item * 10 }));

    expect(await mapInBatches(range(12), task)).toEqual(range(12).map((n) => n * 10));
  });

  it(`keeps at most ${String(FAN_OUT)} in flight, and does use them`, async () => {
    const { task, peak, started } = tracked(() => ({ after: 2 }));

    await mapInBatches(range(FAN_OUT * 3 + 2), task);

    expect(started).toEqual(range(FAN_OUT * 3 + 2));
    expect(peak()).toBe(FAN_OUT);
  });

  it('starts the next batch only once the one before has settled', async () => {
    const log: string[] = [];
    const { task } = tracked((item) => ({ after: item === 0 ? 20 : 1 }));
    const logged = async (item: number): Promise<void> => {
      log.push(`start ${String(item)}`);
      await task(item);
      log.push(`end ${String(item)}`);
    };

    await mapInBatches(range(FAN_OUT + 1), logged);

    // The slow first item held the whole first batch back: the item after the
    // batch started only once item 0 had finished.
    expect(log.indexOf('end 0')).toBeLessThan(log.indexOf(`start ${String(FAN_OUT)}`));
    expect(log.indexOf(`start ${String(FAN_OUT - 1)}`)).toBeLessThan(log.indexOf('end 0'));
  });

  it('rejects with the first failure and starts no later batch', async () => {
    const failure = new Error('refused');
    const { task, started } = tracked((item) => ({
      after: 1,
      ...(item === 1 ? { error: failure } : {}),
    }));

    await expect(mapInBatches(range(FAN_OUT * 2), task)).rejects.toBe(failure);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(started).toEqual(range(FAN_OUT));
  });

  it('asks nothing of an empty list', async () => {
    const { task, started } = tracked(() => ({ after: 1 }));

    expect(await mapInBatches([], task)).toEqual([]);
    expect(started).toEqual([]);
  });
});

describe('inSequence', () => {
  it('runs one step at a time, in order, even when later steps are quicker', async () => {
    const { task, started, peak } = tracked((item) => ({ after: 6 - item }));

    await inSequence(range(6), task);

    expect(started).toEqual(range(6));
    expect(peak()).toBe(1);
  });

  it('stops at a failing step and starts none after it', async () => {
    const failure = new Error('refused');
    const { task, started } = tracked((item) => ({
      after: 1,
      ...(item === 2 ? { error: failure } : {}),
    }));

    await expect(inSequence(range(5), task)).rejects.toBe(failure);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(started).toEqual([0, 1, 2]);
  });

  it('resolves at once for an empty list', async () => {
    const { task, started } = tracked(() => ({ after: 1 }));

    await expect(inSequence([], task)).resolves.toBeUndefined();
    expect(started).toEqual([]);
  });
});
