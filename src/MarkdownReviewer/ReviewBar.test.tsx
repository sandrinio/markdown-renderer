/**
 * ReviewBar.test.tsx — unit tests for <ReviewBar /> (STORY-002-04)
 *
 * One test per Gherkin scenario in §2.1 that directly concerns ReviewBar behaviour.
 * Runs under vitest + jsdom + @testing-library/react.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewBar } from './ReviewBar';

afterEach(() => {
  cleanup();
});

// ─── Scenario: ReviewBar renders active filename ──────────────────────────────

describe('ReviewBar renders active filename', () => {
  it('shows the active filename when a file is selected', () => {
    render(
      <ReviewBar
        activeFile="spec.md"
        editMode={false}
        onToggleEditMode={vi.fn()}
        onReview={vi.fn()}
      />,
    );
    expect(screen.getByText('spec.md')).toBeTruthy();
  });

  it('shows "No file selected" when activeFile is null', () => {
    render(
      <ReviewBar
        activeFile={null}
        editMode={false}
        onToggleEditMode={vi.fn()}
        onReview={vi.fn()}
      />,
    );
    expect(screen.getByText('No file selected')).toBeTruthy();
  });
});

// ─── Scenario: Edit toggle aria-pressed flips on click ───────────────────────

describe('Edit toggle aria-pressed', () => {
  it('reflects editMode=false as aria-pressed="false"', () => {
    render(
      <ReviewBar
        activeFile="spec.md"
        editMode={false}
        onToggleEditMode={vi.fn()}
        onReview={vi.fn()}
      />,
    );
    const toggle = screen.getByTestId('edit-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.textContent).toBe('Edit');
  });

  it('reflects editMode=true as aria-pressed="true" and shows "Done"', () => {
    render(
      <ReviewBar
        activeFile="spec.md"
        editMode={true}
        onToggleEditMode={vi.fn()}
        onReview={vi.fn()}
      />,
    );
    const toggle = screen.getByTestId('edit-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.textContent).toBe('Done');
  });

  it('calls onToggleEditMode when the Edit toggle is clicked', () => {
    const onToggle = vi.fn();
    render(
      <ReviewBar
        activeFile="spec.md"
        editMode={false}
        onToggleEditMode={onToggle}
        onReview={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('edit-toggle'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

// ─── Scenario: Review button disabled when no active file ────────────────────

describe('Review button disabled when no active file', () => {
  it('has the disabled attribute when activeFile is null', () => {
    render(
      <ReviewBar
        activeFile={null}
        editMode={false}
        onToggleEditMode={vi.fn()}
        onReview={vi.fn()}
      />,
    );
    const reviewBtn = screen.getByTestId('review-button');
    expect(reviewBtn.getAttribute('disabled')).not.toBeNull();
  });

  it('does NOT have the disabled attribute when a file is active', () => {
    render(
      <ReviewBar
        activeFile="spec.md"
        editMode={false}
        onToggleEditMode={vi.fn()}
        onReview={vi.fn()}
      />,
    );
    const reviewBtn = screen.getByTestId('review-button');
    expect(reviewBtn.getAttribute('disabled')).toBeNull();
  });
});

// ─── Scenario: Review click calls onReview ───────────────────────────────────

describe('Review click calls onReview', () => {
  it('calls onReview when Review button is clicked', () => {
    const onReview = vi.fn();
    render(
      <ReviewBar
        activeFile="spec.md"
        editMode={false}
        onToggleEditMode={vi.fn()}
        onReview={onReview}
      />,
    );
    fireEvent.click(screen.getByTestId('review-button'));
    expect(onReview).toHaveBeenCalledTimes(1);
  });
});
