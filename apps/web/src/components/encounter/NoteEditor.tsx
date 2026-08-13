'use client';

import { Badge, Button, Card, Modal, Toast } from '@openrunic/ui';
import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import { useRegisterCommands } from '@/components/command';
import type { Command } from '@/components/command';
import { clinicNow } from '@/lib/api/chart';
import type {
  Addendum,
  EmittedItem,
  EncounterNote,
  NoteSection,
  SlashCommand,
} from '@/lib/api/chart';
import { formatDate, formatDateTime } from '@/lib/format';

import { NoteBlock } from './NoteBlock';
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
 * Signing is local to this screen until the note API lands. Nothing here
 * pretends to have reached a server: the mock client implements reads only, on
 * purpose, because a fixture that accepts writes teaches screens to trust state
 * the server never saw.
 */

export interface NoteEditorProps {
  note: EncounterNote;
  commands: readonly SlashCommand[];
}

const ATTESTATION = 'I attest that this note records the care I provided at this visit.';

/** A short, stable content hash. Deterministic, so a signed fixture reads the same every run. */
export function contentHash(sections: readonly NoteSection[]): string {
  const text = sections.map((section) => `${section.key}:${section.text}`).join('|');
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
  }
  const hex = hash.toString(16).padStart(8, '0');
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${(text.length % 65536).toString(16).padStart(4, '0')}`;
}

type Confirming = 'sign' | 'addendum' | null;

export function NoteEditor({ note, commands }: NoteEditorProps): ReactElement {
  const [sections, setSections] = useState<NoteSection[]>(note.sections);
  const [state, setState] = useState(note.state);
  const [signature, setSignature] = useState(note.signature);
  const [addenda, setAddenda] = useState<Addendum[]>([...note.addenda]);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [addendumText, setAddendumText] = useState('');
  const [writingAddendum, setWritingAddendum] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const locked = state === 'SIGNED' || state === 'COSIGN_PENDING';

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const updateSection = (key: NoteSection['key'], text: string) => {
    setSections((current) =>
      current.map((section) => (section.key === key ? { ...section, text } : section))
    );
  };

  const emit = (key: NoteSection['key'], item: Omit<EmittedItem, 'id'>) => {
    setSections((current) =>
      current.map((section) =>
        section.key === key
          ? {
              ...section,
              emitted: [
                ...section.emitted,
                { ...item, id: `${section.key}-${section.emitted.length + 1}` },
              ],
            }
          : section
      )
    );
  };

  const sign = () => {
    setSignature({
      signerName: note.providerName,
      credential: note.providerCredential,
      signedAt: clinicNow(),
      attestation: ATTESTATION,
      hash: contentHash(sections),
    });
    setState('SIGNED');
    setConfirming(null);
    setToast('Note signed');
  };

  const signAddendum = () => {
    setAddenda((current) => [
      ...current,
      {
        id: `addendum-${current.length + 1}`,
        authorName: note.providerName,
        credential: note.providerCredential,
        addedAt: clinicNow(),
        text: addendumText.trim(),
      },
    ]);
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
            <Button variant="primary" onClick={sign}>
              Sign note
            </Button>
          </>
        }
      >
        <p className="or-body">{ATTESTATION}</p>
        <p className="or-caption">
          Signing as {note.providerName}, {note.providerCredential}.
        </p>
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
            <Button variant="primary" onClick={signAddendum}>
              Sign addendum
            </Button>
          </>
        }
      >
        <p className="or-body">{addendumText}</p>
      </Modal>

      {toast ? (
        <div className="or-note__toast">
          <Toast
            tone="success"
            title={toast}
            message="This build keeps note changes in the browser; the note API is not wired up yet."
            onClose={() => setToast(null)}
          />
        </div>
      ) : null}
    </div>
  );
}
