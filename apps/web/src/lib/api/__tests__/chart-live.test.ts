import { describe, expect, it, vi } from 'vitest';

import { createHttpClient, createMockClient, MOCK_DIRECTORY_USERS } from '@/lib/api';
import type { ClinicalNoteDto } from '@/lib/api';
import { contentHash, createHttpChartClient, createMockChartClient } from '@/lib/api/chart';
import { NOTE_SECTION_KEYS } from '@/lib/api/chart';
import type { NoteSectionKey } from '@/lib/api/chart';
import { MOCK_ENCOUNTERS, MOCK_NOTES } from '@/lib/api/mock/records';

/**
 * The chart against the routes the API actually serves.
 *
 * This file exists because of a specific defect: the live chart client used to
 * request `/patients/:id/chart` and `/encounters/:id/note`, and neither route
 * has ever existed. Every assertion below either names a real route or names
 * something the composed chart must not claim - most importantly that an
 * allergy list nobody has asked about reads as "not recorded" and never as
 * "none".
 */

/** A live chart client whose transport is the in-memory store, not a network. */
function liveChart() {
  return createHttpChartClient(createMockClient());
}

/** The first fixture visit, asserted once so no test below re-checks the index. */
const firstVisit = MOCK_ENCOUNTERS[0];
if (firstVisit === undefined) throw new Error('records.ts has no visits to read');

