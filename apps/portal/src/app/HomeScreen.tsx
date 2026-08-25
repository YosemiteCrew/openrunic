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

/** The balance sentence. A missing due date is a fact to state, not a blank to paper over. */
function dueSentence(t: Translator, dueOn: string | null): string {
  const when =
    dueOn === null ? 'Ask the practice when this is due.' : `Due by ${formatDate(t, dueOn)}.`;
  return `${when} You can pay online, or ask the practice about paying in instalments.`;
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
      <Card overline="Next appointment" title="You have no appointments booked">
        <p className="or-body">Ask the practice for a slot and they will confirm it by message.</p>
        <div className="portal-actions">
          <Button href="/appointments" variant="secondary" iconLeft="calendar-plus">
            Request an appointment
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card overline="Next appointment" title={appointment.reason}>
      <AppointmentFacts
        t={t}
        appointment={appointment}
        videoLocation="A video call. The link opens in this browser."
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
        overline="Your care"
        title="Home"
        lede="What needs your attention today. Everything else is in the sections around this page."
      />

      <AsyncBoundary
        state={state}
        what="your home summary"
        onRetry={reload}
        isEmpty={hasNothingToShow}
        empty={
          <EmptyState
            icon="circle-check"
            title="Nothing needs your attention."
            message="Your appointments, health record, messages and bills are all still here whenever you want them."
          />
        }
      >
        {(home) => (
          <div className="portal-stack">
            <NextAppointmentCard appointment={home.nextAppointment} />

            <div className="portal-grid">
              <Card overline="Balance" title="What you owe">
                <p className="portal-figure">
                  <Money value={home.balance.outstanding} showCode />
                </p>
                <p className="or-body">
                  {home.balance.outstanding.amountMinor === 0
                    ? 'There is nothing to pay.'
                    : dueSentence(t, home.balance.dueOn)}
                </p>
                <div className="portal-actions">
                  <Button
                    href="/bills"
                    variant={home.balance.outstanding.amountMinor === 0 ? 'secondary' : 'primary'}
                    iconLeft="credit-card"
                  >
                    {home.balance.outstanding.amountMinor === 0 ? 'See your bills' : 'Pay a bill'}
                  </Button>
                </div>
              </Card>

              <Card overline="Messages" title="From your care team">
                <p className="portal-figure">{home.unreadMessages}</p>
                <p className="or-body">{counted(t, UNREAD, home.unreadMessages)}</p>
                <div className="portal-actions">
                  <Button href="/messages" variant="secondary" iconLeft="message-square">
                    Open messages
                  </Button>
                </div>
              </Card>
            </div>

            <Card overline="Action needed" title="Things only you can do">
              {home.actionItems.length === 0 ? (
                <p className="or-body">There is nothing waiting on you.</p>
              ) : (
                <ul className="portal-inline-list">
                  {home.actionItems.map((item) => (
                    <li key={item.id}>
                      <p className="portal-record__head">
                        <span className="portal-term__clinical">{item.title}</span>
                        <Badge tone="neutral">To do</Badge>
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
