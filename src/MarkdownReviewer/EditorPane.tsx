/**
 * EditorPane.tsx — presentational Crepe/Milkdown editor wrapper (STORY-001-05)
 *
 * Props:
 *   value     — markdown source to display (identity change triggers re-mount via key)
 *   onChange  — called with serialised markdown on each edit (debounced by parent)
 *   readOnly  — when true, Crepe is set to read-only
 *   theme     — 'light' (default) or 'dark'; dark falls back to light in v1 with a
 *               one-shot console.info per mount
 *
 * Cleanup contract (§1.5 risk mitigation):
 *   On unmount (or when the active file switches, which causes a key-driven re-mount),
 *   destroy() is called on the Crepe instance to release the ProseMirror view.
 *   The parent flushes any pending storage debounce BEFORE the key changes, so by the
 *   time EditorPane unmounts the debounce is already resolved.
 */

import { useEffect, useRef } from 'react';
import { Crepe } from '@milkdown/crepe';

export interface EditorPaneProps {
  value: string;
  onChange: (next: string) => void;
  readOnly: boolean;
  theme?: 'light' | 'dark';
  /**
   * editorRootRef — optional callback ref or RefObject forwarded from a parent
   * (e.g. CommentLayer integration in STORY-002-01). Receives the Crepe
   * contenteditable root element so CommentLayer can attach selectionchange
   * listeners inside the correct DOM subtree.
   *
   * Implementation: assigned inside the first useEffect (after Crepe is created)
   * via a callback-ref check. Using useImperativeHandle is overkill here.
   */
  editorRootRef?: React.Ref<HTMLDivElement | null>;
  /**
   * onMarkdownChange — fired RAW (not debounced) on every markdown edit.
   * The parent (index.tsx) debounces this via `useDebounce` to avoid re-running
   * the reconciliation pass on every keystroke. Do NOT add a debounce here.
   * (STORY-002-03)
   */
  onMarkdownChange?: (next: string) => void;
}

// Module-level guard so the console.info fires at most once per dark-theme mount
// (resets per HMR cycle — acceptable for dev)
let _darkInfoFired = false;

export function EditorPane({ value, onChange, readOnly, theme = 'light', editorRootRef, onMarkdownChange }: EditorPaneProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  // Stable ref to always call the latest onChange without re-running the effect
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Stable ref for onMarkdownChange (STORY-002-03 — fired raw, parent debounces)
  const onMarkdownChangeRef = useRef(onMarkdownChange);
  useEffect(() => {
    onMarkdownChangeRef.current = onMarkdownChange;
  });

  // Stable ref to the editorRootRef prop so we can call it in the mount effect
  // without re-running the effect when the prop changes identity.
  const editorRootRefRef = useRef(editorRootRef);
  useEffect(() => {
    editorRootRefRef.current = editorRootRef;
  });

  useEffect(() => {
    if (!rootRef.current) return;

    // Forward the editor root ref to the parent (for CommentLayer in STORY-002-01)
    const erRef = editorRootRefRef.current;
    if (erRef) {
      if (typeof erRef === 'function') {
        erRef(rootRef.current);
      } else {
        // React.MutableRefObject
        (erRef as React.MutableRefObject<HTMLDivElement | null>).current = rootRef.current;
      }
    }

    if (theme === 'dark' && !_darkInfoFired) {
      _darkInfoFired = true;
      console.info('dark theme arrives in v2');
    }

    const crepe = new Crepe({
      root: rootRef.current,
      defaultValue: value,
    });

    // Wire onChange and onMarkdownChange via the listener API before .create()
    crepe.on((api) => {
      api.markdownUpdated((_ctx, markdown) => {
        onChangeRef.current(markdown);
        // Fire raw — parent debounces (STORY-002-03)
        if (onMarkdownChangeRef.current) {
          onMarkdownChangeRef.current(markdown);
        }
      });
    });

    crepe.setReadonly(readOnly);

    crepeRef.current = crepe;

    // Create is async — store the promise so cleanup can await it if needed
    let destroyed = false;
    crepe.create().catch((err: unknown) => {
      if (!destroyed) console.error('[EditorPane] Crepe.create() failed:', err);
    });

    return () => {
      destroyed = true;
      crepeRef.current = null;
      // Clear the forwarded editor-root ref on unmount
      const erRefOnUnmount = editorRootRefRef.current;
      if (erRefOnUnmount) {
        if (typeof erRefOnUnmount === 'function') {
          erRefOnUnmount(null);
        } else {
          (erRefOnUnmount as React.MutableRefObject<HTMLDivElement | null>).current = null;
        }
      }
      crepe.destroy().catch(() => {
        // Swallow — can throw if create() never resolved
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // NOTE: We intentionally do NOT include `value` or `readOnly` in the dep array.
  // The parent mounts EditorPane with a stable `key={activeFile}` — a file switch
  // causes a full unmount+remount (new key), which re-runs this effect with the
  // correct `value`. readOnly changes are applied via a separate effect below.

  // Sync readOnly changes without remounting
  useEffect(() => {
    if (crepeRef.current) {
      crepeRef.current.setReadonly(readOnly);
    }
  }, [readOnly]);

  return (
    <div
      ref={rootRef}
      data-testid="editor-pane"
      className={[
        'flex-1 overflow-auto',
        theme === 'dark' ? 'editor-pane--dark' : 'editor-pane--light',
      ].join(' ')}
    />
  );
}
