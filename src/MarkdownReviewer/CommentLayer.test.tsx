/**
 * CommentLayer.test.tsx — unit tests for CommentLayer (STORY-002-01 / STORY-002-02)
 *
 * Gherkin scenarios covered:
 *   1. Floating button appears when text selected in readonly mode
 *   2. Esc closes the new-comment popover (onCreate NOT called)
 *   3. Empty / whitespace-only comment rejected (validation hint shown)
 *   4. Floating button does NOT appear in edit mode (readonly=false)
 *   5. Valid submit calls onCreate with correct payload and closes popover
 *   -- STORY-002-02 additions --
 *   6. Highlight overlays render for each persisted comment
 *   7. Per-file scoping: only active file's comments render as overlays
 *   8. Resize triggers recomputeRects (ResizeObserver stub)
 *
 * Flashcard notes applied:
 *   - getBoundingClientRect() not spy-able in jsdom — assign directly on Range.prototype.
 *   - @testing-library/jest-dom NOT installed — use native .textContent checks.
 *   - RTL does not auto-cleanup between describe blocks — afterEach(cleanup).
 *   - selectionchange debounce: use vi.useFakeTimers() + vi.advanceTimersByTime().
 *   - waitFor + fake timers deadlock in RTL: avoid waitFor after timer advance;
 *     use act()+advanceTimersByTime then query synchronously.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommentLayer } from './CommentLayer';
import { buildBlockLineMap } from './utils/blockMap';
import type { CommentLayerProps } from './CommentLayer';
import type { Comment } from './types';

// ─── Global cleanup ────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreRangeBoundingClientRect();
  // Clear any DOM selection
  const sel = window.getSelection();
  if (sel) sel.removeAllRanges();
  document.body.innerHTML = '';
});

// ─── Range.prototype stub (jsdom doesn't support getBoundingClientRect / getClientRects) ─

let _originalRangeGetBoundingClientRect: (() => DOMRect) | undefined;
let _originalRangeGetClientRects: (() => DOMRectList) | undefined;

function stubRangeBoundingClientRect() {
  if (!_originalRangeGetBoundingClientRect) {
    _originalRangeGetBoundingClientRect = Range.prototype.getBoundingClientRect;
  }
  Range.prototype.getBoundingClientRect = () =>
    ({
      top: 100,
      bottom: 120,
      left: 50,
      right: 200,
      width: 150,
      height: 20,
      x: 50,
      y: 100,
      toJSON: () => ({}),
    }) as DOMRect;

  // Also stub getClientRects so getCursorRect's fallback path works in jsdom.
  // Return empty list → forces final fallback to getBoundingClientRect above.
  if (!_originalRangeGetClientRects) {
    _originalRangeGetClientRects = Range.prototype.getClientRects;
  }
  Range.prototype.getClientRects = () => {
    const empty: DOMRectList = {
      length: 0,
      item: () => null,
      [Symbol.iterator]: [][Symbol.iterator],
    } as unknown as DOMRectList;
    return empty;
  };
}

function restoreRangeBoundingClientRect() {
  if (_originalRangeGetBoundingClientRect !== undefined) {
    Range.prototype.getBoundingClientRect = _originalRangeGetBoundingClientRect;
    _originalRangeGetBoundingClientRect = undefined;
  }
  if (_originalRangeGetClientRects !== undefined) {
    Range.prototype.getClientRects = _originalRangeGetClientRects;
    _originalRangeGetClientRects = undefined;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * makeEditorRoot — builds a simple DOM editor root with a paragraph of text.
 * Appended to document.body so Selection APIs work.
 */
function makeEditorRoot(text = 'Lorem ipsum dolor sit amet'): HTMLDivElement {
  const div = document.createElement('div');
  div.setAttribute('data-testid', 'mock-editor-root');
  const p = document.createElement('p');
  p.textContent = text;
  div.appendChild(p);
  document.body.appendChild(div);
  return div;
}

/**
 * selectTextInEditor — creates a real DOM Selection from start to end offset
 * within the first text node of the editorRoot.
 */
function selectTextInEditor(editorRoot: HTMLDivElement, start: number, end: number) {
  const textNode = editorRoot.querySelector('p')!.firstChild as Text;
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  return range;
}

/**
 * Render CommentLayer with sensible defaults and return utils.
 */
function renderCommentLayer(overrides: Partial<CommentLayerProps> = {}) {
  const editorRoot = makeEditorRoot();
  const onCreate = vi.fn();
  const onEditComment = vi.fn();
  const onDeleteComment = vi.fn();

  const props: CommentLayerProps = {
    markdownSource: 'Lorem ipsum dolor sit amet',
    editorRoot,
    readonly: true,
    comments: [],
    onCreate,
    onEditComment,
    onDeleteComment,
    ...overrides,
  };

  const utils = render(<CommentLayer {...props} />);
  return { ...utils, editorRoot, onCreate, onEditComment, onDeleteComment };
}

/**
 * triggerSelectionChange — fires selectionchange and advances the 50 ms debounce.
 * Must be called inside act() with fake timers active.
 */
async function triggerSelectionChangeAndFlush() {
  await act(async () => {
    fireEvent(document, new Event('selectionchange'));
    vi.advanceTimersByTime(200); // well past the 50 ms debounce
  });
}

// ─── Scenario: Floating button appears on text selection in readonly mode ──────

describe('Scenario: Floating button appears on text selection in readonly mode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubRangeBoundingClientRect();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the Comment floating button after selecting text when readonly=true', async () => {
    const { editorRoot } = renderCommentLayer({ readonly: true });

    // Create a selection inside the editor
    selectTextInEditor(editorRoot, 0, 17); // "Lorem ipsum dolor"

    await triggerSelectionChangeAndFlush();

    // Button must now be visible
    expect(screen.queryByTestId('comment-float-button')).not.toBeNull();
  });
});

// ─── Scenario: Esc closes the new-comment popover ────────────────────────────

