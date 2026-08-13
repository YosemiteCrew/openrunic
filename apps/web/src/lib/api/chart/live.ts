import { mockProviderName } from '../mock/fixtures';

import { ATTESTATION, contentHash } from './signature';
import type { ApiClient, ClinicalNoteDto, EncounterDto, NoteAddendumDto } from '../types';

import type {
  Addendum,
  ChartSummary,
  EncounterNote,
  NoteSection,
  NoteSectionKey,
  NoteState,
  NoteSignature,
  Visit,
} from './types';

/**
 * The chart, assembled from the routes `apps/api` actually serves.
 *
 * The live chart client used to request `/patients/:id/chart` and
 * `/encounters/:id/note`. Neither route has ever existed, so every chart screen
 * in live mode failed with a 404 that read like a missing patient. What the API
 * does serve is `/patients/:id`, `/encounters`, `/notes` and `/notes/:id`, and
 * this module composes those into the two shapes the chart screens read.
 *
 * Where a section of the chart has no route yet it is reported as absent rather
 * than as empty, which is a different statement and the only safe one. The
 * allergy record makes that distinction in its own type: `NOT_RECORDED` means
 * nobody has asked, and it renders differently from an affirmed
 * `NO_KNOWN_ALLERGIES`. An empty list must never read as "safe".
 */

/** How many visits a chart's timeline shows before it starts paging. */
const VISIT_PAGE_SIZE = 50;

/**
 * The four SOAP blocks, with the heading and the one-line hint each carries.
 *
 * The API stores note blocks as opaque JSON whose shape the editor owns, so it
 * has no opinion about what a block is called or what belongs in it. That
 * opinion lives here, next to the editor that renders it.
 */
const SECTION_COPY: Readonly<Record<NoteSectionKey, { label: string; hint: string }>> = {
  subjective: {
    label: 'Subjective',
    hint: 'What the patient reports, in their words where it matters.',
  },
  objective: {
    label: 'Objective',
    hint: 'Measurements and examination. Vitals flow in from rooming.',
  },
  assessment: {
    label: 'Assessment',
    hint: 'The clinical picture, and the coded problems it maps to.',
  },
  plan: { label: 'Plan', hint: 'What happens next, and what it writes to the chart.' },
};

const SECTION_ORDER: readonly NoteSectionKey[] = ['subjective', 'objective', 'assessment', 'plan'];

/** The credential shown beside a signature until there is a practitioner directory. */
const DEFAULT_CREDENTIAL = 'MD';

/**
 * Reads a block's text, whatever the editor put around it.
 *
 * Blocks are opaque JSON by contract, so this reads defensively: a block from a
 * future editor version that carries no `text` renders as an empty section
 * rather than as `[object Object]` in a clinician's note.
 */
function blockText(block: Record<string, unknown>): string {
  return typeof block.text === 'string' ? block.text : '';
}

function blockKey(block: Record<string, unknown>): string | null {
  return typeof block.key === 'string' ? block.key : null;
}

function sectionsFrom(note: ClinicalNoteDto): NoteSection[] {
  return SECTION_ORDER.map((key) => {
    const block = note.blocks.find((candidate) => blockKey(candidate) === key);
    const { label, hint } = SECTION_COPY[key];
    return {
      key,
      label,
      hint,
      text: block ? blockText(block) : '',
      // The API has no structured record of what a command block emitted, so
      // the chips are absent rather than invented. They come back when the
      // editor writes its emissions into the block document.
      emitted: [],
    };
  });
}

/**
 * The stored note state, as the note screens' own vocabulary.
 *
 * The two are close but not the same: the chart distinguishes a note waiting on
 * a second signature, which the API records as a cosigner with no cosign time
 * rather than as a state of its own, and it has a `NONE` for a visit that never
 * carried a note at all.
 */
export function toNoteState(note: ClinicalNoteDto): NoteState {
  if (note.state === 'SIGNED' || note.state === 'AMENDED') {
    return note.cosignerId !== null && note.cosignedAt === null ? 'COSIGN_PENDING' : 'SIGNED';
  }
  if (note.state === 'UNSIGNED') return 'UNSIGNED';
  // A note recorded in error is not a note anyone should be sent to read, so
  // the visit reads as carrying none.
  return note.state === 'ENTERED_IN_ERROR' ? 'NONE' : 'DRAFT';
}

