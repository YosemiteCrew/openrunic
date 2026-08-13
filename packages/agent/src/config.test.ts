import { describe, expect, it } from 'vitest';

import { ENV, isLocalEndpoint, loadAgentSubsystem } from './config.js';

/**
 * Default off, and named egress.
 *
 * The first test in this file is the most important one in the package: with
 * nothing configured the subsystem reports `disabled`, which is a normal
 * product state and not an error. Everything after it is about making sure a
 * single environment variable cannot start health data flowing.
 */

const LOCAL = {
  [ENV.baseUrl]: 'http://vllm:8000/v1',
  [ENV.modelId]: 'a-locally-served-model',
};

const REMOTE = {
  [ENV.baseUrl]: 'https://api.example-provider.test/v1',
  [ENV.modelId]: 'a-hosted-model',
  [ENV.apiKey]: 'not-a-real-key',
};

describe('with nothing configured', () => {
  it('is disabled, and says so as a normal state', () => {
    const subsystem = loadAgentSubsystem({});
    expect(subsystem.status).toBe('disabled');
    expect(subsystem.status === 'disabled' && subsystem.reason).toMatch(/complete without one/);
  });

  it('treats blank values as absent, not as a broken configuration', () => {
    expect(loadAgentSubsystem({ [ENV.baseUrl]: '   ', [ENV.modelId]: '' }).status).toBe('disabled');
  });

  it('refuses half a configuration rather than guessing the other half', () => {
    expect(loadAgentSubsystem({ [ENV.baseUrl]: 'http://vllm:8000' }).status).toBe('misconfigured');
    expect(loadAgentSubsystem({ [ENV.modelId]: 'a-model' }).status).toBe('misconfigured');
  });
});

describe('a local endpoint', () => {
  it('needs no paperwork and reports no egress', () => {
    const subsystem = loadAgentSubsystem(LOCAL);
    expect(subsystem.status).toBe('enabled');
    expect(subsystem.status === 'enabled' && subsystem.config.model.phiEgress).toBe('none');
  });

  it('normalises a trailing slash off the origin', () => {
    const subsystem = loadAgentSubsystem({ ...LOCAL, [ENV.baseUrl]: 'http://vllm:8000/v1//' });
    expect(subsystem.status === 'enabled' && subsystem.config.model.baseUrl).toBe(
      'http://vllm:8000/v1'
    );
  });

  it('refuses a base URL that is not a URL', () => {
    expect(loadAgentSubsystem({ ...LOCAL, [ENV.baseUrl]: 'not a url' }).status).toBe(
      'misconfigured'
    );
  });

  it('refuses an unknown provider kind', () => {
    expect(loadAgentSubsystem({ ...LOCAL, [ENV.providerKind]: 'telepathy' }).status).toBe(
      'misconfigured'
    );
  });
});

describe('a remote endpoint', () => {
  it('will not start without the egress acknowledgement', () => {
    const subsystem = loadAgentSubsystem(REMOTE);
    expect(subsystem.status).toBe('misconfigured');
    expect(subsystem.status === 'misconfigured' && subsystem.reason).toMatch(
      /nothing else is affected/
    );
  });

  it('will not start on the endpoint alone plus a posture, without naming the agreement', () => {
    const subsystem = loadAgentSubsystem({ ...REMOTE, [ENV.phiEgress]: 'configured-baa' });
    expect(subsystem.status).toBe('misconfigured');
    expect(subsystem.status === 'misconfigured' && subsystem.reason).toMatch(
      /One variable must not be able to start health data flowing/
    );
  });

  it('starts once the agreement and the responsible party are both named', () => {
    const subsystem = loadAgentSubsystem({
      ...REMOTE,
      [ENV.phiEgress]: 'configured-baa',
      [ENV.acknowledgedAgreement]: 'BAA-2026-04 with the model provider',
      [ENV.acknowledgedParty]: 'Clinic Privacy Officer',
    });

    expect(subsystem.status).toBe('enabled');
    expect(subsystem.status === 'enabled' && subsystem.config.model.egressAcknowledgement).toEqual({
      agreement: 'BAA-2026-04 with the model provider',
      responsibleParty: 'Clinic Privacy Officer',
    });
  });

  it('refuses a claim that data never leaves when the endpoint is off the network', () => {
    const subsystem = loadAgentSubsystem({ ...REMOTE, [ENV.phiEgress]: 'none' });
    expect(subsystem.status).toBe('misconfigured');
    expect(subsystem.status === 'misconfigured' && subsystem.reason).toMatch(
      /claims data never leaves/
    );
  });

  it('refuses an unknown egress posture', () => {
    expect(loadAgentSubsystem({ ...REMOTE, [ENV.phiEgress]: 'probably-fine' }).status).toBe(
      'misconfigured'
    );
  });
});

