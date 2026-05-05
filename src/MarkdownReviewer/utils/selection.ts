/**
 * utils/selection.ts — DOM Selection → markdown-source range mapping (STORY-002-01)
 *
 * Architecture rules (EPIC-002 §0):
 *   - All coordinates are markdown-source character offsets (0-indexed lines, 0-indexed chars).
 *   - No DOM HTML offsets stored. No `dangerouslySetInnerHTML`.
 *   - `canon()` is exported ONCE from this file. STORY-002-03's utils/anchor.ts
 *     imports it from here — do NOT redefine it elsewhere (asymmetric canonicalization
 *     is the silent bug the Architect flagged as Risk #2 of SPRINT-02).
 */

import type { Range } from '../types';
import { buildBlockLineMap, getLeafBlocks } from './blockMap';

// ─── Canonicalizer ───────────────────────────────────────────────────────────
//
// Collapses whitespace runs and normalizes list markers `*` → `-`.
// This is the single shared canonicalizer; anchor.ts imports it.

/**
 * canon(text) — canonical form of a markdown text span.
 *   - Collapses all whitespace runs (spaces, tabs, newlines) to a single space.
 *   - Trims leading/trailing whitespace.
 *   - Normalizes list markers: leading `* ` (or `*\t`) → `- `.
 *
 * STORY-002-03 will `import { canon } from './selection'`. Do NOT define a
 * local copy in utils/anchor.ts.
 */
export function canon(text: string): string {
  // First normalize list markers: `* ` or `*\t` at start of any line → `- `
  const markerNormalized = text.replace(/^(\s*)\*(\s)/gm, '$1-$2');
  // Collapse all whitespace runs (including newlines) to single space and trim
  return markerNormalized.replace(/\s+/g, ' ').trim();
}

// ─── Selection capture ───────────────────────────────────────────────────────

export interface CaptureResult {
  range: Range;
  selectedText: string;
}

/**
 * captureSelection — maps a DOM Selection to markdown-source coordinates.
 *
 * @param markdownSource  Raw markdown string (from crepe.getMarkdown()).
 * @param editorRoot      The contenteditable root element that Crepe manages.
 * @param selection       The document's current Selection object.
 * @returns               `{ range, selectedText }` or `null`.
 *
 * Returns `null` when:
 *   - selection is null, empty, or collapsed.
 *   - selection falls entirely outside `editorRoot`.
 *
 * Mapping strategy (v1 — covers paragraphs, headings, lists, inline emphasis, links):
 *   Walk the markdown source line by line while also walking the plain-text content
 *   of the rendered DOM. For each rendered text node, accumulate a cursor tracking
 *   `(line, char)` in the markdown source. When the DOM Selection's
 *   `startContainer`/`startOffset` and `endContainer`/`endOffset` are encountered
 *   during the walk, record the markdown cursor position.
 *
 *   Block boundaries: each rendered block maps to one or more markdown lines.
 *   When a block boundary is crossed, advance the markdown cursor to the next non-blank
 *   line that accounts for the rendered content (handles `<p>`, `<h1>`-`<h6>`,
 *   `<li>`, etc.).
 *
 *   List markers (`*`, `-`, `1.`): these are NOT rendered as separate text nodes in
 *   Crepe / ProseMirror — they appear as `<li>` bullets. We detect `<li>` containers
 *   and advance the markdown cursor past the list-marker character(s) so the `startChar`
 *   / `endChar` align with the actual list-item text in the markdown source.
 *
 * Limitations (v1):
 *   - Tables, raw HTML blocks, math, Mermaid — best-effort; may misalign.
 *   - Code blocks: inner text aligns but fence markers are skipped.
 */
export function captureSelection(
  markdownSource: string,
  editorRoot: HTMLElement,
  selection: Selection,
): CaptureResult | null {
  // Guard: null, empty, or collapsed selection
  if (!selection || selection.rangeCount === 0) return null;
  const domRange = selection.getRangeAt(0);
  if (domRange.collapsed) return null;

  // Guard: selection must overlap with editorRoot
  if (!editorRoot.contains(domRange.startContainer) && !editorRoot.contains(domRange.endContainer)) {
    return null;
  }

  // Collect all text nodes inside editorRoot in document order
  const textNodes = collectTextNodes(editorRoot);

  // Build a map from each text node to its (line, char) position in markdownSource
  const nodePositions = buildNodePositionMap(markdownSource, editorRoot, textNodes);

  // Find start and end in markdown coordinates
  const startPos = resolvePosition(
    domRange.startContainer,
    domRange.startOffset,
    nodePositions,
    markdownSource,
    'start',
  );
  const endPos = resolvePosition(
    domRange.endContainer,
    domRange.endOffset,
    nodePositions,
    markdownSource,
    'end',
  );

  if (startPos === null || endPos === null) return null;

  // Ensure start <= end
  let { line: startLine, char: startChar } = startPos;
  let { line: endLine, char: endChar } = endPos;

  if (startLine > endLine || (startLine === endLine && startChar >= endChar)) {
    return null;
  }

  const range: Range = { startLine, endLine, startChar, endChar };

  // Extract the text from markdown source
  const lines = markdownSource.split('\n');
  let rawText: string;
  if (startLine === endLine) {
    rawText = (lines[startLine] ?? '').slice(startChar, endChar);
  } else {
    const firstPart = (lines[startLine] ?? '').slice(startChar);
    const middleParts = lines.slice(startLine + 1, endLine);
    const lastPart = (lines[endLine] ?? '').slice(0, endChar);
    rawText = [firstPart, ...middleParts, lastPart].join('\n');
  }

  const selectedText = canon(rawText);
  if (!selectedText) return null;

  return { range, selectedText };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

interface MarkdownPos {
  line: number;
  char: number;
}

interface NodePositionEntry {
  node: Text;
  startPos: MarkdownPos; // markdown position at start of this text node's content
}

/**
 * collectTextNodes — depth-first traversal of all Text nodes within `root`.
 */
function collectTextNodes(root: HTMLElement): Text[] {
  const result: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    result.push(node as Text);
  }
  return result;
}

