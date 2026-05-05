/**
 * FileMenu.tsx — sidebar file list with drag-drop + pick-file + rename + delete
 * (STORY-001-03 base; STORY-001-04 adds inline rename + delete-confirm)
 *
 * Props:
 *   files      — ordered list of filenames to display
 *   activeFile — currently selected filename (or null)
 *   onSelect   — called when the user clicks / presses Enter on a file row
 *   onAdd      — called with (name, content) when a valid .md file is accepted
 *   onReject   — called with a toast payload when a file is rejected (also used
 *                for UI-side rename validation errors, e.g. missing .md extension)
 *   onRename   — called with (oldName, newName) after UI-side validation passes
 *   onDelete   — called with (name) after the user confirms inline delete
 *
 * ─── Row state machine ───────────────────────────────────────────────────────
 *
 * type RowMode = 'view' | 'rename' | 'confirm-delete'
 *
 * Per-row state is held in a Map<filename, RowMode> inside component state.
 * Only one row may be in a non-'view' mode at a time; entering a new mode on
 * row B resets row A back to 'view'.
 */

import { useRef, useState } from 'react';
import { DropZone, isMdFile, readFileAsText } from './DropZone';
import { Toast, type ToastData } from './Toast';

// ─── Row state machine types ──────────────────────────────────────────────────

/** @see STORY-001-04 — 'rename' and 'confirm-delete' modes wired here */
export type RowMode = 'view' | 'rename' | 'confirm-delete';

export interface RowState {
  mode: RowMode;
}

// ─── Component props ─────────────────────────────────────────────────────────

export interface FileMenuProps {
  files: string[];
  activeFile: string | null;
  onSelect: (name: string) => void;
  onAdd: (name: string, content: string) => void;
  onReject: (toast: ToastData) => void;
  /** Called after UI-side validation passes (extension check). Parent handles storage. */
  onRename?: (oldName: string, newName: string) => void;
  /** Called when user confirms deletion. Parent handles storage. */
  onDelete?: (name: string) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function FileMenu({ files, activeFile, onSelect, onAdd, onReject, onRename, onDelete }: FileMenuProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Local toast state — FileMenu surfaces the toast for in-menu feedback
  const [toast, setToast] = useState<ToastData | null>(null);

  // Per-row mode: only one row can be in non-view mode at a time.
  // Key: filename. Value: current RowMode (only stored when non-'view').
  const [rowMode, setRowMode] = useState<Map<string, RowMode>>(new Map());

  // Draft rename input value (for the currently renaming row)
  const [renameDraft, setRenameDraft] = useState<string>('');

  // Ref for the rename input — needed for focus + select-all
  const renameInputRef = useRef<HTMLInputElement>(null);

  function handleReject(payload: ToastData) {
    setToast(payload);
    onReject(payload); // also propagate to parent
  }

  function handleAccept(name: string, content: string) {
    onAdd(name, content);
  }

  async function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const inputFiles = e.target.files;
    if (!inputFiles || inputFiles.length === 0) return;

    for (const file of Array.from(inputFiles)) {
      if (!isMdFile(file)) {
        handleReject({ kind: 'error', message: 'Only .md files are supported' });
        continue;
      }
      try {
        const content = await readFileAsText(file);
        handleAccept(file.name, content);
      } catch {
        handleReject({ kind: 'error', message: `Failed to read ${file.name}` });
      }
    }

    // Reset input so selecting the same file again triggers onChange
    e.target.value = '';
  }

  function handleChooseFile() {
    fileInputRef.current?.click();
  }

  // ─── Row mode helpers ───────────────────────────────────────────────────────

  /** Enter rename mode for the given row; resets any other active row to 'view'. */
  function enterRenameMode(name: string) {
    setRowMode(new Map([[name, 'rename']]));
    setRenameDraft(name);
    // Focus + select-all happens via the ref callback below after render
  }

  /** Enter confirm-delete mode for the given row; resets any other active row to 'view'. */
  function enterConfirmDeleteMode(name: string) {
    setRowMode(new Map([[name, 'confirm-delete']]));
  }

  /** Reset all rows to 'view' mode. */
  function resetAllRows() {
    setRowMode(new Map());
    setRenameDraft('');
  }

  // ─── Rename handlers ────────────────────────────────────────────────────────

  function commitRename(oldName: string, draft: string) {
    const newName = draft.trim();

    // Same as current — no-op, return to view
    if (newName === oldName) {
      resetAllRows();
      return;
    }

    // UI-side .md extension check (story §1.2 — before calling onRename)
    if (!newName.toLowerCase().endsWith('.md')) {
      handleReject({ kind: 'error', message: 'File name must end in .md' });
      // Stay in rename mode; reset draft to original name
      setRenameDraft(oldName);
      // Re-focus
      setTimeout(() => {
        if (renameInputRef.current) {
          renameInputRef.current.focus();
          renameInputRef.current.select();
        }
      }, 0);
      return;
    }

    // Call onRename — parent handles collision + storage
    resetAllRows();
    if (onRename) {
      onRename(oldName, newName);
    }
  }

