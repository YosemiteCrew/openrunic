# Running openrunic in your practice

This guide is for the person who looks after the computers at a clinic. It does
not assume you have written software. It does assume you can open a terminal on
a Linux server, copy and paste a command, and read what comes back.

If you get stuck, the [Troubleshooting](#troubleshooting) section at the end is
organised by what you see on screen, not by what is wrong underneath.

> **Read this before you put real patient records into openrunic.**
>
> openrunic does not have a login system yet. Access is granted by a short list
> of demo tokens that are published in the source code. Anyone who can reach the
> server can read everything in it. The software will tell you this every time it
> starts.
>
> Today openrunic is safe to evaluate on a machine you control, on a network
> nobody else is on. It is not yet safe to hold a real patient record. The
> [Security](#security) section says what has to change before that is true.

---

## What you need

|                  | Minimum                                                               | Comfortable                                 |
| ---------------- | --------------------------------------------------------------------- | ------------------------------------------- |
| Operating system | Any Linux with Docker. Debian 12 and Ubuntu 24.04 are what we test on | same                                        |
| CPU              | 2 cores                                                               | 4 cores                                     |
| Memory           | 4 GB                                                                  | 8 GB                                        |
| Disk             | 20 GB free                                                            | 50 GB free, plus somewhere else for backups |
| Software         | Docker Engine 24 or newer, with the Compose plugin                    | same                                        |

You do **not** need to install Node.js, a database, or a web server. All three
run inside containers that openrunic builds for you.

Check what you have:

```bash
docker version
docker compose version
```

If either of those says "command not found", install Docker first. Docker's own
instructions for your distribution are the ones to follow; the packages named
`docker.io` in some distributions are old and will not work.

---

## Install

### 1. Get the code

```bash
git clone https://github.com/openrunic/openrunic.git
cd openrunic
```

### 2. Start it

```bash
docker compose up --build
```

That is the whole install. It will take a while the first time - it is
compiling the application from source - and it will print a lot. You are waiting
for these lines:

```
migrate  | migrations applied
migrate  | seed complete
api      | openrunic-api listening on port 4000
```

Then open **http://localhost:3000** in a browser on that machine.

Timings measured on a 4-core, 8 GB machine:

|                                             | Time            |
| ------------------------------------------- | --------------- |
| First run, compiling everything from source | 5 to 25 minutes |
| Starting an already-built stack             | about 1 minute  |
| Booting to a working, seeded practice       | 56 seconds      |

Almost all of the first run is compilation. Later starts reuse the built images.

### 3. Or use the guided installer

If Node.js and pnpm are available on the machine, this does the same thing and
also generates real passwords instead of the published defaults, checks your
prerequisites first, and times itself:

```bash
pnpm install
pnpm setup:selfhost
```

It writes a `.env` file with a generated database password. It never prints the
password, and the file is created readable only by you.

### What you get

A demo practice, so the software has something in it on the first day:

- one practice with two sites
- twenty invented patients, with charts, appointments, results and claims
- five staff accounts

Every name in it is obviously fake ("Testina Patientsson", "Placeholder Mutual
Health"). None of it is real patient information, and it never will be.

To start with an empty database instead, set `OPENRUNIC_SEED=never` in `.env`
before the first start. Once the database has been created, changing this has no
effect - the demo data is only ever written into an empty database.

### Signing in

There is no sign-in screen yet. The API accepts three demo tokens:

| Token             | Who they are                   |
| ----------------- | ------------------------------ |
| `dev-clinician-a` | Dr. Adaeze Okafor, a clinician |
| `dev-frontdesk-a` | Front desk                     |
| `dev-biller-a`    | Billing                        |

These are not passwords and they are not secret. They are in the source code,
and they exist so the demo practice can be looked at. See [Security](#security).

---

## Everyday operation

### Starting and stopping

```bash
docker compose up -d      # start, in the background
docker compose stop       # stop, keeping all data
docker compose down       # stop and remove the containers, keeping all data
docker compose ps         # what is running
docker compose logs -f    # watch what it is doing
```

`docker compose down` is safe. Patient data lives in a Docker volume called
`openrunic-pgdata`, which survives everything except the one command in the next
paragraph.

**The one dangerous command** is `docker compose down --volumes`. That deletes
the database. There is no confirmation prompt and no undo.

### Is it healthy?

```bash
docker compose ps
```

Every row should say `running` and, where it has one, `(healthy)`. The `migrate`
container is meant to say `exited (0)` - it does its job at startup and stops.

---

## Backups

**A backup that has never been restored is a guess.** openrunic's backup tool
therefore ships with a verifier, and the verifier is the part that matters.

### Take a backup

```bash
pnpm ops:backup
```

This writes two files into `./backups`:

- `openrunic-<timestamp>.dump` - the database
- `openrunic-<timestamp>.manifest.json` - what was in it

The manifest is what makes the backup checkable. It records how many rows were
in each table, which database version wrote it, a checksum of the archive, and a
fingerprint of one patient's entire chart.

### Prove the backup works

```bash
pnpm ops:verify-backup
```

This restores the backup into a **separate scratch database** - your live data is
not touched - and then compares what came back against the manifest: every table's
row count, the migration history, and that patient's chart, field by field.

Run this after every backup. It takes about as long as the backup did. A backup
that fails this check is not a backup, and you want to find that out on a quiet
Tuesday rather than during an outage.

### Restore

To restore over the live database, replacing everything currently in it:

```bash
pnpm ops:restore -- --yes
docker compose restart api
```

To restore beside the live database, so you can look before committing:

```bash
pnpm ops:restore -- --into openrunic_check
```

Measured on the demo practice (590 rows, 48 tables): the backup takes 0.7
seconds, verifying it takes 1.2 seconds, and restoring takes 0.7 seconds. A real
practice of a few thousand patients takes minutes rather than seconds, scaling
with data volume rather than with table count.

The target openrunic holds itself to is **fifteen minutes from a destroyed
database to a working one**, and CI measures it on every change and fails if it
is exceeded.

### Where backups should live

By default they land in `./backups`, next to the code, which is **on the same
disk as the database**. That is fine for testing and wrong for real use: one
failed disk takes both.

Set `OPENRUNIC_BACKUP_DIR` in `.env` to a path on a different disk, and copy
those files somewhere else entirely - another building, or an object store -
on a schedule. Backups older than `OPENRUNIC_BACKUP_RETAIN_DAYS` (30 by default)
are deleted, but only ever right after a new backup has succeeded, so a run of
failures cannot quietly age out your last good copy.

---

## Upgrades

```bash
git pull
pnpm ops:upgrade            # says what would happen, changes nothing
pnpm ops:upgrade -- --apply # does it
```

The first command is a dry run. It tells you which database changes are pending
and, importantly, whether they can be applied while people are working.

**An upgrade will not start without a backup behind it.** The pre-flight looks
for one in `OPENRUNIC_BACKUP_DIR` and refuses to apply if the database holds
rows and there is nothing to go back to. It does not take the backup for you, on
purpose: a backup taken by the thing that is about to change the database is a
backup nobody has verified. Run `pnpm ops:backup` and then
`pnpm ops:verify-backup` first. A brand-new install with an empty database is
exempt, because there is nothing to lose yet.

**Most upgrades need no downtime.** openrunic only ships database changes that
add things - a new column, a new table - which the running version simply
ignores. So the upgrade applies the change first and swaps the application
afterwards, and nobody notices.

**Some upgrades cannot work that way.** If a release removes or narrows
something, the version that is currently running would break the moment the
change lands. `pnpm ops:upgrade` detects this, refuses the live path, and tells
you. For those:

```bash
pnpm ops:backup && pnpm ops:verify-backup   # do not skip this
docker compose stop web api                 # patients cannot reach it now
pnpm ops:upgrade -- --apply --force
docker compose up -d                        # back online
```

Do that outside clinic hours. The release notes will say when it is needed; it
is rare, and it is never a surprise.

If an upgrade fails, the previous containers are still running and still
serving. Nothing is replaced until the database change has succeeded.

---

## When something breaks during clinic

openrunic is built to fail visibly rather than silently.

If the database becomes unreachable while staff are working, a **red banner**
appears across the top of every screen: _"Read-only: records cannot be saved"_,
followed by what has happened and what to do instead. It cannot be dismissed,
because a clinician who closes it and keeps typing loses that note. It clears by
itself, within a few seconds, when the database comes back.

If the whole server becomes unreachable, the banner says _"Cannot reach
openrunic"_ instead, and keeps retrying on its own.

The two messages are different on purpose, because the situations call for
different actions: in the first, the screens still work and staff should write on
paper; in the second, nothing loads at all.

If a screen ever fails outright, staff see a short explanation and a reference
code to quote - never a blank page and never a stack trace.

Staff should keep working on paper while the banner is up, and enter it
afterwards. Anything already on screen stays readable.

---

## Security

Read this section before openrunic sees a real patient.

**There is no authentication.** The tokens above are published in the source.
Anyone who can reach port 3000 or port 4000 can read and change everything.
Until a login system ships, openrunic must only run on a machine that only
you can reach.

**Do not put it on the internet.** Not behind a password-protected reverse
proxy either. The gap is not the front door; there is no lock on any of the
rooms.

**The database port is not published**, deliberately. Postgres is reachable only
from the other containers. Backups work through the container, so there is no
reason to open it, and you should not.

**Change the default password.** If you started with `docker compose up` and no
`.env`, the database is using a password that is printed in this repository.
`pnpm setup:selfhost` replaces it with a generated one.

**Keep the containers non-root.** They already are - everything runs as an
unprivileged user with id 10001. If you bind-mount a directory into a container,
it has to be readable by that id.

---

## Troubleshooting

### `docker compose up` says "permission denied" talking to Docker

Your user is not in the `docker` group.

```bash
sudo usermod -aG docker "$USER"
```

Then log out and back in - a new terminal is not enough.

### The build fails with "no space left on device"

Docker has filled the disk. See what it is using and reclaim it:

```bash
docker system df
docker system prune
```

### The `migrate` container fails and everything else refuses to start

That is the design: the API and web containers are not allowed to start against
a database whose schema is wrong.

```bash
docker compose logs migrate
```

The last few lines say why. The two common causes are that the database is not
accepting connections yet (the container retries for a minute, then gives up -
try again on a slow machine), and that `POSTGRES_PASSWORD` in `.env` was changed
after the database was created. A password change after first start does not
change the password Postgres already has; either put the old one back, or delete
the volume and start over - **which deletes all data**.

### The page loads but there are no patients in it

The demo data is only written into an empty database. If you started once with
`OPENRUNIC_SEED=never` and then changed your mind, the database is no longer
empty - it has tables, just no rows.

```bash
docker compose down --volumes    # deletes the database
docker compose up -d
```

### A red banner says records cannot be saved

The application cannot reach the database.

```bash
docker compose ps
docker compose logs postgres --tail 50
```

Usually the postgres container has stopped or is restarting. `docker compose up
-d postgres` brings it back, and the banner clears within a few seconds on its
own. Staff do not need to reload anything.

You can check the same thing yourself at any time:

```bash
curl -s http://localhost:4000/readyz
```

`{"status":"ok"}` means the API can reach the database. `503` with
`"degraded"` means it cannot - which is exactly what puts the banner on screen.

### Everything is slow

Check whether the machine is short of memory:

```bash
docker stats --no-stream
```

If postgres is at its memory limit, raise `POSTGRES_MEMORY_LIMIT` in `.env` and
restart. The defaults assume an 8 GB machine.

### I need to start completely over

```bash
docker compose down --volumes --remove-orphans
docker compose up --build
```

This deletes the database. Take a backup first if there is anything in it you
want.

---

## Getting help

When you report a problem, include:

- what you typed and what came back
- `docker compose ps`
- `docker compose logs --tail 100`

**Never include a screenshot or a log containing real patient information.** If
you have to show a record, use one of the demo patients.
