/**
 * CommentLayer.tsx — selection listener + floating Comment button + new-comment
 * popover + highlight overlays + hover tooltip + click-to-edit popup
 * (STORY-002-01 / STORY-002-02 / STORY-002-02-rebuild)
 *
 * Architecture rules (EPIC-002 §0):
 *   - Markdown-source-anchored coordinates only (no DOM HTML offsets).
 *   - Comment text rendered as text only — no dangerouslySetInnerHTML.
 *   - Single selectionchange listener; overlay path extends this file.
 *   - Highlight: bg-yellow-300/60 (mustard #FFDB58 baseline) per story §1.2.
 *   - Hover tooltip: enabled via hoveredCommentId state.
 *   - Click-to-edit: opens editPopover with textarea + Save + Delete + Cancel.
 *   - Rects derived from Range.getClientRects() — scroll-container-relative.
 *   - ResizeObserver on editorRoot forces re-render on layout change.
 *
 * Rebuild rationale (Phase-D walkthrough Event 5):
 *   The previous overlay-span model had three defects:
 *     1. Drift on scroll — rects computed once, not updated on scroll.
 *     2. Block-level over-highlighting — used block.getBoundingClientRect().
 *     3. No hover/edit affordance — pointer-events:none killed interactivity.
 *   This rebuild uses Range.getClientRects() for per-visual-line, word-precise
 *   rects. Rects are recomputed on every render (derived state, not stored).
 *   The wrapper has pointer-events:none; individual rect divs have
 *   pointer-events:auto — selection passes through gaps, clicks land on rects.
 *
 * Props:
 *   markdownSource    — raw markdown string from crepe.getMarkdown()
 *   editorRoot        — ref to the Crepe contenteditable root (from EditorPane)
 *   scrollContainer   — ref to the scroll container div (from index.tsx)
 *   readonly          — when false, no Comment button appears (edit mode)
 *   comments          — persisted comments for the active file
 *   onCreate          — called with { range, selectedText, comment } on valid submit
 *   onEditComment     — called with (id, text) to persist an edit
 *   onDeleteComment   — called with (id) to delete a comment
 *   onSetDetached     — called when reconciliation detects anchor drift
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { captureSelection } from './utils/selection';
import { reconcile } from './utils/anchor';
import {
  buildBlockLineMap,
  findBlockForLine,
  getLeafBlocks,
  lineCharToRange,
} from './utils/blockMap';
import type { Comment as CommentType, Range } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateCommentPayload {
  range: Range;
  selectedText: string;
  comment: string;
}

export interface CommentLayerProps {
  markdownSource: string;
  editorRoot: HTMLElement | null;
  /** scrollContainer — the overflow-auto div that wraps EditorPane + CommentLayer.
   *  Used to compute scroll-container-relative rect coords so highlights stay
   *  anchored on scroll. When null (jsdom tests), rects fall back to viewport-
   *  relative coords (acceptable in test environment). */
  scrollContainer?: HTMLElement | null;
  readonly: boolean;
  comments: CommentType[];
  onCreate: (payload: CreateCommentPayload) => void;
  onEditComment: (id: string, text: string) => void;
  onDeleteComment: (id: string) => void;
  /** onSetDetached — called when reconciliation determines a comment's detached flag should change. */
  onSetDetached?: (id: string, detached: boolean) => void;
}

interface FloatingState {
  anchorRect: DOMRect;
  range: Range;
  selectedText: string;
}

interface PopoverState {
  range: Range;
  selectedText: string;
  anchorRect: DOMRect;
}

/** Per-visual-line rect derived from Range.getClientRects(), scroll-container-relative */
interface HighlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** State for the click-to-edit popup */
interface EditPopoverState {
  commentId: string;
  anchorRect: HighlightRect;
}

// ─── getCursorRect ────────────────────────────────────────────────────────────

/**
 * getCursorRect — returns the DOMRect at the selection's focus point (cursor).
 *
 * For multi-line selections, `domRange.getBoundingClientRect()` returns a large
 * union rect whose right edge is at the end of the longest line — far from where
 * the user actually released the cursor.  This helper constructs a zero-width
 * range at the focus node/offset so the popover anchors at the cursor position.
 *
 * Fallback chain:
 *   1. Zero-width range at focusNode/focusOffset → first non-empty DOMRect
 *   2. Last rect from domRange.getClientRects()  → visual end of selection
 *   3. domRange.getBoundingClientRect()          → original union rect
 *
 * NOTE: parameter `domRange` is typed as `globalThis.Range` (the DOM Range) to
 * avoid shadowing by the `Range` imported from ./types.
 */
