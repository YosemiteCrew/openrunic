import path from 'node:path';

import type { LintReport } from './lint.js';
import type { Finding } from './rules.js';

/**
 * Turning findings into something a reviewer acts on.
 *
 * A linter whose output is a wall of rule ids trains people to add the
 * suppression and move on. Every finding here prints the statement it is about,
 * says what it does to existing data in one sentence, and names the
 * expand/contract route that gets the same result safely.
 */

const RULE_TITLES: Record<Finding['rule'], string> = {
  'drop-table': 'Table dropped',
  'drop-column': 'Column dropped',
  'not-null-without-default': 'NOT NULL without a default',
  'type-narrowing': 'Column type narrowed',
  rename: 'Renamed in place',
};

/** Relative path to the migration file, for a clickable location. */
function locationOf(finding: Finding, migrationsDir: string): string {
  return path.join(migrationsDir, finding.migration, 'migration.sql');
}

export function formatHuman(report: LintReport, migrationsDir: string): string {
  const lines: string[] = [];

  if (report.findings.length === 0) {
    lines.push(
      `Migration safety: ${String(report.migrations.length)} migration(s), all expand-only.`
    );
    lines.push('No statement in this history destroys data or breaks a running older version.');
    return lines.join('\n');
  }

  lines.push('Migration safety: destructive statements found.');
  lines.push('');
  lines.push('These are not automatically wrong. They are the half of an upgrade that cannot be');
  lines.push('rolled back, so they need a reviewer to agree the expand step already shipped.');
  lines.push('');

  for (const migration of report.migrations) {
    if (migration.findings.length === 0) continue;
    lines.push(`  ${migration.name}  [contract]`);
    for (const finding of migration.findings) {
      lines.push(`    ${RULE_TITLES[finding.rule]}  (${finding.rule})`);
      lines.push(`      ${locationOf(finding, migrationsDir)}:${String(finding.line)}`);
      lines.push(`      ${finding.statement}`);
      lines.push(`      What it does: ${finding.message}`);
      lines.push(`      Instead: ${finding.remedy}`);
      lines.push('');
    }
  }

  const expand = report.migrations.length - report.contractMigrations.length;
  lines.push(
    `${String(report.findings.length)} finding(s) across ${String(report.contractMigrations.length)} migration(s); ${String(expand)} expand-only.`
  );
  return lines.join('\n');
}

/**
 * GitHub Actions annotations, so findings land on the diff itself.
 *
 * Emitted as warnings rather than errors: the check's own exit code decides
 * whether the build fails, and an annotation that says "error" on a build that
 * passed is how people stop believing annotations.
 */
export function formatAnnotations(report: LintReport, migrationsDir: string): string {
  return report.findings
    .map((finding) => {
      const file = locationOf(finding, migrationsDir);
      const title = RULE_TITLES[finding.rule];
      // Annotation bodies are single-line; %0A is the documented newline escape.
      const body = `${finding.message}%0A%0AInstead: ${finding.remedy}%0A%0A${finding.statement}`;
      return `::warning file=${file},line=${String(finding.line)},title=${title}::${body}`;
    })
    .join('\n');
}
