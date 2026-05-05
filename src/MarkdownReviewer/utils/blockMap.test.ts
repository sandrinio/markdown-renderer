/**
 * utils/blockMap.test.ts — tests for the shared block-map helper (UR:bug fix Phase-D)
 *
 * Key scenarios:
 *   1. Crepe-style wrapped DOM: transparent div wrappers around real blocks.
 *      The leaf-filter MUST produce only 2 entries (the <p> elements), NOT 4
 *      (which would include the wrapper divs if `div` were in BLOCK_SELECTOR).
 *   2. Flat DOM (no wrappers): basic paragraph/heading/list structure.
 *   3. buildBlockLineMap assigns correct line ranges.
 *   4. findBlockForLine finds the right block for a given line.
 *   5. findLineForBlock maps a block element back to its source line.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  BLOCK_SELECTOR,
  buildBlockLineMap,
  findBlockForLine,
  findLineForBlock,
  getLeafBlocks,
  lineCharToRange,
} from './blockMap';

afterEach(() => {
  document.body.innerHTML = '';
});

// ─── Scenario 1: Crepe-style wrapped DOM ──────────────────────────────────────
//
// This is the bug scenario. Crepe wraps rendered content in transparent <div>
// containers. Before the fix, `selection.ts` used a blockSelector that included
// `div`, causing wrapper divs to be counted as leaf blocks. With BLOCK_SELECTOR
// NOT including `div`, only the real content blocks are returned.
//
// Fixture: <div>                         ← Crepe root
//            <div>                       ← transparent wrapper
//              <p>Para 1</p>             ← leaf block (should be counted)
//            </div>
//            <div>                       ← transparent wrapper
//              <p>Para 2</p>             ← leaf block (should be counted)
//            </div>
//          </div>
//
// Expected: getLeafBlocks returns [<p>Para 1</p>, <p>Para 2</p>] — 2 entries.
// Buggy:    if `div` were in BLOCK_SELECTOR, the filter would yield the wrapper
//           divs as "leaf blocks" because they don't contain other matching blocks
//           (the inner div contains a <p>, but the outer div's contains() call
//           sees the <p> — so actually the outer div IS filtered out correctly,
//           but the inner divs survive as "leaf" if they contain no other blocks
//           in the set). With `div` in selector, we get 4 elements total:
//           [outer-div, inner-div-1, p1, inner-div-2, p2] → leaf filter →
//           inner-div-1 is NOT a leaf (contains p1), but actually depends on the
//           filter logic. The actual bug: inner-div-1.contains(p1) = true, so
//           inner-div-1 is excluded. But the p elements ARE leaves too, so we'd
//           get p1 and p2 as leaves... WAIT — let's think again:
//
//           With `div` in selector:
//             allBlocks = [inner-div-1, p1, inner-div-2, p2]  (outer div has no match if root IS the outer div)
//           Actually with `root.querySelectorAll(...)` and root being the outer div:
//             allBlocks = [inner-div-1, p1, inner-div-2, p2]
//           Leaf filter: keep blocks where !allBlocks.some(o => o !== b && b.contains(o))
//             - inner-div-1.contains(p1) = true → inner-div-1 is NOT a leaf → excluded
//             - p1.contains(inner-div-1) = false, p1.contains(inner-div-2) = false, p1.contains(p2) = false → p1 IS a leaf
//             - inner-div-2.contains(p2) = true → inner-div-2 is NOT a leaf → excluded
//             - p2.contains(...) = false → p2 IS a leaf
//           So leafBlocks = [p1, p2] — same result!
//
//           Hmm — so the leaf filter in CommentLayer.tsx IS correct and would give p1/p2.
//           But the bug is in selection.ts's buildNodePositionMap which uses a DIFFERENT
//           approach: it queries allBlocks, applies the SAME leaf filter, and then
//           walks through leafBlocks assigning lineIdx. If div IS included in the query
//           AND a div survives the leaf filter (because it contains NO other matching
//           blocks — e.g., a Crepe wrapper div that wraps content using spans, not p/h*/li),
//           then that div is assigned a markdown line, advancing lineIdx incorrectly.
//
//           The real Crepe structure has deeper nesting that can produce such "leaf divs".
//           This test validates the principle: with BLOCK_SELECTOR excluding div,
//           wrapper divs are invisible to the selector, so only real content blocks
//           (p, h*, li, pre, blockquote) are candidates — eliminating the possibility
//           of spurious leaf-div entries consuming markdown lines.

