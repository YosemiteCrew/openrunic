'use client';

import { Badge, Button, Card, Input, Select, Switch, Table, Tag } from '@openrunic/ui';
import type { TableColumn } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import { adminBreadcrumb, DetailList, Drawer } from '@/components/admin';
import type { Command } from '@/components/command';
import { ScreenCommands } from '@/components/command';
import { AppShell } from '@/components/shell';
import { AsyncBoundary, isEmptyList } from '@/components/state';
import { useAdminClientOption, useFacilities } from '@/lib/api';
import type { AdminClient, Facility } from '@/lib/api';
import { formatCount } from '@/lib/format';

/**
 * AD-02 Facilities.
 *
 * One screen owns the physical practice: identity and billing attributes, the
 * hours grid the slot engine reads, and the rooms the Flow Board reads. In
 * legacy systems those three lived in server globals, the facility table and a
 * multisite module; splitting them is how a practice ends up booking into a room that
 * does not exist.
 *
 * Single-facility practices see no multi-facility chrome: the list renders, the
 * primary facility is marked, and nothing asks which site you meant.
 */

export interface FacilitiesScreenProps {
  client?: AdminClient;
}

const HOURS_COLUMNS: TableColumn[] = [
  { key: 'day', header: 'Day' },
  { key: 'opens', header: 'Opens' },
  { key: 'closes', header: 'Closes' },
];

function hoursSummary(facility: Facility): string {
  const open = facility.hours.filter((entry) => entry.opens !== null);
  if (open.length === 0) return 'Closed all week';
  return `${open.length} days a week`;
}

export function FacilitiesScreen({ client }: Readonly<FacilitiesScreenProps>): ReactElement {
  const options = useAdminClientOption(client);
  const facilities = useFacilities(options);

  const [openId, setOpenId] = useState<string | null>(null);
  /* Inactive facilities are hidden by default and never deleted: a claim from
     2024 still has to resolve the place it happened. */
  const [showInactive, setShowInactive] = useState(false);

  const openFirst = useCallback(() => {
    setOpenId((current) => current ?? 'first');
  }, []);

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'admin.facilities.open',
        group: 'actions',
        label: 'Open the main facility',
        keywords: ['location', 'site', 'hours', 'rooms'],
        icon: 'building-2',
        perform: openFirst,
      },
      {
        id: 'admin.facilities.inactive',
        group: 'actions',
        label: 'Show inactive facilities',
        keywords: ['closed', 'retired location'],
        icon: 'eye',
        perform: () => setShowInactive(true),
      },
    ],
    [openFirst]
  );

  const rows = facilities.data?.data ?? [];
  const visible = showInactive ? rows : rows.filter((facility) => facility.status === 'ACTIVE');
  const selected =
    openId === 'first' ? (visible[0] ?? null) : (visible.find((f) => f.id === openId) ?? null);

  return (
    <AppShell
      title="Facilities"
      description="Where the practice works: billing attributes, opening hours and rooms."
      breadcrumb={adminBreadcrumb('Facilities')}
      actions={
        <>
          <Switch
            label="Show inactive"
            checked={showInactive}
            onChange={() => setShowInactive((value) => !value)}
          />
          <Button variant="primary" iconLeft="plus" onClick={openFirst}>
            Add a facility
          </Button>
        </>
      }
    >
      <ScreenCommands commands={commands} />

      <AsyncBoundary
        state={facilities}
        subject="facilities"
        isEmpty={isEmptyList}
        loadingVariant="cards"
        loadingRows={3}
        empty={{
          title: 'No facilities yet',
          message:
            'A facility is the physical place a visit happens. Add the practice itself first; rooms and opening hours come with it.',
          icon: 'building-2',
          action: (
            <Button variant="primary" onClick={openFirst}>
              Add a facility
            </Button>
          ),
        }}
      >
        {() => (
          <ul className="or-cardgrid">
            {visible.map((facility) => (
              <li key={facility.id}>
                <Card className="or-facility">
                  <div className="or-facility__head">
                    <h2 className="or-h3">{facility.name}</h2>
                    <Badge tone={facility.status === 'ACTIVE' ? 'success' : 'neutral'}>
                      {facility.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>

                  <p className="or-small">
                    {facility.addressLine}, {facility.city}, {facility.state} {facility.postalCode}
                  </p>

                  <div className="or-cell-chips">
                    {facility.isPrimary ? <Tag>Primary</Tag> : null}
                    <Tag mono>POS {facility.posCode}</Tag>
                    <Tag>{facility.posLabel}</Tag>
                    <Tag>{formatCount(facility.rooms.length, 'room')}</Tag>
                    <Tag>{hoursSummary(facility)}</Tag>
                  </div>

                  <Button variant="secondary" size="sm" onClick={() => setOpenId(facility.id)}>
                    Edit {facility.name}
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </AsyncBoundary>

      <Drawer
        open={selected !== null}
        title={selected?.name ?? ''}
        description="Billing attributes feed claims, hours feed the slot engine, rooms feed the Flow Board."
        width={720}
        onClose={() => setOpenId(null)}
        meta={
          selected ? (
            <Badge tone={selected.status === 'ACTIVE' ? 'success' : 'neutral'}>
              {selected.status === 'ACTIVE' ? 'Active' : 'Inactive'}
            </Badge>
          ) : null
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpenId(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setOpenId(null)}>
              Save facility
            </Button>
          </>
        }
      >
        {selected ? (
          <div className="or-stack">
            <Card tone="bone" title="Identity and billing">
              <div className="or-formgrid">
                <Input label="Facility name" defaultValue={selected.name} />
                <Input label="Phone" defaultValue={selected.phone} />
                <Select
                  label="Place of service"
                  options={[
                    { value: '11', label: '11 - Office' },
                    { value: '02', label: '02 - Telehealth' },
                    { value: '19', label: '19 - Off-campus outpatient' },
                  ]}
                  defaultValue={selected.posCode}
                />
                <Input label="Facility NPI" defaultValue={selected.npi} mono />
                <Input label="Tax id" defaultValue={selected.taxId} mono />
                <Input label="Street" defaultValue={selected.addressLine} />
              </div>
            </Card>

            <Card tone="bone" title="Opening hours">
              <p className="or-small">
                The slot engine offers appointments inside these hours only. Closed days show no
                slots at all rather than empty ones.
              </p>
              <Table
                caption={`Opening hours at ${selected.name}`}
                columns={HOURS_COLUMNS}
                rows={selected.hours.map((entry) => ({
                  id: entry.day,
                  day: entry.day,
                  opens: entry.opens ?? 'Closed',
                  closes: entry.closes ?? 'Closed',
                }))}
              />
            </Card>

            <Card tone="bone" title="Rooms">
              {selected.rooms.length === 0 ? (
                <p className="or-body">
                  No rooms yet. The Flow Board needs at least one room before it can show where a
                  patient is.
                </p>
              ) : (
                <div className="or-cell-chips">
                  {selected.rooms.map((room) => (
                    <Tag key={room}>{room}</Tag>
                  ))}
                </div>
              )}
            </Card>

            <DetailList
              columns={2}
              items={[
                { label: 'Providers working here', value: String(selected.providerCount) },
                {
                  label: 'Bookable minutes a week',
                  value: selected.weeklyBookableMinutes.toLocaleString('en-US'),
                },
              ]}
            />
          </div>
        ) : null}
      </Drawer>
    </AppShell>
  );
}