describe('the live chart summary', () => {
  it('reads the patient first, so an unknown id is absent rather than an empty chart', async () => {
    await expect(liveChart().summary.get('nobody')).rejects.toMatchObject({ status: 404 });
  });

  it('builds the visit list from encounters and the notes written against them', async () => {
    const chart = await liveChart().summary.get(firstVisit.patientId);

    const visit = chart.visits.find((row) => row.id === firstVisit.id);
    expect(visit).toBeDefined();
    expect(visit?.date).toBe(firstVisit.startedAt.slice(0, 10));
    expect(visit?.providerName).toBe('Ada Okafor');
    // The link target is the note, because that is what the encounter route
    // renders. A visit with no note has nothing to open.
    expect(visit?.encounterId).toBe(MOCK_NOTES[0]?.id);
    expect(visit?.noteState).toBe('SIGNED');
  });

  it('reports an allergy list nobody has asked about as not recorded, never as none', async () => {
    const chart = await liveChart().summary.get(firstVisit.patientId);

    // The distinction this type exists to protect: an empty list must never
    // read as "safe". There is no allergy mapping on the live path yet, and
    // saying so is the only honest answer.
    expect(chart.allergies.state).toBe('NOT_RECORDED');
    expect(chart.allergies.affirmedOn).toBeNull();
    expect(chart.allergies.entries).toEqual([]);
  });

  it('requests the routes the API serves and nothing it does not', async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        new Response(JSON.stringify(url.includes('?') ? { data: [], page: {} } : { id: 'p-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    );
    const chart = createHttpChartClient(
      createHttpClient({ baseUrl: 'http://api.test', fetchImpl })
    );

    await chart.summary.get('p-1');

    const urls = fetchImpl.mock.calls.map((call) => String(call[0]).replace('http://api.test', ''));
    expect(urls).toContain('/bff/v0/patients/p-1');
    expect(urls.some((url) => url.startsWith('/bff/v0/encounters?patientId=p-1'))).toBe(true);
    expect(urls.some((url) => url.startsWith('/bff/v0/notes?patientId=p-1'))).toBe(true);
    // The two routes that never existed.
    expect(urls.some((url) => url.includes('/chart'))).toBe(false);
    expect(urls.some((url) => url.endsWith('/note'))).toBe(false);
  });
});

describe('the live encounter note', () => {
  const signedNote = MOCK_NOTES.find((note) => note.state === 'SIGNED');
  const unsignedNote = MOCK_NOTES.find((note) => note.state === 'UNSIGNED');

  it('renders the four SOAP blocks in order, whatever order they were stored in', async () => {
    const note = await liveChart().notes.get(signedNote?.id ?? '');

    expect(note.sections.map((section) => section.key)).toEqual([
      'subjective',
      'objective',
      'assessment',
      'plan',
    ]);
    expect(note.sections[0]?.label).toBe('Subjective');
    expect(note.sections[3]?.text).toContain('lisinopril');
  });

  it('names the signer from the directory rather than from a fixture lookup', async () => {
    const note = await liveChart().notes.get(signedNote?.id ?? '');

    expect(note.signature).not.toBeNull();
    // Given name and family name off the `/bff/v0/users` row, plus the
    // credential that row carries. Nothing here is invented from the id.
    expect(note.signature?.signerName).toBe('Ada Okafor');
    expect(note.signature?.credential).toBe('MD');
  });

  /**
   * What the fingerprint actually is, asserted so that a wrong implementation
   * fails.
   *
   * The assertion this replaces was `signature.hash === contentHash(sections)`,
   * which held for any implementation whatsoever - a constant, the note id,
   * anything - because both sides were computed from the same value on the same
   * side. What the field claims is narrower and checkable: it is derived from
   * the note's text, from all of it, and from nothing else. So one note is
   * varied by its text and must move, and another is varied by everything
   * except its text and must not.
   */
  describe('the note fingerprint', () => {
    const base = MOCK_NOTES.find((row) => row.state === 'SIGNED');
    if (base === undefined) throw new Error('records.ts has no signed note to vary');

    /** Reads one note back through the live client, as the screen would. */
    async function fingerprintOf(note: ClinicalNoteDto): Promise<string | undefined> {
      const chart = createHttpChartClient(createMockClient({ notes: [note] }));
      return (await chart.notes.get(note.id)).signature?.fingerprint;
    }

    it('moves when the text moves', async () => {
      const edited = base.blocks.map((block) =>
        block.key === 'plan' ? { ...block, text: 'Recheck in two weeks.' } : block
      );

      expect(await fingerprintOf({ ...base, blocks: edited })).not.toBe(await fingerprintOf(base));
    });

    it('moves when a block far from the end moves, so it covers the whole note', async () => {
      const edited = base.blocks.map((block) =>
        block.key === 'subjective' ? { ...block, text: 'Reports no symptoms at all.' } : block
      );

      expect(await fingerprintOf({ ...base, blocks: edited })).not.toBe(await fingerprintOf(base));
    });

    it('stays put when everything except the text changes', async () => {
      // A different signer, a different title, a different signing instant. The
      // fingerprint describes the text, so none of these may disturb it.
      const restamped: ClinicalNoteDto = {
        ...base,
        title: 'Retitled after the fact',
        signedAt: '2026-07-01T08:00:00.000Z',
        signedById: MOCK_DIRECTORY_USERS[1]?.id ?? base.authorId,
      };

      expect(await fingerprintOf(restamped)).toBe(await fingerprintOf(base));
    });

    it('is unchanged when the same blocks come back in a different order', async () => {
      // The screen always renders subjective, objective, assessment, plan. A
      // fingerprint that moved because storage handed the blocks over in
      // another order would be describing the storage, not the note.
      const reversed = [...base.blocks].reverse();

      expect(await fingerprintOf({ ...base, blocks: reversed })).toBe(await fingerprintOf(base));
    });

    it('covers the text and the section it belongs to, and nothing else', async () => {
      /** The stored text of one block, or none when the note has no such block. */
      const textOf = (key: NoteSectionKey): string => {
        const block = base.blocks.find((candidate) => candidate.key === key);
        return typeof block?.text === 'string' ? block.text : '';
      };

      // Built here from the stored blocks and the order this module documents,
      // not from the sections the client just returned, so the expectation is
      // an independent statement rather than a restatement. The label and the
      // hint are deliberately wrong: they are this app's interface copy rather
      // than anything the clinician wrote, and they must not reach the hash.
      const expected = contentHash(
        NOTE_SECTION_KEYS.map((key) => ({
          key,
          label: 'not part of the note',
          hint: 'not part of the note',
          text: textOf(key),
          emitted: [],
        }))
      );

      expect(await fingerprintOf(base)).toBe(expected);
    });
  });

  it('says it does not know an author the directory no longer lists', async () => {
    const note = MOCK_NOTES.find((row) => row.state === 'SIGNED');
    if (note === undefined) throw new Error('records.ts has no signed note to read');
    // A leaver, or a directory larger than one page. Either way the chart may
    // not put a name to the id, and "Unassigned" says exactly that.
    const client = createMockClient({ notes: [note], users: [] });

    const read = await createHttpChartClient(client).notes.get(note.id);

    expect(read.providerName).toBe('Unassigned');
    expect(read.providerCredential).toBe('');
    expect(read.signature?.signerName).toBe('Unassigned');
  });

  it('leaves an unsigned note without a signature block', async () => {
    const note = await liveChart().notes.get(unsignedNote?.id ?? '');
    expect(note.state).toBe('UNSIGNED');
    expect(note.signature).toBeNull();
  });

  it('takes the visit date and reason from the encounter the note documents', async () => {
    const note = await liveChart().notes.get(signedNote?.id ?? '');
    const encounter = MOCK_ENCOUNTERS.find((row) => row.id === signedNote?.encounterId);

    expect(note.visitDate).toBe(encounter?.startedAt.slice(0, 10));
    expect(note.reason).toBe(encounter?.reasonText);
  });

  it('commits the text with the signature, so the signature covers what was typed', async () => {
    const client = createMockClient();
    const chart = createHttpChartClient(client);
    const id = unsignedNote?.id ?? '';

    const before = await chart.notes.get(id);
    const edited = before.sections.map((section) =>
      section.key === 'plan' ? { ...section, text: 'Recheck in two weeks.' } : section
    );

    const signed = await chart.notes.sign(id, edited);

    expect(signed.state).toBe('SIGNED');
    expect(signed.sections[3]?.text).toBe('Recheck in two weeks.');
    // Not just on screen: the note the API now holds carries the edit.
    const stored = await client.notes.get(id);
    expect(stored.state).toBe('SIGNED');
    expect(stored.blocks).toContainEqual({ key: 'plan', text: 'Recheck in two weeks.' });
  });

  it('records an addendum against the signed note and reads it back', async () => {
    const client = createMockClient();
    const chart = createHttpChartClient(client);
    const id = signedNote?.id ?? '';

    const amended = await chart.notes.addAddendum(id, 'Home readings average 124/76.');

    expect(amended.addenda.at(-1)?.text).toBe('Home readings average 124/76.');
    expect(amended.addenda.at(-1)?.authorName).toBe('Ada Okafor');
    // The note moves with its addendum, so a reader who sees it knows to look.
    expect((await client.notes.get(id)).state).toBe('AMENDED');
  });

  it('refuses a second signature rather than stamping over the first', async () => {
    const chart = liveChart();
    const note = await chart.notes.get(signedNote?.id ?? '');
    await expect(chart.notes.sign(note.id, note.sections)).rejects.toMatchObject({ status: 409 });
  });
});

describe('the mock chart client, as a session store', () => {
  it('keeps a signature for the life of the client and not beyond it', async () => {
    const first = createMockChartClient();
    const second = createMockChartClient();
    const note = await first.notes.get('0192f1a0-0000-7000-8000-00000000e001');

    await first.notes.sign(note.id, note.sections);

    expect((await first.notes.get(note.id)).state).toBe('SIGNED');
    expect((await second.notes.get(note.id)).state).toBe('UNSIGNED');
  });

  it('refuses an addendum on a draft, the way the API refuses one', async () => {
    const client = createMockChartClient();
    const note = await client.notes.get('0192f1a0-0000-7000-8000-00000000e001');
    await expect(client.notes.addAddendum(note.id, 'too soon')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('reports an unknown note as absent', async () => {
    await expect(createMockChartClient().notes.get('nope')).rejects.toMatchObject({ status: 404 });
  });
});

describe('the stored note state, as the note screens read it', () => {
  /** The signed fixture note, varied one field at a time. */
  function noteWith(overrides: Partial<ClinicalNoteDto>): ClinicalNoteDto {
    const base = MOCK_NOTES[0];
    if (base === undefined) throw new Error('records.ts has no notes to vary');
    return { ...base, ...overrides };
  }

  const base = noteWith({});

  it('reads a note waiting on a second signature as cosign pending', async () => {
    const client = createMockClient({
      notes: [noteWith({ state: 'SIGNED', cosignerId: 'u-2', cosignedAt: null })],
    });
    const note = await createHttpChartClient(client).notes.get(base.id);
    // The API records a cosigner with no cosign time rather than a state of its
    // own, and the chart is the surface that has to say what that means.
    expect(note.state).toBe('COSIGN_PENDING');
  });

  it('reads an amended note as signed, because that is what it still is', async () => {
    const client = createMockClient({ notes: [noteWith({ state: 'AMENDED' })] });
    const note = await createHttpChartClient(client).notes.get(base.id);
    expect(note.state).toBe('SIGNED');
  });

  it('reads a note recorded in error as no note at all', async () => {
    const client = createMockClient({
      notes: [noteWith({ state: 'ENTERED_IN_ERROR', signedAt: null, signedById: null })],
    });
    const note = await createHttpChartClient(client).notes.get(base.id);
    // Nobody should be sent to read a note that was recorded in error, so the
    // visit reads as carrying none rather than as carrying a bad one.
    expect(note.state).toBe('NONE');
  });

  it('reads a draft under AI review as a draft', async () => {
    const client = createMockClient({
      notes: [noteWith({ state: 'AI_DRAFT_REVIEW', signedAt: null, signedById: null })],
    });
    const note = await createHttpChartClient(client).notes.get(base.id);
    expect(note.state).toBe('DRAFT');
  });

  it('renders a block with no text as an empty section rather than as an object', async () => {
    const client = createMockClient({
      notes: [noteWith({ blocks: [{ key: 'plan' }, { text: 'orphan with no key' }] })],
    });
    const note = await createHttpChartClient(client).notes.get(base.id);

    expect(note.sections.map((section) => section.text)).toEqual(['', '', '', '']);
  });

  it('names a visit with no reason recorded rather than showing an empty line', async () => {
    const client = createMockClient({ encounters: [{ ...firstVisit, reasonText: null }] });
    const chart = createHttpChartClient(client);

    const summary = await chart.summary.get(firstVisit.patientId);
    expect(summary.visits[0]?.reason).toBe('Not recorded');
    expect((await chart.notes.get(base.id)).reason).toBe('Not recorded');
  });

  it('leaves a visit that produced no note with nothing to open', async () => {
    const client = createMockClient({ encounters: [firstVisit], notes: [] });

    const summary = await createHttpChartClient(client).summary.get(firstVisit.patientId);
    expect(summary.visits[0]?.encounterId).toBeNull();
    expect(summary.visits[0]?.noteState).toBe('NONE');
  });
});
