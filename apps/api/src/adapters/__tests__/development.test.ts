import { describe, expect, it } from 'vitest';

import { createDevelopmentAdapters } from '../development.js';

/**
 * The partner seams a development run gets for free.
 *
 * The properties below are worth pinning, and none is about coverage.
 *
 * Each adapter is initialised at construction, because one that is not answers
 * `misconfigured` to every call and surfaces as a 502 from a route that looks
 * like it should work. `createApp` is synchronous so the module cannot await
 * that init; it relies on this particular adapter settling on the next
 * microtask, having done no I/O. A test is the only thing that holds anybody to
 * that, and it is the assumption that breaks first if somebody swaps either
 * mock for a vendor whose init reaches the network.
 *
 * And the join links point at `.invalid`, a TLD the DNS root can never resolve.
 * That is what makes a fixture link that escapes into a ticket, a log or a
 * screenshot go nowhere rather than somewhere.
 */

/** One microtask, which is all the documented init is allowed to need. */
const settle = (): Promise<void> => Promise.resolve();

describe('createDevelopmentAdapters', () => {
  it('registers a telehealth adapter under the video capability', () => {
    const registry = createDevelopmentAdapters();
    const resolved = registry.resolve('video');

    expect(resolved.ok).toBe(true);
    expect(registry.descriptors().map((descriptor) => descriptor.capability)).toContain('video');
  });

  it('registers prescribing without controlled-substance enrolment', () => {
    const registry = createDevelopmentAdapters();

    expect(registry.resolve('erx').ok).toBe(true);
    expect(registry.entitledTo('erx', 'epcs')).toBe(false);
  });

  it('can transmit an ordinary prescription on the microtask after construction', async () => {
    const registry = createDevelopmentAdapters();
    const resolved = registry.resolve('erx');
    if (!resolved.ok) throw new Error('the development registry has no eRx adapter');

    await settle();

    const receipt = await resolved.value.transmitPrescription({
      prescriptionId: 'prescription-1',
      patientRef: 'patient-1',
      prescriberRef: 'prescriber-1',
      pharmacyRef: 'pharmacy-1',
      drugCode: '1049502',
      drugCodeSystem: 'http://www.nlm.nih.gov/research/umls/rxnorm',
      sigText: 'Take one tablet by mouth daily.',
      quantity: 30,
      quantityUnit: 'tablet',
      refills: 0,
      daysSupply: 30,
      dispenseAsWritten: false,
      writtenAt: '2026-09-03T09:30:00.000Z',
    });

    expect(receipt.ok).toBe(true);
  });

  it('is usable on the microtask after construction, without anybody awaiting init', async () => {
    const registry = createDevelopmentAdapters();
    const resolved = registry.resolve('video');
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    await settle();

    const room = await resolved.value.createVisitRoom({
      appointmentRef: 'appointment-1',
      scheduledStart: '2026-09-03T09:30:00.000Z',
      expectedMinutes: 20,
      waitingRoom: false,
    });

    /*
     * The assertion that matters is `ok`. An adapter whose init had not settled
     * would answer `misconfigured` here, which is the 502-with-no-explanation
     * the module's construction-time init exists to prevent.
     */
    expect(room.ok).toBe(true);
  });

  it('issues join links at a host that can never resolve', async () => {
    const registry = createDevelopmentAdapters();
    const resolved = registry.resolve('video');
    if (!resolved.ok) throw new Error('the development registry has no video adapter');

    await settle();

    const room = await resolved.value.createVisitRoom({
      appointmentRef: 'appointment-2',
      scheduledStart: '2026-09-03T09:30:00.000Z',
      expectedMinutes: 20,
      waitingRoom: false,
    });
    if (!room.ok) throw new Error('the development video adapter refused to open a room');

    /*
     * `.invalid` is reserved by RFC 2606 and guaranteed not to resolve, so a
     * link that leaks out of a fixture is inert. Asserted on the TLD rather
     * than the whole host, because which host the mock mints is its business
     * and this is the property the module promises.
     */
    expect(new URL(room.value.joinUrl).hostname.endsWith('.invalid')).toBe(true);
  });

  it('hands out an independent registry each call', () => {
    /*
     * `createApp` is called per test in this suite and per process in
     * development. A shared registry would leak one test's room state into the
     * next, which is the kind of coupling that shows up as an unrelated flake.
     */
    const first = createDevelopmentAdapters();
    const second = createDevelopmentAdapters();

    expect(first).not.toBe(second);
    expect(first.unregister('video')).toBe(true);
    expect(first.unregister('erx')).toBe(true);
    expect(second.resolve('video').ok).toBe(true);
    expect(second.resolve('erx').ok).toBe(true);
  });
});
