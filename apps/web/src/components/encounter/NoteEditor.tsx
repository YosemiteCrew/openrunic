'use client';

import { Badge, Button, Card, Modal, Toast } from '@openrunic/ui';
import { useEffect, useMemo, useReducer, useState } from 'react';
import type { ReactElement } from 'react';

import { useRegisterCommands } from '@/components/command';
import type { Command } from '@/components/command';
import { ATTESTATION, chartApi } from '@/lib/api/chart';
import type {
  ChartClient,
  EmittedItem,
  EncounterNote,
  NoteSection,
  SlashCommand,
} from '@/lib/api/chart';
import { useMutation } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';

import { NoteBlock } from './NoteBlock';
import { initialDraft, isLocked, reduceNoteDraft } from './note-draft';
import { SignatureBlock } from './SignatureBlock';

/**
 * CH-02 The visit note.
 *
 * The three states that matter are all here and all visible: unsigned, where
 * the banner says so and the only primary action is to sign; signed, where the
 * text is locked, the signature block carries the attestation and hash, and the
 * only way to add anything is an addendum; and the command flow that writes
 * narrative and structured data from the same keystrokes.
 *
 * Signing is clinically significant, so it is confirmed with one deliberate
 * step that states the consequence in a sentence and names the verb on the
 * button. It is not made harder than that: friction on a routine, correct
 * action is how a system trains people to click through warnings.
 *
 * Signing and amending both reach the server, and the note the server answers
 * with is what the screen then shows. The text is committed as part of signing
 * rather than saved separately, because "sign this note" means "sign what I
 * just wrote", and there is no autosave to have done it earlier. A refusal
 * leaves the note exactly as it was and says why: the one thing this screen
 * must never do is show a signature block for a signature that did not happen.
 */

export interface NoteEditorProps {
  note: EncounterNote;
  commands: readonly SlashCommand[];
  /** Injectable for tests. Defaults to the app's chart client. */
  client?: ChartClient;
}

type Confirming = 'sign' | 'addendum' | null;

