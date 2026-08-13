import { useId } from 'react';

/**
 * Stable id for a control plus its label, hint and error nodes.
 *
 * Always call it unconditionally (it wraps a hook); pass the consumer's `id` when
 * they supplied one and the generated id is discarded.
 *
 * @example
 * const id = useFieldId(props.id);
 * const hintId = `${id}-hint`;
 */
export function useFieldId(providedId?: string): string {
  const generated = useId();
  return providedId ?? generated;
}
