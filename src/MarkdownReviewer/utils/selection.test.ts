/**
 * utils/selection.test.ts — unit tests for captureSelection + canon (STORY-002-01)
 *
 * 4 unit tests (story §4.1):
 *   1. Paragraph selection
 *   2. Heading selection
 *   3. List item selection
 *   4. Cross-block (paragraph → list) selection
 *
 * Test runner: vitest + jsdom
 *
 * jsdom Selection limitation: getBoundingClientRect() returns zeros.
 * We test captureSelection by constructing real DOM nodes in jsdom and
 * building a real Selection + Range object where possible. For the parts
 * that need stub behaviour, we construct the Selection manually.
 *
 * Key insight: captureSelection walks Text nodes inside editorRoot.
 * We build a minimal DOM tree that mirrors what Crepe renders, then
 * create a Range pointing at specific text nodes, and verify the
 * returned markdown coordinates.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { captureSelection, canon } from './selection';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * makeEditorRoot — creates a minimal DOM element that stands in for
 * the Crepe contenteditable root, with children that simulate what
 * Milkdown/ProseMirror renders.
 */
function makeEditorRoot(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

/**
 * makeSelection — creates a Selection-like object that wraps a real DOM Range.
 * jsdom supports createRange() and range manipulation.
 */
function makeSelection(range: globalThis.Range): Selection {
  // Use the real jsdom selection API
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  return sel;
}

afterEach(() => {
  // Clean up DOM nodes added during tests
  document.body.innerHTML = '';
  // Clear any selection
  const sel = window.getSelection();
  if (sel) sel.removeAllRanges();
});

// ─── canon() tests ────────────────────────────────────────────────────────────

describe('canon()', () => {
  it('collapses whitespace runs to single space', () => {
    expect(canon('hello   world')).toBe('hello world');
    expect(canon('  hello\n  world  ')).toBe('hello world');
  });

  it('normalizes * list markers to -', () => {
    expect(canon('* item one')).toBe('- item one');
    expect(canon('* item one\n* item two')).toBe('- item one - item two');
  });

  it('does not alter - markers', () => {
    expect(canon('- item')).toBe('- item');
  });
});

// ─── Scenario 1: Paragraph selection ─────────────────────────────────────────

describe('captureSelection: paragraph', () => {
  it('maps a selection within a single paragraph to correct startLine/endLine/startChar/endChar', () => {
    const markdown = 'Lorem ipsum dolor sit amet';
    // Crepe renders a paragraph as <p>Lorem ipsum dolor sit amet</p>
    const editorRoot = makeEditorRoot('<p>Lorem ipsum dolor sit amet</p>');

    const p = editorRoot.querySelector('p')!;
    const textNode = p.firstChild as Text;

    // Select "Lorem ipsum dolor" (0..17)
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 17);
    const selection = makeSelection(range);

    const result = captureSelection(markdown, editorRoot, selection);
    expect(result).not.toBeNull();
    expect(result!.range.startLine).toBe(0);
    expect(result!.range.endLine).toBe(0);
    expect(result!.range.startChar).toBe(0);
    expect(result!.range.endChar).toBe(17);
    expect(result!.selectedText).toBe('Lorem ipsum dolor');
  });
});

// ─── Scenario 2: Heading selection ───────────────────────────────────────────

describe('captureSelection: heading', () => {
  it('maps a selection within a heading line to correct markdown coordinates', () => {
    // Markdown line 0 is a heading: "# Introduction"
    // Markdown line 1 is a paragraph: "Some text here"
    const markdown = '# Introduction\nSome text here';
    // Crepe renders headings as <h1>Introduction</h1> (without the `#` marker)
    const editorRoot = makeEditorRoot('<h1>Introduction</h1><p>Some text here</p>');

    const h1 = editorRoot.querySelector('h1')!;
    const textNode = h1.firstChild as Text;

    // Select "Introduction" (rendered text) → maps to char 2..14 in markdown line 0
    // because `# ` is the prefix (length 2)
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 12); // "Introduction".length == 12
    const selection = makeSelection(range);

    const result = captureSelection(markdown, editorRoot, selection);
    expect(result).not.toBeNull();
    expect(result!.range.startLine).toBe(0);
    expect(result!.range.endLine).toBe(0);
    // startChar: prefix length (2 for "# ") + 0 = 2
    expect(result!.range.startChar).toBe(2);
    // endChar: 2 + 12 = 14 (clamped to line length 15 at most)
    expect(result!.range.endChar).toBe(14);
    expect(result!.selectedText).toBe('Introduction');
  });
});