function getCursorRect(selection: Selection, domRange: globalThis.Range): DOMRect {
  const focusNode = selection.focusNode;
  const focusOffset = selection.focusOffset;
  if (focusNode) {
    try {
      const cursorRange = document.createRange();
      cursorRange.setStart(focusNode, focusOffset);
      cursorRange.setEnd(focusNode, focusOffset);
      const rects = cursorRange.getClientRects();
      if (rects.length > 0 && (rects[0]!.width > 0 || rects[0]!.height > 0)) {
        return rects[0]!;
      }
    } catch {
      /* fall through */
    }
  }
  // Fallback: use the LAST rect of the selection (visual end), not the union
  const allRects = Array.from(domRange.getClientRects());
  if (allRects.length > 0) {
    return allRects[allRects.length - 1]!;
  }
  return domRange.getBoundingClientRect();
}

// ─── getCommentRects ──────────────────────────────────────────────────────────

/**
 * getCommentRects — derives per-visual-line rects for a comment by calling
 * lineCharToRange() then Range.getClientRects().
 *
 * Coords are converted from viewport-relative to scroll-container-relative:
 *   top  = r.top  - containerRect.top  + container.scrollTop
 *   left = r.left - containerRect.left + container.scrollLeft
 *
 * This means highlights auto-scroll with the content — no drift.
 *
 * Falls back to block-level rect when lineCharToRange returns null (e.g., stale
 * comment whose line no longer maps cleanly to a text node). Block-level is still
 * better than nothing and preserves the dashed-underline for detached comments.
 */
