'use client';

import { Badge, Button, Card, Input, Select, Switch, Table, Tag } from '@openrunic/ui';
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import {
  adminArea,
  adminBreadcrumb,
  DetailList,
  Drawer,
  pluralKey,
  translateColumns,
} from '@/components/admin';
import type { AdminColumn } from '@/components/admin';
import type { Command } from '@/components/command';
import { ScreenCommands } from '@/components/command';
import { AppShell } from '@/components/shell';
import { AsyncBoundary, isEmptyList } from '@/components/state';
import { useAdminClientOption, useFacilities } from '@/lib/api';
import type { AdminClient, Facility } from '@/lib/api';
import { searchWords } from '@/lib/i18n/counted';
import { useTranslator } from '@/lib/i18n/messages';

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

const HOURS_COLUMNS: readonly AdminColumn[] = [
  { key: 'day', headerKey: 'admin.facilities.hours.column.day' },
  { key: 'opens', headerKey: 'admin.facilities.hours.column.opens' },
  { key: 'closes', headerKey: 'admin.facilities.hours.column.closes' },
];

const ROOM_COUNT = {
  oneKey: 'admin.facilities.roomCount.one',
  otherKey: 'admin.facilities.roomCount.other',
};

/**
 * The place-of-service options are the CMS code set, not this screen's words.
 *
 * They stay as they are for the same reason a LOINC display does: the code
 * already carries a name, and a second one in the interface is a second answer
 * to a question the code has already answered. `Facility.posLabel` arrives from
 * the API the same way.
 */
const PLACE_OF_SERVICE = [
  { value: '11', label: '11 - Office' },
  { value: '02', label: '02 - Telehealth' },
  { value: '19', label: '19 - Off-campus outpatient' },
];

