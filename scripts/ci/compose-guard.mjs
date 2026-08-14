#!/usr/bin/env node
// Docker Compose misconfiguration guard.
//
// WHY THIS EXISTS RATHER THAN A RULE PACK. .github/workflows/iac-scan.yml runs
// Trivy in config mode, which has a maintained policy set for Dockerfiles,
// Kubernetes, Terraform, Helm and CloudFormation. It has none for Docker
// Compose - `trivy config docker-compose.yml` reports the file as "not
// scanned". Checkov has no docker_compose framework either. So the Compose
// file, which is the thing that decides whether a clinic's Postgres is
// reachable from the internet, is covered by nothing off the shelf.
//
// These checks are therefore written out explicitly, one per production-hostile
// default, with a severity and a reason attached to each. They are unit-tested
// in compose-guard.test.mjs.
//
// INPUT is the Compose document as JSON, because parsing YAML by hand is how
// static analysis quietly starts passing files it never understood. CI converts
// the file with a pinned, checksum-verified yq; this script only reads JSON.
//
// Usage:
//   yq -o=json '.' docker-compose.yml | node scripts/ci/compose-guard.mjs -
//   node scripts/ci/compose-guard.mjs compose.json [--fail-on high] [--json]
//
// Exit code 0 when nothing is at or above the threshold, 1 otherwise.

import { readFileSync } from 'node:fs';
import process from 'node:process';
import path from 'node:path';

/** Severity ladder, lowest first. */
export const SEVERITIES = ['low', 'medium', 'high', 'critical'];

/**
 * Ports whose exposure to the host network is the difference between a
 * database only the application can reach and one the internet can reach.
 */
const DATASTORE_PORTS = new Map([
  [1433, 'SQL Server'],
  [3306, 'MySQL'],
  [5432, 'PostgreSQL'],
  [5672, 'AMQP broker'],
  [6379, 'Redis'],
  [9042, 'Cassandra'],
  [9092, 'Kafka'],
  [9200, 'Elasticsearch'],
  [11211, 'Memcached'],
  [15672, 'AMQP management'],
  [27017, 'MongoDB'],
]);

/** Capabilities that hand a container most of what it would need to escape. */
const DANGEROUS_CAPABILITIES = new Set([
  'ALL',
  'SYS_ADMIN',
  'SYS_MODULE',
  'SYS_PTRACE',
  'SYS_RAWIO',
  'NET_ADMIN',
  'DAC_READ_SEARCH',
]);

/** Environment keys whose value is a credential if it is a literal. */
const SECRET_KEY = /(pass(word|wd)?|secret|token|api[_-]?key|private[_-]?key|access[_-]?key)/i;

/**
 * Values that are obviously not a real credential: an unresolved interpolation,
 * an empty string, or a placeholder a human is meant to replace.
 */
const PLACEHOLDER_VALUE =
  /^\s*$|^\$\{[^}]*\}$|^\$[A-Za-z_][A-Za-z0-9_]*$|^(changeme|change-me|replace-?me|example|placeholder|your[-_].*|<.*>)$/i;

const finding = (rule, severity, service, message) => ({ rule, severity, service, message });

/** Normalises `environment` from either the map form or the `KEY=value` list. */
export function readEnvironment(environment) {
  if (!environment) return [];
  if (Array.isArray(environment)) {
    return environment
      .filter((entry) => typeof entry === 'string')
      .map((entry) => {
        const index = entry.indexOf('=');
        return index === -1 ? [entry, undefined] : [entry.slice(0, index), entry.slice(index + 1)];
      });
  }
  if (typeof environment === 'object') return Object.entries(environment);
  return [];
}

/**
 * Normalises a `ports` entry from either the short string form
 * ("127.0.0.1:5432:5432") or the long object form.
 *
 * Returns `{ published, target, hostIp }` with numbers where they are numbers,
 * or null when the entry publishes nothing to the host.
 */
