'use client';

import { Badge, Card } from '@openrunic/ui';
import type { ReactElement } from 'react';

import type { Addendum, NoteSignature } from '@/lib/api/chart';
import { formatCredentialed, formatDateTime } from '@/lib/format';
import { useTranslator } from '@/lib/i18n/messages';

/**
 * The e-sign unit, C25.
 *
 * Identical wherever it appears - notes, forms, consents, staff and portal -
 * and undecorated on purpose: a signature block that has been styled to look
 * impressive is a signature block nobody reads. Signer, credential, the moment,
 * and the attestation sentence.
 *
 * The last row is a fingerprint of the note's text as it currently reads, and
 * it is labelled as one rather than as proof of anything. It is computed on
 * this side from the text on this side; the API stores no hash taken at signing
 * time, so nothing here can say the text is unchanged since. Calling it proof
 * would put a guarantee on a clinical record that no code in this repository
 * can honour.
 */

export interface SignatureBlockProps {
  signature: NoteSignature;
  addenda: readonly Addendum[];
}

export function SignatureBlock({
  signature,
  addenda,
}: Readonly<SignatureBlockProps>): ReactElement {
  const t = useTranslator();

  return (
    <Card title={t('encounter.signature.title')} className="or-signature">
      {/* The attestation is the sentence the signer signed. It comes back with
          the signature and is rendered verbatim: a clinician must read the words
          they attested to, not this application's rendering of them. */}
      <p className="or-body or-signature__attestation">{signature.attestation}</p>
      <dl className="or-signature__grid">
        <div className="or-signature__pair">
          <dt className="or-overline">{t('encounter.signature.signedBy')}</dt>
          <dd className="or-body">
            {formatCredentialed(signature.signerName, signature.credential)}
          </dd>
        </div>
        <div className="or-signature__pair">
          <dt className="or-overline">{t('encounter.signature.signedAt')}</dt>
          <dd className="or-body">{formatDateTime(signature.signedAt)}</dd>
        </div>
        <div className="or-signature__pair">
          <dt className="or-overline">{t('encounter.signature.fingerprint')}</dt>
          <dd className="or-body or-mono">{signature.fingerprint}</dd>
        </div>
      </dl>

      {addenda.length > 0 ? (
        <div className="or-signature__addenda">
          <h4 className="or-h3 or-signature__addenda-title">{t('encounter.signature.addenda')}</h4>
          <ul className="or-signature__addenda-list">
            {addenda.map((addendum) => (
              <li key={addendum.id} className="or-signature__addendum">
                <Badge tone="neutral">{t('encounter.signature.addendum')}</Badge>
                <p className="or-body or-signature__addendum-text">{addendum.text}</p>
                <p className="or-caption">
                  {formatCredentialed(addendum.authorName, addendum.credential)},{' '}
                  {formatDateTime(addendum.addedAt)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
