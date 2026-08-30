'use client';

import { Badge, Button, Card, Modal } from '@openrunic/ui';
import { useEffect, useMemo, useReducer, useState } from 'react';
import type { ReactElement } from 'react';

import { Toast } from '@/components/state';
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
import { formatCredentialed, formatDate, formatDateTime } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

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
  const t = useTranslator();
  /* The note itself is one value with one transition per action. The rest is
     interface state that belongs to this screen and to nothing in the record. */
  const [draft, dispatch] = useReducer(reduceNoteDraft, note, initialDraft);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [addendumText, setAddendumText] = useState('');
  const [writingAddendum, setWritingAddendum] = useState(false);
  /* The rendered sentence rather than its key, because the toast is transient
     interface state and holding a key here would put a lookup the drift test
     cannot see between the action and the words. It is set from a literal key
     at the moment the write comes back. */
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
    setToast(t('encounter.toast.noteSigned'));
  };

  const signAddendum = async () => {
    const outcome = await amending.run(addendumText.trim());
    if (!outcome.ok) return;
    dispatch({ type: 'replace', note: outcome.value });
    setAddendumText('');
    setWritingAddendum(false);
    setConfirming(null);
    setToast(t('encounter.toast.addendumSigned'));
  };

  /* The palette entries depend on the reader as well as on the lock, so the
     translator joins the dependency list: a list built once in English would
     otherwise survive a language change intact.

     That dependency is only sound because the translator is memoised on the
     locale. `useRegisterCommands` registers whenever this array's identity
     changes and registering sets state, so a translator with a new identity
     every render would make this a render loop rather than a wasted
     allocation.

     Keywords are a comma-separated catalogue string split here, the way the
     navigation table already does it: somebody searching in another language
     does not type the English word. */
  useRegisterCommands(
    useMemo<Command[]>(() => {
      const keywords = (key: string) =>
        t(key)
          .split(',')
          .map((word) => word.trim())
          .filter((word) => word !== '');

      if (locked) {
        return [
          {
            id: 'note.addendum',
            group: 'actions',
            label: t('encounter.action.addAddendum'),
            keywords: keywords('encounter.command.addendum.keywords'),
            icon: 'file-plus',
            perform: () => setWritingAddendum(true),
          },
        ];
      }
      return [
        {
          id: 'note.sign',
          group: 'actions',
          label: t('encounter.action.signNote'),
          keywords: keywords('encounter.command.sign.keywords'),
          icon: 'pen-line',
          perform: () => setConfirming('sign'),
        },
      ];
    }, [locked, t])
  );

  return (
    <div className="or-note">
      {locked ? (
        <Card className="or-note__banner or-note__banner--signed">
          <div className="or-note__banner-row">
            <Badge tone="success" icon="lock">
              {t('encounter.banner.signedTitle')}
            </Badge>
            <p className="or-body">
              {t('encounter.banner.signedDetail', {
                signer: signature?.signerName ?? note.providerName,
                when: formatDateTime(t, signature?.signedAt),
              })}
            </p>
            <Button
              variant="secondary"
              iconLeft="file-plus"
              onClick={() => setWritingAddendum(true)}
            >
              {t('encounter.action.addAddendum')}
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="or-note__banner or-note__banner--caution">
          <div className="or-note__banner-row">
            <Badge tone="neutral" icon="pen-line">
              {state === 'DRAFT' ? t('encounter.banner.draft') : t('encounter.banner.unsigned')}
            </Badge>
            <p className="or-body">
              {state === 'DRAFT'
                ? t('encounter.banner.draftDetail')
                : t('encounter.banner.unsignedDetail')}
            </p>
            <Button variant="primary" iconLeft="pen-line" onClick={() => setConfirming('sign')}>
              {t('encounter.action.signNote')}
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
          {t('encounter.footnote.unsigned', {
            date: formatDate(t, note.visitDate),
            author: formatCredentialed(note.providerName, note.providerCredential),
          })}
        </p>
      )}

      {writingAddendum ? (
        <Card title={t('encounter.addendum.title')} className="or-note__addendum">
          <p className="or-caption" id="addendum-hint">
            {t('encounter.addendum.hint')}
          </p>
          <label className="or-note__addendum-label" htmlFor="addendum-text">
            {t('encounter.addendum.label')}
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
              {t('encounter.addendum.discard')}
            </Button>
            <Button
              variant="primary"
              iconLeft="pen-line"
              disabled={addendumText.trim().length === 0}
              onClick={() => setConfirming('addendum')}
            >
              {t('encounter.action.signAddendum')}
            </Button>
          </div>
        </Card>
      ) : null}

      <Modal
        open={confirming === 'sign'}
        role="alertdialog"
        title={t('encounter.confirm.sign.title')}
        description={t('encounter.confirm.sign.description')}
        onClose={() => setConfirming(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              {t('encounter.action.cancel')}
            </Button>
            <Button variant="primary" disabled={signing.pending} onClick={sign}>
              {signing.pending ? t('encounter.action.signing') : t('encounter.action.signNote')}
            </Button>
          </>
        }
      >
        {/* The sentence the signer is attesting to, rendered exactly as the
            record will store it. Not a catalogue string: a clinician must read
            the words that go into the note, not a translation of them. */}
        <p className="or-body">{ATTESTATION}</p>
        <p className="or-caption">
          {t('encounter.confirm.sign.signingAs', {
            signer: formatCredentialed(note.providerName, note.providerCredential),
          })}
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
        title={t('encounter.confirm.addendum.title')}
        description={t('encounter.confirm.addendum.description')}
        onClose={() => setConfirming(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              {t('encounter.action.cancel')}
            </Button>
            <Button variant="primary" disabled={amending.pending} onClick={signAddendum}>
              {amending.pending
                ? t('encounter.action.signing')
                : t('encounter.action.signAddendum')}
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
            message={t('encounter.toast.message')}
            onClose={() => setToast(null)}
          />
        </div>
      ) : null}
    </div>
  );
}
