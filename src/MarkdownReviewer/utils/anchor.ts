/**
 * utils/anchor.ts — anchor reconciliation (STORY-002-03)
 *
 * Architecture rules (EPIC-002 §0):
 *   - Pure function — no DOM, no React, no storage import.
 *   - Uses the single shared `canon()` from utils/selection.ts.
 *     NEVER redefine a local canonicalizer here — asymmetric canonicalization
 *     between selection-time (002-01) and reconcile-time (this file) silently
 *     detaches every comment on every edit.
 *
 * Canonicalizer contract (from selection.ts):
 *   - Collapses whitespace runs to a single space, trims.
 *   - Normalizes leading `* ` / `*\t` list markers to `- `.
 *   - Idempotent: canon(canon(x)) === canon(x).
 */

import { canon } from './selection';
import type { Comment } from '../types';

export type { Comment };

/**
 * reconcile — checks whether a comment's anchor still matches the markdown source.
 *
 * @param markdownSource  Current raw markdown string.
 * @param comment         Subset of Comment with `range` and `selectedText`.
 * @returns               `{ matched, currentText }` where:
 *   - `currentText` = canon(text at comment.range in current markdownSource).
 *   - `matched`     = currentText === canon(comment.selectedText).
 */
export function reconcile(
  markdownSource: string,
  comment: Pick<Comment, 'range' | 'selectedText'>,
): { matched: boolean; currentText: string } {
  const { range, selectedText } = comment;
  const { startLine, endLine, startChar, endChar } = range;

  const lines = markdownSource.split('\n');

  // Extract the raw text at the comment's range in the current source
  let rawCurrentText: string;

  if (startLine === endLine) {
    rawCurrentText = (lines[startLine] ?? '').slice(startChar, endChar);
  } else {
    const firstPart = (lines[startLine] ?? '').slice(startChar);
    const middleParts = lines.slice(startLine + 1, endLine);
    const lastPart = (lines[endLine] ?? '').slice(0, endChar);
    rawCurrentText = [firstPart, ...middleParts, lastPart].join('\n');
  }

  const currentText = canon(rawCurrentText);
  const canonSelectedText = canon(selectedText);

  return {
    matched: currentText === canonSelectedText,
    currentText,
  };
}
