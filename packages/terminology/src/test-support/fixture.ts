import type { TerminologyConcept } from '../service.js';
import type { ValueSetDefinition } from '../value-set.js';

/**
 * The one fixture both implementations are tested against.
 *
 * Every system, code and display here is invented, and every system URI is
 * under `example.invalid`, a domain reserved by the IETF precisely so that it
 * can never resolve. That is not decoration: this package's whole reason to
 * exist is that real code systems are licensed content, and a fixture that
 * quoted one would be the exact mistake the package is built to prevent.
 *
 * The data is shaped to exercise the awkward cases rather than the happy one:
 * two loaded releases of the same code, a retired code in each system, a
 * two-level hierarchy, a concept carrying publisher properties, and displays
 * that sort into a specific order. It is deliberately small, so a failing
 * assertion can be read against the table below rather than debugged.
 */

/** Tenant every contract test runs as. */
export const FIXTURE_TENANT_ID = '018f2b6e-0000-7000-8000-000000000001';

/** A second tenant whose rows must never appear in a result. Its codes overlap on purpose. */
export const OTHER_TENANT_ID = '018f2b6e-0000-7000-8000-000000000002';

export const PROBLEM_SYSTEM = 'http://example.invalid/fs/demo-problems';
export const PROCEDURE_SYSTEM = 'http://example.invalid/fs/demo-procedures';

/** A system no fixture row belongs to, for the "content was never loaded" cases. */
export const UNLOADED_SYSTEM = 'http://example.invalid/fs/demo-nothing';

export const VS_ELBOW_PROBLEMS = 'http://example.invalid/vs/elbow-problems';
export const VS_JOINT_PROBLEMS = 'http://example.invalid/vs/joint-problems';
export const VS_OVERLAPPING_PROBLEMS = 'http://example.invalid/vs/overlapping-problems';
export const VS_EXPLICIT_PROCEDURES = 'http://example.invalid/vs/explicit-procedures';
export const VS_PROBLEMS_MINUS_LEFT = 'http://example.invalid/vs/problems-minus-left';
export const VS_ALL_PROBLEM_RELEASES = 'http://example.invalid/vs/all-problem-releases';
export const VS_HISTORICAL_PROBLEMS = 'http://example.invalid/vs/historical-problems';
export const VS_NO_RULES = 'http://example.invalid/vs/no-rules';
export const VS_UNCONFIGURED = 'http://example.invalid/vs/not-configured-here';

function problem(
  code: string,
  display: string,
  version: string,
  parentCode: string | null,
  isActive = true
): TerminologyConcept {
  return { system: PROBLEM_SYSTEM, code, display, version, parentCode, isActive, properties: null };
}

/**
 * Ten concepts:
 *
 * | system     | code   | display                | version | parent | active |
 * | problems   | PB-100 | Aching elbow           | 2025-01 | -      | yes    |
 * | problems   | PB-100 | Aching elbow           | 2026-01 | -      | yes    |
 * | problems   | PB-110 | Aching left elbow      | 2026-01 | PB-100 | yes    |
 * | problems   | PB-111 | Aching right elbow     | 2026-01 | PB-100 | yes    |
 * | problems   | PB-200 | Bruised knee           | 2026-01 | -      | yes    |
 * | problems   | PB-210 | Bruised left knee      | 2026-01 | PB-200 | yes    |
 * | problems   | PB-900 | Retired swelling entry | 2026-01 | -      | no     |
 * | procedures | PR-10  | Elbow examination      | 2026-01 | -      | yes    |
 * | procedures | PR-20  | Knee examination       | 2026-01 | -      | yes    |
 * | procedures | PR-30  | Withdrawn examination  | 2026-01 | -      | no     |
 */
export const FIXTURE_CONCEPTS: readonly TerminologyConcept[] = [
  problem('PB-100', 'Aching elbow', '2025-01', null),
  problem('PB-100', 'Aching elbow', '2026-01', null),
  problem('PB-110', 'Aching left elbow', '2026-01', 'PB-100'),
  problem('PB-111', 'Aching right elbow', '2026-01', 'PB-100'),
  problem('PB-200', 'Bruised knee', '2026-01', null),
  problem('PB-210', 'Bruised left knee', '2026-01', 'PB-200'),
  problem('PB-900', 'Retired swelling entry', '2026-01', null, false),
  {
    system: PROCEDURE_SYSTEM,
    code: 'PR-10',
    display: 'Elbow examination',
    version: '2026-01',
    parentCode: null,
    isActive: true,
    properties: { defaultMinutes: 15 },
  },
  {
    system: PROCEDURE_SYSTEM,
    code: 'PR-20',
    display: 'Knee examination',
    version: '2026-01',
    parentCode: null,
    isActive: true,
    properties: null,
  },
  {
    system: PROCEDURE_SYSTEM,
    code: 'PR-30',
    display: 'Withdrawn examination',
    version: '2026-01',
    parentCode: null,
    isActive: false,
    properties: null,
  },
];

/** One value set per interesting rule shape, named for what it demonstrates. */
export const FIXTURE_VALUE_SETS: readonly ValueSetDefinition[] = [
  {
    url: VS_ELBOW_PROBLEMS,
    name: 'Elbow problems',
    include: [{ system: PROBLEM_SYSTEM, parentCode: 'PB-100' }],
  },
  {
    url: VS_JOINT_PROBLEMS,
    include: [
      { system: PROBLEM_SYSTEM, parentCode: 'PB-100' },
      { system: PROBLEM_SYSTEM, parentCode: 'PB-200' },
    ],
  },
  {
    url: VS_OVERLAPPING_PROBLEMS,
    include: [
      { system: PROBLEM_SYSTEM, parentCode: 'PB-100' },
      { system: PROBLEM_SYSTEM, codes: ['PB-110', 'PB-200'] },
    ],
  },
  {
    url: VS_EXPLICIT_PROCEDURES,
    include: [{ system: PROCEDURE_SYSTEM, codes: ['PR-10', 'PR-20'] }],
  },
  {
    url: VS_PROBLEMS_MINUS_LEFT,
    include: [{ system: PROBLEM_SYSTEM, version: '2026-01' }],
    exclude: [{ system: PROBLEM_SYSTEM, codes: ['PB-110', 'PB-210'] }],
  },
  {
    url: VS_ALL_PROBLEM_RELEASES,
    include: [{ system: PROBLEM_SYSTEM }],
  },
  {
    url: VS_HISTORICAL_PROBLEMS,
    include: [{ system: PROBLEM_SYSTEM }],
    includeRetired: true,
  },
  {
    url: VS_NO_RULES,
    include: [],
  },
];