function signatureFrom(
  note: ClinicalNoteDto,
  sections: readonly NoteSection[]
): NoteSignature | null {
  if (note.signedAt === null) return null;
  return {
    signerName: mockProviderName(note.signedById ?? note.authorId),
    credential: DEFAULT_CREDENTIAL,
    signedAt: note.signedAt,
    attestation: ATTESTATION,
    // Hashed from the sections the screen renders, so the hash describes the
    // text on screen rather than a storage detail nobody can see.
    hash: contentHash(sections),
  };
}

function toAddendum(addendum: NoteAddendumDto): Addendum {
  return {
    id: addendum.id,
    authorName: mockProviderName(addendum.authorId),
    credential: DEFAULT_CREDENTIAL,
    addedAt: addendum.signedAt ?? addendum.createdAt,
    // One pass: a block with no text contributes nothing rather than an empty
    // paragraph in the middle of a correction.
    text: addendum.blocks.flatMap((block) => blockText(block) || []).join('\n\n'),
  };
}

/** The visit timeline: one row per encounter, carrying the note it produced. */
function toVisit(encounter: EncounterDto, notes: readonly ClinicalNoteDto[]): Visit {
  const note = notes.find((candidate) => candidate.encounterId === encounter.id);
  return {
    id: encounter.id,
    // The link target is the note, because that is what `/encounters/<id>`
    // renders. A visit with no note has nothing to open.
    encounterId: note?.id ?? null,
    date: encounter.startedAt.slice(0, 10),
    // No appointment-type lookup on this path: the visit list would otherwise
    // cost one request per row. `class` is what the encounter itself says it
    // was, in the API's own word.
    type: encounter.class,
    providerName: mockProviderName(encounter.providerId),
    reason: encounter.reasonText ?? 'Not recorded',
    noteState: note ? toNoteState(note) : 'NONE',
  };
}

/**
 * The chart summary, from the three routes that exist.
 *
 * Allergies, problems, medications, care gaps, results, documents, care team
 * and the account balance are each their own aggregate in `apps/api`, and
 * mapping them into this screen's view types is a change of its own. Until then
 * they are reported as absent: `NOT_RECORDED` for allergies, and empty lists
 * elsewhere, which the chart tabs already render as "nothing recorded" rather
 * than as "nothing wrong".
 */
export async function readChartSummary(
  client: ApiClient,
  patientId: string,
  signal?: AbortSignal
): Promise<ChartSummary> {
  // Read first, so a patient this principal cannot see is a 404 and not a chart
  // full of empty tabs for a person who may not exist.
  await client.patients.get(patientId, signal);

  const [encounters, notes] = await Promise.all([
    client.encounters.list({ patientId, pageSize: VISIT_PAGE_SIZE }, signal),
    client.notes.list({ patientId, pageSize: VISIT_PAGE_SIZE }, signal),
  ]);

  return {
    patientId,
    allergies: { state: 'NOT_RECORDED', affirmedOn: null, entries: [] },
    problems: [],
    medications: [],
    careGaps: [],
    visits: encounters.data.map((encounter) => toVisit(encounter, notes.data)),
    results: [],
    documents: [],
    careTeam: [],
    balanceDue: 0,
  };
}

/**
 * One note, with the visit it belongs to and the corrections against it.
 *
 * Three reads rather than one: the note, the visit it documents, and its
 * addenda. The visit is needed because the note carries no date or reason of
 * its own, and the API is right not to duplicate them.
 */
export async function readEncounterNote(
  client: ApiClient,
  noteId: string,
  signal?: AbortSignal
): Promise<EncounterNote> {
  const note = await client.notes.get(noteId, signal);
  const [encounter, addenda] = await Promise.all([
    client.encounters.get(note.encounterId, signal),
    client.notes.listAddenda(noteId, { pageSize: VISIT_PAGE_SIZE }, signal),
  ]);

  const sections = sectionsFrom(note);

  return {
    id: note.id,
    patientId: note.patientId,
    // The note's own title is what a clinician wrote it as, which is a better
    // heading than the encounter class and is always present.
    visitType: note.title,
    visitDate: encounter.startedAt.slice(0, 10),
    // There is no practitioner endpoint yet, so a name comes from the fixture
    // directory, exactly as the schedule's provider columns do. When that
    // endpoint lands this is one lookup, and nothing else here changes.
    providerName: mockProviderName(note.authorId),
    providerCredential: DEFAULT_CREDENTIAL,
    reason: encounter.reasonText ?? 'Not recorded',
    state: toNoteState(note),
    sections,
    signature: signatureFrom(note, sections),
    addenda: addenda.data.map(toAddendum),
  };
}