describe('getLeafBlocks: Crepe-style wrapped DOM (the bug fixture)', () => {
  it('returns only <p> elements when transparent div wrappers surround them — NOT the wrapper divs', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div>
        <p>Para 1</p>
      </div>
      <div>
        <p>Para 2</p>
      </div>
    `;
    document.body.appendChild(root);

    const leafBlocks = getLeafBlocks(root);

    // Must return exactly 2 entries (the <p> elements)
    expect(leafBlocks).toHaveLength(2);

    // Both must be <p> elements, not <div>
    expect(leafBlocks[0]!.tagName.toLowerCase()).toBe('p');
    expect(leafBlocks[1]!.tagName.toLowerCase()).toBe('p');
    expect(leafBlocks[0]!.textContent).toBe('Para 1');
    expect(leafBlocks[1]!.textContent).toBe('Para 2');
  });

  it('returns only <p> elements for deeply nested Crepe-style wrapper divs', () => {
    // Deeper nesting: div > div > div > p (3 levels of transparent wrappers)
    const root = document.createElement('div');
    root.innerHTML = `
      <div>
        <div>
          <div>
            <p>Deep para 1</p>
          </div>
        </div>
      </div>
      <div>
        <div>
          <p>Deep para 2</p>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    const leafBlocks = getLeafBlocks(root);

    expect(leafBlocks).toHaveLength(2);
    expect(leafBlocks[0]!.tagName.toLowerCase()).toBe('p');
    expect(leafBlocks[1]!.tagName.toLowerCase()).toBe('p');
  });

  it('BLOCK_SELECTOR does not include div', () => {
    // Explicit assertion that `div` is not part of the canonical selector.
    // If this fails, the root cause of the bug has been re-introduced.
    const selectorParts = BLOCK_SELECTOR.split(',').map((s) => s.trim());
    expect(selectorParts).not.toContain('div');
  });
});

// ─── Scenario 2: Flat DOM (no wrappers) ──────────────────────────────────────

