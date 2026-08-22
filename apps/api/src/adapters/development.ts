import { AdapterRegistry, MockVideoAdapter } from '@openrunic/adapters';

/**
 * The partner seams a development run gets for free.
 *
 * One in-process telehealth vendor, which issues join links at a host that can
 * never resolve. That is the point: a developer can open a visit, let two
 * people in and end it without an account anywhere, and a link that escapes a
 * fixture goes nowhere.
 *
 * `assertProductionWiring` refuses this default under NODE_ENV=production, for
 * the same reason it refuses the demo token table. Nothing about a mock vendor
 * fails at boot; it fails with a patient already waiting.
 *
 * ## Why init is called here and why the promise is not awaited
 *
 * An adapter that has not been initialised answers `misconfigured` to every
 * call, which surfaces as a 502 from a route that looks like it should work,
 * with the reason three packages away from where anybody would look for it. So
 * it is initialised at construction.
 *
 * `createApp` is synchronous, so this cannot await. It is safe only because of
 * what this particular adapter's init does: it validates a literal config and
 * resolves one secret from an already-resolved promise, with no I/O, so it
 * settles on the next microtask and long before a server has bound a port or a
 * test has awaited a request. A real vendor's adapter does reach the network,
 * and a deployment that installs one MUST await its init before it starts
 * serving rather than copying this.
 */
export function createDevelopmentAdapters(): AdapterRegistry {
  const registry = new AdapterRegistry();
  const video = new MockVideoAdapter();

  video
    .init(
      {
        vendorId: video.descriptor.vendorId,
        environment: 'sandbox',
        credentialRef: 'development',
        timeoutMs: 10_000,
        region: 'local',
        maxParticipants: 8,
      },
      {
        now: () => new Date(),
        // A fixed placeholder, because the mock never calls anything. A real
        // vendor's reference is resolved from the deployment's secret store,
        // and that wiring belongs with the vendor rather than here.
        resolveSecret: () => Promise.resolve('development'),
        emit: () => undefined,
        log: () => undefined,
      }
    )
    .catch((error: unknown) => {
      // Cannot happen with a literal config and no I/O, and is reported rather
      // than swallowed all the same: a silently uninitialised adapter is
      // exactly the 502-with-no-explanation this function exists to prevent.
      console.error('openrunic: the development telehealth adapter failed to initialise', error);
    });

  registry.register('video', video);
  return registry;
}
