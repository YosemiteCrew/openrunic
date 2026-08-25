# Running a public demonstration

`apps/web` ships a complete set of fixtures, so every screen works with no database, no API and no
network. That is what makes a hosted demonstration cheap: it is the web application, built, with the
data layer left on its default.

One thing was in the way, and this document exists because of it.

## Why a production build used to have no way in

`lib/auth/directory.ts` refuses to offer any credential under `NODE_ENV=production`, and says why:

> a convenience default that survives into production is how a demo token becomes a credential

That objection is right and it stands. What it also produced was a build nobody outside a checkout
could look at. Deployed as it was, a visitor got four marketing pages and a sign-in form that
refused everything they typed.

So there is a door, and it takes two conditions to open, both in `lib/auth/build.ts`:

1. **`NEXT_PUBLIC_DEMO_MODE=true`.** Nothing defaults to it and nothing else spells it. Not
   truthiness: the exact word, so a stray `1` or `yes` leaves it shut.
2. **The data layer is reading fixtures.** `NEXT_PUBLIC_API_MODE` is anything but `live`.

The second is what makes the first safe to exist. The credentials the door opens are the API's
public development principals, and that API refuses to start with them under `NODE_ENV=production`
anyway. A build pointed at a real deployment can never open the door, whatever the flag says, and
that was verified rather than assumed - see the table at the end.

## What to set

| Variable                | Value                     | Why                                                                         |
| ----------------------- | ------------------------- | --------------------------------------------------------------------------- |
| `NEXT_PUBLIC_DEMO_MODE` | `true`                    | Opens the door                                                              |
| `NEXT_PUBLIC_API_MODE`  | `mock`                    | The default; set it explicitly so the demonstration says what it is         |
| `SESSION_COOKIE_SECRET` | `openssl rand -base64 32` | A production build cannot seal a session cookie without one and answers 503 |
| `NODE_ENV`              | `production`              | Set by every host; listed because it is what closes the door by default     |

Nothing else. No `NEXT_PUBLIC_API_BASE_URL`, because nothing is fetched. No database URL, no API
container, no migration.

### Vercel

Framework preset Next.js, root directory `apps/web`, and the four variables above as Environment
Variables on the Production environment. The build command is the repository default; `pnpm` and the
workspace are detected from the lockfile.

### Anything that runs a container

`apps/web/Dockerfile` builds the same artifact:

```
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_MODE=mock \
  --build-arg NEXT_PUBLIC_DEMO_MODE=true \
  -t openrunic-demo .
```

Both are build arguments rather than run-time environment, and both have defaults that make an
ordinary image an ordinary image: `live` and `false`. `SESSION_COOKIE_SECRET` is passed at run time,
because it is the only one of the four that is a secret.

## What a visitor sees

They land on the marketing pages, which are the real ones. The sign-in screen offers four people to
be - a clinician, the front desk, a biller, a second clinician - under a heading that says
**Demonstration** and a sentence saying every record is invented and nothing is saved. Inside, every
screen carries a **Demo data** badge in the top bar beside the clinic's name, which is not new: it
has always rendered whenever the data layer is reading fixtures.

The four public pages are served `noindex` in a demonstration build. Indexed, they would compete
with the real site for the same words and teach a crawler that the canonical answer is a sandbox.
The staff screens were already `noindex`, from the root layout, which is fail-closed.

## What it is not

**It is not a trial.** Nothing is saved. Every reload restores the same fixtures, and the admin
controls that would change something are disabled and say so (#178).

**It is not a security boundary.** Anyone can sign in as anyone. That is the point of it, and it is
only acceptable because the records are invented. Do not point a demonstration build at anything
real; it cannot open the door if you do, but do not rely on that as the only thing stopping you.

**It does not exercise the API.** The FHIR boundary, the BFF, the database and the audit chain are
not running. A demonstration shows what the product looks like and how it behaves, not that the
server works.

## Turning it off

Rebuild without `NEXT_PUBLIC_DEMO_MODE`. Removing the variable from a running deployment is not
enough on its own, and the reason is worth knowing: Next inlines `NEXT_PUBLIC_*` into the artifact
when it has a value at build time, so a demonstration artifact stays one.

The same mechanism runs the other way. A build made without the flag reads it from the environment
at run time, so a **mock-mode** deployment can be turned into a demonstration by setting a variable
and restarting, with no rebuild. That is acceptable rather than overlooked: a mock-mode deployment
is already serving invented records to everyone who reaches it, so the door opens onto a room that
was already empty. A `live` deployment is the case that matters, and it refuses.

## How the four combinations behave

Verified against a real build and a running server, not reasoned about:

| Built with the flag | Flag set at run time | `NEXT_PUBLIC_API_MODE` | `POST /session` with `dev-clinician-a`   |
| ------------------- | -------------------- | ---------------------- | ---------------------------------------- |
| yes                 | yes                  | mock                   | 200, session minted                      |
| yes                 | no                   | mock                   | 200 - the artifact carries it            |
| no                  | yes                  | mock                   | 200 - read from the environment          |
| yes                 | yes                  | **live**               | **401, the credential was not accepted** |

The last row is the one the design rests on.