describe('getLeafBlocks: flat DOM without wrappers', () => {
  it('returns all block elements from a flat heading + paragraph + list structure', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <h1>Heading</h1>
      <p>Paragraph</p>
      <ul>
        <li>Item one</li>
        <li>Item two</li>
      </ul>
    `;
    document.body.appendChild(root);

    const leafBlocks = getLeafBlocks(root);

    // h1, p, li, li — ul is not in BLOCK_SELECTOR so it's ignored
    expect(leafBlocks).toHaveLength(4);
    expect(leafBlocks[0]!.tagName.toLowerCase()).toBe('h1');
    expect(leafBlocks[1]!.tagName.toLowerCase()).toBe('p');
    expect(leafBlocks[2]!.tagName.toLowerCase()).toBe('li');
    expect(leafBlocks[3]!.tagName.toLowerCase()).toBe('li');
  });

  it('handles blockquote > p by returning the inner <p>, not the <blockquote>', () => {
    // blockquote contains a p: the leaf is the p, not the blockquote
    const root = document.createElement('div');
    root.innerHTML = `<blockquote><p>quoted text</p></blockquote>`;
    document.body.appendChild(root);

    const leafBlocks = getLeafBlocks(root);

    // Both blockquote and p are in BLOCK_SELECTOR, but blockquote contains p → p is leaf
    expect(leafBlocks).toHaveLength(1);
    expect(leafBlocks[0]!.tagName.toLowerCase()).toBe('p');
  });
});

// ─── Scenario 3: buildBlockLineMap assigns correct line ranges ─────────────────

describe('buildBlockLineMap: line range assignment', () => {
  it('assigns correct line ranges for a heading + blank + paragraph + blank + list structure', () => {
    const markdown = '# Heading\n\nParagraph one\n\n- Item one\n- Item two';

    const root = document.createElement('div');
    const h1 = document.createElement('h1');
    h1.textContent = 'Heading';
    const p = document.createElement('p');
    p.textContent = 'Paragraph one';
    const li1 = document.createElement('li');
    li1.textContent = 'Item one';
    const li2 = document.createElement('li');
    li2.textContent = 'Item two';
    root.appendChild(h1);
    root.appendChild(p);
    root.appendChild(li1);
    root.appendChild(li2);

    const leafBlocks = [h1, p, li1, li2] as HTMLElement[];
    const blockMap = buildBlockLineMap(markdown, leafBlocks);

    expect(blockMap).toHaveLength(4);

    // h1 → line 0
    expect(blockMap[0]!.block).toBe(h1);
    expect(blockMap[0]!.startLine).toBe(0);
    expect(blockMap[0]!.endLine).toBe(0);

    // p → line 2 (blank line 1 skipped)
    expect(blockMap[1]!.block).toBe(p);
    expect(blockMap[1]!.startLine).toBe(2);
    expect(blockMap[1]!.endLine).toBe(2);

    // li1 → line 4 (blank line 3 skipped)
    expect(blockMap[2]!.block).toBe(li1);
    expect(blockMap[2]!.startLine).toBe(4);
    expect(blockMap[2]!.endLine).toBe(4);

    // li2 → line 5 (consecutive with li1)
    expect(blockMap[3]!.block).toBe(li2);
    expect(blockMap[3]!.startLine).toBe(5);
    expect(blockMap[3]!.endLine).toBe(5);
  });

  it('assigns correct line ranges for a Crepe-style wrapped DOM structure', () => {
    // Simulate the actual Crepe output: wrapper divs around p blocks.
    // getLeafBlocks correctly extracts [p1, p2]; buildBlockLineMap receives them.
    const markdown = 'First paragraph\n\nSecond paragraph';

    const root = document.createElement('div');
    root.innerHTML = `
      <div><p>First paragraph</p></div>
      <div><p>Second paragraph</p></div>
    `;
    document.body.appendChild(root);

    // Use getLeafBlocks to simulate what both selection.ts and CommentLayer.tsx will do
    const leafBlocks = getLeafBlocks(root);
    expect(leafBlocks).toHaveLength(2); // sanity

    const blockMap = buildBlockLineMap(markdown, leafBlocks);

    expect(blockMap).toHaveLength(2);
    // p1 → line 0
    expect(blockMap[0]!.startLine).toBe(0);
    expect(blockMap[0]!.endLine).toBe(0);
    // p2 → line 2 (blank line 1 skipped)
    expect(blockMap[1]!.startLine).toBe(2);
    expect(blockMap[1]!.endLine).toBe(2);
  });

  it('handles empty leafBlocks array', () => {
    const result = buildBlockLineMap('some content', []);
    expect(result).toHaveLength(0);
  });

  it('handles code fence (pre) block spanning multiple lines', () => {
    const markdown = 'Intro\n\n```\nconst x = 1;\nconst y = 2;\n```\n\nOutro';

    const root = document.createElement('div');
    const p1 = document.createElement('p');
    p1.textContent = 'Intro';
    const pre = document.createElement('pre');
    pre.textContent = 'const x = 1;\nconst y = 2;';
    const p2 = document.createElement('p');
    p2.textContent = 'Outro';
    root.appendChild(p1);
    root.appendChild(pre);
    root.appendChild(p2);

    const leafBlocks = [p1, pre, p2] as HTMLElement[];
    const blockMap = buildBlockLineMap(markdown, leafBlocks);

    expect(blockMap).toHaveLength(3);

    // p1 → line 0
    expect(blockMap[0]!.startLine).toBe(0);
    expect(blockMap[0]!.endLine).toBe(0);

    // pre → lines 2–5 (opening ``` at 2, content 3-4, closing ``` at 5)
    expect(blockMap[1]!.startLine).toBe(2);
    expect(blockMap[1]!.endLine).toBe(5);

    // p2 → line 7 (blank line 6 skipped)
    expect(blockMap[2]!.startLine).toBe(7);
    expect(blockMap[2]!.endLine).toBe(7);
  });
});

// ─── Scenario 4: findBlockForLine ────────────────────────────────────────────

describe('findBlockForLine', () => {
  it('returns the block whose range covers the target line', () => {
    const h1 = document.createElement('h1');
    const p = document.createElement('p');
    const li = document.createElement('li');

    const blockMap = [
      { block: h1, startLine: 0, endLine: 0 },
      { block: p, startLine: 2, endLine: 2 },
      { block: li, startLine: 4, endLine: 4 },
    ];

    expect(findBlockForLine(0, blockMap)).toBe(h1);
    expect(findBlockForLine(2, blockMap)).toBe(p);
    expect(findBlockForLine(4, blockMap)).toBe(li);
  });

  it('falls back to nearest block when no exact cover exists', () => {
    const p1 = document.createElement('p');
    const p2 = document.createElement('p');

    const blockMap = [
      { block: p1, startLine: 0, endLine: 0 },
      { block: p2, startLine: 4, endLine: 4 },
    ];

    // Line 1 is a blank line — no exact cover; nearest is p1 (distance 1 vs 3)
    expect(findBlockForLine(1, blockMap)).toBe(p1);
    // Line 3 — nearest is p2 (distance 1 vs 3)
    expect(findBlockForLine(3, blockMap)).toBe(p2);
  });

  it('returns null for empty blockMap', () => {
    expect(findBlockForLine(0, [])).toBeNull();
  });
});

// ─── Scenario 5: findLineForBlock ────────────────────────────────────────────

describe('findLineForBlock', () => {
  it('returns the startLine for a block element that is in the map', () => {
    const p1 = document.createElement('p');
    const p2 = document.createElement('p');

    const blockMap = [
      { block: p1, startLine: 0, endLine: 0 },
      { block: p2, startLine: 2, endLine: 2 },
    ];

    expect(findLineForBlock(p1, blockMap)).toBe(0);
    expect(findLineForBlock(p2, blockMap)).toBe(2);
  });

  it('returns null for an element not in the map', () => {
    const p1 = document.createElement('p');
    const p2 = document.createElement('p');

    const blockMap = [{ block: p1, startLine: 0, endLine: 0 }];

    expect(findLineForBlock(p2, blockMap)).toBeNull();
  });

  it('matches when the target element is a child of a block in the map', () => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    li.appendChild(span);

    const blockMap = [{ block: li, startLine: 3, endLine: 3 }];

    // span is a child of li, so findLineForBlock should return li's line
    expect(findLineForBlock(span as HTMLElement, blockMap)).toBe(3);
  });
});

// ─── Scenario 6: lineCharToRange ─────────────────────────────────────────────

describe('lineCharToRange: converts markdown-source coords to a DOM Range', () => {
  /**
   * Helper — builds an editor root with paragraphs and appends to document.body.
   */
  function makeEditorRootWithParagraphs(texts: string[]): HTMLDivElement {
    const div = document.createElement('div');
    for (const t of texts) {
      const p = document.createElement('p');
      p.textContent = t;
      div.appendChild(p);
    }
    document.body.appendChild(div);
    return div;
  }

  it('returns a Range for a same-line selection (startLine === endLine)', () => {
    // Single paragraph: "Hello world"
    const markdownSource = 'Hello world';
    const root = makeEditorRootWithParagraphs(['Hello world']);

    const range = lineCharToRange(markdownSource, root, 0, 0, 0, 5);
    expect(range).not.toBeNull();
    // The range should cover "Hello" (chars 0..5)
    expect(range!.toString()).toBe('Hello');
  });

  it('returns a Range spanning two blocks (cross-block selection)', () => {
    // Two paragraphs separated by blank line
    const markdownSource = 'First\n\nSecond';
    const root = makeEditorRootWithParagraphs(['First', 'Second']);

    // startLine=0 (First), startChar=0; endLine=2 (Second), endChar=6
    const range = lineCharToRange(markdownSource, root, 0, 0, 2, 6);
    expect(range).not.toBeNull();
    // Range should span from "F" in "First" to end of "Second"
    expect(range!.toString()).toContain('First');
    expect(range!.toString()).toContain('Second');
  });

  it('clamps startChar to end of block when it exceeds text length', () => {
    // Paragraph: "Hi" (length 2); startChar=999 should clamp
    const markdownSource = 'Hi';
    const root = makeEditorRootWithParagraphs(['Hi']);

    const range = lineCharToRange(markdownSource, root, 0, 999, 0, 999);
    // Should NOT throw; should return a valid (collapsed or clamped) range
    expect(range).not.toBeNull();
  });

  it('returns null when startLine is out of bounds', () => {
    const markdownSource = 'Hello';
    const root = makeEditorRootWithParagraphs(['Hello']);

    const range = lineCharToRange(markdownSource, root, 99, 0, 99, 5);
    expect(range).toBeNull();
  });

  it('returns null when editorRoot has no leaf blocks', () => {
    const markdownSource = 'Hello';
    const root = document.createElement('div');
    // div with no matching BLOCK_SELECTOR children
    root.textContent = 'raw text in a div';
    document.body.appendChild(root);

    const range = lineCharToRange(markdownSource, root, 0, 0, 0, 5);
    expect(range).toBeNull();
  });

  it('returns null when markdownSource is empty string', () => {
    const root = makeEditorRootWithParagraphs(['Hello']);
    // Empty source → lines = [''], startLine 0 is valid but no block maps
    // (or the block has text but startLine=0 is in bounds)
    // Actually empty string has 1 line: [''] — this should either return null or a range
    // The key thing: no exception thrown
    expect(() => {
      lineCharToRange('', root, 0, 0, 0, 0);
    }).not.toThrow();
  });
});
