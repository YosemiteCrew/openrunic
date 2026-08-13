import { ATTESTATION, contentHash } from './signature';
import type { ApiClient, ClinicalNoteDto, EncounterDto, NoteAddendumDto, UserDto } from '../types';

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
 * Where a section of the chart is not composed here it is reported as absent
 * rather than as empty, which is a different statement and the only safe one.
 * The allergy record makes that distinction in its own type: `NOT_RECORDED`
 * means nobody has asked, and it renders differently from an affirmed
 * `NO_KNOWN_ALLERGIES`. An empty list must never read as "safe".
 */

/** How many visits a chart's timeline shows before it starts paging. */
const VISIT_PAGE_SIZE = 50;

/** One page of the staff directory. The API caps a page at 100. */
const DIRECTORY_PAGE_SIZE = 100;

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

/**
 * Who someone is, for the two places the chart names a person: the signature
 * block and the visit list.
 *
 * Read from `/bff/v0/users` rather than assumed. A chart that stamped a
 * credential nobody entered would be putting a qualification on a signature
 * block, which is the last place in the product to guess.
 */
interface Person {
  name: string;
  /** Empty when the directory row carries none, and then nothing is rendered. */
  credential: string;
}

/**
 * An author this page of the directory does not list.
 *
 * The read below asks for no status, on purpose: a note written by someone who
 * has since left still has to carry their name, and filtering to active
 * accounts would erase the author of every old note in the chart. So what
 * reaches here is an id genuinely absent from the page - a deleted account, or
 * a directory longer than one page. "Unassigned" says the chart does not know,
 * which is true; a name invented from an id would not be.
 */
const UNKNOWN_PERSON: Person = { name: 'Unassigned', credential: '' };

type Directory = ReadonlyMap<string, Person>;

function toPerson(user: UserDto): Person {
  return { name: `${user.givenName} ${user.familyName}`, credential: user.credential ?? '' };
}

/** The staff directory, keyed by id, for one chart read. */
async function readDirectory(client: ApiClient, signal?: AbortSignal): Promise<Directory> {
  const page = await client.users.list({ pageSize: DIRECTORY_PAGE_SIZE }, signal);
  return new Map(page.data.map((user) => [user.id, toPerson(user)]));
}

function personIn(directory: Directory, userId: string): Person {
  return directory.get(userId) ?? UNKNOWN_PERSON;
}

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
  sections: readonly NoteSection[],
  directory: Directory
): NoteSignature | null {
  if (note.signedAt === null) return null;
  const signer = personIn(directory, note.signedById ?? note.authorId);
  return {
    signerName: signer.name,
    credential: signer.credential,
    signedAt: note.signedAt,
    attestation: ATTESTATION,
    // A fingerprint of the text just read, not evidence about the signature.
    // See `fingerprint` on NoteSignature and `contentHash` in ./signature.ts.
    fingerprint: contentHash(sections),
  };
}

function toAddendum(addendum: NoteAddendumDto, directory: Directory): Addendum {
  const author = personIn(directory, addendum.authorId);
  return {
    id: addendum.id,
    authorName: author.name,
    credential: author.credential,
    addedAt: addendum.signedAt ?? addendum.createdAt,
    // One pass: a block with no text contributes nothing rather than an empty
    // paragraph in the middle of a correction.
    text: addendum.blocks.flatMap((block) => blockText(block) || []).join('\n\n'),
  };
}

/** The visit timeline: one row per encounter, carrying the note it produced. */
function toVisit(
  encounter: EncounterDto,
  notes: readonly ClinicalNoteDto[],
  directory: Directory
): Visit {
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
    providerName: personIn(directory, encounter.providerId).name,
    reason: encounter.reasonText ?? 'Not recorded',
    noteState: note ? toNoteState(note) : 'NONE',
  };
}

/**
 * The chart summary, from the three routes that exist.
 *
 * Allergies, problems, medications, results and documents each have a segment
 * in `apps/api` already; mapping those payloads into this screen's view types
 * is a change of its own. Care gaps, the care team and the account balance have
 * no segment at all, and the last of those is a derivation over charges and
 * payments rather than a row anywhere. Until each is done they are reported as
 * absent: `NOT_RECORDED` for allergies, and empty lists elsewhere, which the
 * chart tabs already render as "nothing recorded" rather than as "nothing
 * wrong".
 */
export async function readChartSummary(
  client: ApiClient,
  patientId: string,
  signal?: AbortSignal
): Promise<ChartSummary> {
  // Read first, so a patient this principal cannot see is a 404 and not a chart
  // full of empty tabs for a person who may not exist.
  await client.patients.get(patientId, signal);

  const [encounters, notes, directory] = await Promise.all([
    client.encounters.list({ patientId, pageSize: VISIT_PAGE_SIZE }, signal),
    client.notes.list({ patientId, pageSize: VISIT_PAGE_SIZE }, signal),
    readDirectory(client, signal),
  ]);

  return {
    patientId,
    allergies: { state: 'NOT_RECORDED', affirmedOn: null, entries: [] },
    problems: [],
    medications: [],
    careGaps: [],
    visits: encounters.data.map((encounter) => toVisit(encounter, notes.data, directory)),
    results: [],
    documents: [],
    careTeam: [],
    balanceDue: 0,
  };
}

/**
 * One note, with the visit it belongs to and the corrections against it.
 *
 * Four reads rather than one: the note, the visit it documents, its addenda,
 * and the staff directory that turns the three author ids on this screen into
 * names. The visit is needed because the note carries no date or reason of its
 * own, and the API is right not to duplicate them.
 */
export async function readEncounterNote(
  client: ApiClient,
  noteId: string,
  signal?: AbortSignal
): Promise<EncounterNote> {
  const note = await client.notes.get(noteId, signal);
  const [encounter, addenda, directory] = await Promise.all([
    client.encounters.get(note.encounterId, signal),
    client.notes.listAddenda(noteId, { pageSize: VISIT_PAGE_SIZE }, signal),
    readDirectory(client, signal),
  ]);

  const sections = sectionsFrom(note);
  const author = personIn(directory, note.authorId);

  return {
    id: note.id,
    patientId: note.patientId,
    // The note's own title is what a clinician wrote it as, which is a better
    // heading than the encounter class and is always present.
    visitType: note.title,
    visitDate: encounter.startedAt.slice(0, 10),
    providerName: author.name,
    providerCredential: author.credential,
    reason: encounter.reasonText ?? 'Not recorded',
    state: toNoteState(note),
    sections,
    signature: signatureFrom(note, sections, directory),
    addenda: addenda.data.map((addendum) => toAddendum(addendum, directory)),
  };
}
