import { describe, expect, it } from 'vitest';
import { helpHref, helpQuestionKey, helpTopicFrom, helpTopicGranted } from '@/components/assistant';
import type { AssistantCapabilities } from '@/lib/assistant';

const granted = (...ids: string[]): AssistantCapabilities => ({
  dictation: null,
  service: { modelId: 'm', endpointHost: 'h.example.invalid', dataLeavesDeployment: false },
  capabilities: ids.map((id) => ({ id, summary: id })),
});

describe('help topics', () => {
  it('reads only the topics it knows from a query value', () => {
    expect(helpTopicFrom('visits')).toBe('visits');
    expect(helpTopicFrom('bills')).toBe('bills');
    expect(helpTopicFrom('record')).toBeNull();
    expect(helpTopicFrom('')).toBeNull();
    expect(helpTopicFrom(null)).toBeNull();
    expect(helpTopicFrom(undefined)).toBeNull();
  });

  it('answers a topic only with the capability that reads it', () => {
    expect(helpTopicGranted(granted('visits.list'), 'visits')).toBe(true);
    expect(helpTopicGranted(granted('visits.list'), 'bills')).toBe(false);
    expect(helpTopicGranted(granted('bills.list'), 'bills')).toBe(true);
    expect(helpTopicGranted(granted(), 'visits')).toBe(false);
  });

  it('builds a link that names the topic and never a record', () => {
    expect(helpHref('visits')).toBe('/assistant?about=visits');
    expect(helpHref('bills')).toBe('/assistant?about=bills');
    expect(helpQuestionKey('visits')).not.toBe(helpQuestionKey('bills'));
  });
});
