import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  useApiKeys,
  useApiScopes,
  useAuditEvents,
  useFacilities,
  useFormDefinitions,
  useFormFieldTypes,
  useIntegrations,
  usePermissionMatrix,
  usePracticeDashboard,
  useSmartApps,
  useStaffUsers,
  useVisitReport,
  useWebhooks,
} from '@/lib/api/admin';
import {
  useClaims,
  useFeeSheets,
  usePayments,
  useRemittances,
  useStatements,
} from '@/lib/api/billing';
import type { AsyncState } from '@/lib/api/hooks';
import { useInbox, useOrders, useResults } from '@/lib/api/worklist';

/**
 * Every read hook, called the way the app calls it: with no arguments at all.
 *
 * Screens pass a client in tests so they can reach an empty or a failing state,
 * which means the default path -- "no options, read through the app's own
 * client" -- is the one path a screen test never exercises. That is the path
 * production takes. A hook whose default client was wired to the wrong module,
 * or whose optional query argument was not actually optional, would work in
 * every screen test and fail on the deployed app.
 */

/** How many rows a hook returned, or its status while it has none. */
function summarise(state: AsyncState<unknown>): string {
  if (state.status !== 'success') return state.status;
  const data = state.data;
  if (data === null) return 'success:none';
  if (Array.isArray(data)) return `success:${data.length}`;
  if (typeof data === 'object' && 'data' in data && Array.isArray(data.data)) {
    return `success:${data.data.length}`;
  }
  return 'success:object';
}

const HOOKS: ReadonlyArray<readonly [string, () => AsyncState<unknown>]> = [
  ['staff users', () => useStaffUsers()],
  ['permission matrix', () => usePermissionMatrix()],
  ['facilities', () => useFacilities()],
  ['form definitions', () => useFormDefinitions()],
  ['form field types', () => useFormFieldTypes()],
  ['audit events', () => useAuditEvents()],
  ['integrations', () => useIntegrations()],
  ['api keys', () => useApiKeys()],
  ['api scopes', () => useApiScopes()],
  ['smart apps', () => useSmartApps()],
  ['webhooks', () => useWebhooks()],
  ['practice dashboard', () => usePracticeDashboard()],
  ['visit report', () => useVisitReport()],
  ['fee sheets', () => useFeeSheets()],
  ['claims', () => useClaims()],
  ['remittances', () => useRemittances()],
  ['statements', () => useStatements()],
  ['payments', () => usePayments()],
  ['orders', () => useOrders()],
  ['results', () => useResults()],
  ['inbox', () => useInbox()],
];

describe('every read hook, with no client and no query', () => {
  it.each(HOOKS)('%s reads the app default client', async (_name, useHook) => {
    function Probe() {
      return <p data-testid="state">{summarise(useHook())}</p>;
    }

    render(<Probe />);

    await waitFor(() => expect(screen.getByTestId('state').textContent).toMatch(/^success:/));
    // Not an empty page: the app's own client is fixture-backed today, so a
    // hook pointed at the wrong module would resolve to nothing.
    expect(screen.getByTestId('state')).not.toHaveTextContent('success:0');
    expect(screen.getByTestId('state')).not.toHaveTextContent('success:none');
  });
});

describe('the fixture clients outside a test runner', () => {
  it('delays in the browser so a loading state is visible, and not in tests', async () => {
    // Under NODE_ENV=test the fixture clients resolve immediately, which is why
    // every screen test above settles without a timer. In a browser demo they
    // wait, because a loading skeleton nobody ever sees is a loading skeleton
    // nobody ever designed.
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    vi.useFakeTimers();
    try {
      const { createMockClient } = await import('@/lib/api/mock/client');
      const { createMockChartClient } = await import('@/lib/api/chart/client');
      const { createAdminMockClient } = await import('@/lib/api/mock/admin');

      const settled: string[] = [];
      void createMockClient()
        .patients.list({})
        .then(() => settled.push('patients'));
      void createAdminMockClient()
        .facilities.list()
        .then(() => settled.push('facilities'));
      void createMockChartClient()
        .summary.get('0192f1a0-0000-7000-8000-00000000p001')
        .then(() => settled.push('chart'));

      await Promise.resolve();
      expect(settled).toEqual([]);

      await vi.advanceTimersByTimeAsync(200);
      expect(settled.toSorted()).toEqual(['chart', 'facilities', 'patients']);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