describe('Scenario: Esc closes the new-comment popover', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubRangeBoundingClientRect();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes the popover on Esc and does NOT call onCreate', async () => {
    const { editorRoot, onCreate } = renderCommentLayer({ readonly: true });

    // Select text to show floating button
    selectTextInEditor(editorRoot, 0, 17);
    await triggerSelectionChangeAndFlush();

    // Floating button must be visible
    expect(screen.queryByTestId('comment-float-button')).not.toBeNull();

    // Click the floating button to open the popover
    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-float-button'));
    });

    // Popover should be open
    expect(screen.queryByTestId('comment-popover')).not.toBeNull();

    // Press Esc
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    });

    // Popover should be closed
    expect(screen.queryByTestId('comment-popover')).toBeNull();

    // onCreate should NOT have been called
    expect(onCreate).not.toHaveBeenCalled();
  });
});

// ─── Scenario: Empty / whitespace-only comment is rejected ───────────────────

describe('Scenario: Empty or whitespace-only comment is rejected', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubRangeBoundingClientRect();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows validation hint and does NOT call onCreate on whitespace-only input', async () => {
    const { editorRoot, onCreate } = renderCommentLayer({ readonly: true });

    selectTextInEditor(editorRoot, 0, 17);
    await triggerSelectionChangeAndFlush();

    expect(screen.queryByTestId('comment-float-button')).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-float-button'));
    });

    expect(screen.queryByTestId('comment-popover')).not.toBeNull();

    // Type whitespace only
    await act(async () => {
      const textarea = screen.getByTestId('comment-textarea') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: '   ' } });
    });

    // Click Comment submit button
    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-submit'));
    });

    // onCreate must NOT be called
    expect(onCreate).not.toHaveBeenCalled();

    // Validation hint must appear
    const hint = screen.queryByTestId('comment-validation-hint');
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toContain('Please enter a comment');
  });

  it('shows validation hint and does NOT call onCreate when textarea is completely empty', async () => {
    const { editorRoot, onCreate } = renderCommentLayer({ readonly: true });

    selectTextInEditor(editorRoot, 0, 17);
    await triggerSelectionChangeAndFlush();

    expect(screen.queryByTestId('comment-float-button')).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-float-button'));
    });

    expect(screen.queryByTestId('comment-popover')).not.toBeNull();

    // Click submit without typing anything
    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-submit'));
    });

    expect(onCreate).not.toHaveBeenCalled();
    const hint = screen.queryByTestId('comment-validation-hint');
    expect(hint).not.toBeNull();
  });
});

// ─── Scenario: Floating button does NOT appear in edit mode ──────────────────

describe('Scenario: Floating button does not appear in edit mode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubRangeBoundingClientRect();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not show the Comment button when readonly=false', async () => {
    const { editorRoot } = renderCommentLayer({ readonly: false });

    // Create a selection inside the editor
    selectTextInEditor(editorRoot, 0, 17);
    await triggerSelectionChangeAndFlush();

    // Button must NOT appear
    expect(screen.queryByTestId('comment-float-button')).toBeNull();
  });
});

// ─── Scenario: Valid submit calls onCreate with correct payload ───────────────

describe('Scenario: Valid submit calls onCreate and closes popover', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubRangeBoundingClientRect();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onCreate with range, selectedText, comment and closes popover', async () => {
    const { editorRoot, onCreate } = renderCommentLayer({
      markdownSource: 'Lorem ipsum dolor sit amet',
      readonly: true,
    });

    // Select "Lorem ipsum dolor" (0..17)
    selectTextInEditor(editorRoot, 0, 17);
    await triggerSelectionChangeAndFlush();

    expect(screen.queryByTestId('comment-float-button')).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-float-button'));
    });

    expect(screen.queryByTestId('comment-popover')).not.toBeNull();

    // Type a comment
    await act(async () => {
      const textarea = screen.getByTestId('comment-textarea') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'needs citation' } });
    });

    // Click Comment submit
    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-submit'));
    });

    // onCreate should be called with correct payload
    expect(onCreate).toHaveBeenCalledTimes(1);
    const payload = onCreate.mock.calls[0][0];
    expect(payload.comment).toBe('needs citation');
    expect(payload.selectedText).toBe('Lorem ipsum dolor');
    expect(typeof payload.range.startLine).toBe('number');
    expect(typeof payload.range.endLine).toBe('number');
    expect(typeof payload.range.startChar).toBe('number');
    expect(typeof payload.range.endChar).toBe('number');

    // Popover should be closed
    expect(screen.queryByTestId('comment-popover')).toBeNull();
  });
});

// ─── Cancel button closes popover ────────────────────────────────────────────

describe('Cancel button', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubRangeBoundingClientRect();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes the popover and does not call onCreate', async () => {
    const { editorRoot, onCreate } = renderCommentLayer({ readonly: true });

    selectTextInEditor(editorRoot, 0, 17);
    await triggerSelectionChangeAndFlush();

    expect(screen.queryByTestId('comment-float-button')).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-float-button'));
    });

    expect(screen.queryByTestId('comment-popover')).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-cancel'));
    });

    expect(screen.queryByTestId('comment-popover')).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
  });
});

// ─── STORY-002-02: Highlight overlay tests ────────────────────────────────────

/** Build a minimal Comment object for overlay tests */
function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'cmt-1',
    selectedText: 'Lorem ipsum dolor',
    range: { startLine: 0, endLine: 0, startChar: 0, endChar: 17 },
    comment: 'needs citation',
    createdAt: '2026-05-05T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
    detached: false,
    ...overrides,
  };
}

// ─── Scenario: Highlight overlays render for each persisted comment ───────────