// ─── Scenario 3: List item selection ─────────────────────────────────────────

describe('captureSelection: list item', () => {
  it('maps a selection within a list item to correct markdown coordinates', () => {
    // Markdown:
    //   line 0: "- first item"
    //   line 1: "- second item"
    const markdown = '- first item\n- second item';
    // Crepe renders lists as <ul><li>first item</li><li>second item</li></ul>
    // The bullet `- ` is NOT a text node; it's a CSS pseudo-element.
    const editorRoot = makeEditorRoot('<ul><li>first item</li><li>second item</li></ul>');

    const li = editorRoot.querySelectorAll('li')[0]!;
    const textNode = li.firstChild as Text;

    // Select "first item" (the full text content of the first <li>)
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 10); // "first item".length == 10
    const selection = makeSelection(range);

    const result = captureSelection(markdown, editorRoot, selection);
    expect(result).not.toBeNull();
    expect(result!.range.startLine).toBe(0);
    expect(result!.range.endLine).toBe(0);
    // startChar: prefix "- " length = 2, so 2 + 0 = 2
    expect(result!.range.startChar).toBe(2);
    // endChar: 2 + 10 = 12
    expect(result!.range.endChar).toBe(12);
    expect(result!.selectedText).toBe('first item');
  });
});

// ─── Scenario 4: Cross-block selection (paragraph → list item) ───────────────

describe('captureSelection: cross-block', () => {
  it('maps a selection spanning a paragraph and a list item to multi-line range', () => {
    // Markdown:
    //   line 0: "Opening paragraph text"
    //   line 1: ""  (blank separator)
    //   line 2: "- list item one"
    //
    // After blank-line skipping in the block-to-line mapper,
    // paragraph → line 0, list item → line 2.
    const markdown = 'Opening paragraph text\n\n- list item one';

    // Crepe renders:
    //   <p>Opening paragraph text</p>
    //   <ul><li>list item one</li></ul>
    const editorRoot = makeEditorRoot(
      '<p>Opening paragraph text</p><ul><li>list item one</li></ul>',
    );

    const p = editorRoot.querySelector('p')!;
    const pText = p.firstChild as Text;

    const li = editorRoot.querySelector('li')!;
    const liText = li.firstChild as Text;

    // Select from "paragraph" (offset 8 in p) to end of "list item one" (offset 13 in li)
    const range = document.createRange();
    range.setStart(pText, 8); // "Opening " is 8 chars, so starts at "paragraph"
    range.setEnd(liText, 13); // "list item one".length == 13
    const selection = makeSelection(range);

    const result = captureSelection(markdown, editorRoot, selection);
    expect(result).not.toBeNull();

    // Start: line 0, char 8 (no prefix for paragraph)
    expect(result!.range.startLine).toBe(0);
    expect(result!.range.startChar).toBe(8);

    // End: line 2 (list item after blank line), char 2 + 13 = 15 (prefix "- " = 2)
    expect(result!.range.endLine).toBe(2);
    expect(result!.range.endChar).toBe(15);

    // selectedText is the canonicalized cross-block text
    // Raw: "paragraph text\n\n- list item one" sliced → canonicalized
    expect(result!.selectedText).toContain('paragraph text');
    expect(result!.selectedText).toContain('list item one');
  });
});

