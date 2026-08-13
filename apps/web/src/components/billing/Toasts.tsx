'use client';

import { Toast } from '@openrunic/ui';
import type { ToastTone } from '@openrunic/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

/**
 * Toast placement and lifetime, which the library's Toast deliberately leaves
 * to the consumer.
 *
 * Bottom-left, five seconds, never more than three at once, and every one
 * dismissible by hand, because an auto-dismissing confirmation that a keyboard
 * user cannot reach is not a confirmation. Toasts here carry completions and
 * undo offers only; anything that needs a decision is a drawer or a dialog.
 */

const DISMISS_MS = 5000;
const MAX_VISIBLE = 3;

export interface ToastMessage {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

export interface ToastController {
  toasts: ToastMessage[];
  push: (toast: Omit<ToastMessage, 'id'>) => void;
  dismiss: (id: number) => void;
}

export function useToasts(): ToastController {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextId = useRef(1);
  const timers = useRef<number[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<ToastMessage, 'id'>) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((current) => [...current, { ...toast, id }].slice(-MAX_VISIBLE));
      const timer = window.setTimeout(() => dismiss(id), DISMISS_MS);
      timers.current.push(timer);
    },
    [dismiss]
  );

  useEffect(() => {
    const scheduled = timers.current;
    return () => {
      for (const timer of scheduled) window.clearTimeout(timer);
    };
  }, []);

  return { toasts, push, dismiss };
}

export interface ToastDockProps {
  toasts: readonly ToastMessage[];
  onDismiss: (id: number) => void;
}

export function ToastDock({ toasts, onDismiss }: ToastDockProps): ReactElement | null {
  if (toasts.length === 0) return null;

  return (
    <div className="or-toast-dock">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          tone={toast.tone}
          title={toast.title}
          message={toast.message}
          onClose={() => onDismiss(toast.id)}
        />
      ))}
    </div>
  );
}