/**
 * buildNodePositionMap — walks the markdown source in parallel with the DOM text
 * nodes to build a mapping from each text node to its (line, char) start position
 * in the markdown source.
 *
 * Strategy:
 *   1. Split markdown into lines.
 *   2. Use getLeafBlocks (from blockMap.ts) to find leaf blocks — the same function
 *      used by CommentLayer.tsx, ensuring both callers agree on block identity.
 *   3. Map each leaf block to its markdown line via buildBlockLineMap (shared helper).
 *   4. For each text node, find its containing leaf block; look up that block's
 *      markdown line; apply prefix offset to get the final char position.
 *
 * Critical fix: the previous version used its own inline block selector that
 * included `div`. Crepe wrapper divs could survive the leaf-filter as "leaf divs"
 * in certain DOM configurations, consuming markdown line slots and misaligning all
 * real content blocks. The shared BLOCK_SELECTOR (no `div`) eliminates this class
 * of divergence entirely.
 */
function buildNodePositionMap(
  markdownSource: string,
  editorRoot: HTMLElement,
  textNodes: Text[],
): NodePositionEntry[] {
  const lines = markdownSource.split('\n');

  // Use the shared helper — same selector and leaf-filter as CommentLayer.tsx.
  // Excludes `div` so Crepe wrapper divs are transparent.
  const leafBlocks = getLeafBlocks(editorRoot);

  // If no blocks found (e.g., editor has flat text nodes), treat editorRoot itself
  if (leafBlocks.length === 0) {
    return buildFlatPositionMap(textNodes, lines);
  }

  // Build block-line map using the shared helper (same logic as CommentLayer.tsx)
  const blockLineMap = buildBlockLineMap(markdownSource, leafBlocks);

  // Build a map from each text node to which leaf block it belongs
  const nodeToBlock = new Map<Text, HTMLElement>();
  for (const textNode of textNodes) {
    for (const block of leafBlocks) {
      if (block.contains(textNode)) {
        nodeToBlock.set(textNode, block);
        break;
      }
    }
  }

  // Build a map from leaf block to its source line index
  const blockToLine = new Map<HTMLElement, number>();
  for (const entry of blockLineMap) {
    blockToLine.set(entry.block, entry.startLine);
  }

  // Map each text node to a markdown position
  const entries: NodePositionEntry[] = [];

  for (const textNode of textNodes) {
    const block = nodeToBlock.get(textNode);
    if (block === undefined) {
      // Orphaned text node — assign position 0,0 as fallback
      entries.push({ node: textNode, startPos: { line: 0, char: 0 } });
      continue;
    }

    const blockLine = blockToLine.get(block);
    if (blockLine === undefined) {
      entries.push({ node: textNode, startPos: { line: 0, char: 0 } });
      continue;
    }

    const markdownLine = lines[blockLine] ?? '';
    const nodeIndexInBlock = findNodeOffsetInBlock(block, textNode);

    // The markdown line may have a prefix (list marker, heading `#`, etc.)
    // that is not rendered as a text node. We need to account for this.
    const prefix = extractMarkdownLinePrefix(markdownLine);

    const startChar = prefix + nodeIndexInBlock;
    const clampedChar = Math.min(startChar, markdownLine.length);

    entries.push({
      node: textNode,
      startPos: { line: blockLine, char: clampedChar },
    });
  }

  return entries;
}

/**
 * buildFlatPositionMap — fallback for editors with no block structure.
 */