export function FacilitiesScreen({ client }: Readonly<FacilitiesScreenProps>): ReactElement {
  const t = useTranslator();
  const options = useAdminClientOption(client);
  const facilities = useFacilities(options);

  const [openId, setOpenId] = useState<string | null>(null);
  /* Inactive facilities are hidden by default and never deleted: a claim from
     2024 still has to resolve the place it happened. */
  const [showInactive, setShowInactive] = useState(false);

  const openFirst = useCallback(() => {
    setOpenId((current) => current ?? 'first');
  }, []);

  const hoursSummary = (facility: Facility): string => {
    const open = facility.hours.filter((entry) => entry.opens !== null);
    if (open.length === 0) return t('admin.facilities.hours.closedAllWeek');
    return t('admin.facilities.hours.daysAWeek', { count: open.length });
  };

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'admin.facilities.open',
        group: 'actions',
        label: t('admin.facilities.command.open'),
        keywords: searchWords(t('admin.facilities.command.open.keywords')),
        icon: 'building-2',
        perform: openFirst,
      },
      {
        id: 'admin.facilities.inactive',
        group: 'actions',
        label: t('admin.facilities.command.inactive'),
        keywords: searchWords(t('admin.facilities.command.inactive.keywords')),
        icon: 'eye',
        perform: () => setShowInactive(true),
      },
    ],
    [openFirst, t]
  );

  const rows = facilities.data?.data ?? [];
  const visible = showInactive ? rows : rows.filter((facility) => facility.status === 'ACTIVE');
  const selected =
    openId === 'first' ? (visible[0] ?? null) : (visible.find((f) => f.id === openId) ?? null);

  const statusLabel = (facility: Facility) =>
    facility.status === 'ACTIVE'
      ? t('admin.facilities.status.active')
      : t('admin.facilities.status.inactive');

  return (
    <AppShell
      title={t(adminArea('facilities').labelKey)}
      description={t('admin.facilities.description')}
      breadcrumb={adminBreadcrumb(t, 'facilities')}
      actions={
        <>
          <Switch
            label={t('admin.facilities.showInactive')}
            checked={showInactive}
            onChange={() => setShowInactive((value) => !value)}
          />
          <Button variant="primary" iconLeft="plus" onClick={openFirst}>
            {t('admin.facilities.add')}
          </Button>
        </>
      }
    >
      <ScreenCommands commands={commands} />

      <AsyncBoundary
        state={facilities}
        subject={t('admin.facilities.subject')}
        isEmpty={isEmptyList}
        loadingVariant="cards"
        loadingRows={3}
        empty={{
          title: t('admin.facilities.empty.title'),
          message: t('admin.facilities.empty.message'),
          icon: 'building-2',
          action: (
            <Button variant="primary" onClick={openFirst}>
              {t('admin.facilities.add')}
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
                      {statusLabel(facility)}
                    </Badge>
                  </div>

                  <p className="or-small">
                    {facility.addressLine}, {facility.city}, {facility.state} {facility.postalCode}
                  </p>

                  <div className="or-cell-chips">
                    {facility.isPrimary ? <Tag>{t('admin.facilities.primary')}</Tag> : null}
                    <Tag mono>{t('admin.facilities.pos', { code: facility.posCode })}</Tag>
                    <Tag>{facility.posLabel}</Tag>
                    <Tag>
                      {t(pluralKey(ROOM_COUNT, facility.rooms.length, t.locale), {
                        count: facility.rooms.length,
                      })}
                    </Tag>
                    <Tag>{hoursSummary(facility)}</Tag>
                  </div>

                  <Button variant="secondary" size="sm" onClick={() => setOpenId(facility.id)}>
                    {t('admin.facilities.edit', { name: facility.name })}
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
        description={t('admin.facilities.drawer.description')}
        width={720}
        onClose={() => setOpenId(null)}
        meta={
          selected ? (
            <Badge tone={selected.status === 'ACTIVE' ? 'success' : 'neutral'}>
              {statusLabel(selected)}
            </Badge>
          ) : null
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpenId(null)}>
              {t('admin.action.cancel')}
            </Button>
            <Button variant="primary" onClick={() => setOpenId(null)}>
              {t('admin.facilities.save')}
            </Button>
          </>
        }
      >
        {selected ? (
          /* Cards in here pass headingLevel={3}: the drawer's own title is the
             h2 above them, so the Card default of 2 would nest an h2 in an h2
             and drop a level out of the outline. */
          <div className="or-stack">
            <Card tone="bone" headingLevel={3} title={t('admin.facilities.identity.title')}>
              <div className="or-formgrid">
                <Input label={t('admin.facilities.field.name')} defaultValue={selected.name} />
                <Input label={t('admin.facilities.field.phone')} defaultValue={selected.phone} />
                <Select
                  label={t('admin.facilities.field.placeOfService')}
                  options={PLACE_OF_SERVICE}
                  defaultValue={selected.posCode}
                />
                <Input label={t('admin.facilities.field.npi')} defaultValue={selected.npi} mono />
                <Input
                  label={t('admin.facilities.field.taxId')}
                  defaultValue={selected.taxId}
                  mono
                />
                <Input
                  label={t('admin.facilities.field.street')}
                  defaultValue={selected.addressLine}
                />
              </div>
            </Card>

            <Card tone="bone" headingLevel={3} title={t('admin.facilities.hours.title')}>
              <p className="or-small">{t('admin.facilities.hours.explanation')}</p>
              <Table
                caption={t('admin.facilities.hours.caption', { name: selected.name })}
                columns={translateColumns(t, HOURS_COLUMNS)}
                rows={selected.hours.map((entry) => ({
                  id: entry.day,
                  /* The day name arrives from the API written out, the same way
                     the slot engine reads the times beside it. */
                  day: entry.day,
                  opens: entry.opens ?? t('admin.facilities.hours.closed'),
                  closes: entry.closes ?? t('admin.facilities.hours.closed'),
                }))}
              />
            </Card>

            <Card tone="bone" headingLevel={3} title={t('admin.facilities.rooms.title')}>
              {selected.rooms.length === 0 ? (
                <p className="or-body">{t('admin.facilities.rooms.empty')}</p>
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
                {
                  label: t('admin.facilities.detail.providers'),
                  value: String(selected.providerCount),
                },
                {
                  label: t('admin.facilities.detail.bookableMinutes'),
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
