import { ok } from '@openrunic/types';

import type { AdapterResult } from '../contracts/core.js';
import { SMS_CONTRACT } from '../contracts/sms.js';
import type {
  FetchInboundMessagesInput,
  GetMessageStatusInput,
  InboundMessageBatch,
  MessageReceipt,
  MessageStatus,
  MessageStatusReport,
  SendMessageInput,
  SmsAdapter,
  SmsConfig,
} from '../contracts/sms.js';
import type { MockAdapterOptions } from './harness.js';
import { MockAdapterBase } from './harness.js';
import { randomInt } from './random.js';

/**
 * An in-process text-messaging vendor.
 *
 * Reminders and recalls are sent in bulk, which means the interesting failures
 * are per-recipient rather than per-call: one wrong number in a thousand, one
 * patient who replied `STOP` last week. The mock makes both reachable - a
 * destination ending in {@link UNDELIVERABLE_SUFFIX} never delivers, and the
 * inbound tray always contains one opt-out - so the campaign runner can be
 * tested on the messages it must not send.
 */

const DEFAULT_FETCH_LIMIT = 100;

/** Characters per billable segment for a plain-text message. */
const SEGMENT_LENGTH = 153;

/** Destinations ending in these digits are refused by the carrier in the mock. */
const UNDELIVERABLE_SUFFIX = '0000';

interface MessageState {
  status: MessageStatus;
  readonly undeliverable: boolean;
}

interface InboundMessage {
  readonly messageRef: string;
  readonly fromNumber: string;
  readonly receivedAt: string;
  readonly body: string;
  readonly keyword?: string;
}

/** The deterministic text-messaging mock. */
export class MockSmsAdapter extends MockAdapterBase<SmsConfig> implements SmsAdapter {
  private readonly messages = new Map<string, MessageState>();
  private readonly inbound: InboundMessage[] = [];
  private inboundSeeded = false;

  constructor(options: MockAdapterOptions = {}) {
    super(SMS_CONTRACT, options);
  }

  sendMessage(input: SendMessageInput): Promise<AdapterResult<MessageReceipt>> {
    return this.runOperation<MessageReceipt>('sendMessage', [input.idempotencyKey], () => {
      const messageRef = this.mintRef('msg');
      this.messages.set(messageRef, {
        status: 'queued',
        undeliverable: input.toNumber.endsWith(UNDELIVERABLE_SUFFIX),
      });
      return ok({
        messageRef,
        status: 'queued',
        segments: Math.ceil(input.body.length / SEGMENT_LENGTH),
        queuedAt: this.nowIso(),
      });
    });
  }

  getMessageStatus(input: GetMessageStatusInput): Promise<AdapterResult<MessageStatusReport>> {
    return this.runOperation<MessageStatusReport>('getMessageStatus', [input.messageRef], () => {
      const state = this.messages.get(input.messageRef);
      if (state === undefined) {
        return this.reject('getMessageStatus', 'unknown_reference');
      }
      state.status = this.advance(state);
      return ok({
        messageRef: input.messageRef,
        status: state.status,
        updatedAt: this.nowIso(),
        ...(state.status === 'undeliverable' ? { failureCode: 'unreachable_destination' } : {}),
      });
    });
  }

  fetchInboundMessages(
    input: FetchInboundMessagesInput
  ): Promise<AdapterResult<InboundMessageBatch>> {
    const gate = this.featureGate('fetchInboundMessages', 'inbound');
    if (gate !== undefined) {
      return Promise.resolve(gate);
    }
    this.seedInbound();
    const since = Date.parse(input.since);
    const pending = this.inbound
      .filter((message) => Date.parse(message.receivedAt) >= since)
      .slice(0, input.limit ?? DEFAULT_FETCH_LIMIT);
    return this.runOperation<InboundMessageBatch>(
      'fetchInboundMessages',
      pending.map((message) => message.messageRef),
      () => ok({ messages: pending })
    );
  }

  private advance(state: MessageState): MessageStatus {
    if (state.status === 'queued') {
      return state.undeliverable ? 'undeliverable' : 'sent';
    }
    if (state.status === 'sent') {
      return 'delivered';
    }
    return state.status;
  }

  /**
   * Seeds the inbound tray once: one opt-out and one ordinary reply. Both are
   * needed, because the opt-out proves the consent path and the ordinary reply
   * proves that a message with no recognised keyword still reaches a human.
   */
  private seedInbound(): void {
    if (this.inboundSeeded) {
      return;
    }
    this.inboundSeeded = true;
    const fromNumber = `+1555010${String(randomInt(this.nextRandom, 9000) + 1000)}`;
    this.inbound.push(
      {
        messageRef: this.mintRef('inmsg'),
        fromNumber,
        receivedAt: this.nowIso(),
        body: 'STOP',
        keyword: 'stop',
      },
      {
        messageRef: this.mintRef('inmsg'),
        fromNumber,
        receivedAt: this.nowIso(),
        body: 'Can I move my appointment to Thursday?',
      }
    );
  }
}