// ─── Scenario 5: Crepe-style wrapped DOM (UR:bug Phase-D fix) ─────────────────
//
// Before the fix, selection.ts included `div` in its blockSelector. Crepe's
// transparent wrapper divs (which contain no other block-level children matching
// the selector) would survive the leaf-filter as "leaf divs", consuming lineIdx
// slots. This caused real content blocks (paragraphs) to be assigned lineIdx
// positions AFTER those div slots were consumed, or to be left without any
// blockToLine entry (mapped to line 0, char 0). When both start and end positions
// resolved to (0, 0), captureSelection returned null → no popover.
//
// Fix: BLOCK_SELECTOR in blockMap.ts excludes `div`, so wrapper divs are
// invisible to the selector, and the lineIdx counter only advances for real
// content blocks.

describe('captureSelection: Crepe-style wrapped DOM — UR:bug Phase-D fix', () => {
  it('returns non-null with correct startLine when editorRoot has Crepe-style wrapper divs', () => {
    // Simulate the Crepe DOM structure:
    //   <div> (editorRoot)
    //     <div> (Crepe wrapper)
    //       <p>First paragraph</p>
    //     </div>
    //     <div> (Crepe wrapper)
    //       <p>Second paragraph</p>
    //     </div>
    //   </div>
    const markdown = 'First paragraph\n\nSecond paragraph';
    const editorRoot = makeEditorRoot(
      '<div><p>First paragraph</p></div><div><p>Second paragraph</p></div>',
    );

    const p1 = editorRoot.querySelector('p')!;
    const textNode = p1.firstChild as Text;

    // Select "First para" (chars 0..10) within the first paragraph
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 10); // "First para".length == 10
    const selection = makeSelection(range);

    const result = captureSelection(markdown, editorRoot, selection);

    // Must NOT return null — the bug caused null here
    expect(result).not.toBeNull();

    // The selection is in "First paragraph" which is line 0
    expect(result!.range.startLine).toBe(0);
    expect(result!.range.endLine).toBe(0);

    // startChar 0 (no prefix for plain paragraph), endChar 10
    expect(result!.range.startChar).toBe(0);
    expect(result!.range.endChar).toBe(10);

    expect(result!.selectedText).toBe('First para');
  });

  it('returns non-null for selection in second paragraph with wrapper divs', () => {
    const markdown = 'First paragraph\n\nSecond paragraph';
    const editorRoot = makeEditorRoot(
      '<div><p>First paragraph</p></div><div><p>Second paragraph</p></div>',
    );

    const paragraphs = editorRoot.querySelectorAll('p');
    const p2 = paragraphs[1]!;
    const textNode = p2.firstChild as Text;

    // Select "Second" (chars 0..6) in the second paragraph
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 6); // "Second".length == 6
    const selection = makeSelection(range);

    const result = captureSelection(markdown, editorRoot, selection);

    // Must NOT return null
    expect(result).not.toBeNull();

    // "Second paragraph" is at line 2 (line 1 is blank)
    expect(result!.range.startLine).toBe(2);
    expect(result!.range.endLine).toBe(2);
    expect(result!.range.startChar).toBe(0);
    expect(result!.range.endChar).toBe(6);
    expect(result!.selectedText).toBe('Second');
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('captureSelection: null guard', () => {
  it('returns null for a collapsed selection', () => {
    const markdown = 'Hello world';
    const editorRoot = makeEditorRoot('<p>Hello world</p>');
    const p = editorRoot.querySelector('p')!;
    const textNode = p.firstChild as Text;

    const range = document.createRange();
    range.setStart(textNode, 5);
    range.setEnd(textNode, 5); // collapsed
    const selection = makeSelection(range);

    const result = captureSelection(markdown, editorRoot, selection);
    expect(result).toBeNull();
  });

  it('returns null when selection is outside editorRoot', () => {
    const markdown = 'Hello world';
    const editorRoot = makeEditorRoot('<p>Hello world</p>');

    // Create a text node outside editorRoot
    const outsideDiv = document.createElement('div');
    const outsideText = document.createTextNode('outside text');
    outsideDiv.appendChild(outsideText);
    document.body.appendChild(outsideDiv);

    const range = document.createRange();
    range.setStart(outsideText, 0);
    range.setEnd(outsideText, 7);
    const selection = makeSelection(range);

    const result = captureSelection(markdown, editorRoot, selection);
    expect(result).toBeNull();
  });
});