function getCommentRects(
  c: CommentType,
  markdownSource: string,
  editorRoot: HTMLElement,
  scrollContainer: HTMLElement | null,
): HighlightRect[] {
  // Try the precise Range.getClientRects() path first
  const range = lineCharToRange(
    markdownSource,
    editorRoot,
    c.range.startLine,
    c.range.startChar,
    c.range.endLine,
    c.range.endChar,
  );

  if (range && typeof range.getClientRects === 'function') {
    const clientRects = Array.from(range.getClientRects());
    // Filter out zero-area rects (jsdom returns empty arrays, browsers may return
    // collapsed rects on line breaks)
    const nonEmpty = clientRects.filter((r) => r.width > 0 || r.height > 0);
    if (nonEmpty.length > 0) {
      if (scrollContainer) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const scrollTop = scrollContainer.scrollTop;
        const scrollLeft = scrollContainer.scrollLeft;
        return nonEmpty.map((r) => ({
          top: r.top - containerRect.top + scrollTop,
          left: r.left - containerRect.left + scrollLeft,
          width: r.width,
          height: r.height,
        }));
      } else {
        // No scroll container — return viewport-relative (test environment)
        return nonEmpty.map((r) => ({
          top: r.top,
          left: r.left,
          width: r.width,
          height: r.height,
        }));
      }
    }
  }

  // Fallback: block-level rect (same as old model — preserves position for detached)
  const leafBlocks = getLeafBlocks(editorRoot);
  const blockMap = buildBlockLineMap(markdownSource, leafBlocks);
  const block = findBlockForLine(c.range.startLine, blockMap);
  if (!block) return [];

  const rootRect = editorRoot.getBoundingClientRect();
  const blockRect = block.getBoundingClientRect();

  if (scrollContainer) {
    const containerRect = scrollContainer.getBoundingClientRect();
    const scrollTop = scrollContainer.scrollTop;
    const scrollLeft = scrollContainer.scrollLeft;
    return [
      {
        top: blockRect.top - containerRect.top + scrollTop,
        left: blockRect.left - containerRect.left + scrollLeft,
        width: blockRect.width,
        height: blockRect.height,
      },
    ];
  }

  return [
    {
      top: blockRect.top - rootRect.top,
      left: blockRect.left - rootRect.left,
      width: blockRect.width,
      height: blockRect.height,
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommentLayer({
  markdownSource,
  editorRoot,
  scrollContainer,
  readonly,
  comments,
  onCreate,
  onEditComment,
  onDeleteComment,
  onSetDetached,
}: CommentLayerProps) {
  const [floating, setFloating] = useState<FloatingState | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [draftText, setDraftText] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  // Hover tooltip state
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);

  // Click-to-edit popover state
  const [editPopover, setEditPopover] = useState<EditPopoverState | null>(null);
  const [editDraftText, setEditDraftText] = useState('');

  // Re-render trigger for ResizeObserver (forces derived-rect recomputation)
  const [, setRenderTick] = useState(0);

  // Track the scroll position at the time the floating button appeared
  const scrollYAtFloatRef = useRef<number>(0);

  // Debounce timer ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref to textarea for focusing on popover open
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Ref to edit textarea for focusing on edit popover open
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // ── ResizeObserver: force re-render on editorRoot resize ──────────────────
  // This recomputes derived rects when layout changes (no stored rect state to
  // invalidate — simply triggering a re-render is sufficient).
  useEffect(() => {
    if (!editorRoot) return;

    const ResizeObserverCtor =
      typeof globalThis.ResizeObserver !== 'undefined'
        ? globalThis.ResizeObserver
        : null;

    if (!ResizeObserverCtor) return;

    const ro = new ResizeObserverCtor(() => {
      setRenderTick((t) => t + 1);
    });
    ro.observe(editorRoot);
    return () => ro.disconnect();
  }, [editorRoot]);

  // ── selectionchange handler (debounced ~50 ms) ───────────────────────────
  const handleSelectionChange = useCallback(() => {
    // If popover is open, do not clobber the floating button
    if (popover !== null) return;
    // In edit mode, no comment button
    if (!readonly) {
      setFloating(null);
      return;
    }
    if (!editorRoot) {
      setFloating(null);
      return;
    }

    const selection = document.getSelection();
    if (!selection) {
      setFloating(null);
      return;
    }

    const result = captureSelection(markdownSource, editorRoot, selection);
    if (result === null || result.selectedText === '') {
      setFloating(null);
      return;
    }

    // Position floating button near the selection end (cursor position, not union rect)
    const domRange = selection.getRangeAt(0);
    const rect = getCursorRect(selection, domRange);

    setFloating({
      anchorRect: rect,
      range: result.range,
      selectedText: result.selectedText,
    });
    scrollYAtFloatRef.current = window.scrollY;
  }, [markdownSource, editorRoot, readonly, popover]);

  // ── Debounced selectionchange listener ────────────────────────────────────
  useEffect(() => {
    const handler = () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(handleSelectionChange, 50);
    };

    document.addEventListener('selectionchange', handler);
    return () => {
      document.removeEventListener('selectionchange', handler);
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [handleSelectionChange]);

  // ── Scroll guard (~40 px) ─────────────────────────────────────────────────
  useEffect(() => {
    if (floating === null) return;

    const handleScroll = () => {
      if (Math.abs(window.scrollY - scrollYAtFloatRef.current) > 40) {
        setFloating(null);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [floating]);

  // ── Esc handler (close popovers) ─────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editPopover !== null) {
          setEditPopover(null);
          setEditDraftText('');
        } else if (popover !== null) {
          setPopover(null);
          setDraftText('');
          setValidationError(null);
        } else if (floating !== null) {
          setFloating(null);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [popover, floating, editPopover]);

  // ── Focus textarea when new-comment popover opens ────────────────────────
  useEffect(() => {
    if (popover !== null && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [popover]);

  // ── Focus textarea when edit popover opens ───────────────────────────────
  useEffect(() => {
    if (editPopover !== null && editTextareaRef.current) {
      editTextareaRef.current.focus();
    }
  }, [editPopover]);

  // ── Reconciliation pass (STORY-002-03) ────────────────────────────────────
  useEffect(() => {
    if (!onSetDetached) return;
    for (const c of comments) {
      const { matched } = reconcile(markdownSource, c);
      const shouldBeDetached = !matched;
      if (c.detached !== shouldBeDetached) {
        onSetDetached(c.id, shouldBeDetached);
      }
    }
    // onSetDetached is stable (stable function reference from parent)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdownSource, comments]);

  // ── New-comment handlers ──────────────────────────────────────────────────

  function handleCommentButtonClick() {
    if (!floating) return;
    setPopover({
      range: floating.range,
      selectedText: floating.selectedText,
      anchorRect: floating.anchorRect,
    });
    setDraftText('');
    setValidationError(null);
    setFloating(null);
  }

  function handleCancel() {
    setPopover(null);
    setDraftText('');
    setValidationError(null);
  }

  function handleSubmit() {
    if (!popover) return;
    if (draftText.trim() === '') {
      setValidationError('Please enter a comment');
      return;
    }
    onCreate({
      range: popover.range,
      selectedText: popover.selectedText,
      comment: draftText.trim(),
    });
    setPopover(null);
    setDraftText('');
    setValidationError(null);
  }

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  // ── Edit-comment handlers ─────────────────────────────────────────────────

  function handleHighlightClick(commentId: string, rect: HighlightRect) {
    const c = comments.find((x) => x.id === commentId);
    if (!c) return;
    setEditPopover({ commentId, anchorRect: rect });
    setEditDraftText(c.comment);
    // Dismiss new-comment flow
    setPopover(null);
    setDraftText('');
    setValidationError(null);
    setFloating(null);
  }

  function handleEditSave() {
    if (!editPopover) return;
    onEditComment(editPopover.commentId, editDraftText);
    setEditPopover(null);
    setEditDraftText('');
  }

  function handleEditDelete() {
    if (!editPopover) return;
    onDeleteComment(editPopover.commentId);
    setEditPopover(null);
    setEditDraftText('');
  }

  function handleEditCancel() {
    setEditPopover(null);
    setEditDraftText('');
  }

  function handleEditTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEditSave();
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  // Compute floating button position from anchorRect (cursor position, not union rect)
  // With getCursorRect, anchorRect is a zero-width rect at the cursor, so left ≈ right.
  // Place the button just below and just to the right of the cursor.
  // If that overflows the viewport, shift it left so it stays on screen.
  const FLOAT_BUTTON_WIDTH = 84; // approximate px width of the "Comment" button
  const floatingButtonStyle: React.CSSProperties = floating
    ? (() => {
        const rawLeft = floating.anchorRect.left + 4;
        const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 9999;
        const left =
          rawLeft + FLOAT_BUTTON_WIDTH > viewportWidth
            ? floating.anchorRect.left - FLOAT_BUTTON_WIDTH
            : rawLeft;
        return {
          position: 'fixed',
          top: floating.anchorRect.bottom + 4,
          left,
          zIndex: 50,
        } as React.CSSProperties;
      })()
    : {};

  const popoverStyle: React.CSSProperties = popover
    ? {
        position: 'fixed',
        top: popover.anchorRect.bottom + 4,
        left: popover.anchorRect.left,
        zIndex: 51,
        width: 280,
      }
    : {};

  return (
    <>
      {/* ── Highlight overlays (new model: Range.getClientRects() per rect) ── */}
      <div
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        aria-hidden="true"
        data-testid="comment-highlight-layer"
      >
        {editorRoot !== null &&
          comments.map((c) => {
            const rects = getCommentRects(c, markdownSource, editorRoot, scrollContainer ?? null);

            // Detached: dashed underline. Attached: solid mustard highlight.
            const highlightClassName = c.detached
              ? 'border-b border-dashed border-yellow-500 hover:border-yellow-600'
              : 'bg-yellow-300/60 hover:bg-yellow-400/70';

            return rects.map((r, i) => (
              <div
                key={`${c.id}-${i}`}
                data-testid={i === 0 ? `comment-highlight-${c.id}` : undefined}
                data-detached={c.detached ? 'true' : 'false'}
                style={{
                  position: 'absolute',
                  top: r.top,
                  left: r.left,
                  width: r.width,
                  height: r.height,
                  pointerEvents: 'auto',
                  cursor: 'pointer',
                  zIndex: 5,
                }}
                className={highlightClassName}
                onMouseEnter={() => setHoveredCommentId(c.id)}
                onMouseLeave={() => setHoveredCommentId(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  handleHighlightClick(c.id, r);
                }}
                role="button"
                tabIndex={0}
                aria-label={`Comment: ${c.comment}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleHighlightClick(c.id, r);
                  }
                }}
              />
            ));
          }).flat()}
      </div>

      {/* ── Hover tooltip ─────────────────────────────────────────────────── */}
      {hoveredCommentId !== null && editPopover === null && (() => {
        const c = comments.find((x) => x.id === hoveredCommentId);
        if (!c || !editorRoot) return null;
        const rects = getCommentRects(c, markdownSource, editorRoot, scrollContainer ?? null);
        if (rects.length === 0) return null;
        const firstRect = rects[0]!;
        return (
          <div
            data-testid="comment-tooltip-wrapper"
            style={{
              position: 'absolute',
              top: firstRect.top + firstRect.height + 4,
              left: firstRect.left,
              zIndex: 30,
              pointerEvents: 'none',
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              padding: '4px 8px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              maxWidth: 280,
              fontSize: 13,
            }}
          >
            <p data-testid="comment-text">{c.comment}</p>
          </div>
        );
      })()}

      {/* ── Edit popover (click-to-edit) ──────────────────────────────────── */}
      {editPopover !== null && (() => {
        const c = comments.find((x) => x.id === editPopover.commentId);
        if (!c) return null;
        const r = editPopover.anchorRect;
        return (
          <div
            data-testid="comment-edit-popover"
            role="dialog"
            aria-modal="true"
            aria-label="Edit comment"
            style={{
              position: 'absolute',
              top: r.top + r.height + 4,
              left: r.left,
              zIndex: 51,
              width: 280,
              background: 'white',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              padding: 12,
              boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            }}
            onMouseUp={(e) => e.stopPropagation()}
          >
            <p className="mb-1 truncate text-xs text-gray-500">{`"${c.selectedText}"`}</p>
            <textarea
              ref={editTextareaRef}
              data-testid="comment-edit-textarea"
              value={editDraftText}
              onChange={(e) => setEditDraftText(e.target.value)}
              onKeyDown={handleEditTextareaKeyDown}
              rows={3}
              placeholder="Edit comment…"
              className="w-full resize-none rounded border border-gray-300 p-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                data-testid="comment-edit-save"
                onClick={handleEditSave}
                className="rounded bg-yellow-400 px-2 py-1 text-xs font-medium text-yellow-900 hover:bg-yellow-500"
              >
                Save
              </button>
              <button
                type="button"
                data-testid="comment-edit-cancel"
                onClick={handleEditCancel}
                className="rounded border px-2 py-1 text-xs hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="comment-edit-delete"
                onClick={handleEditDelete}
                className="ml-auto rounded px-2 py-1 text-xs text-red-500 hover:text-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Floating Comment button ────────────────────────────────────────── */}
      {floating !== null && popover === null && (
        <button
          type="button"
          data-testid="comment-float-button"
          onClick={handleCommentButtonClick}
          style={floatingButtonStyle}
          className="rounded border border-yellow-400 bg-yellow-50 px-2 py-1 text-xs font-medium text-yellow-800 shadow hover:bg-yellow-100 focus:outline-none focus:ring-2 focus:ring-yellow-500"
        >
          Comment
        </button>
      )}

      {/* ── New-comment popover ───────────────────────────────────────────── */}
      {popover !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="New comment"
          data-testid="comment-popover"
          style={popoverStyle}
          className="rounded border border-gray-300 bg-white p-3 shadow-lg"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              handleCancel();
            }
          }}
        >
          <p className="mb-1 text-xs text-gray-500 truncate">
            {`"${popover.selectedText}"`}
          </p>

          <textarea
            ref={textareaRef}
            data-testid="comment-textarea"
            value={draftText}
            onChange={(e) => {
              setDraftText(e.target.value);
              if (validationError) setValidationError(null);
            }}
            onKeyDown={handleTextareaKeyDown}
            rows={3}
            placeholder="Add a comment…"
            className="w-full rounded border border-gray-300 p-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {validationError !== null && (
            <p
              role="alert"
              data-testid="comment-validation-hint"
              className="mt-1 text-xs text-red-600"
            >
              {validationError}
            </p>
          )}

          <div className="mt-2 flex gap-2 justify-end">
            <button
              type="button"
              data-testid="comment-cancel"
              onClick={handleCancel}
              className="rounded border px-2 py-1 text-xs hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="comment-submit"
              onClick={handleSubmit}
              className="rounded bg-yellow-400 px-2 py-1 text-xs font-medium text-yellow-900 hover:bg-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500"
            >
              Comment
            </button>
          </div>
        </div>
      )}
    </>
  );
}