export function readPort(entry) {
  if (entry && typeof entry === 'object') {
    if (entry.published === undefined || entry.published === null) return null;
    return {
      published: Number(String(entry.published).split('-')[0]),
      target: Number(entry.target),
      hostIp: entry.host_ip ?? entry.hostIp ?? undefined,
    };
  }
  const text = String(entry).replace(/\/(tcp|udp)$/i, '');
  const parts = text.split(':');
  // "5432" alone publishes a RANDOM host port for the container port, so there
  // is a host binding but the port number is not chosen here.
  if (parts.length === 1) {
    return { published: Number.NaN, target: Number(parts[0].split('-')[0]), hostIp: undefined };
  }
  if (parts.length === 2) {
    return {
      published: Number(parts[0].split('-')[0]),
      target: Number(parts[1].split('-')[0]),
      hostIp: undefined,
    };
  }
  // host_ip:published:target, with IPv6 host addresses bracketed.
  const target = Number(parts[parts.length - 1].split('-')[0]);
  const published = Number(parts[parts.length - 2].split('-')[0]);
  const hostIp = parts.slice(0, parts.length - 2).join(':');
  return { published, target, hostIp };
}

/** True when a host binding reaches beyond the loopback interface. */
export function isPubliclyBound(hostIp) {
  if (hostIp === undefined || hostIp === '') return true;
  const address = String(hostIp).replace(/^\[|\]$/g, '');
  if (address === '0.0.0.0' || address === '::' || address === '*') return true;
  return !(address === '127.0.0.1' || address === '::1' || address === 'localhost');
}

/** True when an image reference pins a specific, immutable build. */
export function isPinnedImage(image) {
  const reference = String(image);
  if (reference.includes('@sha256:')) return true;
  // Strip a registry host with a port before looking for the tag separator.
  const lastSlash = reference.lastIndexOf('/');
  const namePart = lastSlash === -1 ? reference : reference.slice(lastSlash + 1);
  const colon = namePart.indexOf(':');
  if (colon === -1) return false; // no tag at all: resolves to :latest
  return namePart.slice(colon + 1) !== 'latest';
}

function checkService(name, service, findings) {
  if (service === null || typeof service !== 'object') return;

  if (service.privileged === true) {
    findings.push(
      finding(
        'privileged-container',
        'critical',
        name,
        'runs privileged, which gives it the host kernel. A privileged container on a clinic server is a host compromise waiting for one application bug.'
      )
    );
  }

  for (const [key, label] of [
    ['network_mode', 'the host network stack'],
    ['pid', 'the host process namespace'],
    ['ipc', 'the host IPC namespace'],
  ]) {
    if (String(service[key] ?? '').toLowerCase() === 'host') {
      findings.push(
        finding(
          'host-namespace',
          'high',
          name,
          `shares ${label} (${key}: host), which removes the isolation the container was supposed to provide.`
        )
      );
    }
  }

  for (const capability of service.cap_add ?? []) {
    if (DANGEROUS_CAPABILITIES.has(String(capability).toUpperCase())) {
      findings.push(
        finding(
          'dangerous-capability',
          'high',
          name,
          `adds capability ${capability}, which is close enough to privileged to be treated the same way.`
        )
      );
    }
  }

  for (const volume of service.volumes ?? []) {
    const source = typeof volume === 'string' ? volume.split(':')[0] : (volume?.source ?? '');
    if (String(source).includes('docker.sock')) {
      findings.push(
        finding(
          'docker-socket-mount',
          'critical',
          name,
          'mounts the Docker socket, which is root on the host by another name.'
        )
      );
    }
  }

  for (const entry of service.ports ?? []) {
    const port = readPort(entry);
    if (!port) continue;
    const service_ = DATASTORE_PORTS.get(port.target);
    if (service_ && isPubliclyBound(port.hostIp)) {
      findings.push(
        finding(
          'datastore-port-published',
          'high',
          name,
          `publishes ${service_} port ${port.target} to every host interface. Bind it to 127.0.0.1, or drop the mapping and let the application reach it over the Compose network.`
        )
      );
    }
  }

  if (service.image !== undefined && !isPinnedImage(service.image)) {
    findings.push(
      finding(
        'unpinned-image',
        'high',
        name,
        `uses "${service.image}", which is not pinned. The same Compose file then produces a different container on every clinic's server, and a scan of one says nothing about the others.`
      )
    );
  }

  const user = service.user === undefined ? undefined : String(service.user);
  if (user === undefined) {
    findings.push(
      finding(
        'no-user',
        'high',
        name,
        'sets no `user`, so it runs as whatever the image defaults to - root, unless the image says otherwise.'
      )
    );
  } else if (user === 'root' || user === '0' || user.startsWith('0:')) {
    findings.push(finding('root-user', 'high', name, 'runs as root.'));
  }

  for (const [key, value] of readEnvironment(service.environment)) {
    if (!SECRET_KEY.test(String(key))) continue;
    if (value === undefined) continue; // passed through from the host environment
    if (PLACEHOLDER_VALUE.test(String(value))) continue;
    findings.push(
      finding(
        'secret-in-environment',
        'critical',
        name,
        `has a literal value for ${key}. Credentials belong in an env file or a Compose secret, never in a file that ships in the repository.`
      )
    );
  }

  if (service.read_only !== true) {
    findings.push(
      finding(
        'writable-root-filesystem',
        'low',
        name,
        'has a writable root filesystem. `read_only: true` plus a tmpfs for anything genuinely mutable makes a foothold much harder to keep.'
      )
    );
  }

  const securityOpt = (service.security_opt ?? []).map((option) => String(option).toLowerCase());
  if (!securityOpt.some((option) => option.replace(/\s/g, '') === 'no-new-privileges:true')) {
    findings.push(
      finding(
        'no-new-privileges-missing',
        'low',
        name,
        'does not set `security_opt: ["no-new-privileges:true"]`, so a setuid binary inside the container can still gain privileges.'
      )
    );
  }

  if (service.healthcheck === undefined) {
    findings.push(
      finding(
        'no-healthcheck',
        'low',
        name,
        'declares no healthcheck, so an operator has no way to tell a hung container from a healthy one and `depends_on: condition: service_healthy` cannot be used.'
      )
    );
  }
}

