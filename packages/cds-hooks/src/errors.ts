/**
 * The two failures a hook invocation can have, and the status each maps to.
 *
 * A calling EMR shows a clinician a card or it shows them nothing, so the
 * distinction that matters is whether the caller can fix it. A malformed request
 * is theirs to fix and answers 400; a service that is not mounted answers 404.
 * Anything else is this server's problem and reaches the caller as a 500 through
 * the ordinary error path, which is where it belongs.
 */
export class CdsHooksError extends Error {
  readonly status: 400 | 404;

  private constructor(message: string, status: 400 | 404) {
    super(message);
    this.name = 'CdsHooksError';
    this.status = status;
  }

  static malformed(message: string): CdsHooksError {
    return new CdsHooksError(message, 400);
  }

  static noSuchService(id: string): CdsHooksError {
    return new CdsHooksError(
      `This server serves no CDS service called ${id}. See /cds-services for the ones it does.`,
      404
    );
  }
}
