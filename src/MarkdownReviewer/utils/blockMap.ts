/**
 * utils/blockMap.ts — shared block-to-markdown-line mapping (UR:bug fix Phase-D)
 *
 * This module owns the SINGLE canonical block selector used across both
 * selection capture (selection.ts) and overlay computation (CommentLayer.tsx).
 *
 * Before this fix, selection.ts used `'p, h1, h2, h3, h4, h5, h6, li, pre, blockquote, div'`
 * while CommentLayer.tsx used `'p, h1, h2, h3, h4, h5, h6, li, pre, blockquote'`.
 * The `div` divergence caused Crepe's transparent wrapper divs to be counted as leaf
 * blocks in selection.ts, exhausting the lineIdx counter before real content blocks,
 * so text nodes inside paragraphs mapped to (line:0, char:0). When start === end,
 * captureSelection returned null → no popover.
 *
 * Fix: drop `div` from the selector. The leaf-filter already excludes divs that
 * contain other blocks; the divergence happened because `selection.ts` included
 * "leaf" divs (Crepe wrapper divs with no block-element children) and counted them
 * as content lines.
 */

// ─── Canonical block selector ─────────────────────────────────────────────────

/**
 * BLOCK_SELECTOR — the single canonical CSS selector for leaf content blocks.
 *
 * Intentionally excludes `div`: Crepe renders content inside transparent div
 * wrappers. Those divs are not markdown content blocks — their children (p, h*, li,
 * pre, blockquote) are. Including `div` here would cause wrapper divs to be treated
 * as content lines, advancing the lineIdx counter and misaligning all downstream
 * block-to-line mappings.
 */
export const BLOCK_SELECTOR =
  'p, h1, h2, h3, h4, h5, h6, li, pre, blockquote';

// ─── Leaf block extraction ────────────────────────────────────────────────────

/**
 * getLeafBlocks — returns all leaf block elements inside `root` in DOM order.
 *
 * "Leaf block" = an element matching BLOCK_SELECTOR that does NOT contain
 * another element that also matches BLOCK_SELECTOR. This correctly handles
 * nested structures (e.g., blockquote > p) by preferring the innermost block.
 *
 * Crepe wrapper divs are transparent because `div` is not in BLOCK_SELECTOR;
 * the `<p>` children they wrap are the leaf blocks returned here.
 */
export function getLeafBlocks(root: HTMLElement): HTMLElement[] {
  const blocks = Array.from(
    root.querySelectorAll(BLOCK_SELECTOR),
  ) as HTMLElement[];

  return blocks.filter((block) => {
    // Keep this block only if no other block in the set contains it.
    return !blocks.some((other) => other !== block && block.contains(other));
  });
}

// ─── Block-line range ─────────────────────────────────────────────────────────

/**
 * BlockLineRange — maps a single leaf DOM block to an inclusive range of
 * markdown source lines it spans.
 */
export interface BlockLineRange {
  block: HTMLElement;
  startLine: number;
  endLine: number;
}

/**
 * buildBlockLineMap — assigns each leaf DOM block an inclusive [startLine, endLine]
 * range within the markdown source.
 *
 * Algorithm: walk markdown source lines and leaf blocks in parallel.
 *   - Skip blank lines (they are separators between blocks in the source).
 *   - Each non-blank line is attributed to the current leaf block.
 *   - Advance to the next leaf block when a blank line follows a content run.
 *   - `pre` blocks span multiple source lines (code fences); accumulate until
 *     the closing fence.
 *   - All other leaf block types (p, h*, li, blockquote) map to exactly one
 *     non-blank line each.
 *
 * @param markdownSource  Raw markdown string.
 * @param leafBlocks      Ordered array of leaf DOM elements (from getLeafBlocks).
 * @returns               Ordered array of BlockLineRange entries.
 */
export function buildBlockLineMap(
  markdownSource: string,
  leafBlocks: HTMLElement[],
): BlockLineRange[] {
  if (leafBlocks.length === 0) return [];

  const lines = markdownSource.split('\n');
  const result: BlockLineRange[] = [];

  let blockIdx = 0;
  let lineIdx = 0;

  while (blockIdx < leafBlocks.length && lineIdx < lines.length) {
    // Skip blank lines (separators between blocks)
    while (lineIdx < lines.length && lines[lineIdx]!.trim() === '') {
      lineIdx++;
    }
    if (lineIdx >= lines.length) break;

    const block = leafBlocks[blockIdx]!;
    const isPreBlock = block.tagName.toLowerCase() === 'pre';

    if (isPreBlock) {
      // Code fence: consume all lines until the closing fence line.
      const startLine = lineIdx;
      lineIdx++; // skip opening fence
      while (lineIdx < lines.length) {
        const trimmed = lines[lineIdx]!.trim();
        lineIdx++;
        if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
          break; // closing fence consumed
        }
      }
      result.push({ block, startLine, endLine: lineIdx - 1 });
    } else {
      // Simple block (p, h*, li, blockquote): exactly one non-blank content line.
      result.push({ block, startLine: lineIdx, endLine: lineIdx });
      lineIdx++;
    }

    blockIdx++;
  }

  // Any remaining leaf blocks (e.g., if markdown source is shorter than DOM):
  // assign them to the last line so they at least render somewhere reasonable.
  const lastLine = Math.max(0, lines.length - 1);
  while (blockIdx < leafBlocks.length) {
    result.push({
      block: leafBlocks[blockIdx]!,
      startLine: lastLine,
      endLine: lastLine,
    });
    blockIdx++;
  }

  return result;
}

