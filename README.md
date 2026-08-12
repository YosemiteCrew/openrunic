# openrunic

**Open-source operating system for human health.**

openrunic is a modern, open platform for healthcare software. It is built by
[Yosemite Crew](https://github.com/YosemiteCrew), the team behind the open-source operating system
for animal health, and applies the same philosophy to human healthcare: open standards, a fast and
pleasant developer experience, and software that clinics of any size can run themselves.

The project is organized around three pillars, mirroring Yosemite Crew:

- **Hospitals** - practice management, scheduling, encounters, and clinical workflows for care
  teams.
- **Patients** - patient-facing access to appointments, records, and communication.
- **Developers** - a clean FHIR R4 API surface and typed packages so others can build on top.

## What we're building first

A modern, fast, lightweight EMR - an alternative to OpenEMR:

- Patient demographics and registration
- Scheduling and appointment management
- Clinical encounters and documentation
- A FHIR R4 API at the service boundary, so integrations speak an open standard from day one
- Audit logging as a first-class feature, not an afterthought

## Project status

> **Pre-alpha.** This repository is an early scaffold. APIs, schemas, and package boundaries will
> change without notice. Do not run this in production, and do not put real patient data into it.

## Tech stack

| Layer           | Choice                                               |
| --------------- | ---------------------------------------------------- |
| Monorepo        | pnpm 10 workspaces + Turborepo                       |
| Runtime         | Node.js 22                                           |
| Web app         | Next.js 15 (React)                                   |
| API             | Hono, serving FHIR R4 at the API boundary            |
| Database        | PostgreSQL via Prisma 6 (relational source of truth) |
| Interop         | FHIR R4 types and domain-to-FHIR mappers             |
| Tests           | Vitest                                               |
| Lint and format | ESLint 9 (flat config) + Prettier                    |

## Repository layout

```text
openrunic/
├── apps/
│   ├── web/          # Next.js 15 app: hospital and patient web experience
│   └── api/          # Hono service: FHIR R4 API boundary
├── packages/
│   ├── types/        # Shared TypeScript types
│   ├── fhir/         # FHIR R4 types + domain<->FHIR mappers (round-trip tested)
│   └── database/     # Prisma 6 schema, migrations, and client (Postgres)
└── docs/             # ADRs and project documentation
```

## Getting started

Prerequisites: Node.js 22 and pnpm 10 (via corepack), plus a local PostgreSQL instance for
database work.

```bash
corepack enable
pnpm install

# Database work only: copy the environment template where Prisma reads it
cp packages/database/.env.example packages/database/.env

# Run everything in dev mode
pnpm dev

# Or run a single workspace
pnpm --filter web dev
pnpm --filter api dev
```

Useful repo-wide commands:

```bash
pnpm lint          # ESLint across all workspaces
pnpm type-check    # TypeScript across all workspaces
pnpm test          # Vitest across all workspaces
pnpm build         # Build all workspaces
pnpm verify        # lint + type-check + test + build
```

## Contributing

We welcome contributions. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for the development
workflow, commit conventions, and quality gates, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for
community expectations. Security issues should follow [SECURITY.md](SECURITY.md), not the public
issue tracker.

Key rules worth knowing up front:

- All pull requests target the `dev` branch.
- PR titles must follow Conventional Commits with a required scope, e.g. `feat(api): ...`.
- Never include real patient data anywhere: issues, code, tests, fixtures, screenshots, or logs.

## Compliance disclaimer

Please read this carefully before deploying openrunic anywhere near real patient data.

- **openrunic is software, not a certified medical device.** It has not been certified, cleared, or
  approved by any regulatory body (FDA, EU MDR notified bodies, ONC, or others), and no such
  certification is implied.
- **openrunic is not itself HIPAA-compliant or GDPR-compliant.** Compliance is a property of a
  deployment, not of source code. If you deploy openrunic, you are responsible for meeting your own
  regulatory obligations, including HIPAA Business Associate Agreements, GDPR Article 9 safeguards
  for health data, and any local law that applies to you.
- **The software provides building blocks, not guarantees.** Features such as audit logging and
  access control are designed to support compliant deployments, but including them does not make
  any deployment compliant.
- **openrunic does not provide medical advice.** Nothing in this software is intended to provide
  medical advice, diagnosis, or treatment recommendations. Clinical decisions are the
  responsibility of qualified healthcare professionals.

See [docs/compliance.md](docs/compliance.md) for the project's regulatory posture in more detail.

## License

openrunic is licensed under the [GNU Affero General Public License v3.0 only](LICENSE)
(AGPL-3.0-only). If you run a modified version of openrunic as a network service, the AGPL requires
you to offer the source of your modified version to its users.

Copyright (C) 2026 openrunic contributors