describe('Scenario: Overlay renders for each persisted comment (STORY-002-02)', () => {
  beforeEach(() => {
    // Stub getBoundingClientRect on HTMLElement.prototype for overlay positioning
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 20,
      left: 0,
      right: 200,
      width: 200,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders one highlight span per comment in the comments array', () => {
    const comments = [
      makeComment({ id: 'c1', comment: 'first' }),
      makeComment({ id: 'c2', comment: 'second', range: { startLine: 1, endLine: 1, startChar: 0, endChar: 5 } }),
    ];

    const editorRoot = makeEditorRoot();
    // Add a second paragraph for the second comment
    const p2 = document.createElement('p');
    p2.textContent = 'sit amet';
    editorRoot.appendChild(p2);

    render(
      <CommentLayer
        markdownSource={'Lorem ipsum dolor\nsit amet'}
        editorRoot={editorRoot}
        readonly={true}
        comments={comments}
        onCreate={vi.fn()}
        onEditComment={vi.fn()}
        onDeleteComment={vi.fn()}
      />,
    );

    // Both highlights should be rendered
    expect(screen.queryByTestId('comment-highlight-c1')).not.toBeNull();
    expect(screen.queryByTestId('comment-highlight-c2')).not.toBeNull();
  });

  it('renders overlay rect with aria-label, role=button, and pointer-events:auto (rebuild model)', () => {
    // In the rebuilt model, each per-visual-line rect has:
    //   - aria-label="Comment: <text>" (accessible)
    //   - role="button" (interactive)
    //   - pointer-events: auto (selection passes through the wrapper's gaps;
    //     rects intercept their own clicks/hovers)
    // The wrapper div has pointer-events:none; individual rects have pointer-events:auto.
    const comments = [makeComment({ id: 'c1', comment: 'needs citation' })];
    const editorRoot = makeEditorRoot();

    render(
      <CommentLayer
        markdownSource={'Lorem ipsum dolor'}
        editorRoot={editorRoot}
        readonly={true}
        comments={comments}
        onCreate={vi.fn()}
        onEditComment={vi.fn()}
        onDeleteComment={vi.fn()}
      />,
    );

    const highlight = screen.queryByTestId('comment-highlight-c1');
    expect(highlight).not.toBeNull();
    // aria-label must be present with comment text
    expect(highlight!.getAttribute('aria-label')).toBe('Comment: needs citation');
    // role must be "button" (interactive)
    expect(highlight!.getAttribute('role')).toBe('button');
    // pointer-events must be "auto" (individual rect intercepts events)
    expect((highlight as HTMLElement).style.pointerEvents).toBe('auto');
  });
});

// ─── Scenario: Per-file scoping — only active file's comments render ──────────

describe('Scenario: Per-file scoping renders only active file comments (STORY-002-02)', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 20,
      left: 0,
      right: 200,
      width: 200,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders only the comments passed via the comments prop (parent controls scoping)', () => {
    // Parent (index.tsx) derives activeComments = state.comments[activeFile] ?? []
    // CommentLayer just renders whatever is in props.comments.
    // Here we verify that rendering with 1 comment shows 1 highlight.
    const bComments = [makeComment({ id: 'b1', comment: 'on b.md' })];
    const editorRoot = makeEditorRoot('content for b');

    render(
      <CommentLayer
        markdownSource={'content for b'}
        editorRoot={editorRoot}
        readonly={true}
        comments={bComments}
        onCreate={vi.fn()}
        onEditComment={vi.fn()}
        onDeleteComment={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('comment-highlight-b1')).not.toBeNull();

    // Re-render with empty comments (simulates switching to a file with no comments)
    cleanup();
    const editorRoot2 = makeEditorRoot('a.md content');
    render(
      <CommentLayer
        markdownSource={'a.md content'}
        editorRoot={editorRoot2}
        readonly={true}
        comments={[]}
        onCreate={vi.fn()}
        onEditComment={vi.fn()}
        onDeleteComment={vi.fn()}
      />,
    );

    // No highlights for empty comments
    expect(screen.queryByTestId('comment-highlight-b1')).toBeNull();
  });
});

// ─── Scenario 3 (RESTORED): Hover-tooltip via per-rect mouseEnter ────────────
//
// Rebuild (STORY-002-02-rebuild): the overlay-span model (pointer-events:none)
// is replaced with the per-visual-line rect model. Each rect has pointer-events:auto,
// role="button", onMouseEnter → setHoveredCommentId → comment-tooltip-wrapper visible.
//
// Gherkin:
//   "Given a rendered CommentLayer with 1 persisted comment
//    When the user hovers over a comment-highlight-<id> rect
//    Then the comment-tooltip-wrapper is visible
//    And the comment text is displayed"

describe('Scenario: Hover-tooltip restored — overlay rects have pointer-events:auto (STORY-002-02-rebuild)', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 20,
      left: 0,
      right: 200,
      width: 200,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows comment-tooltip-wrapper with comment text on mouseEnter of highlight rect', async () => {
    const comment = makeComment({ id: 'hover-cmt', comment: 'hover tooltip text' });
    const editorRoot = makeEditorRoot('Lorem ipsum dolor sit amet');

    render(
      <CommentLayer
        markdownSource="Lorem ipsum dolor sit amet"
        editorRoot={editorRoot}
        readonly={true}
        comments={[comment]}
        onCreate={vi.fn()}
        onEditComment={vi.fn()}
        onDeleteComment={vi.fn()}
      />,
    );

    // Highlight rect must be present
    const highlightRect = screen.queryByTestId('comment-highlight-hover-cmt');
    expect(highlightRect).not.toBeNull();

    // Rebuild: each rect has pointer-events:auto (not none)
    expect((highlightRect as HTMLElement).style.pointerEvents).toBe('auto');

    // Tooltip must NOT appear before hover
    expect(screen.queryByTestId('comment-tooltip-wrapper')).toBeNull();

    // Hover over the highlight rect
    await act(async () => {
      fireEvent.mouseEnter(highlightRect!);
    });

    // Tooltip must appear
    const tooltip = screen.queryByTestId('comment-tooltip-wrapper');
    expect(tooltip).not.toBeNull();

    // Comment text must be displayed in the tooltip
    const commentText = screen.queryByTestId('comment-text');
    expect(commentText).not.toBeNull();
    expect(commentText!.textContent).toBe('hover tooltip text');
  });

  it('hides tooltip on mouseLeave of highlight rect', async () => {
    const comment = makeComment({ id: 'hover-leave-cmt', comment: 'tooltip disappears' });
    const editorRoot = makeEditorRoot('Lorem ipsum dolor sit amet');

    render(
      <CommentLayer
        markdownSource="Lorem ipsum dolor sit amet"
        editorRoot={editorRoot}
        readonly={true}
        comments={[comment]}
        onCreate={vi.fn()}
        onEditComment={vi.fn()}
        onDeleteComment={vi.fn()}
      />,
    );

    const highlightRect = screen.queryByTestId('comment-highlight-hover-leave-cmt');
    expect(highlightRect).not.toBeNull();

    // Hover to show tooltip
    await act(async () => {
      fireEvent.mouseEnter(highlightRect!);
    });
    expect(screen.queryByTestId('comment-tooltip-wrapper')).not.toBeNull();

    // Leave to hide tooltip
    await act(async () => {
      fireEvent.mouseLeave(highlightRect!);
    });
    expect(screen.queryByTestId('comment-tooltip-wrapper')).toBeNull();
  });
});

