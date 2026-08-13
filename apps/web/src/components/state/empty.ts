/** The emptiness test every list endpoint shares. */
export function isEmptyList(payload: { data: unknown[] }): boolean {
  return payload.data.length === 0;
}
