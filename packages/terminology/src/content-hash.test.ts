import { describe, expect, it } from 'vitest';

import {
  CONTENT_HASH_PATTERN,
  CONTENT_HASH_PREFIX,
  hashCodeSystemContent,
} from './content-hash.js';

describe('content hash', () => {
  it('carries its algorithm and 64 hex digits', () => {
    const hash = hashCodeSystemContent('code,display\n');
    expect(hash.startsWith(CONTENT_HASH_PREFIX)).toBe(true);
    expect(CONTENT_HASH_PATTERN.test(hash)).toBe(true);
  });

  it('is stable for the same payload and different for a changed one', () => {
    expect(hashCodeSystemContent('one')).toBe(hashCodeSystemContent('one'));
    expect(hashCodeSystemContent('one')).not.toBe(hashCodeSystemContent('one '));
  });

  it('hashes the payload exactly as delivered, including the empty one', () => {
    expect(hashCodeSystemContent('')).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });
});