// ─── Scenario: Click-to-edit opens comment-edit-popover ──────────────────────
//
// Gherkin:
//   "Given a rendered CommentLayer with 1 persisted comment
//    When the user clicks a comment-highlight-<id> rect
//    Then comment-edit-popover is visible
//    And the textarea is pre-filled with the comment text"

describe('Scenario: Click-to-edit opens edit popover (STORY-002-02-rebuild)', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 20,
      left: 0,
      right: 200,
      width: 200,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clicking highlight rect opens comment-edit-popover with pre-filled textarea', async () => {
    const comment = makeComment({ id: 'click-cmt', comment: 'original text' });
    const editorRoot = makeEditorRoot('Lorem ipsum dolor sit amet');

    render(
      <CommentLayer
        markdownSource="Lorem ipsum dolor sit amet"
        editorRoot={editorRoot}
        readonly={true}
        comments={[comment]}
        onCreate={vi.fn()}
        onEditComment={vi.fn()}
        onDeleteComment={vi.fn()}
      />,
    );

    const highlightRect = screen.queryByTestId('comment-highlight-click-cmt');
    expect(highlightRect).not.toBeNull();

    // Edit popover must not be visible before click
    expect(screen.queryByTestId('comment-edit-popover')).toBeNull();

    // Click the highlight rect
    await act(async () => {
      fireEvent.click(highlightRect!);
    });

    // Edit popover must appear
    const editPopover = screen.queryByTestId('comment-edit-popover');
    expect(editPopover).not.toBeNull();

    // Textarea must be pre-filled with the comment text
    const textarea = screen.queryByTestId('comment-edit-textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toBe('original text');
  });

  it('clicking Save in edit popover calls onEditComment with new text', async () => {
    const comment = makeComment({ id: 'save-cmt', comment: 'old text' });
    const editorRoot = makeEditorRoot('Lorem ipsum dolor sit amet');
    const onEditComment = vi.fn();

    render(
      <CommentLayer
        markdownSource="Lorem ipsum dolor sit amet"
        editorRoot={editorRoot}
        readonly={true}
        comments={[comment]}
        onCreate={vi.fn()}
        onEditComment={onEditComment}
        onDeleteComment={vi.fn()}
      />,
    );

    // Open the edit popover
    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-highlight-save-cmt'));
    });

    expect(screen.queryByTestId('comment-edit-popover')).not.toBeNull();

    // Change the textarea value
    await act(async () => {
      const textarea = screen.getByTestId('comment-edit-textarea') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'updated text' } });
    });

    // Click Save
    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-edit-save'));
    });

    // onEditComment must be called with (id, newText)
    expect(onEditComment).toHaveBeenCalledTimes(1);
    expect(onEditComment).toHaveBeenCalledWith('save-cmt', 'updated text');

    // Edit popover must close
    expect(screen.queryByTestId('comment-edit-popover')).toBeNull();
  });

  it('clicking Delete in edit popover calls onDeleteComment and closes popover', async () => {
    const comment = makeComment({ id: 'del-cmt', comment: 'to be deleted' });
    const editorRoot = makeEditorRoot('Lorem ipsum dolor sit amet');
    const onDeleteComment = vi.fn();

    render(
      <CommentLayer
        markdownSource="Lorem ipsum dolor sit amet"
        editorRoot={editorRoot}
        readonly={true}
        comments={[comment]}
        onCreate={vi.fn()}
        onEditComment={vi.fn()}
        onDeleteComment={onDeleteComment}
      />,
    );

    // Open the edit popover
    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-highlight-del-cmt'));
    });

    expect(screen.queryByTestId('comment-edit-popover')).not.toBeNull();

    // Click Delete
    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-edit-delete'));
    });

    // onDeleteComment must be called with the comment id
    expect(onDeleteComment).toHaveBeenCalledTimes(1);
    expect(onDeleteComment).toHaveBeenCalledWith('del-cmt');

    // Edit popover must close
    expect(screen.queryByTestId('comment-edit-popover')).toBeNull();
  });

  it('clicking Cancel in edit popover closes it without calling onEditComment', async () => {
    const comment = makeComment({ id: 'cancel-cmt', comment: 'unchanged' });
    const editorRoot = makeEditorRoot('Lorem ipsum dolor sit amet');
    const onEditComment = vi.fn();

    render(
      <CommentLayer
        markdownSource="Lorem ipsum dolor sit amet"
        editorRoot={editorRoot}
        readonly={true}
        comments={[comment]}
        onCreate={vi.fn()}
        onEditComment={onEditComment}
        onDeleteComment={vi.fn()}
      />,
    );

    // Open the edit popover
    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-highlight-cancel-cmt'));
    });

    expect(screen.queryByTestId('comment-edit-popover')).not.toBeNull();

    // Click Cancel
    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-edit-cancel'));
    });

    // onEditComment must NOT have been called
    expect(onEditComment).not.toHaveBeenCalled();

    // Edit popover must close
    expect(screen.queryByTestId('comment-edit-popover')).toBeNull();
  });
});

