'use client';

import { Badge, Card } from '@openrunic/ui';
import type { ReactElement } from 'react';

import type { Addendum, NoteSignature } from '@/lib/api/chart';
import { formatDateTime } from '@/lib/format';

/**
 * The e-sign unit, C25.
 *
 * Identical wherever it appears - notes, forms, consents, staff and portal -
 * and undecorated on purpose: a signature block that has been styled to look
 * impressive is a signature block nobody reads. Signer, credential, the moment,
 * the attestation sentence, and the hash that proves the locked text is the
 * text that was signed.
 */

export interface SignatureBlockProps {
  signature: NoteSignature;
  addenda: readonly Addendum[];
}

export function SignatureBlock({
  signature,
  addenda,
}: Readonly<SignatureBlockProps>): ReactElement {
  return (
    <Card title="Signature" className="or-signature">
      <p className="or-body or-signature__attestation">{signature.attestation}</p>
      <dl className="or-signature__grid">
        <div className="or-signature__pair">
          <dt className="or-overline">Signed by</dt>
          <dd className="or-body">
            {signature.signerName}, {signature.credential}
          </dd>
        </div>
        <div className="or-signature__pair">
          <dt className="or-overline">Signed at</dt>
          <dd className="or-body">{formatDateTime(signature.signedAt)}</dd>
        </div>
        <div className="or-signature__pair">
          <dt className="or-overline">Content hash</dt>
          <dd className="or-body or-mono">{signature.hash}</dd>
        </div>
      </dl>

      {addenda.length > 0 ? (
        <div className="or-signature__addenda">
          <h4 className="or-h3 or-signature__addenda-title">Addenda</h4>
          <ul className="or-signature__addenda-list">
            {addenda.map((addendum) => (
              <li key={addendum.id} className="or-signature__addendum">
                <Badge tone="neutral">Addendum</Badge>
                <p className="or-body or-signature__addendum-text">{addendum.text}</p>
                <p className="or-caption">
                  {addendum.authorName}, {addendum.credential}, {formatDateTime(addendum.addedAt)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
