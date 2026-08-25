import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * EVERY ROUTE REACHES THE DATABASE THROUGH THE REPOSITORIES, AND NOTHING ELSE DOES.
 *
 * The tenant narrowing, the compartment, and the facility scoping are all
 * decided in `repositories/prisma.ts` and `repositories/memory.ts`, on the spec.
 * That is the whole guarantee: a route does not have to remember any of them,
 * and a route added tomorrow inherits all three without anybody reviewing it for
 * them.
 *
 * It is a guarantee about a location, so it holds exactly as long as no route
 * reaches past that location. Nothing today does. Nothing asserts it either,
 * which is the gap this closes: a handler that opened a Prisma client and wrote
 * its own `where` would be reviewed as a query, and the thing it was missing
 * would be three narrowings nobody mentioned in the diff.
 *
 * ## Why this is the failure worth guarding
 *
 * #87 was this bug in its route-level form. The appointment list checked a
 * facility only when the caller had named one, the generic CRUD list did not
 * check at all, and the FHIR PractitionerRole projection read a user's sites
 * straight out of `UserFacility`. Three routes, three holes, one cause. The fix
 * was not three fixes: it moved the rule onto the spec, where every port and
 * every surface reads it. `repositories.facility-scope.test.ts` is the other
 * half of that fix, asserting the specs opt in; this half asserts nobody walks
 * around them.
 *
 * #139 is the same shape from the other side. The FHIR boundary and the BFF gave
 * different answers about which patients a caller could address, because each
 * had its own opinion about it. They cannot now: they share the answer because
 * they share the code that decides it.
 *
 * ## What is allowed, and why the line is where it is
 *
 * A route may import from `@openrunic/database`, and ten of them do. What they
 * take is validation schemas and `uuidv7` - the input contract and an id
 * generator, neither of which touches a connection. What they may not take is
 * anything that reaches the data: the client, the Prisma namespace, or the
 * tenant-session helpers that exist to open a scoped transaction.
 *
 * The names are listed rather than derived. A derived list would grow silently
 * when the database package gained an export, and this test would go on passing
 * while meaning less. A name added here is a decision somebody made.
 */

const ROUTES = join(import.meta.dirname, '..', 'routes');
const FHIR = join(import.meta.dirname, '..', 'fhir');

/**
 * The exports of `@openrunic/database` that reach a connection.
 *
 * From `client.ts`, `rls.ts` and `tenant.ts` - the three modules that are about
 * talking to Postgres rather than about describing what may be stored in it.
 */
const REACHES_THE_DATABASE: readonly string[] = [
  'createPrismaClient',
  'CreatePrismaClientOptions',
  'PrismaClient',
  'Prisma',
  'withTenantSession',
  'TENANT_SETTING',
  'TenantClient',
  'TenantContext',
  'TenantScopedModel',
  'TenantTransactionClient',
];

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__') continue;
      found.push(...sourceFiles(path));
      continue;
    }
    if (/\.ts$/u.test(entry) && !/\.test\.ts$/u.test(entry)) found.push(path);
  }
  return found;
}

/** Every `import ... from '...'`, as the names it brought in. */
function importedNames(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/import\s+(?:type\s+)?\{(?<names>[^}]*)\}\s+from/gu)) {
    for (const piece of (match.groups?.['names'] ?? '').split(',')) {
      // `type Foo`, `Foo as Bar` - the imported name is the first word either way.
      const name =
        piece
          .trim()
          .replace(/^type\s+/u, '')
          .split(/\s+/u)[0] ?? '';
      if (name !== '') names.push(name);
    }
  }
  return names;
}

const FILES = [...sourceFiles(ROUTES), ...sourceFiles(FHIR)];

describe('the route layer', () => {
  it('is reading the files it thinks it is', () => {
    // The guard on the guard. Both assertions below look for an absence, which
    // is the case where a scan that found no files passes while proving nothing.
    expect(FILES.length).toBeGreaterThan(20);
  });

  it('imports the input contract from the database package, which is why the next test is narrow', () => {
    // Not a rule, a fact: the line is drawn between describing data and reaching
    // it, and this says the first half is genuinely in use. A version of the
    // next test that banned the package outright would be simpler and would be
    // banning ten legitimate imports.
    const importsThePackage = FILES.filter((path) =>
      readFileSync(path, 'utf8').includes("from '@openrunic/database'")
    );

    expect(importsThePackage.length).toBeGreaterThan(5);
  });

  it('reaches the database through the repositories and through nothing else', () => {
    const reaching: string[] = [];
    for (const path of FILES) {
      const names = importedNames(readFileSync(path, 'utf8'));
      for (const name of names) {
        if (!REACHES_THE_DATABASE.includes(name)) continue;
        reaching.push(`${path.slice(path.indexOf('/src/') + 5)} imports ${name}`);
      }
    }

    expect(reaching).toStrictEqual([]);
  });
});