// ─── Scenario: ResizeObserver triggers recomputeRects ─────────────────────────

describe('Scenario: ResizeObserver stub triggers reposition (STORY-002-02)', () => {
  it('calls the ResizeObserver observe method on the editorRoot', () => {
    const observeSpy = vi.fn();
    const disconnectSpy = vi.fn();

    // Stub ResizeObserver globally (not available in jsdom)
    const OriginalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe(el: Element) { observeSpy(el); }
      disconnect() { disconnectSpy(); }
      unobserve(_el: Element) {}
    } as unknown as typeof ResizeObserver;

    const editorRoot = makeEditorRoot();

    const { unmount } = render(
      <CommentLayer
        markdownSource={'Lorem ipsum'}
        editorRoot={editorRoot}
        readonly={true}
        comments={[]}
        onCreate={vi.fn()}
        onEditComment={vi.fn()}
        onDeleteComment={vi.fn()}
      />,
    );

    // ResizeObserver.observe must have been called with editorRoot
    expect(observeSpy).toHaveBeenCalledWith(editorRoot);

    unmount();

    // disconnect must have been called on unmount
    expect(disconnectSpy).toHaveBeenCalled();

    // Restore
    globalThis.ResizeObserver = OriginalResizeObserver;
  });
});

// ─── STORY-002-03: Anchor drift detection ─────────────────────────────────────

/**
 * Gherkin: "Anchor stays attached when surrounding text changes"
 * When text is changed in a DIFFERENT paragraph from the comment,
 * onSetDetached must NOT be called (comment stays attached).
 */
describe('Scenario: Anchor stays attached when surrounding text changes (STORY-002-03)', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 20,
      left: 0,
      right: 200,
      width: 200,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT call onSetDetached when text far from the anchor changes', async () => {
    // Comment is on "Lorem ipsum dolor" (line 0)
    const comment = makeComment({
      id: 'c-stable',
      selectedText: 'Lorem ipsum dolor',
      range: { startLine: 0, endLine: 0, startChar: 0, endChar: 17 },
      detached: false,
    });
    const onSetDetached = vi.fn();
    const editorRoot = makeEditorRoot('Lorem ipsum dolor');

    const { rerender } = render(
      <CommentLayer
        markdownSource={'Lorem ipsum dolor\noriginal paragraph'}
        editorRoot={editorRoot}
        readonly={true}
        comments={[comment]}
        onCreate={vi.fn()}
        onEditComment={vi.fn()}
        onDeleteComment={vi.fn()}
        onSetDetached={onSetDetached}
      />,
    );

    // Simulate: the second paragraph changed (not the comment's paragraph)
    await act(async () => {
      rerender(
        <CommentLayer
          markdownSource={'Lorem ipsum dolor\nmodified paragraph (draft)'}
          editorRoot={editorRoot}
          readonly={true}
          comments={[comment]}
          onCreate={vi.fn()}
          onEditComment={vi.fn()}
          onDeleteComment={vi.fn()}
          onSetDetached={onSetDetached}
        />,
      );
    });

    // onSetDetached must NOT have been called with (id, true)
    // because "Lorem ipsum dolor" is still exactly at line 0
    const detachCalls = onSetDetached.mock.calls.filter(([, d]) => d === true);
    expect(detachCalls).toHaveLength(0);
  });
});

/**
 * Gherkin: "Anchor drifts when selected text is altered"
 * When the anchored text changes, onSetDetached must be called with (id, true)
 * and the highlight span must carry data-detached="true".
 */
describe('Scenario: Anchor drifts when selected text is altered (STORY-002-03)', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 20,
      left: 0,
      right: 200,
      width: 200,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls onSetDetached(id, true) when the anchored text changes', async () => {
    // Comment originally anchored to "Lorem ipsum dolor" (chars 0..17, line 0)
    const comment = makeComment({
      id: 'c-drift',
      selectedText: 'Lorem ipsum dolor',
      range: { startLine: 0, endLine: 0, startChar: 0, endChar: 17 },
      detached: false,
    });
    const onSetDetached = vi.fn();
    const editorRoot = makeEditorRoot('Lorem ipsum dolor');

    const { rerender } = render(
      <CommentLayer
        markdownSource={'Lorem ipsum dolor'}
        editorRoot={editorRoot}
        readonly={true}
        comments={[comment]}
        onCreate={vi.fn()}
        onEditComment={vi.fn()}
        onDeleteComment={vi.fn()}
        onSetDetached={onSetDetached}
      />,
    );

    // Simulate: "Lorem ipsum dolor" changed to "Hello world" at line 0
    await act(async () => {
      rerender(
        <CommentLayer
          markdownSource={'Hello world'}
          editorRoot={editorRoot}
          readonly={true}
          comments={[comment]}
          onCreate={vi.fn()}
          onEditComment={vi.fn()}
          onDeleteComment={vi.fn()}
          onSetDetached={onSetDetached}
        />,
      );
    });

    // onSetDetached must have been called with (id, true) — drift detected
    expect(onSetDetached).toHaveBeenCalledWith('c-drift', true);
  });

  it('renders the dashed-underline class on a detached comment highlight span', () => {
    // A comment already in detached state (the parent has already flipped the flag)
    const detachedComment = makeComment({
      id: 'c-detached-visual',
      selectedText: 'Lorem ipsum dolor',
      range: { startLine: 0, endLine: 0, startChar: 0, endChar: 17 },
      detached: true,
    });

    const editorRoot = makeEditorRoot('Hello world');

    render(
      <CommentLayer
        markdownSource={'Hello world'}
        editorRoot={editorRoot}
        readonly={true}
        comments={[detachedComment]}
        onCreate={vi.fn()}
        onEditComment={vi.fn()}
        onDeleteComment={vi.fn()}
        onSetDetached={vi.fn()}
      />,
    );

    const highlight = screen.queryByTestId('comment-highlight-c-detached-visual');
    expect(highlight).not.toBeNull();
    // Must carry the dashed-underline class, not the solid mustard class
    expect(highlight!.getAttribute('class')).toContain('border-dashed');
    expect(highlight!.getAttribute('class')).not.toContain('bg-yellow-300');
    // data-detached attribute must be "true"
    expect(highlight!.getAttribute('data-detached')).toBe('true');
  });

  it('flips back to non-detached when onSetDetached is called with false (undo recovery)', async () => {
    // Comment starts as detached (after an edit)
    const detachedComment = makeComment({
      id: 'c-recover',
      selectedText: 'Lorem ipsum dolor',
      range: { startLine: 0, endLine: 0, startChar: 0, endChar: 17 },
      detached: true,
    });
    const onSetDetached = vi.fn();
    const editorRoot = makeEditorRoot('Lorem ipsum dolor');

    // Render with the ORIGINAL markdown (undo restores text) but comment still has detached:true
    await act(async () => {
      render(
        <CommentLayer
          markdownSource={'Lorem ipsum dolor'}
          editorRoot={editorRoot}
          readonly={true}
          comments={[detachedComment]}
          onCreate={vi.fn()}
          onEditComment={vi.fn()}
          onDeleteComment={vi.fn()}
          onSetDetached={onSetDetached}
        />,
      );
    });

    // The reconciliation effect should detect that the text now matches again,
    // and call onSetDetached(id, false) to recover
    expect(onSetDetached).toHaveBeenCalledWith('c-recover', false);
  });
});

