/**
 * index.tsx — public <MarkdownReviewer /> composition (STORY-001-05)
 *
 * Composes FileMenu + EditorPane + Toast under a single root component.
 * Owns the read/edit toggle and the storage instance.
 *
 * Props (final EPIC-001 shape — NO onSubmit, NO comments):
 *   initialFiles  — seeded ONLY when storage is empty
 *   storageKey    — localStorage key; defaults to DEFAULT_STORAGE_KEY
 *   theme         — 'light' | 'dark'
 *   className     — merged onto the root element
 *
 * storageKey collision warning:
 *   A module-level Set tracks mounted keys. If two instances share the same key,
 *   console.warn fires once on the second mount.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createStorage, StorageQuotaError, StorageRenameCollisionError } from './storage';
import type { StorageState } from './types';
import { DEFAULT_STORAGE_KEY } from './types';
import type { MarkdownReviewerProps, ReviewPayload } from './types';
import { FileMenu } from './FileMenu';
import { Toast } from './Toast';
import type { ToastData } from './Toast';
import { EditorPane } from './EditorPane';
import { CommentLayer } from './CommentLayer';
import type { CreateCommentPayload } from './CommentLayer';
import { reconcile } from './utils/anchor';
import { ReviewBar } from './ReviewBar';

// ─── storageKey collision guard ───────────────────────────────────────────────

const _mountedKeys = new Set<string>();

// ─── Debounce helper ──────────────────────────────────────────────────────────

function useDebounce(fn: (value: string) => void, delayMs: number) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingValueRef = useRef<string | null>(null);

  const debounced = useCallback(
    (value: string) => {
      pendingValueRef.current = value;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const v = pendingValueRef.current;
        if (v !== null) {
          pendingValueRef.current = null;
          fn(v);
        }
      }, delayMs);
    },
    [fn, delayMs],
  );

  /** Flush: call fn immediately with the pending value (if any) and cancel the timer. */
  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const v = pendingValueRef.current;
    if (v !== null) {
      pendingValueRef.current = null;
      fn(v);
    }
  }, [fn]);

  /** Cancel: discard any pending value without calling fn. */
  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingValueRef.current = null;
  }, []);

  return { debounced, flush, cancel };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MarkdownReviewer({
  initialFiles,
  storageKey = DEFAULT_STORAGE_KEY,
  theme = 'light',
  className,
  onSubmit,
}: MarkdownReviewerProps) {
  // ── storageKey collision warning ───────────────────────────────────────────
  useEffect(() => {
    if (_mountedKeys.has(storageKey)) {
      console.warn(
        `Multiple MarkdownReviewer instances share storageKey "${storageKey}"`,
      );
    }
    _mountedKeys.add(storageKey);
    return () => {
      _mountedKeys.delete(storageKey);
    };
  }, [storageKey]);

  // ── Storage (memoised on storageKey so changes re-create) ──────────────────
  const storage = useMemo(() => createStorage(storageKey), [storageKey]);

  // ── Component state ────────────────────────────────────────────────────────
  const [state, setState] = useState<StorageState>(() => {
    const loaded = storage.loadState();
    // Seed initialFiles only when storage is empty (no overwrite on mount)
    if (initialFiles && initialFiles.length > 0 && Object.keys(loaded.files).length === 0) {
      let seeded = loaded;
      for (const f of initialFiles) {
        const next = {
          ...seeded,
          files: { ...seeded.files, [f.name]: f.content },
          activeFile: seeded.activeFile === null ? f.name : seeded.activeFile,
        };
        // Write to storage; on quota error just use what we have
        try {
          storage.saveState(next);
          seeded = next;
        } catch {
          break;
        }
      }
      return seeded;
    }
    return loaded;
  });

  const [editMode, setEditMode] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);

  // ── Debounced save (500 ms) ────────────────────────────────────────────────
  const saveFn = useCallback(
    (content: string) => {
      const activeFile = state.activeFile;
      if (!activeFile) return;
      try {
        // Bug B fix: read fresh state from localStorage so that any comment
        // deletes/edits that happened since saveFn was last rebuilt are not
        // overwritten. saveFn's deps only include state.activeFile (not
        // state.comments), so the closure can hold stale comments — a flush
        // during file-switch would re-persist the old deleted comments.
        const fresh = storage.loadState();
        storage.saveState({
          ...fresh,
          files: { ...fresh.files, [activeFile]: content },
          mtime: { ...fresh.mtime, [activeFile]: new Date().toISOString() },
        });
        // saveState returns void; reload from storage to stay in sync
        setState(storage.loadState());
      } catch (err) {
        if (err instanceof StorageQuotaError) {
          setToast({
            kind: 'error',
            message: 'Storage quota exceeded — delete a file to free space',
          });
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.activeFile, storage],
  );

  const { debounced: debouncedSave, flush: flushSave } = useDebounce(saveFn, 500);

  // Expose flush via ref so EditorPane cleanup ordering works
  const flushRef = useRef(flushSave);
  useEffect(() => {
    flushRef.current = flushSave;
  });

  // ── File switch: flush pending debounce BEFORE switching activeFile ────────
  function handleSelect(name: string) {
    flushRef.current();
    try {
      const next = storage.setActiveFile(name);
      setState(next);
    } catch (err) {
      if (err instanceof StorageQuotaError) {
        setToast({
          kind: 'error',
          message: 'Storage quota exceeded — delete a file to free space',
        });
      }
    }
    setEditMode(false);
  }

  // ── FileMenu callbacks ────────────────────────────────────────────────────
  function handleAdd(name: string, content: string) {
    try {
      const next = storage.addFile(name, content);
      setState(next);
    } catch (err) {
      if (err instanceof StorageQuotaError) {
        setToast({
          kind: 'error',
          message: 'Storage quota exceeded — delete a file to free space',
        });
      }
    }
  }

  function handleReject(toastData: ToastData) {
    setToast(toastData);
  }

  function handleRename(oldName: string, newName: string) {
    try {
      const next = storage.renameFile(oldName, newName);
      setState(next);
    } catch (err) {
      if (err instanceof StorageRenameCollisionError) {
        setToast({ kind: 'error', message: 'A file with that name already exists' });
      } else if (err instanceof StorageQuotaError) {
        setToast({
          kind: 'error',
          message: 'Storage quota exceeded — delete a file to free space',
        });
      }
    }
  }

  function handleDelete(name: string) {
    try {
      const next = storage.deleteFile(name);
      setState(next);
    } catch (err) {
      if (err instanceof StorageQuotaError) {
        setToast({
          kind: 'error',
          message: 'Storage quota exceeded — delete a file to free space',
        });
      }
    }
  }

  // ── EditorPane onChange ───────────────────────────────────────────────────
  function handleEditorChange(next: string) {
    if (!editMode) return;
    debouncedSave(next);
  }

  // ── Reconciliation pass (anchor drift — STORY-002-03) ─────────────────────
  //
  // Runs after a debounced markdown change to flip `detached` flags.
  // Must NOT run in render — wrapped in useEffect keyed on markdownSource + activeFile
  // (story §1.5 risk: calling setCommentDetached in render creates an infinite loop).
  //
  // Strategy: use a ref-based stable callback so the debounce never goes stale.

  const reconcileFn = useCallback(
    (nextMarkdown: string) => {
      const af = state.activeFile;
      if (!af) return;
      const comments = state.comments[af] ?? [];
      let didChange = false;
      for (const c of comments) {
        const { matched } = reconcile(nextMarkdown, c);
        const shouldBeDetached = !matched;
        if (c.detached !== shouldBeDetached) {
          try {
            storage.setCommentDetached(af, c.id, shouldBeDetached);
            didChange = true;
          } catch {
            // StorageQuotaError during a flag flip is extremely unlikely;
            // swallow silently to avoid disrupting editing.
          }
        }
      }
      if (didChange) {
        setState(storage.loadState());
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.activeFile, state.comments, storage],
  );

  const { debounced: debouncedReconcile } = useDebounce(reconcileFn, 500);

  // handleMarkdownChange — passed to EditorPane as onMarkdownChange (raw, no debounce).
  // The debounce lives here in the parent (M1 §2.3 blueprint note).
  const handleMarkdownChange = useCallback(
    (next: string) => {
      if (!editMode) return;
      debouncedReconcile(next);
    },
    [editMode, debouncedReconcile],
  );

  // ── Comment CRUD callbacks ────────────────────────────────────────────────
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  function handleCreateComment(payload: CreateCommentPayload) {
    const af = state.activeFile;
    if (!af) return;
    try {
      storage.addComment(af, {
        range: payload.range,
        selectedText: payload.selectedText,
        comment: payload.comment,
      });
      setState(storage.loadState());
    } catch (err) {
      if (err instanceof StorageQuotaError) {
        setToast({
          kind: 'error',
          message: 'Storage quota exceeded — delete a file to free space',
        });
      }
    }
  }

  function handleEditComment(id: string, text: string) {
    const af = state.activeFile;
    if (!af) return;
    try {
      storage.updateComment(af, id, { comment: text });
      setState(storage.loadState());
    } catch (err) {
      if (err instanceof StorageQuotaError) {
        setToast({
          kind: 'error',
          message: 'Storage quota exceeded — delete a file to free space',
        });
      }
    }
  }

  function handleDeleteComment(id: string) {
    const af = state.activeFile;
    if (!af) return;
    try {
      storage.deleteComment(af, id);
      setState(storage.loadState());
    } catch (err) {
      if (err instanceof StorageQuotaError) {
        setToast({
          kind: 'error',
          message: 'Storage quota exceeded — delete a file to free space',
        });
      }
    }
  }

  function handleSetDetached(id: string, detached: boolean) {
    const af = state.activeFile;
    if (!af) return;
    try {
      storage.setCommentDetached(af, id, detached);
      setState(storage.loadState());
    } catch {
      // StorageQuotaError on a flag flip is extremely unlikely; swallow silently.
    }
  }

  // ── ReviewPayload assembly (STORY-002-04) ────────────────────────────────
  function buildPayload(): ReviewPayload {
    const f = state.activeFile!;
    return {
      file: {
        name: f,
        content: state.files[f] ?? '',
        // lastModified from mtime map; fallback to current time if not yet set
        lastModified: state.mtime[f] ?? new Date().toISOString(),
      },
      comments: state.comments[f] ?? [],
      submittedAt: new Date().toISOString(),
    };
  }

  async function defaultOnSubmit(payload: ReviewPayload): Promise<void> {
    console.log(payload);
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setToast({ kind: 'info', message: 'Copied to clipboard' });
    } catch {
      // navigator.clipboard unavailable (non-secure context or sandboxed iframe)
      setToast({ kind: 'info', message: 'Clipboard unavailable — see console for payload' });
    }
  }

  async function handleReview(): Promise<void> {
    if (!state.activeFile) return;
    const payload = buildPayload();
    // ?? ensures the default runs ONLY when no host handler is provided (no double-copy).
    await (onSubmit ?? defaultOnSubmit)(payload);
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const files = Object.keys(state.files);
  const activeFile = state.activeFile;
  const activeContent = activeFile !== null ? (state.files[activeFile] ?? '') : '';
  const activeComments = activeFile !== null ? (state.comments[activeFile] ?? []) : [];

  return (
    <div
      data-testid="markdown-reviewer"
      className={['flex h-full min-h-0', className].filter(Boolean).join(' ')}
    >
      {/* Left sidebar — FileMenu */}
      <aside className="w-64 shrink-0 border-r overflow-hidden flex flex-col">
        <FileMenu
          files={files}
          activeFile={activeFile}
          onSelect={handleSelect}
          onAdd={handleAdd}
          onReject={handleReject}
          onRename={handleRename}
          onDelete={handleDelete}
        />
      </aside>

      {/* Right pane — editor area */}
      <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        {/* ReviewBar: always visible; Review button disabled when no activeFile.
            Replaces the temporary inline Edit toggle from STORY-001-05. */}
        <ReviewBar
          activeFile={activeFile}
          editMode={editMode}
          onToggleEditMode={() => setEditMode((m) => !m)}
          onReview={handleReview}
        />

        {activeFile !== null ? (
          <>
            {/* Editor area: position:relative so highlight overlays can be absolute */}
            <div ref={scrollContainerRef} className="relative flex-1 min-h-0 overflow-auto">
              {/* EditorPane — key forces remount on file switch (clean Crepe instance) */}
              <EditorPane
                key={activeFile}
                value={activeContent}
                onChange={handleEditorChange}
                readOnly={!editMode}
                theme={theme}
                editorRootRef={(el) => { editorRootRef.current = el; }}
                onMarkdownChange={handleMarkdownChange}
              />

              {/* CommentLayer: overlays + tooltip + new-comment popover */}
              <CommentLayer
                markdownSource={activeContent}
                editorRoot={editorRootRef.current}
                scrollContainer={scrollContainerRef.current}
                readonly={!editMode}
                comments={activeComments}
                onCreate={handleCreateComment}
                onEditComment={handleEditComment}
                onDeleteComment={handleDeleteComment}
                onSetDetached={handleSetDetached}
              />
            </div>
          </>
        ) : (
          <div
            data-testid="no-file-placeholder"
            className="flex flex-1 items-center justify-center text-gray-400 text-sm"
          >
            Drop a <code className="mx-1">.md</code> file or choose one from the sidebar.
          </div>
        )}
      </div>

      {/* Toast host */}
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
