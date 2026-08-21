'use client';

import { STATUS_COPY } from '@/lib/downtime/status';
import { useTranslator } from '@/lib/i18n/messages';

import { useConnectivity } from './ConnectivityProvider';
import styles from './downtime.module.css';

/**
 * The banner staff see when the records system cannot be reached.
 *
 * Deliberately not dismissable. A clinician who closes it and keeps typing a
 * note that is not being saved has lost that note, and will not find out until
 * the patient has left. It stays until the condition clears.
 *
 * It is also not a toast. Toasts disappear, and this has to still be on screen
 * for the person who walks up to the machine ten minutes later.
 */
export function DowntimeBanner() {
  const { status, recheck } = useConnectivity();
  const t = useTranslator();

  if (status === 'online') return null;

  const copy = STATUS_COPY[status];

  return (
    <div
      // `alert` rather than `status`: assertive is right here. A screen-reader
      // user must not finish dictating a note before being told it is not
      // being saved.
      role="alert"
      aria-live="assertive"
      data-testid="downtime-banner"
      data-status={status}
      className={styles.banner}
    >
      <div className={styles.body}>
        <p className={styles.title}>{t(copy.titleKey)}</p>
        <p className={styles.detail}>{t(copy.detailKey)}</p>
        {copy.actionKey === null ? null : <p className={styles.action}>{t(copy.actionKey)}</p>}
      </div>
      <button type="button" onClick={recheck} className={styles.retry}>
        {t('downtime.checkAgain')}
      </button>
    </div>
  );
}
