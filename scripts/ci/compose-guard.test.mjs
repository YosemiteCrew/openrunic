#!/usr/bin/env node
// Unit tests for the Docker Compose misconfiguration guard.
//
// Each production-hostile default the guard claims to catch gets a test that it
// is caught, and a matching test that the hardened form is accepted. The second
// half is what stops this from becoming a gate people route around.
//
// Run with `node --test scripts/ci/compose-guard.test.mjs`, or
// `pnpm run check:compose:test`.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  checkCompose,
  isPinnedImage,
  isPubliclyBound,
  readEnvironment,
  readPort,
} from './compose-guard.mjs';

/** A service with every hardening in place, used as the baseline everywhere. */
const HARDENED = {
  image: 'ghcr.io/yosemitecrew/openrunic-api:1.0.0@sha256:' + 'a'.repeat(64),
  user: '10001:10001',
  read_only: true,
  security_opt: ['no-new-privileges:true'],
  healthcheck: { test: ['CMD', 'true'] },
};

const compose = (service) => ({ services: { app: { ...HARDENED, ...service } } });
const rules = (document) => checkCompose(document).map((f) => f.rule);
const has = (document, rule) => rules(document).includes(rule);

describe('the hardened baseline', () => {
  it('produces no findings at all', () => {
    assert.deepEqual(checkCompose(compose({})), []);
  });

  it('accepts a document with no services', () => {
    assert.deepEqual(checkCompose({ name: 'openrunic' }), []);
    assert.deepEqual(checkCompose(null), []);
  });
});

