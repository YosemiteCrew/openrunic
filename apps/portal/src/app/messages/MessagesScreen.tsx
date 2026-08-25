'use client';

/**
 * Messages: the thread list, the conversation, and the box to reply in.
 *
 * Two things here are not negotiable. The "not for emergencies" notice sits ABOVE the
 * compose box, because a notice below it is read after the message has already been
 * written and often after it has been sent. And a failed send keeps the draft on the page:
 * losing what someone typed about their own health, to a network blip, is not acceptable.
 */

import { useCallback, useState } from 'react';
import { Badge, Button, Card, EmptyState } from '@openrunic/ui';
import { AsyncBoundary } from '@/components/AsyncBoundary';
import { Notice } from '@/components/Notice';
import { PageHeader } from '@/components/PageHeader';
import { getPortalApi } from '@/lib/api';
import type { MessageThread, PortalApi } from '@/lib/api/types';
import { useTranslator } from '@/lib/i18n/messages';
import { formatDateTime } from '@/lib/format';
import { useAction, useAsync } from '@/lib/useAsync';

export interface MessagesScreenProps {
  api?: PortalApi;
}

interface ConversationProps {
  thread: MessageThread;
  api: PortalApi;
}

function Conversation({ thread, api }: Readonly<ConversationProps>) {
  const t = useTranslator();
  const [draft, setDraft] = useState('');
  const send = useAction((body: string) => api.sendMessage(thread.id, body));

  const submit = async () => {
    const sent = await send.run(draft);
    // Only a confirmed send clears the box. A failure leaves every word where it was.
    if (sent) setDraft('');
  };

  return (
    <Card overline="Conversation" title={thread.subject}>
      <ul className="portal-conversation">
        {thread.messages.map((message) => (
          <li className={`portal-message portal-message--${message.author}`} key={message.id}>
            <p className="portal-message__who">
              {message.authorName}, {formatDateTime(t, message.sentAt)}
            </p>
            <p className="portal-message__body">{message.body}</p>
          </li>
        ))}
      </ul>

      {/* Above the box, always. */}
      <Notice title="Not for emergencies">
        Replies can take a few working days. If you need help now, call the practice. For a medical
        emergency, call the emergency services on your local number.
      </Notice>

      <div className="portal-compose">
        <label className="portal-field-label" htmlFor="compose-body">
          Your message
        </label>
        <textarea
          className="portal-textarea"
          id="compose-body"
          name="body"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Write your reply here."
        />

        <div className="portal-actions">
          <Button iconLeft="send" disabled={draft.trim() === ''} onClick={submit}>
            {send.status === 'pending' ? 'Sending' : 'Send message'}
          </Button>
        </div>

        {send.status === 'done' ? (
          <output className="portal-record__meta">
            Message sent. It is at the bottom of the conversation above.
          </output>
        ) : null}

        {send.status === 'failed' ? (
          <p className="portal-record__meta" role="alert">
            Your message did not send, and your draft is still in the box. Check your connection,
            then send it again.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

export function MessagesScreen({ api = getPortalApi() }: Readonly<MessagesScreenProps>) {
  const t = useTranslator();
  const load = useCallback(() => api.getThreads(), [api]);
  const { state, reload } = useAsync(load);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        overline="Your care team"
        title="Messages"
        lede="Read what your care team has written and reply. This is not the way to get help quickly."
      />

      <AsyncBoundary state={state} what="your messages" onRetry={reload}>
        {(threads) => {
          /* Falling back to the first thread rather than syncing state in an effect: the
             selection is derived from the data, so it never needs a second render to
             settle and can never point at a thread that is no longer there. An empty list
             therefore has no active thread, which is exactly the empty state. */
          const active = threads.find((thread) => thread.id === selectedId) ?? threads[0];

          if (!active) {
            return (
              <EmptyState
                icon="inbox"
                title="You have no messages."
                message="When your care team writes to you, the conversation appears here."
              />
            );
          }

          return (
            <div className="portal-messages">
              <section className="portal-section" aria-label="Conversations">
                <h2 className="or-h3 portal-section__heading">Conversations</h2>
                <ul className="portal-threads">
                  {threads.map((thread) => (
                    <li key={thread.id}>
                      <button
                        className="portal-thread-button"
                        type="button"
                        aria-pressed={active.id === thread.id}
                        onClick={() => setSelectedId(thread.id)}
                      >
                        <span className="portal-thread-button__subject">
                          {thread.subject}
                          {thread.unread ? <Badge tone="accent">Unread</Badge> : null}
                        </span>
                        <span className="portal-thread-button__meta">
                          {thread.correspondent}, {formatDateTime(t, thread.lastMessageAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>

              {/* Keyed by thread so switching conversations starts a fresh draft rather
                  than carrying half a sentence over to a different reader. */}
              <Conversation api={api} key={active.id} thread={active} />
            </div>
          );
        }}
      </AsyncBoundary>
    </>
  );
}
