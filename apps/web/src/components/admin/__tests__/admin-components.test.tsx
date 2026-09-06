import { appCatalogue, createTranslator } from '@openrunic/i18n';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { DetailList } from '@/components/admin/DetailList';
import { Drawer } from '@/components/admin/Drawer';
import { FilterBar } from '@/components/admin/FilterBar';
import { PermissionMatrix } from '@/components/admin/PermissionMatrix';
import { pluralKey, translateColumns } from '@/components/admin/copy';
import { isAllowed, permissionKey, summariseRole } from '@/components/admin/permissions';
import { TabPanel, Tabs } from '@/components/admin/Tabs';
import { MOCK_PERMISSIONS } from '@/lib/api';
import type { PermissionRow } from '@/lib/api';

const ROWS: PermissionRow[] = [...MOCK_PERMISSIONS];

/* The source locale, so these assertions read in the language this file is
   written in. Components under test get the same translator from the setup
   file; the helpers below are plain functions and are handed it directly. */
const t = createTranslator(appCatalogue, 'en');

describe('Drawer', () => {
  it('renders nothing while closed, so it holds no focus stops', () => {
    render(
      <Drawer open={false} title="Dev Sandoval" onClose={vi.fn()}>
        body
      </Drawer>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is a labelled modal dialog with a close control', () => {
    render(
      <Drawer open title="Dev Sandoval" description="Medical assistant" onClose={vi.fn()}>
        body
      </Drawer>
    );

    const dialog = screen.getByRole('dialog', { name: 'Dev Sandoval' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('closes on Escape as well as on the close button', () => {
    const onClose = vi.fn();
    render(
      <Drawer open title="Dev Sandoval" onClose={onClose}>
        body
      </Drawer>
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('moves focus into the panel when it opens', () => {
    render(
      <Drawer open title="Dev Sandoval" onClose={vi.fn()}>
        body
      </Drawer>
    );
    expect(screen.getByRole('dialog')).toHaveFocus();
  });
});

describe('Tabs', () => {
  function Harness() {
    const [active, setActive] = useState('keys');
    return (
      <>
        <Tabs
          label="Developer platform sections"
          active={active}
          onChange={setActive}
          items={[
            { id: 'keys', label: 'API keys' },
            { id: 'apps', label: 'SMART apps' },
            { id: 'webhooks', label: 'Webhooks' },
          ]}
        />
        <TabPanel id="keys" active={active === 'keys'}>
          keys panel
        </TabPanel>
        <TabPanel id="apps" active={active === 'apps'}>
          apps panel
        </TabPanel>
        <TabPanel id="webhooks" active={active === 'webhooks'}>
          webhooks panel
        </TabPanel>
      </>
    );
  }

  it('exposes one tab stop and marks the selected tab', () => {
    render(<Harness />);
    const list = screen.getByRole('tablist', { name: 'Developer platform sections' });
    const tabs = within(list).getAllByRole('tab');

    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');
  });

  it('moves between tabs with the arrow keys and wraps at the ends', () => {
    render(<Harness />);
    // Roving tabindex: exactly one tab is in the tab order, and the arrow keys
    // are pressed on it, which is where a keyboard user's focus actually is.
    const selectedTab = () => screen.getByRole('tab', { selected: true });

    fireEvent.keyDown(selectedTab(), { key: 'ArrowRight' });
    expect(screen.getByText('apps panel')).toBeInTheDocument();

    fireEvent.keyDown(selectedTab(), { key: 'End' });
    expect(screen.getByText('webhooks panel')).toBeInTheDocument();

    fireEvent.keyDown(selectedTab(), { key: 'ArrowRight' });
    expect(screen.getByText('keys panel')).toBeInTheDocument();
  });

  it('keeps only the selected tab in the tab order', () => {
    render(<Harness />);
    const tabs = screen.getAllByRole('tab');

    expect(tabs.filter((tab) => tab.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(screen.getByRole('tab', { selected: true })).toHaveAttribute('tabindex', '0');
  });

  it('unmounts the inactive panels rather than hiding them', () => {
    render(<Harness />);
    expect(screen.queryByText('apps panel')).not.toBeInTheDocument();
  });
});

describe('ConfirmDialog', () => {
  it('keeps the destructive confirm disabled until the phrase is typed exactly', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Deactivate Dev Sandoval"
        consequence="They can no longer sign in."
        confirmLabel="Deactivate account"
        typedConfirmation="Dev Sandoval"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    const confirm = screen.getByRole('button', { name: 'Deactivate account' });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Type Dev Sandoval to confirm'), {
      target: { value: 'dev sandoval' },
    });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Type Dev Sandoval to confirm'), {
      target: { value: 'Dev Sandoval' },
    });
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('asks for no typing on a clinical-significant confirmation', () => {
    render(
      <ConfirmDialog
        open
        title="Publish Adult intake version 4"
        consequence="Version 4 becomes the form every new response uses."
        confirmLabel="Publish version 4"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Publish version 4' })).toBeEnabled();
    expect(screen.queryByLabelText(/to confirm/)).not.toBeInTheDocument();
  });

  it('names the object and the consequence, never "OK"', () => {
    render(
      <ConfirmDialog
        open
        title="Revoke Old billing bridge"
        consequence="Anything using this key stops working immediately."
        confirmLabel="Revoke key"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole('alertdialog')).toHaveTextContent('stops working immediately');
    expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();
  });
});

describe('PermissionMatrix', () => {
  it('renders every cell as a labelled checkbox naming its capability and role', () => {
    render(<PermissionMatrix rows={ROWS} roles={['PROVIDER']} overrides={{}} onToggle={vi.fn()} />);
    expect(screen.getByLabelText('Sign notes for Provider')).toBeChecked();
    expect(screen.getByLabelText('Configure the practice for Provider')).not.toBeChecked();
  });

  it('reports a toggle with the capability, the role and the new value', () => {
    const onToggle = vi.fn();
    render(<PermissionMatrix rows={ROWS} roles={['BILLER']} overrides={{}} onToggle={onToggle} />);

    fireEvent.click(screen.getByLabelText('Sign notes for Biller'));
    expect(onToggle).toHaveBeenCalledWith('note.sign', 'BILLER', true);
  });

  it('reads an override in preference to the role bundle', () => {
    const row = ROWS[0];
    expect(row).toBeDefined();
    if (!row) return;
    expect(isAllowed(row, 'BILLER', {})).toBe(false);
    expect(isAllowed(row, 'BILLER', { [permissionKey(row.id, 'BILLER')]: true })).toBe(true);
  });
});

describe('summariseRole', () => {
  it('says what the role can and cannot do, in one plain sentence', () => {
    const summary = summariseRole(t, ROWS, 'FRONT_DESK', {});
    expect(summary).toContain('Can view charts');
    expect(summary).toContain('Cannot');
    expect(summary).toContain('sign notes');
  });

  it('says so when a role grants nothing at all', () => {
    const stripped = ROWS.map((row) => ({
      ...row,
      roles: { ...row.roles, READ_ONLY: 'DENY' as const },
    }));
    expect(summariseRole(t, stripped, 'READ_ONLY', {})).toContain('can do nothing yet');
  });
});

describe('FilterBar and DetailList', () => {
  it('names the filter group and announces its result count politely', () => {
    render(
      <FilterBar label="Filter the audit trail" summary="12 events">
        <input aria-label="From" />
      </FilterBar>
    );

    expect(screen.getByRole('group', { name: 'Filter the audit trail' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('12 events');
  });

  it('renders attributes as a description list, never a blank value', () => {
    render(<DetailList items={[{ label: 'NPI', value: 'Not recorded', mono: true }]} />);
    expect(screen.getByText('NPI')).toBeInTheDocument();
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
  });
});

describe('Drawer, the focus trap', () => {
  function TrapHarness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open the drawer
        </button>
        <Drawer
          open={open}
          title="Dev Sandoval"
          onClose={() => setOpen(false)}
          footer={
            <button type="button" id="save">
              Save
            </button>
          }
        >
          <input aria-label="Display name" defaultValue="Dev" />
        </Drawer>
      </>
    );
  }

  it('cycles Tab from the last stop back to the first, never onto the page behind', () => {
    render(<TrapHarness />);
    const dialog = screen.getByRole('dialog');
    const stops = within(dialog).getAllByRole('button');
    const last = screen.getByRole('button', { name: 'Save' });
    const first = stops[0]!;

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    // The page behind an open drawer is not reachable: Tab from the last stop
    // lands on the first, rather than on the button that opened it.
    expect(first).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Open the drawer' })).not.toHaveFocus();
  });

  it('cycles Shift-Tab from the first stop round to the last', () => {
    render(<TrapHarness />);
    const dialog = screen.getByRole('dialog');
    const first = within(dialog).getAllByRole('button')[0]!;

    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
  });

  it('leaves an ordinary Tab in the middle of the panel alone', () => {
    render(<TrapHarness />);
    const field = screen.getByLabelText('Display name');

    field.focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    // Not at either end, so the browser moves focus itself; the trap must not
    // yank the caret back to the top of the panel on every keystroke.
    expect(field).toHaveFocus();
  });

  it('pulls focus back in when it has escaped to the page behind', () => {
    render(<TrapHarness />);
    const outside = screen.getByRole('button', { name: 'Open the drawer' });

    outside.focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('returns focus to whatever opened it', () => {
    render(<TrapHarness />);
    const opener = screen.getByRole('button', { name: 'Open the drawer' });

    opener.focus();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!);

    // A keyboard user is never dropped at the top of the page when a panel
    // closes: they are put back where they were.
    expect(opener).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes when the scrim behind it is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <Drawer open title="Dev Sandoval" onClose={onClose}>
        body
      </Drawer>
    );

    fireEvent.click(container.querySelector('.or-drawer__scrim')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps nothing when the panel has no focusable stop of its own', () => {
    render(
      <Drawer open title="Empty" onClose={vi.fn()}>
        <p>Nothing to interact with.</p>
      </Drawer>
    );

    // The header close button is always a stop, so the panel is never a dead
    // end; Tab stays inside it.
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });
});

describe('the admin copy helpers', () => {
  it('builds table headers from catalogue keys and keeps the rest of the column', () => {
    const columns = translateColumns(t, [
      { key: 'name', headerKey: 'admin.users.column.name' },
      { key: 'actions', headerKey: 'admin.users.column.actions', align: 'right' },
    ]);

    expect(columns).toStrictEqual([
      { key: 'name', header: 'Name' },
      { key: 'actions', header: 'Actions', align: 'right' },
    ]);
  });

  it('picks the plural form the locale selects, not the one English would', () => {
    const keys = {
      oneKey: 'admin.users.accountCount.one',
      otherKey: 'admin.users.accountCount.other',
    };
    // A second translator, because the key this picks and the language it
    // renders in are two separate decisions and the test has to be able to get
    // one right while the other is wrong.
    const es = createTranslator(appCatalogue, 'es');

    // The counts are already strings: this is about which key `pluralKey`
    // picks, and a real caller has put the number through `formatCount` before
    // it gets here.
    expect(t(pluralKey(keys, 1, 'en'), { count: '1' })).toBe('1 account');
    expect(t(pluralKey(keys, 4, 'en'), { count: '4' })).toBe('4 accounts');
    expect(es(pluralKey(keys, 1, 'es'), { count: '1' })).toBe('1 cuenta');
    // Zero is `other` in both languages this build carries, and the count that
    // most often gets hard-coded to the singular by mistake.
    expect(es(pluralKey(keys, 0, 'es'), { count: '0' })).toBe('0 cuentas');
  });
});
