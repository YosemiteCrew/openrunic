import { api } from '../api';
import { API_MODE } from '../config';
import { mockChartFor, mockEncounterNote } from '../mock/chart';
import { MOCK_PATIENTS } from '../mock/fixtures';
import { attempt, conflict, notFound } from '../mock/protocol';
import { createClock, createIdFactory } from '../mock/store';
import type { ApiClient } from '../types';

import { ATTESTATION, contentHash } from './signature';
import { readChartSummary, readEncounterNote } from './live';
import type { Addendum, ChartSummary, EncounterNote, NoteSection } from './types';

/**
 * The chart read and write surface.
 *
 * It is a second client rather than more methods on {@link ApiClient} because
 * the chart rail and the six chart tabs read one composed payload, and what
 * composes it differs by mode. Against the API it is assembled from
 * `/patients/:id`, `/encounters` and `/notes`, which is what `./live.ts` does.
 * Against fixtures it is a hand-written chart with allergies, problems,
 * medications and results on it, because those aggregates have routes but no
 * mapping into these view types yet, and a demo chart with four empty tabs
 * would not be a demo.
 *
 * That difference is the seam worth closing next, and it is narrow: when the
 * remaining aggregates are mapped in `./live.ts`, the fixture chart becomes a
 * seed for the mock `ApiClient` and this file loses its second implementation.
 *
 * Both implementations satisfy the same interface, so a chart screen never
 * branches on the mode.
 */

export interface ChartClient {
  readonly mode: 'live' | 'mock';
  summary: {
    get: (patientId: string, signal?: AbortSignal) => Promise<ChartSummary>;
  };
  notes: {
    get: (noteId: string, signal?: AbortSignal) => Promise<EncounterNote>;
    /**
     * Commits the sections and then signs the note, answering it as it stands.
     *
     * The text goes with the signature on purpose. A clinician who types into a
     * block and presses sign means "sign what I just wrote"; signing without
     * saving first would take a signature over the last text the server saw,
     * which is a different note from the one on their screen. There is no
     * autosave yet, so this is the moment the draft is committed.
     *
     * The whole note comes back rather than an acknowledgement because signing
     * changes more than one field - the state, the signature block, the lock -
     * and a screen that patched those in locally would be guessing at three
     * values the server has already decided.
     */
    sign: (
      noteId: string,
      sections: readonly NoteSection[],
      signal?: AbortSignal
    ) => Promise<EncounterNote>;
    /** Records a correction against a signed note, and answers the amended note. */
    addAddendum: (noteId: string, text: string, signal?: AbortSignal) => Promise<EncounterNote>;
  };
}

export interface MockChartClientOptions {
  /** Overrides the fixture chart, for a screen state a fixture does not carry. */
  charts?: readonly ChartSummary[];
  notes?: readonly EncounterNote[];
  /** Patient ids that exist. Defaults to the patient fixtures. */
  patientIds?: readonly string[];
  /** Fails every call with this error, for the screens' error states. */
  failure?: Error;
  /** The instant the first write is stamped with. Fixed, so a test is repeatable. */
  now?: string;
}

/** Who a mock signature is attributed to, standing in for the signed-in principal. */
const MOCK_SIGNER = { name: 'Dr. Okafor', credential: 'MD' } as const;

/** The states a signature may be added from. A signed note is signed once. */
function assertSignable(note: EncounterNote): void {
  if (note.state === 'SIGNED' || note.state === 'COSIGN_PENDING') {
    // A second signature would overwrite what the first person attested to,
    // and the record has to keep the first one.
    throw conflict('That note is already signed.');
  }
}

/** Only a signed note takes an addendum: a correction to a draft is just an edit. */
function assertAmendable(note: EncounterNote): void {
  if (note.state !== 'SIGNED' && note.state !== 'COSIGN_PENDING') {
    throw conflict('A note can only be amended once it is signed.');
  }
}

