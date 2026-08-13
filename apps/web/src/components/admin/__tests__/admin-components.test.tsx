import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { DetailList } from '@/components/admin/DetailList';
import { Drawer } from '@/components/admin/Drawer';
import { FilterBar } from '@/components/admin/FilterBar';
import {
  isAllowed,
  PermissionMatrix,
  permissionKey,
  summariseRole,
} from '@/components/admin/PermissionMatrix';
import { TabPanel, Tabs } from '@/components/admin/Tabs';
import { MOCK_PERMISSIONS } from '@/lib/api';
import type { PermissionRow } from '@/lib/api';

const ROWS: PermissionRow[] = [...MOCK_PERMISSIONS];

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
    const list = screen.getByRole('tablist', { name: 'Developer platform sections' });

    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(screen.getByText('apps panel')).toBeInTheDocument();

    fireEvent.keyDown(list, { key: 'End' });
    expect(screen.getByText('webhooks panel')).toBeInTheDocument();

    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(screen.getByText('keys panel')).toBeInTheDocument();
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
    const summary = summariseRole(ROWS, 'FRONT_DESK', {});
    expect(summary).toContain('Can view charts');
    expect(summary).toContain('Cannot');
    expect(summary).toContain('sign notes');
  });

  it('says so when a role grants nothing at all', () => {
    const stripped = ROWS.map((row) => ({
      ...row,
      roles: { ...row.roles, READ_ONLY: 'DENY' as const },
    }));
    expect(summariseRole(stripped, 'READ_ONLY', {})).toContain('can do nothing yet');
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
