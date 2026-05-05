/**
 * Toast.tsx — controlled toast notification component (STORY-001-03)
 *
 * Design: controlled — the parent owns the toast state machine.
 * Props:
 *   toast: { kind: 'success' | 'error' | 'info'; message: string } | null
 *   onDismiss: () => void
 *
 * Auto-dismisses after 4 s. Click dismisses immediately.
 * Fixed position bottom-right, Tailwind-styled.
 */

import { useEffect } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ToastData {
  kind: 'success' | 'error' | 'info';
  message: string;
}

export interface ToastProps {
  toast: ToastData | null;
  onDismiss: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

const KIND_STYLES: Record<ToastData['kind'], string> = {
  success: 'bg-green-100 border-green-400 text-green-800',
  error: 'bg-red-100 border-red-400 text-red-800',
  info: 'bg-blue-100 border-blue-400 text-blue-800',
};

const AUTO_DISMISS_MS = 4000;

export function Toast({ toast, onDismiss }: ToastProps) {
  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  if (toast === null) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed bottom-4 right-4 z-50"
    >
      <div
        className={[
          'flex items-center gap-2 rounded border px-4 py-3 shadow-md cursor-pointer',
          KIND_STYLES[toast.kind],
        ].join(' ')}
        onClick={onDismiss}
        data-testid="toast"
      >
        <span className="flex-1 text-sm">{toast.message}</span>
        <button
          type="button"
          aria-label="Dismiss notification"
          className="ml-2 text-lg font-bold leading-none opacity-60 hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
        >
          &times;
        </button>
      </div>
    </div>
  );
}
