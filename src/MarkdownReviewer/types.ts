/**
 * types.ts — shared types for MarkdownReviewer (STORY-001-02, extended STORY-002-04)
 *
 * STORY-002-04 adds:
 *   - `mtime` field on StorageState (ISO-8601 per filename, set on addFile and persist)
 *   - `ReviewPayload` export
 *   - `onSubmit?` on MarkdownReviewerProps
 *
 * `StorageState.mtime` is additive: old state without `mtime` is tolerated on load
 * (storage.ts loadState hydrates it to `{}` rather than resetting to default).
 */

export interface FileEntry {
  name: string;
  content: string;
}

export interface Range {
  startLine: number;
  endLine: number;
  startChar: number;
  endChar: number;
}

/**
 * Comment — PLACEHOLDER only. Declared here so EPIC-002 does not need to
 * change the types module. NOT used in EPIC-001 runtime.
 */
export interface Comment {
  id: string;
  selectedText: string;
  range: Range;
  comment: string;
  createdAt: string;
  updatedAt: string;
  detached: boolean;
}

export interface StorageState {
  version: 1;
  files: Record<string, string>; // filename → markdown content
  comments: Record<string, Comment[]>; // EMPTY in EPIC-001; populated by EPIC-002
  mtime: Record<string, string>; // ISO-8601 timestamp per filename (STORY-002-04)
  activeFile: string | null;
}

/**
 * ReviewPayload — the typed bundle handed to onSubmit (STORY-002-04).
 * `file.lastModified` is the mtime from storage (set on addFile + each persisted edit).
 * `submittedAt` is a fresh ISO-8601 stamp at click time.
 * `comments` is the verbatim array including detached:true entries.
 */
export interface ReviewPayload {
  file: { name: string; content: string; lastModified: string };
  comments: Comment[];
  submittedAt: string; // ISO-8601, fresh at click time
}

export interface MarkdownReviewerProps {
  initialFiles?: FileEntry[];
  storageKey?: string;
  theme?: 'light' | 'dark';
  className?: string;
  onSubmit?: (payload: ReviewPayload) => Promise<void> | void; // STORY-002-04
}

export const DEFAULT_STORAGE_KEY = 'markdown-reviewer';