/** Runs every check over a parsed Compose document. */
export function checkCompose(document) {
  const findings = [];
  const services = document?.services;
  if (!services || typeof services !== 'object') return findings;
  for (const [name, service] of Object.entries(services)) {
    checkService(name, service, findings);
  }
  return findings.sort(
    (a, b) =>
      SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity) ||
      a.service.localeCompare(b.service) ||
      a.rule.localeCompare(b.rule)
  );
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

function main(argv) {
  const json = argv.includes('--json');
  const failOnIndex = argv.indexOf('--fail-on');
  // MEDIUM by default, matching the Trivy threshold in iac-scan.yml so both
  // halves of the infrastructure gate speak with one voice.
  const failOn = failOnIndex === -1 ? 'medium' : argv[failOnIndex + 1];
  if (!SEVERITIES.includes(failOn)) {
    process.stderr.write(`compose-guard: --fail-on must be one of ${SEVERITIES.join(', ')}\n`);
    return 2;
  }
  const inputs = argv.filter(
    (argument, index) => !argument.startsWith('--') && argv[index - 1] !== '--fail-on'
  );
  if (inputs.length === 0) {
    process.stderr.write('compose-guard: pass a Compose JSON file, or - for stdin\n');
    return 2;
  }

  const results = [];
  for (const input of inputs) {
    const text = input === '-' ? readFileSync(0, 'utf8') : readFileSync(input, 'utf8');
    const label = input === '-' ? 'docker-compose.yml' : input;
    for (const item of checkCompose(JSON.parse(text))) results.push({ ...item, file: label });
  }

  const gating = results.filter(
    (item) => SEVERITIES.indexOf(item.severity) >= SEVERITIES.indexOf(failOn)
  );

  if (json) {
    process.stdout.write(`${JSON.stringify({ findings: results, failOn }, null, 2)}\n`);
  } else if (results.length === 0) {
    process.stdout.write('compose-guard: clean - no misconfiguration found.\n');
  } else {
    process.stdout.write(`compose-guard: ${results.length} finding(s), gating at ${failOn}\n\n`);
    for (const item of results) {
      process.stdout.write(
        `  ${item.file}  services.${item.service}  [${item.severity}] ${item.rule}\n    ${item.message}\n\n`
      );
    }
  }
  return gating.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(main(process.argv.slice(2)));
}
