import { AdapterRegistry, MockErxAdapter, MockVideoAdapter } from '@openrunic/adapters';

/**
 * The partner seams a development run gets for free.
 *
 * In-process telehealth and prescribing vendors let a developer exercise both
 * seams without an account anywhere. Video issues join links at a host that
 * can never resolve, so a link that escapes a fixture goes nowhere. The eRx
 * practice is deliberately not enrolled for controlled substances: ordinary
 * prescriptions can travel while the enrolment refusal remains exercisable.
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
  const erx = new MockErxAdapter();
  const dependencies = {
    now: () => new Date(),
    // Fixed placeholders, because the mocks never call anything. Real vendor
    // references are resolved from the deployment's secret store.
    resolveSecret: () => Promise.resolve('development'),
    emit: () => undefined,
    log: () => undefined,
  };

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
      dependencies
    )
    .catch((error: unknown) => {
      // Cannot happen with a literal config and no I/O, and is reported rather
      // than swallowed all the same: a silently uninitialised adapter is
      // exactly the 502-with-no-explanation this function exists to prevent.
      console.error('openrunic: the development telehealth adapter failed to initialise', error);
    });

  const erxConfig = {
    vendorId: erx.descriptor.vendorId,
    environment: 'sandbox' as const,
    credentialRef: 'development',
    timeoutMs: 10_000,
    networkAccountId: 'development',
    epcs: false,
  };
  erx.init(erxConfig, dependencies).catch((error: unknown) => {
    console.error('openrunic: the development prescribing adapter failed to initialise', error);
  });

  registry.register('video', video);
  registry.register('erx', erx, { config: erxConfig });
  return registry;
}