function buildFlatPositionMap(textNodes: Text[], lines: string[]): NodePositionEntry[] {
  const entries: NodePositionEntry[] = [];
  let charCursor = 0;
  let lineCursor = 0;
  const fullText = lines.join('\n');

  for (const textNode of textNodes) {
    const nodeText = textNode.textContent ?? '';
    const posInFull = fullText.indexOf(nodeText, charCursor);
    if (posInFull !== -1) {
      // Convert flat character position to line:char
      const beforeNode = fullText.slice(0, posInFull);
      const beforeLines = beforeNode.split('\n');
      const line = beforeLines.length - 1;
      const char = beforeLines[beforeLines.length - 1]!.length;
      entries.push({ node: textNode, startPos: { line, char } });
      charCursor = posInFull;
    } else {
      entries.push({ node: textNode, startPos: { line: lineCursor, char: 0 } });
    }
  }
  return entries;
}

/**
 * findNodeOffsetInBlock — returns the character offset of `textNode` within the
 * concatenated text of its parent block, in document order.
 */
function findNodeOffsetInBlock(block: Element, targetNode: Text): number {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    if (node === targetNode) return offset;
    offset += (node.textContent ?? '').length;
  }
  return offset;
}

/**
 * extractMarkdownLinePrefix — returns the length of the non-content prefix in a
 * markdown line that is NOT rendered as a text node by Crepe/ProseMirror.
 *
 * Examples:
 *   `* item`   → 2  (the `* ` marker is rendered as a bullet by `<li>`, not text)
 *   `- item`   → 2
 *   `1. item`  → 3
 *   `# Heading` → 2 (the `# ` is the prefix; headings do render `#` differently)
 *   `paragraph` → 0
 *
 * In Crepe (ProseMirror), list markers are NOT rendered as text nodes; they become
 * CSS ::before pseudo-elements or `<li>` bullets. Heading `#` markers are similarly
 * transformed into HTML heading elements. So we need to skip these in our offset math.
 */
function extractMarkdownLinePrefix(line: string): number {
  // Unordered list marker: `* `, `- `, `+ `
  const ulMatch = line.match(/^(\s*(?:[*\-+])\s)/);
  if (ulMatch) return ulMatch[1]!.length;

  // Ordered list marker: `1. `, `12. `, etc.
  const olMatch = line.match(/^(\s*\d+\.\s)/);
  if (olMatch) return olMatch[1]!.length;

  // Headings: `# `, `## `, etc. — heading text IS rendered as the heading's textContent
  // but the `#` markers are NOT text nodes. However, in most MD editors the heading
  // content div only contains the heading text without `#` markers.
  const headingMatch = line.match(/^(#{1,6}\s)/);
  if (headingMatch) return headingMatch[1]!.length;

  return 0;
}

/**
 * resolvePosition — given a DOM node + offset (as in a Range), find the corresponding
 * markdown (line, char) position using the pre-built node position map.
 */
function resolvePosition(
  container: Node,
  offset: number,
  nodePositions: NodePositionEntry[],
  markdownSource: string,
  _side: 'start' | 'end',
): MarkdownPos | null {
  const lines = markdownSource.split('\n');

  // If container is a Text node, find it in our map
  if (container.nodeType === Node.TEXT_NODE) {
    const entry = nodePositions.find((e) => e.node === container);
    if (entry) {
      const line = entry.startPos.line;
      const char = entry.startPos.char + offset;
      const clampedChar = Math.min(char, (lines[line] ?? '').length);
      return { line, char: clampedChar };
    }
  }

  // If container is an Element node, the offset refers to a child index.
  // Find the nth child text node or element and resolve from there.
  if (container.nodeType === Node.ELEMENT_NODE) {
    const el = container as Element;
    const children = Array.from(el.childNodes);
    if (offset === 0) {
      // Position is before all children — find the first text node descendant
      const firstTextEntry = nodePositions.find((e) =>
        el.contains(e.node),
      );
      if (firstTextEntry) {
        return firstTextEntry.startPos;
      }
    } else if (offset >= children.length) {
      // Position is after all children — find the last text node descendant
      const lastTextEntry = [...nodePositions].reverse().find((e) =>
        el.contains(e.node),
      );
      if (lastTextEntry) {
        const lastNode = lastTextEntry.node;
        const textLen = (lastNode.textContent ?? '').length;
        const line = lastTextEntry.startPos.line;
        const char = lastTextEntry.startPos.char + textLen;
        const clampedChar = Math.min(char, (lines[line] ?? '').length);
        return { line, char: clampedChar };
      }
    } else {
      // Position is between two child nodes — take the child at `offset`
      const childNode = children[offset];
      if (childNode) {
        if (childNode.nodeType === Node.TEXT_NODE) {
          const entry = nodePositions.find((e) => e.node === childNode);
          if (entry) return entry.startPos;
        }
        // Find first text entry inside this child
        const entry = nodePositions.find(
          (e) => childNode.nodeType === Node.ELEMENT_NODE
            ? (childNode as Element).contains(e.node)
            : e.node === childNode,
        );
        if (entry) return entry.startPos;
      }
    }
  }

  return null;
}