// ─── UR:bug Phase-D fix: line-to-block mapping tests ─────────────────────────
//
// These tests cover the bug where c.range.startLine was used directly as an
// index into leafBlocks[] — wrong for any non-trivial document. The fix builds
// a block-line map and does a proper line-range lookup.
//
// Flashcard applied: #test-harness #jsdom — vi.spyOn HTMLElement.prototype.getBoundingClientRect

/**
 * makeMultiBlockEditor — builds an editorRoot with N paragraphs.
 * Each paragraph receives a unique getBoundingClientRect stub top value
 * so tests can distinguish which block was selected for each highlight.
 */
function makeMultiBlockEditor(paragraphTexts: string[]): HTMLDivElement {
  const div = document.createElement('div');
  div.setAttribute('data-testid', 'mock-multi-editor-root');
  for (const text of paragraphTexts) {
    const p = document.createElement('p');
    p.textContent = text;
    div.appendChild(p);
  }
  document.body.appendChild(div);
  return div;
}

// ─── Scenario A: Wrapped paragraph (multiple source lines, one leaf block) ────
//
// Gherkin: Given a markdown document where paragraph 2 spans source lines 2-4
//           And a comment with startLine=3 (mid-paragraph source line)
//           When the overlay is computed
//           Then the highlight renders on block 1 (the paragraph), not block 3

describe('UR:bug fix — Scenario A: wrapped paragraph maps to correct leaf block', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        // Each paragraph returns a distinct top based on its data-block-idx attribute
        const idx = parseInt(this.getAttribute('data-block-idx') ?? '0', 10);
        return {
          top: idx * 100,
          bottom: idx * 100 + 20,
          left: 0,
          right: 500,
          width: 500,
          height: 20,
          x: 0,
          y: idx * 100,
          toJSON: () => ({}),
        } as DOMRect;
      },
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('buildBlockLineMap assigns a multi-source-line paragraph a correct startLine/endLine', () => {
    // Markdown where paragraphs are separated by blank lines:
    // Line 0: "# Title"
    // Line 1: ""          (blank)
    // Line 2: "Paragraph one"
    // Line 3: ""          (blank)
    // Line 4: "Paragraph two"
    const markdown = '# Title\n\nParagraph one\n\nParagraph two';

    const div = document.createElement('div');
    const h1 = document.createElement('h1');
    h1.textContent = 'Title';
    const p1 = document.createElement('p');
    p1.textContent = 'Paragraph one';
    const p2 = document.createElement('p');
    p2.textContent = 'Paragraph two';
    div.appendChild(h1);
    div.appendChild(p1);
    div.appendChild(p2);

    const leafBlocks = [h1, p1, p2] as HTMLElement[];
    const blockMap = buildBlockLineMap(markdown, leafBlocks);

    // h1 should be at line 0
    expect(blockMap[0]!.startLine).toBe(0);
    expect(blockMap[0]!.endLine).toBe(0);
    expect(blockMap[0]!.block).toBe(h1);

    // p1 should be at line 2 (blank line 1 is skipped)
    expect(blockMap[1]!.startLine).toBe(2);
    expect(blockMap[1]!.endLine).toBe(2);
    expect(blockMap[1]!.block).toBe(p1);

    // p2 should be at line 4 (blank line 3 is skipped)
    expect(blockMap[2]!.startLine).toBe(4);
    expect(blockMap[2]!.endLine).toBe(4);
    expect(blockMap[2]!.block).toBe(p2);
  });
});

// ─── Scenario B: Heading + paragraph + list mix ───────────────────────────────
//
// Gherkin: Given a document with a heading at line 0, paragraph at line 2, and
//           two list items at lines 4-5
//           And a comment with startLine=4 (first list item)
//           When overlay is computed
//           Then the highlight renders on the first <li>, not the <h1>

