/** The deployment environments Openrunic recognises, in promotion order. */
export const OPENRUNIC_ENVIRONMENTS = ['development', 'staging', 'production'] as const;

/** A deployment environment name. */
export type OpenrunicEnvironment = (typeof OPENRUNIC_ENVIRONMENTS)[number];

/** Narrows an arbitrary string (e.g. `process.env.NODE_ENV`) to an {@link OpenrunicEnvironment}. */
export function isOpenrunicEnvironment(value: string): value is OpenrunicEnvironment {
  return (OPENRUNIC_ENVIRONMENTS as readonly string[]).includes(value);
}
