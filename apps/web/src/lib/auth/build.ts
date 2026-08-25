import { IS_MOCK_MODE } from '@/lib/api/config';

/**
 * WHETHER THIS BUILD IS A DEMONSTRATION, AND WHY THAT IS TWO CONDITIONS.
 *
 * `lib/auth/directory.ts` records the stance this exists to keep: "a
 * convenience default that survives into production is how a demo token becomes
 * a credential." That is an objection to a default, not to a door. The
 * consequence it also records is that a production build has no way to sign in
 * at all, which makes a hosted demonstration of this product impossible to
 * stand up (#154).
 *
 * So there is a door, and it needs two things to be true at once.
 *
 * **It was asked for.** `NEXT_PUBLIC_DEMO_MODE=true`, set on the build. There is
 * no default that reaches it and no way to arrive here by forgetting something.
 *
 * **There is nothing behind it.** The data layer has to be reading fixtures. A
 * build pointed at a real API can never open the door, whatever the flag says,
 * because the credentials it would open it to are the API's public development
 * principals and that API refuses to start with them under
 * `NODE_ENV=production` anyway. The pairing is what makes the flag safe to
 * exist: the only build it can affect is one whose records are invented.
 *
 * Both halves are parameters of {@link isDemoBuild} rather than reads inside it,
 * for the reason `directory.ts` gives about `nodeEnv`: the branch that matters
 * is the one a test process can never be in.
 */
export function isDemoBuild(flag: string | undefined, mock: boolean): boolean {
  return flag === 'true' && mock;
}

/**
 * The answer for this build.
 *
 * Read once at module load. `NEXT_PUBLIC_*` is inlined by Next at build time, so
 * this cannot vary between two deployments of one image - which is the same
 * reason `oidcEnabled` is passed down from a server component rather than read
 * here.
 */
export const IS_DEMO_BUILD: boolean = isDemoBuild(process.env.NEXT_PUBLIC_DEMO_MODE, IS_MOCK_MODE);
