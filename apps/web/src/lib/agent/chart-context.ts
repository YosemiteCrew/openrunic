/**
 * Which chart the caller has open, read from the route.
 *
 * The chart is sent with every turn and can only ever narrow what a tool
 * returns. It is derived from the URL rather than passed down through props so
 * the panel stays mounted in the shell: a clinician who walks from one chart to
 * the next carries the same conversation and the context follows them.
 *
 * Only the patient route yields one. `/encounters/:id` names an encounter, and
 * an encounter id is not a patient id; guessing there would send the server an
 * identifier that does not resolve.
 */

const PATIENT_ROUTE = /^\/patients\/([^/]+)/;

/** The API's `chartPatientId` is a UUID. Anything else is not sent at all. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function chartPatientIdFromPath(pathname: string | null): string | undefined {
  const id = PATIENT_ROUTE.exec(pathname ?? '')?.[1];
  return id !== undefined && UUID.test(id) ? id : undefined;
}