describe('a fallback endpoint', () => {
  it('is refused when its egress posture differs from the primary one', () => {
    // The exact shape that turns an outage into a breach: a local primary and
    // a hosted spare, each individually acceptable.
    const subsystem = loadAgentSubsystem({
      ...LOCAL,
      [ENV.fallbackBaseUrl]: 'https://api.example-provider.test/v1',
      [ENV.fallbackModel]: 'a-hosted-model',
      [ENV.fallbackPhiEgress]: 'configured-baa',
      [ENV.acknowledgedAgreement]: 'BAA-2026-04',
      [ENV.acknowledgedParty]: 'Clinic Privacy Officer',
    });

    expect(subsystem.status).toBe('misconfigured');
    expect(subsystem.status === 'misconfigured' && subsystem.reason).toMatch(
      /turns an outage into a breach/
    );
  });

  it('is accepted when both endpoints have the same posture', () => {
    const subsystem = loadAgentSubsystem({
      ...LOCAL,
      [ENV.fallbackBaseUrl]: 'http://vllm-spare:8000/v1',
      [ENV.fallbackModel]: 'a-second-locally-served-model',
    });

    expect(subsystem.status).toBe('enabled');
    expect(subsystem.status === 'enabled' && subsystem.config.fallback?.modelId).toBe(
      'a-second-locally-served-model'
    );
  });

  it('refuses half a fallback', () => {
    expect(
      loadAgentSubsystem({ ...LOCAL, [ENV.fallbackBaseUrl]: 'http://vllm-spare:8000' }).status
    ).toBe('misconfigured');
  });

  it('refuses a fallback base URL that is not a URL', () => {
    expect(
      loadAgentSubsystem({
        ...LOCAL,
        [ENV.fallbackBaseUrl]: 'nope',
        [ENV.fallbackModel]: 'a-model',
      }).status
    ).toBe('misconfigured');
  });
});

describe('budgets', () => {
  it('takes whole numbers of cents', () => {
    const subsystem = loadAgentSubsystem({
      ...LOCAL,
      [ENV.dailyBudget]: '500',
      [ENV.monthlyBudget]: '9000',
    });
    expect(subsystem.status === 'enabled' && subsystem.config.budget.dailyCostCents).toBe(500);
    expect(subsystem.status === 'enabled' && subsystem.config.budget.monthlyCostCents).toBe(9000);
  });

  it('refuses anything that is not a whole number of cents', () => {
    for (const value of ['12.5', 'lots', '-3', '1e3']) {
      expect(loadAgentSubsystem({ ...LOCAL, [ENV.dailyBudget]: value }).status).toBe(
        'misconfigured'
      );
    }
  });
});

describe('isLocalEndpoint', () => {
  it('recognises the deployment its own network', () => {
    for (const url of [
      'http://localhost:8000',
      'http://127.0.0.1:8000',
      'http://vllm:8000',
      'http://ollama.local:11434',
      'http://models.internal',
      'http://10.1.2.3:8000',
      'http://192.168.1.9:8000',
      'http://172.20.0.4:8000',
    ]) {
      expect(isLocalEndpoint(new URL(url)), url).toBe(true);
    }
  });

  it('treats anything it cannot prove local as remote', () => {
    for (const url of [
      'https://api.example-provider.test',
      'http://172.32.0.1:8000',
      'http://8.8.8.8',
      'https://models.example.com',
    ]) {
      expect(isLocalEndpoint(new URL(url)), url).toBe(false);
    }
  });
});