export function NoteEditor({ note, commands, client }: Readonly<NoteEditorProps>): ReactElement {
  /* The note itself is one value with one transition per action. The rest is
     interface state that belongs to this screen and to nothing in the record. */
  const [draft, dispatch] = useReducer(reduceNoteDraft, note, initialDraft);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [addendumText, setAddendumText] = useState('');
  const [writingAddendum, setWritingAddendum] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const { sections, state, signature, addenda } = draft;
  const locked = isLocked(draft);

  const notes = (client ?? chartApi).notes;
  const signing = useMutation((committed: readonly NoteSection[]) =>
    notes.sign(note.id, committed)
  );
  const amending = useMutation((text: string) => notes.addAddendum(note.id, text));

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const updateSection = (key: NoteSection['key'], text: string) => {
    dispatch({ type: 'edit', key, text });
  };

  const emit = (key: NoteSection['key'], item: Omit<EmittedItem, 'id'>) => {
    dispatch({ type: 'emit', key, item });
  };

  const sign = async () => {
    const outcome = await signing.run(sections);
    // The dialog stays open on a refusal, so the reason is read beside the
    // button that caused it rather than behind a dialog that closed anyway.
    if (!outcome.ok) return;
    dispatch({ type: 'replace', note: outcome.value });
    setConfirming(null);
    setToast('Note signed');
  };

  const signAddendum = async () => {
    const outcome = await amending.run(addendumText.trim());
    if (!outcome.ok) return;
    dispatch({ type: 'replace', note: outcome.value });
    setAddendumText('');
    setWritingAddendum(false);
    setConfirming(null);
    setToast('Addendum signed');
  };

  useRegisterCommands(
    useMemo<Command[]>(() => {
      if (locked) {
        return [
          {
            id: 'note.addendum',
            group: 'actions',
            label: 'Add addendum',
            keywords: ['amend', 'correct', 'append', 'note'],
            icon: 'file-plus',
            perform: () => setWritingAddendum(true),
          },
        ];
      }
      return [
        {
          id: 'note.sign',
          group: 'actions',
          label: 'Sign note',
          keywords: ['sign', 'lock', 'finish', 'attest'],
          icon: 'pen-line',
          perform: () => setConfirming('sign'),
        },
      ];
    }, [locked])
  );

  return (
    <div className="or-note">
      {locked ? (
        <Card className="or-note__banner or-note__banner--signed">
          <div className="or-note__banner-row">
            <Badge tone="success" icon="lock">
              Signed and locked
            </Badge>
            <p className="or-body">
              Signed by {signature?.signerName ?? note.providerName} on{' '}
              {formatDateTime(signature?.signedAt)}. The text cannot be changed; corrections are
              added as an addendum.
            </p>
            <Button
              variant="secondary"
              iconLeft="file-plus"
              onClick={() => setWritingAddendum(true)}
            >
              Add addendum
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="or-note__banner or-note__banner--caution">
          <div className="or-note__banner-row">
            <Badge tone="neutral" icon="pen-line">
              {state === 'DRAFT' ? 'Draft' : 'Unsigned'}
            </Badge>
            <p className="or-body">
              {state === 'DRAFT'
                ? 'This note is a draft. It is not part of the record until it is signed.'
                : 'This note is unsigned. Signing locks the text into the record; addenda remain possible.'}
            </p>
            <Button variant="primary" iconLeft="pen-line" onClick={() => setConfirming('sign')}>
              Sign note
            </Button>
          </div>
        </Card>
      )}

      <div className="or-note__blocks">
        {sections.map((section) => (
          <NoteBlock
            key={section.key}
            section={section}
            commands={commands}
            locked={locked}
            onChange={(text) => updateSection(section.key, text)}
            onEmit={(item) => emit(section.key, item)}
          />
        ))}
      </div>

      {locked && signature ? (
        <SignatureBlock signature={signature} addenda={addenda} />
      ) : (
        <p className="or-caption or-note__footnote">
          Nothing is signed yet, so this note carries no signature block. Written{' '}
          {formatDate(note.visitDate)} by {note.providerName}, {note.providerCredential}.
        </p>
      )}

      {writingAddendum ? (
        <Card title="New addendum" className="or-note__addendum">
          <p className="or-caption" id="addendum-hint">
            An addendum is appended to the signed note with its own signature. The original text
            stays exactly as it was signed.
          </p>
          <label className="or-note__addendum-label" htmlFor="addendum-text">
            Addendum text
          </label>
          <textarea
            id="addendum-text"
            className="or-note-block__field"
            aria-describedby="addendum-hint"
            rows={4}
            value={addendumText}
            onChange={(event) => setAddendumText(event.target.value)}
          />
          <div className="or-note__addendum-actions">
            <Button
              variant="ghost"
              onClick={() => {
                setWritingAddendum(false);
                setAddendumText('');
              }}
            >
              Discard addendum
            </Button>
            <Button
              variant="primary"
              iconLeft="pen-line"
              disabled={addendumText.trim().length === 0}
              onClick={() => setConfirming('addendum')}
            >
              Sign addendum
            </Button>
          </div>
        </Card>
      ) : null}

      <Modal
        open={confirming === 'sign'}
        role="alertdialog"
        title="Sign this note?"
        description="Sign and lock this note. The text cannot be changed afterwards; addenda remain possible."
        onClose={() => setConfirming(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={signing.pending} onClick={sign}>
              {signing.pending ? 'Signing...' : 'Sign note'}
            </Button>
          </>
        }
      >
        <p className="or-body">{ATTESTATION}</p>
        <p className="or-caption">
          Signing as {note.providerName}, {note.providerCredential}.
        </p>
        {signing.error ? (
          <p className="or-body" role="alert">
            {signing.error.problem?.detail ?? signing.error.message}
          </p>
        ) : null}
      </Modal>

      <Modal
        open={confirming === 'addendum'}
        role="alertdialog"
        title="Sign this addendum?"
        description="The addendum is added to the signed note and cannot be edited afterwards."
        onClose={() => setConfirming(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={amending.pending} onClick={signAddendum}>
              {amending.pending ? 'Signing...' : 'Sign addendum'}
            </Button>
          </>
        }
      >
        <p className="or-body">{addendumText}</p>
        {amending.error ? (
          <p className="or-body" role="alert">
            {amending.error.problem?.detail ?? amending.error.message}
          </p>
        ) : null}
      </Modal>

      {toast ? (
        <div className="or-note__toast">
          <Toast
            tone="success"
            title={toast}
            message="Recorded against this visit. The text is locked; corrections are added as an addendum."
            onClose={() => setToast(null)}
          />
        </div>
      ) : null}
    </div>
  );
}
