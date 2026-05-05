/**
 * Comment.tsx — single-comment popover with view / edit modes (STORY-002-02)
 *
 * Architecture rules (EPIC-002 §0):
 *   - Comment text rendered as text only — no dangerouslySetInnerHTML.
 *   - No storage calls here; all mutations go through parent callbacks.
 *   - Esc cancels edit (does NOT commit); Save commits and calls onClose.
 *   - Once mode === 'edit', mouseleave dismiss is disabled (per §1.4 recommended).
 *   - Empty / whitespace-only draft blocks Save (same rule as create-side).
 *
 * Props:
 *   comment   — the Comment to display
 *   onEdit    — called with (id, newText) when Save is clicked
 *   onDelete  — called with (id) when Delete is clicked (immediate, no confirm)
 *   onClose   — called after Save or Delete; parent should hide this component
 */

import { useEffect, useRef, useState } from 'react';
import type { Comment as CommentType } from './types';

export interface CommentProps {
  comment: CommentType;
  /**
   * currentText — the current canonicalized text at the comment's range in
   * the live markdown source. Passed from CommentLayer to avoid re-running
   * reconcile() inside this component (STORY-002-03).
   * When `comment.detached === true`, this is displayed in the Was/Now line.
   */
  currentText?: string;
  onEdit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function Comment({ comment, currentText = '', onEdit, onDelete, onClose }: CommentProps) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [draftText, setDraftText] = useState(comment.comment);
  const [validationError, setValidationError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (mode === 'edit' && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [mode]);

  function handleEditClick() {
    setDraftText(comment.comment);
    setValidationError(null);
    setMode('edit');
  }

  function handleSave() {
    if (draftText.trim() === '') {
      setValidationError('Please enter a comment');
      return;
    }
    onEdit(comment.id, draftText.trim());
    onClose();
  }

  function handleCancelEdit() {
    setMode('view');
    setDraftText(comment.comment);
    setValidationError(null);
  }

  function handleDelete() {
    onDelete(comment.id);
    onClose();
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      handleCancelEdit();
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
  }

  return (
    <div
      data-testid="comment-tooltip"
      role="dialog"
      aria-modal="true"
      aria-label={`Comment: ${comment.comment}`}
      className="rounded border border-gray-300 bg-white p-3 shadow-lg"
      style={{ minWidth: 220, maxWidth: 320 }}
    >
      {mode === 'view' ? (
        <>
          {/* Was/Now line for detached comments (STORY-002-03) — text only */}
          {comment.detached && (
            <p
              data-testid="comment-was-now"
              className="mb-2 text-xs text-amber-700 break-words border-l-2 border-amber-400 pl-2"
            >
              {`Was: "${comment.selectedText}" — Now: "${currentText}"`}
            </p>
          )}

          {/* Comment text (text only — no dangerouslySetInnerHTML) */}
          <p
            data-testid="comment-text"
            className="mb-2 text-sm text-gray-800 break-words"
          >
            {comment.comment}
          </p>

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              data-testid="comment-edit-btn"
              onClick={handleEditClick}
              className="rounded border px-2 py-1 text-xs hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Edit
            </button>
            <button
              type="button"
              data-testid="comment-delete-btn"
              onClick={handleDelete}
              className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              Delete
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Edit mode */}
          <textarea
            ref={textareaRef}
            data-testid="comment-edit-textarea"
            value={draftText}
            onChange={(e) => {
              setDraftText(e.target.value);
              if (validationError) setValidationError(null);
            }}
            onKeyDown={handleTextareaKeyDown}
            rows={3}
            placeholder="Edit comment…"
            className="w-full rounded border border-gray-300 p-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {validationError !== null && (
            <p
              role="alert"
              data-testid="comment-edit-validation-hint"
              className="mt-1 text-xs text-red-600"
            >
              {validationError}
            </p>
          )}

          <div className="mt-2 flex gap-2 justify-end">
            <button
              type="button"
              data-testid="comment-edit-cancel"
              onClick={handleCancelEdit}
              className="rounded border px-2 py-1 text-xs hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="comment-edit-save"
              onClick={handleSave}
              className="rounded bg-yellow-400 px-2 py-1 text-xs font-medium text-yellow-900 hover:bg-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500"
            >
              Save
            </button>
          </div>
        </>
      )}
    </div>
  );
}