export function createMockChartClient(options: MockChartClientOptions = {}): ChartClient {
  const knownPatients = options.patientIds ?? MOCK_PATIENTS.map((patient) => patient.id);
  const clock = createClock(options.now ?? '2026-08-12T10:20:00.000Z');
  const nextAddendumId = createIdFactory('q');

  /* Written notes live here for the session, keyed by id. A note is copied in
     on first read so that the fixture module is never mutated: two clients
     built from the same fixtures must not see each other's signatures. */
  const written = new Map<string, EncounterNote>();

  const load = (noteId: string): EncounterNote => {
    const held = written.get(noteId);
    if (held) return held;
    const found = options.notes
      ? options.notes.find((note) => note.id === noteId)
      : mockEncounterNote(noteId);
    if (!found) throw notFound('No such visit note.');
    return found;
  };

  const store = (note: EncounterNote): EncounterNote => {
    written.set(note.id, note);
    return note;
  };

  /** Every call goes through here, so the failure flag is honoured exactly once. */
  const answer = <T>(run: () => T): Promise<T> => {
    if (options.failure) return Promise.reject(options.failure);
    return attempt(run);
  };

  return {
    mode: 'mock',
    summary: {
      get: (patientId) =>
        answer(() => {
          const override = options.charts?.find((chart) => chart.patientId === patientId);
          if (override) return override;
          // A chart for a patient who does not exist is a 404, not an empty
          // chart: a mistyped id must never render as a patient with nothing
          // wrong with them.
          if (!knownPatients.includes(patientId)) throw notFound('No such patient.');
          return mockChartFor(patientId);
        }),
    },
    notes: {
      get: (noteId) => answer(() => load(noteId)),
      sign: (noteId, sections) =>
        answer(() => {
          const note = load(noteId);
          assertSignable(note);
          const committed = [...sections];
          return store({
            ...note,
            sections: committed,
            state: 'SIGNED',
            signature: {
              signerName: MOCK_SIGNER.name,
              credential: MOCK_SIGNER.credential,
              signedAt: clock.next(),
              attestation: ATTESTATION,
              // Hashed from the sections this signature is covering, so the
              // hash can never describe text the signature did not include.
              hash: contentHash(committed),
            },
          });
        }),
      addAddendum: (noteId, text) =>
        answer(() => {
          const note = load(noteId);
          assertAmendable(note);
          const addendum: Addendum = {
            id: nextAddendumId(),
            authorName: MOCK_SIGNER.name,
            credential: MOCK_SIGNER.credential,
            addedAt: clock.next(),
            text,
          };
          return store({ ...note, addenda: [...note.addenda, addendum] });
        }),
    },
  };
}

/**
 * The editor's sections, as the block document the API stores.
 *
 * Only the key and the text travel: the label and the hint are this app's
 * headings for a block, not part of what was documented, and storing them would
 * make every past note carry a copy of today's interface copy.
 */
function toBlocks(sections: readonly NoteSection[]): Record<string, unknown>[] {
  return sections.map((section) => ({ key: section.key, text: section.text }));
}

/**
 * The live chart, over the same `ApiClient` every other screen writes through.
 *
 * It takes the client rather than a base URL so the token source, the problem
 * document handling and the abort behaviour are the ones already tested in
 * `client.ts`, rather than a second copy that can drift from them.
 */
export function createHttpChartClient(client: ApiClient): ChartClient {
  return {
    mode: 'live',
    summary: {
      get: (patientId, signal) => readChartSummary(client, patientId, signal),
    },
    notes: {
      get: (noteId, signal) => readEncounterNote(client, noteId, signal),
      sign: async (noteId, sections, signal) => {
        await client.notes.update(noteId, { blocks: toBlocks(sections) }, signal);
        await client.notes.sign(noteId, signal);
        // Read back rather than mapping the signed DTO here: the signature
        // block also renders the addenda, and re-reading is what keeps the two
        // consistent without this file learning how to merge them.
        return readEncounterNote(client, noteId, signal);
      },
      addAddendum: async (noteId, text, signal) => {
        // No author is sent. The API stamps it from the verified token, the way
        // it stamps a signature, so a correction is always attributed to whoever
        // actually wrote it rather than to whoever wrote the note being
        // corrected.
        await client.notes.addAddendum(noteId, { blocks: [{ key: 'addendum', text }] }, signal);
        return readEncounterNote(client, noteId, signal);
      },
    },
  };
}

/** The client the chart screens read through, resolved once at module load. */
export const chartApi: ChartClient =
  API_MODE === 'mock' ? createMockChartClient() : createHttpChartClient(api);