describe('container privilege', () => {
  it('flags privileged mode', () => {
    assert.equal(has(compose({ privileged: true }), 'privileged-container'), true);
  });

  it('flags host namespaces', () => {
    assert.equal(has(compose({ network_mode: 'host' }), 'host-namespace'), true);
    assert.equal(has(compose({ pid: 'host' }), 'host-namespace'), true);
    assert.equal(has(compose({ ipc: 'host' }), 'host-namespace'), true);
    assert.equal(has(compose({ network_mode: 'bridge' }), 'host-namespace'), false);
  });

  it('flags escape-shaped capabilities and allows narrow ones', () => {
    assert.equal(has(compose({ cap_add: ['SYS_ADMIN'] }), 'dangerous-capability'), true);
    assert.equal(has(compose({ cap_add: ['ALL'] }), 'dangerous-capability'), true);
    assert.equal(has(compose({ cap_add: ['NET_BIND_SERVICE'] }), 'dangerous-capability'), false);
  });

  it('flags a Docker socket mount in either volume form', () => {
    assert.equal(
      has(
        compose({ volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro'] }),
        'docker-socket-mount'
      ),
      true
    );
    assert.equal(
      has(
        compose({ volumes: [{ type: 'bind', source: '/var/run/docker.sock', target: '/sock' }] }),
        'docker-socket-mount'
      ),
      true
    );
    assert.equal(has(compose({ volumes: ['./data:/data'] }), 'docker-socket-mount'), false);
  });
});

describe('published datastore ports', () => {
  it('flags Postgres published to every interface', () => {
    assert.equal(has(compose({ ports: ['5432:5432'] }), 'datastore-port-published'), true);
    assert.equal(has(compose({ ports: ['0.0.0.0:5432:5432'] }), 'datastore-port-published'), true);
    assert.equal(
      has(compose({ ports: [{ target: 5432, published: '5432' }] }), 'datastore-port-published'),
      true
    );
  });

  it('accepts a loopback binding and an unpublished port', () => {
    assert.equal(
      has(compose({ ports: ['127.0.0.1:5432:5432'] }), 'datastore-port-published'),
      false
    );
    assert.equal(
      has(
        compose({ ports: [{ target: 5432, published: '5432', host_ip: '127.0.0.1' }] }),
        'datastore-port-published'
      ),
      false
    );
    assert.equal(has(compose({ expose: ['5432'] }), 'datastore-port-published'), false);
  });

  it('leaves an application port alone', () => {
    assert.equal(has(compose({ ports: ['8080:8080'] }), 'datastore-port-published'), false);
  });

  it('covers the other datastores a clinic deployment might add', () => {
    for (const port of [3306, 6379, 27017, 9200, 1433, 11211]) {
      assert.equal(
        has(compose({ ports: [`${port}:${port}`] }), 'datastore-port-published'),
        true,
        String(port)
      );
    }
  });
});

describe('image pinning', () => {
  it('flags an untagged image and the moving :latest tag', () => {
    assert.equal(has(compose({ image: 'postgres' }), 'unpinned-image'), true);
    assert.equal(has(compose({ image: 'postgres:latest' }), 'unpinned-image'), true);
    assert.equal(has(compose({ image: 'ghcr.io/org/app:latest' }), 'unpinned-image'), true);
  });

  it('accepts a version tag and a digest', () => {
    assert.equal(has(compose({ image: 'postgres:17.2-alpine' }), 'unpinned-image'), false);
    assert.equal(
      has(compose({ image: `postgres@sha256:${'b'.repeat(64)}` }), 'unpinned-image'),
      false
    );
  });

  it('does not read a registry port as a tag', () => {
    assert.equal(isPinnedImage('registry.example.com:5000/app'), false);
    assert.equal(isPinnedImage('registry.example.com:5000/app:1.2.3'), true);
  });
});

describe('runtime user and filesystem', () => {
  it('flags a missing user and an explicit root', () => {
    const { user: _unused, ...noUser } = HARDENED;
    assert.equal(
      checkCompose({ services: { app: noUser } }).some((f) => f.rule === 'no-user'),
      true
    );
    assert.equal(has(compose({ user: 'root' }), 'root-user'), true);
    assert.equal(has(compose({ user: '0' }), 'root-user'), true);
    assert.equal(has(compose({ user: '0:0' }), 'root-user'), true);
    assert.equal(has(compose({ user: '10001' }), 'root-user'), false);
  });

  it('flags a writable root filesystem and a missing no-new-privileges', () => {
    assert.equal(has(compose({ read_only: false }), 'writable-root-filesystem'), true);
    assert.equal(has(compose({ security_opt: [] }), 'no-new-privileges-missing'), true);
  });

  it('flags a missing healthcheck', () => {
    const { healthcheck: _unused, ...noCheck } = HARDENED;
    assert.equal(
      checkCompose({ services: { app: noCheck } }).some((f) => f.rule === 'no-healthcheck'),
      true
    );
  });
});

describe('credentials in the file', () => {
  it('flags a literal password in either environment form', () => {
    assert.equal(
      has(compose({ environment: { POSTGRES_PASSWORD: 'hunter2' } }), 'secret-in-environment'),
      true
    );
    assert.equal(
      has(compose({ environment: ['DATABASE_TOKEN=abc123'] }), 'secret-in-environment'),
      true
    );
  });

  it('accepts an interpolation, a pass-through and a placeholder', () => {
    assert.equal(
      has(
        compose({ environment: { POSTGRES_PASSWORD: '${POSTGRES_PASSWORD}' } }),
        'secret-in-environment'
      ),
      false
    );
    assert.equal(
      has(compose({ environment: ['POSTGRES_PASSWORD'] }), 'secret-in-environment'),
      false,
      'no value: taken from the host environment'
    );
    assert.equal(
      has(compose({ environment: { API_KEY: 'changeme' } }), 'secret-in-environment'),
      false
    );
  });

  it('leaves a non-credential environment variable alone', () => {
    assert.equal(
      has(compose({ environment: { NODE_ENV: 'production' } }), 'secret-in-environment'),
      false
    );
  });
});

describe('parsing helpers', () => {
  it('reads both environment forms', () => {
    assert.deepEqual(readEnvironment({ A: '1' }), [['A', '1']]);
    assert.deepEqual(readEnvironment(['A=1', 'B']), [
      ['A', '1'],
      ['B', undefined],
    ]);
    assert.deepEqual(readEnvironment(undefined), []);
  });

  it('reads every ports form', () => {
    assert.deepEqual(readPort('5432:5432'), { published: 5432, target: 5432, hostIp: undefined });
    assert.deepEqual(readPort('127.0.0.1:5432:5432'), {
      published: 5432,
      target: 5432,
      hostIp: '127.0.0.1',
    });
    assert.equal(readPort('5432/tcp').target, 5432);
    assert.equal(readPort({ target: 5432, published: '5432' }).target, 5432);
    assert.equal(readPort({ target: 5432 }), null, 'not published to the host');
  });

  it('knows which host bindings reach beyond loopback', () => {
    assert.equal(isPubliclyBound(undefined), true);
    assert.equal(isPubliclyBound('0.0.0.0'), true);
    assert.equal(isPubliclyBound('::'), true);
    assert.equal(isPubliclyBound('127.0.0.1'), false);
    assert.equal(isPubliclyBound('[::1]'), false);
  });
});

describe('a realistic production-hostile file', () => {
  it('reports the whole set, worst first', () => {
    const document = {
      services: {
        db: {
          image: 'postgres:latest',
          privileged: true,
          ports: ['5432:5432'],
          environment: { POSTGRES_PASSWORD: 'hunter2' },
        },
      },
    };
    const findings = checkCompose(document);
    const found = findings.map((f) => f.rule);
    for (const rule of [
      'privileged-container',
      'secret-in-environment',
      'datastore-port-published',
      'unpinned-image',
      'no-user',
      'writable-root-filesystem',
      'no-new-privileges-missing',
      'no-healthcheck',
    ]) {
      assert.equal(found.includes(rule), true, rule);
    }
    assert.equal(findings[0].severity, 'critical', 'sorted worst first');
  });
});
