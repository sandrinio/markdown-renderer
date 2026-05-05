/**
 * utils/anchor.test.ts — unit tests for `reconcile` (STORY-002-03)
 *
 * Gherkin scenarios covered (partial — pure-function layer):
 *   1. Nominal match — unchanged text stays matched.
 *   2. Whitespace-run canonicalization — extra spaces do NOT detach.
 *   3. List-marker canonicalization — `*` vs `-` do NOT detach.
 *   4. CRLF vs LF canonicalization — CRLF does NOT detach.
 *   + 5. Altered text is detected as drifted (matched: false).
 */

import { describe, expect, it } from 'vitest';
import { reconcile } from './anchor';

// ─── Scenario 1: Nominal match (unchanged text) ───────────────────────────────

describe('reconcile — nominal match', () => {
  it('returns matched: true when selectedText exactly equals the text at the range', () => {
    const markdown = 'Lorem ipsum dolor sit amet';
    // Comment anchored to "Lorem ipsum dolor" (chars 0..17, line 0)
    const result = reconcile(markdown, {
      range: { startLine: 0, endLine: 0, startChar: 0, endChar: 17 },
      selectedText: 'Lorem ipsum dolor',
    });
    expect(result.matched).toBe(true);
    expect(result.currentText).toBe('Lorem ipsum dolor');
  });

  it('returns matched: false when the text at range has changed', () => {
    // "Hello world" is now at the position where "Lorem ipsum dolor" was
    const markdown = 'Hello world sit amet';
    const result = reconcile(markdown, {
      range: { startLine: 0, endLine: 0, startChar: 0, endChar: 17 },
      selectedText: 'Lorem ipsum dolor',
    });
    expect(result.matched).toBe(false);
  });
});

// ─── Scenario 2: Whitespace-run canonicalization ──────────────────────────────

describe('reconcile — whitespace-run canonicalization', () => {
  it('does NOT detach when the markdown has extra internal spaces (whitespace collapse)', () => {
    // "Lorem   ipsum   dolor" — extra spaces; canon collapses to "Lorem ipsum dolor"
    const markdown = 'Lorem   ipsum   dolor sit amet';
    const result = reconcile(markdown, {
      range: { startLine: 0, endLine: 0, startChar: 0, endChar: 22 },
      selectedText: 'Lorem ipsum dolor', // originally canonical (stored by 002-01)
    });
    // canon("Lorem   ipsum   dolor") === "Lorem ipsum dolor"
    expect(result.matched).toBe(true);
  });

  it('does NOT detach when trailing spaces differ', () => {
    const markdown = 'paragraph   ';
    const result = reconcile(markdown, {
      range: { startLine: 0, endLine: 0, startChar: 0, endChar: 12 },
      selectedText: 'paragraph',
    });
    expect(result.matched).toBe(true);
  });
});

// ─── Scenario 3: List-marker canonicalization ─────────────────────────────────

describe('reconcile — list-marker canonicalization', () => {
  it('does NOT detach when `*` marker is replaced by `-` marker', () => {
    // Crepe may normalize `* item` to `- item` on re-render
    const markdownWithDash = '- item text';
    const result = reconcile(markdownWithDash, {
      range: { startLine: 0, endLine: 0, startChar: 0, endChar: 11 },
      selectedText: '* item text', // original used `*`
    });
    // canon("* item text") === "- item text" === canon("- item text")
    expect(result.matched).toBe(true);
  });

  it('does NOT detach when `* ` marker with extra space normalizes', () => {
    const markdownWithStarExtraSpace = '*  item text';
    const result = reconcile(markdownWithStarExtraSpace, {
      range: { startLine: 0, endLine: 0, startChar: 0, endChar: 12 },
      selectedText: '- item text',
    });
    expect(result.matched).toBe(true);
  });
});

// ─── Scenario 4: CRLF vs LF canonicalization ─────────────────────────────────

describe('reconcile — CRLF vs LF canonicalization', () => {
  it('does NOT detach when line endings change from LF to canonical (whitespace collapse)', () => {
    // Multi-line selection where CRLF was used at capture time but LF at reconcile time.
    // canon() collapses ALL whitespace including \r\n to a single space.
    const markdownLF = 'line one\nline two';
    const result = reconcile(markdownLF, {
      range: { startLine: 0, endLine: 1, startChar: 0, endChar: 8 },
      selectedText: 'line one\r\nline two', // stored with CRLF
    });
    // canon("line one\nline two") === "line one line two"
    // canon("line one\r\nline two") === "line one line two"
    expect(result.matched).toBe(true);
  });

  it('matches across multi-line selections when text is unchanged', () => {
    const markdown = 'first line\nsecond line';
    const result = reconcile(markdown, {
      range: { startLine: 0, endLine: 1, startChar: 0, endChar: 11 },
      selectedText: 'first line\nsecond line',
    });
    expect(result.matched).toBe(true);
  });
});

// ─── Scenario 5: Altered text is detected ────────────────────────────────────

describe('reconcile — altered text detection (Gherkin: anchor drifts)', () => {
  it('returns matched: false and the new currentText when the anchored word changes', () => {
    const markdown = 'Hello world'; // was "Lorem ipsum dolor"
    const result = reconcile(markdown, {
      range: { startLine: 0, endLine: 0, startChar: 0, endChar: 11 },
      selectedText: 'Lorem ipsum',
    });
    expect(result.matched).toBe(false);
    expect(result.currentText).toBe('Hello world');
  });

  it('returns matched: true when undo restores the original text', () => {
    const originalMarkdown = 'Lorem ipsum dolor';
    const result = reconcile(originalMarkdown, {
      range: { startLine: 0, endLine: 0, startChar: 0, endChar: 17 },
      selectedText: 'Lorem ipsum dolor',
    });
    expect(result.matched).toBe(true);
  });
});
