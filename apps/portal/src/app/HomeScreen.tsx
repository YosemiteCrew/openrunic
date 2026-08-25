'use client';

/**
 * Home: what needs the reader's attention, and nothing louder than it needs to be.
 *
 * Nothing on this screen uses danger red. An outstanding balance and a form still to fill
 * in are ordinary facts about an account, not emergencies, and dressing them in alarm
 * colours would teach a patient to dread opening their own portal. Red is kept for a
 * clinical value outside its range, where it means something.
 */

import { useCallback } from 'react';
import { Badge, Button, Card, EmptyState } from '@openrunic/ui';
import { counted } from '@openrunic/i18n';
import type { CountedMessage, Translator } from '@openrunic/i18n';

import { AppointmentFacts } from '@/components/appointments/AppointmentFacts';
import { AsyncBoundary } from '@/components/AsyncBoundary';
import { Money } from '@/components/Money';
import { PageHeader } from '@/components/PageHeader';
import { getPortalApi } from '@/lib/api';
import type { Appointment, HomeSummary, PortalApi } from '@/lib/api/types';
import { useTranslator } from '@/lib/i18n/messages';
import { formatDate } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';

/** Both forms, so the reader's own rules pick between them rather than `n === 1`. */
const UNREAD: CountedMessage = {
  oneKey: 'portal.home.unread.one',
  otherKey: 'portal.home.unread.other',
};

export interface HomeScreenProps {
  /** Injected in tests; defaults to the app's own data source. */
  api?: PortalApi;
}

/**
 * The balance sentence. A missing due date is a fact to state, not a blank to
 * paper over.
 *
 * Two whole messages rather than a clause joined to a shared tail. The tail was
 * appended in code, which fixes English word order: a language that puts the
 * instruction first cannot say so by translating fragments.
 */
function dueSentence(t: Translator, dueOn: string | null): string {
  return dueOn === null
    ? t('portal.home.balance.dueUnknown')
    : t('portal.home.balance.dueBy', { date: formatDate(t, dueOn) });
}

/** Home is empty only when all four of its strands are: otherwise a card has something. */
function hasNothingToShow(home: HomeSummary): boolean {
  return (
    home.nextAppointment === null &&
    home.balance.outstanding.amountMinor === 0 &&
    home.unreadMessages === 0 &&
    home.actionItems.length === 0
  );
}

function NextAppointmentCard({ appointment }: Readonly<{ appointment: Appointment | null }>) {
  const t = useTranslator();
  if (!appointment) {
    return (
      <Card
        overline={t('portal.home.appointment.overline')}
        title={t('portal.home.appointment.none')}
      >
        <p className="or-body">{t('portal.home.appointment.noneMessage')}</p>
        <div className="portal-actions">
          <Button href="/appointments" variant="secondary" iconLeft="calendar-plus">
            {t('portal.home.appointment.request')}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card overline={t('portal.home.appointment.overline')} title={appointment.reason}>
      <AppointmentFacts
        t={t}
        appointment={appointment}
        videoLocation={t('portal.home.appointment.videoLocation')}
      />
      <div className="portal-actions">
        {appointment.joinUrl ? (
          <Button href={appointment.joinUrl} iconLeft="video">
            Join the video call
          </Button>
        ) : null}
        {appointment.directionsUrl ? (
          <Button href={appointment.directionsUrl} iconLeft="map-pin">
            Get directions
          </Button>
        ) : null}
        <Button href="/appointments" variant="secondary">
          See all appointments
        </Button>
      </div>
    </Card>
  );
}

export function HomeScreen({ api = getPortalApi() }: Readonly<HomeScreenProps>) {
  const t = useTranslator();
  const load = useCallback(() => api.getHome(), [api]);
  const { state, reload } = useAsync(load);

  return (
    <>
      <PageHeader
        overline={t('portal.home.overline')}
        title={t('portal.home.title')}
        lede={t('portal.home.lede')}
      />

      <AsyncBoundary
        state={state}
        what={t('portal.home.subject')}
        onRetry={reload}
        isEmpty={hasNothingToShow}
        empty={
          <EmptyState
            icon="circle-check"
            title={t('portal.home.empty.title')}
            message={t('portal.home.empty.message')}
          />
        }
      >
        {(home) => (
          <div className="portal-stack">
            <NextAppointmentCard appointment={home.nextAppointment} />

            <div className="portal-grid">
              <Card
                overline={t('portal.home.balance.overline')}
                title={t('portal.home.balance.title')}
              >
                <p className="portal-figure">
                  <Money value={home.balance.outstanding} showCode />
                </p>
                <p className="or-body">
                  {home.balance.outstanding.amountMinor === 0
                    ? t('portal.home.balance.nothing')
                    : dueSentence(t, home.balance.dueOn)}
                </p>
                <div className="portal-actions">
                  <Button
                    href="/bills"
                    variant={home.balance.outstanding.amountMinor === 0 ? 'secondary' : 'primary'}
                    iconLeft="credit-card"
                  >
                    {home.balance.outstanding.amountMinor === 0
                      ? t('portal.home.balance.seeBills')
                      : t('portal.home.balance.pay')}
                  </Button>
                </div>
              </Card>

              <Card
                overline={t('portal.home.messages.overline')}
                title={t('portal.home.messages.title')}
              >
                <p className="portal-figure">{home.unreadMessages}</p>
                <p className="or-body">{counted(t, UNREAD, home.unreadMessages)}</p>
                <div className="portal-actions">
                  <Button href="/messages" variant="secondary" iconLeft="message-square">
                    {t('portal.home.messages.open')}
                  </Button>
                </div>
              </Card>
            </div>

            <Card
              overline={t('portal.home.actions.overline')}
              title={t('portal.home.actions.title')}
            >
              {home.actionItems.length === 0 ? (
                <p className="or-body">{t('portal.home.actions.none')}</p>
              ) : (
                <ul className="portal-inline-list">
                  {home.actionItems.map((item) => (
                    <li key={item.id}>
                      <p className="portal-record__head">
                        <span className="portal-term__clinical">{item.title}</span>
                        <Badge tone="neutral">{t('portal.home.actions.badge')}</Badge>
                      </p>
                      <p className="portal-record__meta">{item.detail}</p>
                      <div className="portal-actions">
                        <Button href={item.href} variant="secondary" iconLeft="clipboard-list">
                          {item.actionLabel}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </AsyncBoundary>
    </>
  );
}
