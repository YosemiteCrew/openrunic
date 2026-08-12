import { describe, expect, it } from 'vitest';

import { OPENRUNIC_ENVIRONMENTS, isOpenrunicEnvironment } from './index.js';

describe('OPENRUNIC_ENVIRONMENTS', () => {
  it('lists the three environments in promotion order', () => {
    expect(OPENRUNIC_ENVIRONMENTS).toEqual(['development', 'staging', 'production']);
  });
});

describe('isOpenrunicEnvironment', () => {
  it.each(['development', 'staging', 'production'])('accepts %s', (value) => {
    expect(isOpenrunicEnvironment(value)).toBe(true);
  });

  it.each(['dev', 'prod', 'test', 'DEVELOPMENT', '', 'production '])('rejects %j', (value) => {
    expect(isOpenrunicEnvironment(value)).toBe(false);
  });
});