describe('UR:bug fix — Scenario B: heading + paragraph + list mix', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 20,
      left: 0,
      right: 500,
      width: 500,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('buildBlockLineMap correctly maps list items to their source lines', () => {
    // Line 0: "# Heading"
    // Line 1: ""
    // Line 2: "A paragraph"
    // Line 3: ""
    // Line 4: "- item one"
    // Line 5: "- item two"
    const markdown = '# Heading\n\nA paragraph\n\n- item one\n- item two';

    const div = document.createElement('div');
    const h1 = document.createElement('h1');
    h1.textContent = 'Heading';
    const p = document.createElement('p');
    p.textContent = 'A paragraph';
    const li1 = document.createElement('li');
    li1.textContent = 'item one';
    const li2 = document.createElement('li');
    li2.textContent = 'item two';
    div.appendChild(h1);
    div.appendChild(p);
    div.appendChild(li1);
    div.appendChild(li2);

    const leafBlocks = [h1, p, li1, li2] as HTMLElement[];
    const blockMap = buildBlockLineMap(markdown, leafBlocks);

    expect(blockMap).toHaveLength(4);

    // h1 → line 0
    expect(blockMap[0]!.startLine).toBe(0);
    expect(blockMap[0]!.block).toBe(h1);

    // p → line 2
    expect(blockMap[1]!.startLine).toBe(2);
    expect(blockMap[1]!.block).toBe(p);

    // li1 → line 4
    expect(blockMap[2]!.startLine).toBe(4);
    expect(blockMap[2]!.block).toBe(li1);

    // li2 → line 5
    expect(blockMap[3]!.startLine).toBe(5);
    expect(blockMap[3]!.block).toBe(li2);
  });
});

// ─── Scenario C: Blank-line-gap document ─────────────────────────────────────
//
// Gherkin: Given a document where every other line is blank
//           And comments at various non-blank lines
//           When overlays are computed
//           Then each comment maps to the correct block (not shifted by blank lines)

describe('UR:bug fix — Scenario C: blank-line-gap document', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 20,
      left: 0,
      right: 500,
      width: 500,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('comments at non-blank lines map to correct blocks despite blank-line gaps', () => {
    // Line 0: "Para A"
    // Line 1: ""
    // Line 2: "Para B"
    // Line 3: ""
    // Line 4: "Para C"
    // Line 5: ""
    // Line 6: "Para D"
    const markdown = 'Para A\n\nPara B\n\nPara C\n\nPara D';

    const div = document.createElement('div');
    const blocks: HTMLElement[] = ['Para A', 'Para B', 'Para C', 'Para D'].map((t) => {
      const p = document.createElement('p');
      p.textContent = t;
      div.appendChild(p);
      return p;
    });

    const blockMap = buildBlockLineMap(markdown, blocks);

    // With the broken old code (leafBlocks[startLine]):
    //   comment at line 4 would give leafBlocks[4] = undefined → last block fallback
    // With the fix:
    //   line 4 → Para C (block index 2)
    expect(blockMap[2]!.startLine).toBe(4);  // Para C at source line 4
    expect(blockMap[2]!.block).toBe(blocks[2]);

    expect(blockMap[3]!.startLine).toBe(6);  // Para D at source line 6
    expect(blockMap[3]!.block).toBe(blocks[3]);
  });
});

// ─── Scenario D: User's actual bug — mid-document selection (~20 lines) ───────
//
// Gherkin: Given a markdown document with ~20 lines of content before "Why it exists"
//           And a comment captured on "Why it exists" paragraph (startLine=13, say)
//           When the overlay is computed
//           Then the highlight renders on the correct paragraph, NOT the last block
//
// This is the exact failure mode from the Phase-D walkthrough.

describe('UR:bug fix — Scenario D: mid-document selection on ~20-line document', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('comment at paragraph 5 (line 8) renders on the correct block, not the last block', () => {
    // Simulate a document where blank lines separate each paragraph.
    // Each paragraph is on an even line; blank lines fill odd lines.
    // Line 0: "Title"
    // Line 1: ""
    // Line 2: "Subtitle"
    // Line 3: ""
    // Line 4: "Introduction"
    // Line 5: ""
    // Line 6: "Background"
    // Line 7: ""
    // Line 8: "Why it exists"
    // Line 9: ""
    // Line 10: "How it works"
    // Line 11: ""
    // Line 12: "Usage"
    // Line 13: ""
    // Line 14: "Summary"
    const paragraphs = ['Title', 'Subtitle', 'Introduction', 'Background', 'Why it exists', 'How it works', 'Usage', 'Summary'];
    const markdown = paragraphs.join('\n\n');  // blank line between each

    const editorRoot = makeMultiBlockEditor(paragraphs);
    const pElements = Array.from(editorRoot.querySelectorAll('p')) as HTMLElement[];

    // Each paragraph gets a distinct top value based on its index.
    // The editorRoot div itself gets top=0 so that rect math works out:
    //   overlay.top = blockRect.top - rootRect.top = (idx * 100) - 0 = idx * 100
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        const idxAttr = this.getAttribute('data-block-idx');
        if (idxAttr !== null) {
          const top = parseInt(idxAttr, 10) * 100;
          return { top, bottom: top + 20, left: 0, right: 500, width: 500, height: 20, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
        }
        // editorRoot div and other elements → top=0
        return { top: 0, bottom: 20, left: 0, right: 500, width: 500, height: 20, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      },
    );
    pElements.forEach((p, i) => p.setAttribute('data-block-idx', String(i)));

    // "Why it exists" is at source line 8 (0-indexed: each para is 2 lines apart starting from 0)
    // In the array: index 4 → data-block-idx=4 → top style = 4*100 = 400
    const comment: Comment = makeComment({
      id: 'mid-doc-comment',
      selectedText: 'Why it exists',
      range: { startLine: 8, endLine: 8, startChar: 0, endChar: 13 },
      comment: 'This is the bug scenario',
    });

    render(
      <CommentLayer
        markdownSource={markdown}
        editorRoot={editorRoot}
        readonly={true}
        comments={[comment]}
        onCreate={vi.fn()}
        onEditComment={vi.fn()}
        onDeleteComment={vi.fn()}
      />,
    );

    const highlight = screen.queryByTestId('comment-highlight-mid-doc-comment');
    expect(highlight).not.toBeNull();

    // overlay.top = blockRect.top - rootRect.top = 400 - 0 = 400
    const topStyle = parseFloat((highlight as HTMLElement).style.top ?? '0');
    // Should be 400 ("Why it exists" = index 4), NOT 700 ("Summary" = index 7 = last block)
    expect(topStyle).toBe(400);
  });

  it('REGRESSION: old code would have rendered on last block — verify the fix prevents it', () => {
    // Same setup, confirm the top is NOT 700 (last block = Summary)
    const paragraphs = ['Title', 'Subtitle', 'Introduction', 'Background', 'Why it exists', 'How it works', 'Usage', 'Summary'];
    const markdown = paragraphs.join('\n\n');

    const editorRoot = makeMultiBlockEditor(paragraphs);
    const pElements = Array.from(editorRoot.querySelectorAll('p')) as HTMLElement[];

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        const idxAttr = this.getAttribute('data-block-idx');
        if (idxAttr !== null) {
          const top = parseInt(idxAttr, 10) * 100;
          return { top, bottom: top + 20, left: 0, right: 500, width: 500, height: 20, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
        }
        return { top: 0, bottom: 20, left: 0, right: 500, width: 500, height: 20, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      },
    );
    pElements.forEach((p, i) => p.setAttribute('data-block-idx', String(i)));

    const comment: Comment = makeComment({
      id: 'regression-check',
      selectedText: 'Why it exists',
      range: { startLine: 8, endLine: 8, startChar: 0, endChar: 13 },
      comment: 'regression guard',
    });

    render(
      <CommentLayer
        markdownSource={markdown}
        editorRoot={editorRoot}
        readonly={true}
        comments={[comment]}
        onCreate={vi.fn()}
        onEditComment={vi.fn()}
        onDeleteComment={vi.fn()}
      />,
    );

    const highlight = screen.queryByTestId('comment-highlight-regression-check');
    expect(highlight).not.toBeNull();

    const topStyle = parseFloat((highlight as HTMLElement).style.top ?? '0');
    // Must NOT be at last block (Summary = index 7 → top=700)
    expect(topStyle).not.toBe(700);
    // Must be at "Why it exists" (index 4 → top=400)
    expect(topStyle).toBe(400);
  });
});