  function handleRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>, oldName: string) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename(oldName, renameDraft);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      resetAllRows();
    }
  }

  function handleRenameBlur(oldName: string) {
    // Blur commits rename (story §1.5 — matches OS conventions)
    const currentMode = rowMode.get(oldName);
    if (currentMode === 'rename') {
      commitRename(oldName, renameDraft);
    }
  }

  // ─── Delete handlers ────────────────────────────────────────────────────────

  function handleDeleteConfirm(name: string) {
    resetAllRows();
    if (onDelete) {
      onDelete(name);
    }
  }

  function handleDeleteCancel() {
    resetAllRows();
  }

  return (
    <nav aria-label="File list" className="flex h-full flex-col">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,text/markdown"
        multiple
        className="sr-only"
        onChange={handleFileInputChange}
        data-testid="file-input"
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* Choose-file button — first in tab order */}
      <div className="border-b p-2">
        <button
          type="button"
          onClick={handleChooseFile}
          className="w-full rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          data-testid="choose-file-btn"
        >
          Choose file
        </button>
      </div>

      {/* DropZone wraps the file list area */}
      <DropZone onAccept={handleAccept} onReject={handleReject}>
        <ul className="flex-1 overflow-y-auto" role="listbox" aria-label="Files">
          {files.map((name) => {
            const isActive = name === activeFile;
            const mode = rowMode.get(name) ?? 'view';

            if (mode === 'rename') {
              // ─── Rename mode ───────────────────────────────────────────────
              return (
                <li key={name} role="presentation">
                  <div
                    className={[
                      'flex items-center gap-1 px-2 py-1',
                      isActive ? 'border-l-4 border-yellow-400 bg-yellow-100' : 'border-l-4 border-transparent',
                    ].join(' ')}
                    data-testid={`file-row-rename-${name}`}
                  >
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => handleRenameKeyDown(e, name)}
                      onBlur={() => handleRenameBlur(name)}
                      className="flex-1 rounded border border-blue-400 px-1 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      data-testid={`rename-input-${name}`}
                      aria-label={`Rename ${name}`}
                      // Auto-focus + select-all via callback ref pattern
                      autoFocus
                      onFocus={(e) => e.target.select()}
                    />
                  </div>
                </li>
              );
            }

            if (mode === 'confirm-delete') {
              // ─── Confirm-delete mode ───────────────────────────────────────
              return (
                <li key={name} role="presentation">
                  <div
                    className={[
                      'flex items-center gap-1 px-2 py-1 text-sm',
                      isActive ? 'border-l-4 border-yellow-400 bg-yellow-100' : 'border-l-4 border-transparent',
                    ].join(' ')}
                    data-testid={`file-row-confirm-delete-${name}`}
                  >
                    <span className="flex-1 truncate">{name}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteConfirm(name)}
                      className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                      data-testid={`delete-confirm-yes-${name}`}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteCancel}
                      className="rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400"
                      data-testid={`delete-confirm-cancel-${name}`}
                    >
                      Cancel
                    </button>
                  </div>
                </li>
              );
            }

            // ─── View mode (default) ─────────────────────────────────────────
            return (
              <li key={name} role="presentation">
                <div
                  className={[
                    'flex items-center',
                    isActive ? 'border-l-4 border-yellow-400 bg-yellow-100' : 'border-l-4 border-transparent',
                  ].join(' ')}
                >
                  <button
                    role="option"
                    aria-selected={isActive}
                    aria-current={isActive ? 'true' : undefined}
                    type="button"
                    tabIndex={0}
                    className={[
                      'flex-1 px-3 py-2 text-left text-sm hover:bg-gray-100 focus:outline-none focus:ring-inset focus:ring-2 focus:ring-blue-500',
                      isActive ? 'font-medium' : '',
                    ].join(' ')}
                    onClick={() => onSelect(name)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onSelect(name);
                    }}
                    onDoubleClick={() => enterRenameMode(name)}
                    data-testid={`file-row-${name}`}
                  >
                    {name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      enterConfirmDeleteMode(name);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        enterConfirmDeleteMode(name);
                      }
                    }}
                    className="mr-1 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 focus:outline-none focus:ring-2 focus:ring-red-400"
                    data-testid={`delete-btn-${name}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      aria-hidden="true"
                      className="h-3.5 w-3.5"
                    >
                      <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>
                      <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>
                    </svg>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </DropZone>

      {/* Toast surface — controlled by local toast state */}
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </nav>
  );
}
