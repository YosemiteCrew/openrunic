/**
 * A one-producer, one-consumer async channel.
 *
 * The loop needs to emit events while it is awaiting a model call, so that
 * prose and named steps reach the surface as they happen rather than in a batch
 * once the turn is over. An async generator alone cannot do that, because it
 * only resumes between yields; a queue can.
 *
 * Small enough to read in one sitting, which matters: this is the mechanism the
 * whole streaming contract rests on.
 */
export interface EventChannel<T> {
  push(value: T): void;
  close(): void;
  fail(error: unknown): void;
  stream(): AsyncGenerator<T>;
}

export function createEventChannel<T>(): EventChannel<T> {
  const buffer: T[] = [];
  let closed = false;
  let failure: unknown;
  let wake: (() => void) | undefined;

  const signal = (): void => {
    wake?.();
    wake = undefined;
  };

  return {
    push(value: T): void {
      if (closed) return;
      buffer.push(value);
      signal();
    },
    close(): void {
      closed = true;
      signal();
    },
    fail(error: unknown): void {
      failure = error;
      closed = true;
      signal();
    },
    async *stream(): AsyncGenerator<T> {
      for (;;) {
        while (buffer.length > 0) {
          // `shift` is safe here: length was just checked, and this is the only
          // consumer.
          yield buffer.shift() as T;
        }
        if (failure !== undefined) throw failure;
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}