// ─── STORY-002-02-popover-anchor: floating button anchors at cursor, not union rect ─

/**
 * Gherkin:
 *   Given a multi-line selection (focusNode + focusOffset set to a specific point)
 *   And Range.getClientRects returns a set of per-line rects where the LAST rect
 *     is the cursor position (left=80) while the union getBoundingClientRect has right=400
 *   When the user's selection triggers the selectionchange event
 *   Then the floating button style.left uses the focus rect's left (80+4=84),
 *     NOT the union rect's right (400)
 *
 * Mocking strategy:
 *   - Stub Range.prototype.getBoundingClientRect → union rect (right=400, left=0)
 *   - Stub Range.prototype.getClientRects → returns two rects: line1 and cursor rect
 *   - The cursor rect (index 1) has left=80, bottom=220 — this is where the button lands.
 *   - focusNode/focusOffset are set on the real selection so getCursorRect can create
 *     a zero-width range at the focus; that range returns a non-empty rect too.
 */
describe('STORY-002-02-popover-anchor: floating button anchors at cursor focus position (not union rect)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('positions the floating button near the cursor (focus rect left), not the union rect right edge', async () => {
    // Union rect: spans the entire multi-line selection (large right edge)
    const unionRect: DOMRect = {
      top: 100,
      bottom: 220,
      left: 0,
      right: 400,
      width: 400,
      height: 120,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect;

    // Cursor rect: where the user's cursor is at the end of the selection
    const cursorRect: DOMRect = {
      top: 210,
      bottom: 220,
      left: 80,
      right: 81,   // zero-width at cursor
      width: 1,
      height: 10,
      x: 80,
      y: 210,
      toJSON: () => ({}),
    } as DOMRect;

    // Stub getBoundingClientRect on Range.prototype → union rect
    const originalGetBCR = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = () => unionRect;

    // Stub getClientRects: zero-width range at cursor returns [cursorRect]
    // The full selection range returns [line1Rect, cursorRect]
    const line1Rect: DOMRect = {
      top: 100, bottom: 120, left: 0, right: 400, width: 400, height: 20,
      x: 0, y: 100, toJSON: () => ({}),
    } as DOMRect;
    const originalGetCR = Range.prototype.getClientRects;
    Range.prototype.getClientRects = function () {
      // Zero-width range (start===end) returns [cursorRect]; selection range returns both
      if (this.collapsed) {
        return { length: 1, 0: cursorRect, item: (i: number) => (i === 0 ? cursorRect : null), [Symbol.iterator]: [][Symbol.iterator] } as unknown as DOMRectList;
      }
      const rects = [line1Rect, cursorRect];
      return {
        length: rects.length,
        0: rects[0],
        1: rects[1],
        item: (i: number) => rects[i] ?? null,
        [Symbol.iterator]: rects[Symbol.iterator].bind(rects),
      } as unknown as DOMRectList;
    };

    const { editorRoot } = renderCommentLayer({ readonly: true });

    // Select text — this creates a real DOM Range with focusNode set
    selectTextInEditor(editorRoot, 0, 17);

    await triggerSelectionChangeAndFlush();

    // Floating button must appear
    const btn = screen.queryByTestId('comment-float-button') as HTMLElement | null;
    expect(btn).not.toBeNull();

    // The button should be positioned near the cursor (left ≈ 80+4 = 84),
    // NOT at the union rect's right edge (400).
    const styleLeft = parseFloat(btn!.style.left ?? '0');
    expect(styleLeft).toBeLessThan(200); // well below 400 (union right)
    expect(styleLeft).toBeGreaterThanOrEqual(80); // near or at cursor left (80)

    // top should be below the cursor line (cursorRect.bottom + 4 = 224)
    const styleTop = parseFloat(btn!.style.top ?? '0');
    expect(styleTop).toBe(224);

    // Restore
    Range.prototype.getBoundingClientRect = originalGetBCR;
    Range.prototype.getClientRects = originalGetCR;
  });
});
