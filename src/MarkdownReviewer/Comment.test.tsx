/**
 * Comment.test.tsx — unit tests for the Comment popover component (STORY-002-02)
 *
 * Gherkin scenarios covered:
 *   - View mode renders comment text + Edit and Delete buttons
 *   - Clicking Edit switches mode + focuses textarea
 *   - Save commits text and calls onClose; empty text is blocked
 *   - Delete fires onDelete + onClose immediately
 *   - Esc in edit mode cancels (no onEdit call)
 *
 * Flashcard notes applied:
 *   - @testing-library/jest-dom NOT installed — use native .textContent checks.
 *   - RTL does not auto-cleanup between describe blocks — afterEach(cleanup).
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Comment } from './Comment';
import type { Comment as CommentType } from './types';

// ─── Global cleanup ────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeComment(overrides: Partial<CommentType> = {}): CommentType {
  return {
    id: 'test-id-1',
    selectedText: 'Lorem ipsum dolor',
    range: { startLine: 0, endLine: 0, startChar: 0, endChar: 17 },
    comment: 'needs citation',
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
    detached: false,
    ...overrides,
  };
}

function renderComment(overrides: {
  comment?: CommentType;
  onEdit?: (id: string, text: string) => void;
  onDelete?: (id: string) => void;
  onClose?: () => void;
} = {}) {
  const comment = overrides.comment ?? makeComment();
  const onEdit = overrides.onEdit ?? vi.fn();
  const onDelete = overrides.onDelete ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();

  const utils = render(
    <Comment
      comment={comment}
      onEdit={onEdit}
      onDelete={onDelete}
      onClose={onClose}
    />,
  );
  return { ...utils, comment, onEdit, onDelete, onClose };
}

// ─── Scenario: View mode renders comment text + Edit + Delete buttons ──────────

describe('Scenario: View mode renders comment text and Edit / Delete buttons', () => {
  it('renders comment text and both action buttons in view mode', () => {
    renderComment();

    // Comment text is visible
    const textEl = screen.queryByTestId('comment-text');
    expect(textEl).not.toBeNull();
    expect(textEl!.textContent).toContain('needs citation');

    // Edit and Delete buttons are present
    expect(screen.queryByTestId('comment-edit-btn')).not.toBeNull();
    expect(screen.queryByTestId('comment-delete-btn')).not.toBeNull();

    // Edit textarea should NOT be visible in view mode
    expect(screen.queryByTestId('comment-edit-textarea')).toBeNull();
  });
});

// ─── Scenario: Edit click switches mode and focuses textarea ──────────────────

describe('Scenario: Clicking Edit switches mode', () => {
  it('switches to edit mode when Edit button is clicked', async () => {
    renderComment();

    // Click Edit
    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-edit-btn'));
    });

    // Edit textarea should appear
    expect(screen.queryByTestId('comment-edit-textarea')).not.toBeNull();

    // Save and Cancel buttons should appear
    expect(screen.queryByTestId('comment-edit-save')).not.toBeNull();
    expect(screen.queryByTestId('comment-edit-cancel')).not.toBeNull();

    // View-mode text should disappear
    expect(screen.queryByTestId('comment-text')).toBeNull();
  });

  it('textarea is pre-filled with existing comment text on edit', async () => {
    renderComment();

    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-edit-btn'));
    });

    const textarea = screen.getByTestId('comment-edit-textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('needs citation');
  });
});

// ─── Scenario: Save commits text and calls onEdit + onClose ──────────────────

describe('Scenario: Save commits text and closes', () => {
  it('calls onEdit with new text and onClose when Save is clicked', async () => {
    const onEdit = vi.fn();
    const onClose = vi.fn();
    renderComment({ onEdit, onClose });

    // Enter edit mode
    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-edit-btn'));
    });

    // Change the text
    await act(async () => {
      const textarea = screen.getByTestId('comment-edit-textarea') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'needs source' } });
    });

    // Click Save
    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-edit-save'));
    });

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith('test-id-1', 'needs source');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('blocks Save when edit textarea is whitespace-only and shows validation hint', async () => {
    const onEdit = vi.fn();
    const onClose = vi.fn();
    renderComment({ onEdit, onClose });

    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-edit-btn'));
    });

    // Clear the textarea (whitespace only)
    await act(async () => {
      const textarea = screen.getByTestId('comment-edit-textarea') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: '   ' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-edit-save'));
    });

    // onEdit must NOT have been called
    expect(onEdit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    // Validation hint must appear
    const hint = screen.queryByTestId('comment-edit-validation-hint');
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toContain('Please enter a comment');
  });
});

// ─── Scenario: Delete fires onDelete + onClose immediately ───────────────────

describe('Scenario: Delete fires immediately', () => {
  it('calls onDelete with comment id and onClose when Delete is clicked', async () => {
    const onDelete = vi.fn();
    const onClose = vi.fn();
    renderComment({ onDelete, onClose });

    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-delete-btn'));
    });

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('test-id-1');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ─── Scenario: Esc in edit mode cancels without committing ───────────────────

describe('Scenario: Esc cancels edit without calling onEdit', () => {
  it('returns to view mode on Esc without calling onEdit', async () => {
    const onEdit = vi.fn();
    renderComment({ onEdit });

    // Enter edit mode
    await act(async () => {
      fireEvent.click(screen.getByTestId('comment-edit-btn'));
    });

    expect(screen.queryByTestId('comment-edit-textarea')).not.toBeNull();

    // Change text then Esc
    await act(async () => {
      const textarea = screen.getByTestId('comment-edit-textarea') as HTMLTextAreaElement;
      fireEvent.change(textarea, { target: { value: 'should not save' } });
      fireEvent.keyDown(textarea, { key: 'Escape', code: 'Escape' });
    });

    // Back to view mode
    expect(screen.queryByTestId('comment-text')).not.toBeNull();
    expect(screen.queryByTestId('comment-edit-textarea')).toBeNull();

    // onEdit must NOT have been called
    expect(onEdit).not.toHaveBeenCalled();
  });
});
