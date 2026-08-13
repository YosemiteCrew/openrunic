import { z } from 'zod';

import type { Adapter, AdapterResult, CapabilityContract } from './core.js';
import { adapterConfigBase, isoDateTime, opaqueRef } from './core.js';

/**
 * The text-messaging seam: appointment reminders, recalls, balance links and
 * whatever the patient texts back.
 *
 * Consent and quiet hours are deliberately not enforced here. They are practice
 * policy with a legal shape, they need the patient record to evaluate, and a
 * seam that enforced them would let a vendor swap change who may be texted at
 * seven in the morning. The owning service decides; the seam records the
 * consent reference that decision was made against.
 */

/** Semver of this seam. */
export const SMS_CONTRACT_VERSION = '1.0.0';

/** Delivery state of an outbound message. `undeliverable` means the carrier refused the destination outright. */
export const messageStatus = z.enum(['queued', 'sent', 'delivered', 'failed', 'undeliverable']);

/** Inferred shape of {@link messageStatus}. */
export type MessageStatus = z.infer<typeof messageStatus>;

const sendMessageInput = z.strictObject({
  idempotencyKey: z.string().min(8).max(128),
  /** Destination in E.164. */
  toNumber: z.string().min(4).max(20),
  body: z.string().min(1).max(1600),
  /** The consent record the owning service checked before calling. */
  consentRef: opaqueRef,
  /** Template the body was rendered from, for reporting and for carrier registration. */
  templateCode: z.string().min(1).max(64).optional(),
});

const messageReceipt = z.strictObject({
  messageRef: opaqueRef,
  status: messageStatus,
  /** Billable segments; surfaced because a template edit that adds one doubles a campaign's cost. */
  segments: z.int().positive(),
  queuedAt: isoDateTime,
});

const getMessageStatusInput = z.strictObject({ messageRef: opaqueRef });

const messageStatusReport = z.strictObject({
  messageRef: opaqueRef,
  status: messageStatus,
  updatedAt: isoDateTime,
  /** Present on `failed` and `undeliverable`; coded, so an opt-out can be told from a wrong number. */
  failureCode: z.string().min(1).max(64).optional(),
});

const fetchInboundMessagesInput = z.strictObject({
  since: isoDateTime,
  limit: z.int().positive().max(500).optional(),
});

const inboundMessageBatch = z.strictObject({
  messages: z
    .array(
      z.strictObject({
        messageRef: opaqueRef,
        fromNumber: z.string().min(1).max(20),
        receivedAt: isoDateTime,
        body: z.string().max(1600),
        /** Recognised control word such as `stop`, lifted by the vendor so opt-outs are never missed. */
        keyword: z.string().min(1).max(32).optional(),
      })
    )
    .readonly(),
});

/** Configuration for a text-messaging adapter. */
export const smsConfig = z.strictObject({
  ...adapterConfigBase.shape,
  /** Registered sender the practice messages from. */
  senderId: z.string().min(1).max(32),
  /** Where inbound replies arrive, when different from the sender. */
  inboundNumber: z.string().min(4).max(20).optional(),
});

/** Inferred shape of {@link smsConfig}. */
export type SmsConfig = z.infer<typeof smsConfig>;

/** Optional features a text-messaging vendor may implement. */
export const SMS_FEATURES = ['inbound', 'delivery_receipts', 'unicode', 'shortcode'] as const;

/** Input of `sendMessage`. */
export type SendMessageInput = z.infer<typeof sendMessageInput>;
/** Output of `sendMessage`. */
export type MessageReceipt = z.infer<typeof messageReceipt>;
/** Input of `getMessageStatus`. */
export type GetMessageStatusInput = z.infer<typeof getMessageStatusInput>;
/** Output of `getMessageStatus`. */
export type MessageStatusReport = z.infer<typeof messageStatusReport>;
/** Input of `fetchInboundMessages`. */
export type FetchInboundMessagesInput = z.infer<typeof fetchInboundMessagesInput>;
/** Output of `fetchInboundMessages`. */
export type InboundMessageBatch = z.infer<typeof inboundMessageBatch>;

/** The text-messaging seam as data. */
export const SMS_CONTRACT = {
  capability: 'sms',
  contractVersion: SMS_CONTRACT_VERSION,
  config: smsConfig,
  features: SMS_FEATURES,
  operations: {
    sendMessage: { input: sendMessageInput, output: messageReceipt },
    getMessageStatus: { input: getMessageStatusInput, output: messageStatusReport },
    fetchInboundMessages: { input: fetchInboundMessagesInput, output: inboundMessageBatch },
  },
} as const satisfies CapabilityContract;

/** Everything a text-messaging vendor must implement. */
export interface SmsAdapter extends Adapter<SmsConfig> {
  sendMessage(input: SendMessageInput): Promise<AdapterResult<MessageReceipt>>;
  getMessageStatus(input: GetMessageStatusInput): Promise<AdapterResult<MessageStatusReport>>;
  /** Requires the `inbound` feature. */
  fetchInboundMessages(
    input: FetchInboundMessagesInput
  ): Promise<AdapterResult<InboundMessageBatch>>;
}
