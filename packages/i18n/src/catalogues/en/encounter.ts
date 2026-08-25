import type { Messages } from '../../catalogue.js';

/**
 * The note editor and signing. Clinical.
 *
 * ## What is here and what is deliberately not
 *
 * The screen's own words: the banners that say what state a note is in, the
 * confirmations that state what signing does, the labels on the signature
 * block. Not the note. A block's heading and hint, a slash command's label and
 * the text it inserts, the attestation sentence and every addendum are the
 * practice's own note configuration, and this file interpolates them rather
 * than restating them. A translated block heading would be a second name for a
 * section the record already names, and a translated attestation would be a
 * clinician attesting to a sentence they did not read.
 *
 * The slash commands are worth naming precisely, because today they do not come
 * from anywhere: `lib/api/chart/index.ts` re-exports `MOCK_SLASH_COMMANDS`, a
 * fixture in this repository, so "History of present illness" is English this
 * codebase wrote and nobody can translate. That is a gap in the seam rather
 * than a decision about the catalogue: the labels belong to a practice's note
 * templates, and keying them here would key a fixture and then have to be
 * undone when the real list arrives. Recorded so the next reader knows which of
 * the two it is.
 *
 * ## Counts
 *
 * `Messages` is flat strings, so a plural has no single key: the forms English
 * distinguishes get one key each, suffixed with the CLDR category, and
 * `counted` asks the reader's locale which to use rather than testing the
 * number against one.
 *
 * Two forms is the limit rather than a claim to handle every language.
 * `CountedMessage` carries `one` and `other`; a locale that selects `few`,
 * `many`, `zero` or `two` gets `other` for them, which is `plural`'s documented
 * fallback and a translation gap rather than a crash. Closing it means carrying
 * all six CLDR keys and writing a message for each.
 */
export const encounter: Messages = {
  /* `EmittedItemKind`, declared in `lib/api/chart/types.ts`. Ours to name. */
  'encounter.emittedKind.order': 'Order',
  'encounter.emittedKind.prescription': 'Prescription',
  'encounter.emittedKind.problem': 'Problem',
  'encounter.emittedKind.followUp': 'Follow up',
  /* ------------------------------------------------------------------ shell */
  /* The heading on the screen itself. The browser tab title is NOT here: it
     comes from `generateMetadata`, which runs before there is a translator and
     has no locale to build one from without reading the request headers, and
     every other route in this application still ships an English tab title from
     a static `metadata` export. Converting one route's tab in isolation would
     leave this screen the only translated tab in a strip of English ones, which
     is a decision about how server metadata gets a locale rather than one this
     area file can make. */
  'encounter.title': 'Visit note',

  'encounter.boundary.subject': 'this visit note',
  'encounter.empty.title': 'No note for this visit',
  'encounter.empty.message':
    'Notes are created when a visit starts. Open the chart to see the visit list.',

  /* --------------------------------------------------------------- commands */
  'encounter.command.openChart': 'Open the chart',
  'encounter.command.openChart.keywords': 'chart, summary, patient, problems',
  'encounter.command.sign.keywords': 'sign, lock, finish, attest',
  'encounter.command.addendum.keywords': 'amend, correct, append, note',

  /* ---------------------------------------------------------------- actions */
  'encounter.action.signNote': 'Sign note',
  'encounter.action.signing': 'Signing...',
  'encounter.action.addAddendum': 'Add addendum',
  'encounter.action.signAddendum': 'Sign addendum',
  'encounter.action.cancel': 'Cancel',

  /* ---------------------------------------------------------- state banners */
  /* Which of the three states a note is in is the first thing this screen has
     to say, because it decides whether what is on the page is part of the
     record yet and whether it can still be typed into. */
  'encounter.banner.signedTitle': 'Signed and locked',
  'encounter.banner.signedDetail':
    'Signed by {signer} on {when}. The text cannot be changed; corrections are added as an addendum.',
  'encounter.banner.draft': 'Draft',
  'encounter.banner.draftDetail':
    'This note is a draft. It is not part of the record until it is signed.',
  'encounter.banner.unsigned': 'Unsigned',
  'encounter.banner.unsignedDetail':
    'This note is unsigned. Signing locks the text into the record; addenda remain possible.',

  'encounter.footnote.unsigned':
    'Nothing is signed yet, so this note carries no signature block. Written {date} by {author}.',

  /* ------------------------------------------------------------ the blocks */
  'encounter.block.empty': 'Nothing recorded in this block.',
  /* `{section}` is the block's own heading as the note carries it, lower-cased
     into the sentence. It is record data rather than copy, so it is passed in
     rather than translated. */
  'encounter.block.insertCommand': 'Insert a command in {section}',
  'encounter.block.writtenToChart': 'Written to the chart from {section}',
  /* Spoken, not seen: the live region that tells a reader who cannot see the
     list how much is in it. */
  'encounter.block.commandsAvailable.one':
    '{count} command available. Use the arrow keys and Enter.',
  'encounter.block.commandsAvailable.other':
    '{count} commands available. Use the arrow keys and Enter.',

  /* -------------------------------------------------------- the slash menu */
  'encounter.slash.label': 'Note commands',
  'encounter.slash.noMatch': 'No command matches that. Keep typing to write plain text.',
  'encounter.slash.noMatchQuery': 'No command matches "{query}". Keep typing to write plain text.',
  'encounter.slash.writes': 'Writes {item}',
  'encounter.slash.textOnly': 'Text only',

  /* -------------------------------------------------------- the signature */
  'encounter.signature.title': 'Signature',
  'encounter.signature.signedBy': 'Signed by',
  'encounter.signature.signedAt': 'Signed at',
  /* Labelled as a fingerprint rather than as proof, because nothing on the wire
     carries the hash taken at signing time and there is therefore nothing here
     to compare the value with. */
  'encounter.signature.fingerprint': 'Note fingerprint',
  'encounter.signature.addenda': 'Addenda',
  'encounter.signature.addendum': 'Addendum',

  /* ---------------------------------------------------------- the addendum */
  'encounter.addendum.title': 'New addendum',
  'encounter.addendum.hint':
    'An addendum is appended to the signed note with its own signature. The original text stays exactly as it was signed.',
  'encounter.addendum.label': 'Addendum text',
  'encounter.addendum.discard': 'Discard addendum',

  /* ------------------------------------------------------- confirmations */
  /* One deliberate step that states the consequence in a sentence and names the
     verb on the button. Not made harder than that: friction on a routine,
     correct action is how a system trains people to click through warnings. */
  'encounter.confirm.sign.title': 'Sign this note?',
  'encounter.confirm.sign.description':
    'Sign and lock this note. The text cannot be changed afterwards; addenda remain possible.',
  'encounter.confirm.sign.signingAs': 'Signing as {signer}.',
  'encounter.confirm.addendum.title': 'Sign this addendum?',
  'encounter.confirm.addendum.description':
    'The addendum is added to the signed note and cannot be edited afterwards.',

  /* ------------------------------------------------------------- the toast */
  'encounter.toast.noteSigned': 'Note signed',
  'encounter.toast.addendumSigned': 'Addendum signed',
  'encounter.toast.message':
    'Recorded against this visit. The text is locked; corrections are added as an addendum.',

  /* ------------------------------------------------------- the browser tab */
  /*
   * A route file is a server component, so it cannot reach `useTranslator`.
   * `lib/i18n/metadata.ts` builds its own translator and looks these up. The tab
   * strip is often all a tired person has to tell nine open screens apart.
   */
  'encounter.page.title': 'Visit note',
  'encounter.page.titleForPatient': '{name} - Visit note',
};
