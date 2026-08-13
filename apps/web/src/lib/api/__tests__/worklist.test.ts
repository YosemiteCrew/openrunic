import { describe, expect, it } from 'vitest';

import {
  MOCK_INBOX_ITEMS,
  MOCK_NOW,
  MOCK_ORDER_CATALOG,
  MOCK_ORDERS,
  MOCK_RESULTS,
} from '@/lib/api/mock/fixtures';
import {
  createWorklistClient,
  filterInbox,
  filterOrders,
  filterResults,
  isBulkSignable,
  patientProblems,
  rankCatalog,
  slaState,
  warningsFor,
} from '@/lib/api/worklist';

const TESTINA = '0192f1a0-0000-7000-8000-00000000p001';
const EXAMPLA = '0192f1a0-0000-7000-8000-00000000p002';

describe('rankCatalog', () => {
  it('ranks what the patient is actually being treated for above the rest', () => {
    const ranked = rankCatalog('', patientProblems(TESTINA));
    const hba1c = ranked.findIndex((entry) => entry.code === 'LAB-HBA1C');
    const ankle = ranked.findIndex((entry) => entry.code === 'IMG-ANKLE');
    expect(hba1c).toBeLessThan(ankle);
  });

  it('matches on the short code and on the words a person types', () => {
    expect(rankCatalog('cbc', []).map((entry) => entry.code)).toContain('LAB-CBC');
    expect(rankCatalog('cholesterol', []).map((entry) => entry.code)).toContain('LAB-LIPID');
  });

  it('returns nothing rather than everything for a query that matches nothing', () => {
    expect(rankCatalog('zzzz', [])).toHaveLength(0);
  });

  it('keeps every catalogue entry reachable with an empty query', () => {
    expect(rankCatalog('', [])).toHaveLength(MOCK_ORDER_CATALOG.length);
  });
});

describe('warningsFor', () => {
  it('raises the duplicate hard stop only for the patient it belongs to', () => {
    const forTestina = warningsFor(TESTINA, ['LAB-HBA1C']);
    expect(forTestina.map((warning) => warning.tier)).toContain('CRITICAL');
    expect(warningsFor(EXAMPLA, ['LAB-HBA1C'])).toHaveLength(0);
  });

  it('sorts criticals before caution and information', () => {
    const tiers = warningsFor(TESTINA, ['LAB-HBA1C', 'LAB-CREAT', 'LAB-LIPID']).map(
      (warning) => warning.tier
    );
    expect(tiers).toEqual(['CRITICAL', 'CAUTION', 'INFO']);
  });

  it('gives every critical an override reason to choose from', () => {
    for (const warning of warningsFor(EXAMPLA, ['IMG-CT-ABDO'])) {
      if (warning.tier === 'CRITICAL') expect(warning.overrideReasons?.length).toBeGreaterThan(0);
    }
  });
});

describe('slaState', () => {
  it('reads the clinic clock, never the machine clock', () => {
    expect(slaState('2026-08-11T17:00:00.000Z', MOCK_NOW)).toBe('OVERDUE');
    expect(slaState('2026-08-12T11:00:00.000Z', MOCK_NOW)).toBe('DUE_SOON');
    expect(slaState('2026-08-15T17:00:00.000Z', MOCK_NOW)).toBe('ON_TIME');
  });
});

describe('isBulkSignable', () => {
  it('never lets a critical value leave the queue in a batch', () => {
    const critical = MOCK_RESULTS.find((report) => report.flag === 'CRITICAL');
    const normal = MOCK_RESULTS.find(
      (report) => report.flag === 'NORMAL' && report.status === 'UNREVIEWED'
    );
    expect(critical && isBulkSignable(critical)).toBe(false);
    expect(normal && isBulkSignable(normal)).toBe(true);
  });
});

describe('filters', () => {
  it('narrows orders by status without losing the rest of the ledger', () => {
    const pended = filterOrders(MOCK_ORDERS, { status: 'PENDED' });
    expect(pended.length).toBeGreaterThan(0);
    expect(pended.every((order) => order.status === 'PENDED')).toBe(true);
  });

  it('narrows results by assignment', () => {
    const mine = filterResults(MOCK_RESULTS, { assignedTo: 'ME' });
    expect(mine.every((report) => report.assignedTo === 'ME')).toBe(true);
  });

  it('narrows the inbox by stream', () => {
    const refills = filterInbox(MOCK_INBOX_ITEMS, { stream: 'REFILLS' });
    expect(refills.length).toBeGreaterThan(0);
    expect(refills.every((item) => item.stream === 'REFILLS')).toBe(true);
  });
});

describe('createWorklistClient', () => {
  it('answers with a page envelope the boundary can read', async () => {
    const client = createWorklistClient();
    const page = await client.inbox.list();
    expect(page.page.totalPages).toBe(1);
    expect(page.data).toHaveLength(MOCK_INBOX_ITEMS.length);
  });

  it('takes injected rows, so a test can reach the empty state', async () => {
    const client = createWorklistClient({ results: [], orders: [], inbox: [] });
    await expect(client.results.list()).resolves.toMatchObject({ data: [] });
  });
});