/**
 * findBlockForLine — given a line index and a block-line map, returns the block
 * whose [startLine, endLine] range covers the given line.
 *
 * Falls back to nearest block by minimum distance from the range midpoint when
 * no exact cover exists (handles stale/malformed comment line references).
 */
export function findBlockForLine(
  targetLine: number,
  blockMap: BlockLineRange[],
): HTMLElement | null {
  if (blockMap.length === 0) return null;

  for (const entry of blockMap) {
    if (targetLine >= entry.startLine && targetLine <= entry.endLine) {
      return entry.block;
    }
  }

  // Nearest by distance from midpoint
  let bestBlock = blockMap[0]!.block;
  let bestDist = Infinity;
  for (const entry of blockMap) {
    const mid = (entry.startLine + entry.endLine) / 2;
    const dist = Math.abs(mid - targetLine);
    if (dist < bestDist) {
      bestDist = dist;
      bestBlock = entry.block;
    }
  }
  return bestBlock;
}

/**
 * findLineForBlock — given a DOM element (or text node's containing block), find
 * the markdown source line it maps to by looking it up in a BlockLineRange map.
 *
 * Returns the startLine for the block, or null if the element is not found in
 * the map.
 */
export function findLineForBlock(
  element: HTMLElement,
  blockMap: BlockLineRange[],
): number | null {
  for (const entry of blockMap) {
    if (entry.block === element || entry.block.contains(element)) {
      return entry.startLine;
    }
  }
  return null;
}

// ─── lineCharToRange ──────────────────────────────────────────────────────────

/**
 * lineCharToRange — converts markdown-source coordinates (line, char in
 * `markdownSource.split('\n')`) to a live DOM Range inside `editorRoot`.
 *
 * Algorithm:
 *   1. Build a block-line map for all leaf blocks in editorRoot.
 *   2. Find the start block (covers startLine) and end block (covers endLine).
 *   3. Within each block, walk text nodes via TreeWalker, accumulating char
 *      counts until the target offset is reached.
 *   4. Set range.setStart / range.setEnd on the found text nodes.
 *
 * Returns null when:
 *   - editorRoot has no leaf blocks
 *   - startLine / endLine are out of bounds for the markdown source
 *   - The block cannot be resolved for a line
 *
 * Char offsets are clamped to the end of the block's text content to avoid
 * exceptions from `range.setStart/End(node, offset)` when stale comments
 * reference chars beyond the current text length.
 */
export function lineCharToRange(
  markdownSource: string,
  editorRoot: HTMLElement,
  startLine: number,
  startChar: number,
  endLine: number,
  endChar: number,
): Range | null {
  const lines = markdownSource.split('\n');
  if (startLine < 0 || startLine >= lines.length) return null;
  if (endLine < 0 || endLine >= lines.length) return null;

  const leafBlocks = getLeafBlocks(editorRoot);
  if (leafBlocks.length === 0) return null;

  const blockMap = buildBlockLineMap(markdownSource, leafBlocks);
  if (blockMap.length === 0) return null;

  const startBlock = findBlockForLine(startLine, blockMap);
  const endBlock = findBlockForLine(endLine, blockMap);
  if (!startBlock || !endBlock) return null;

  // Helper: find text node + offset within a block for a given char offset.
  // Returns null if the block has no text nodes.
  function resolveTextOffset(
    block: HTMLElement,
    charOffset: number,
  ): { node: Text; offset: number } | null {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
    let accumulated = 0;
    let lastNode: Text | null = null;
    let current: Text | null;

    while ((current = walker.nextNode() as Text | null) !== null) {
      lastNode = current;
      const len = current.length;
      if (accumulated + len >= charOffset) {
        // Clamp offset to text node length to avoid DOMException
        const offset = Math.min(charOffset - accumulated, len);
        return { node: current, offset };
      }
      accumulated += len;
    }

    // charOffset exceeds total text length — clamp to end of last text node
    if (lastNode !== null) {
      return { node: lastNode, offset: lastNode.length };
    }

    // No text nodes found; try to find any text node as fallback
    const fallbackWalker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
    const firstNode = fallbackWalker.nextNode() as Text | null;
    if (firstNode) return { node: firstNode, offset: 0 };

    return null;
  }

  const startPos = resolveTextOffset(startBlock, startChar);
  const endPos = resolveTextOffset(endBlock, endChar);

  if (!startPos || !endPos) return null;

  try {
    const range = document.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);
    return range;
  } catch {
    // Invalid range (e.g., end before start after stale coords) — return null
    return null;
  }
}
