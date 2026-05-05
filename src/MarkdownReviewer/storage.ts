/**
 * storage.ts — versioned localStorage adapter (STORY-001-02)
 *
 * CONTRACT (non-negotiable):
 *   Build-next-state → persist → return.
 *   Quota errors throw StorageQuotaError; in-memory state is NEVER mutated.
 *
 * Architect decisions (M1.md §348-357):
 *   - Version mismatch on load() → reset to default + console.warn (NOT throw).
 *   - Rename collision is case-insensitive; preserve user casing on save.
 *   - addFile(name, content): overwrite if exists; set activeFile = name ONLY
 *     if currently null (do NOT steal focus from another active file).
 */

import type { StorageState, Comment } from './types';

// ─── Error types ────────────────────────────────────────────────────────────

export class StorageQuotaError extends Error {
  constructor(msg?: string) {
    super(msg ?? 'localStorage quota exceeded');
    this.name = 'StorageQuotaError';
  }
}

export class StorageRenameCollisionError extends Error {
  constructor(msg?: string) {
    super(msg ?? 'A file with that name already exists');
    this.name = 'StorageRenameCollisionError';
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

const SCHEMA_VERSION = 1 as const;

function defaultState(): StorageState {
  return {
    version: SCHEMA_VERSION,
    files: {},
    comments: {} as Record<string, Comment[]>,
    mtime: {},
    activeFile: null,
  };
}

function isValidState(parsed: unknown): parsed is StorageState {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const p = parsed as Record<string, unknown>;
  // Tolerate missing `mtime` (STORY-002-04 additive field): hydrate to {} rather than
  // treating as invalid. This prevents force-reset of existing user data on first upgrade.
  if (!('mtime' in p) || typeof p['mtime'] !== 'object' || p['mtime'] === null) {
    (p as Record<string, unknown>)['mtime'] = {};
  }
  return (
    p['version'] === SCHEMA_VERSION &&
    typeof p['files'] === 'object' &&
    p['files'] !== null &&
    typeof p['comments'] === 'object' &&
    p['comments'] !== null &&
    (p['activeFile'] === null || typeof p['activeFile'] === 'string')
  );
}

function isQuotaError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return err.name === 'QuotaExceededError' || err.code === 22;
  }
  // Some environments throw a plain Error with a matching name
  if (err instanceof Error) {
    return err.name === 'QuotaExceededError';
  }
  return false;
}

// ─── Public interface ────────────────────────────────────────────────────────

export interface Storage {
  loadState(): StorageState;
  saveState(next: StorageState): void;
  addFile(name: string, content: string): StorageState;
  deleteFile(name: string): StorageState;
  renameFile(oldName: string, newName: string): StorageState;
  setActiveFile(name: string | null): StorageState;
  addComment(file: string, comment: Omit<Comment, 'id' | 'createdAt' | 'updatedAt' | 'detached'>): Comment;
  updateComment(file: string, id: string, patch: { comment?: string }): Comment;
  deleteComment(file: string, id: string): void;
  setCommentDetached(file: string, id: string, detached: boolean): void;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createStorage(storageKey: string): Storage {
  /**
   * persist — JSON-stringifies and writes to localStorage.
   * Throws StorageQuotaError on quota failure; never touches in-memory state.
   */
  function persist(next: StorageState): void {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch (err) {
      if (isQuotaError(err)) {
        throw new StorageQuotaError();
      }
      throw err;
    }
  }

  function loadState(): StorageState {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === null) return defaultState();
      const parsed: unknown = JSON.parse(raw);
      if (!isValidState(parsed)) {
        console.warn(
          `[MarkdownReviewer] localStorage key "${storageKey}" has version mismatch or invalid shape — resetting to default.`,
        );
        return defaultState();
      }
      return parsed;
    } catch {
      console.warn(
        `[MarkdownReviewer] Failed to parse localStorage key "${storageKey}" — resetting to default.`,
      );
      return defaultState();
    }
  }

  function saveState(next: StorageState): void {
    persist(next);
  }

  function addFile(name: string, content: string): StorageState {
    const current = loadState();
    const next: StorageState = {
      ...current,
      files: { ...current.files, [name]: content },
      // Track last-modified timestamp; atomic with content write (mtime does not
      // advance if persist throws — both are in the same next object literal).
      mtime: { ...current.mtime, [name]: new Date().toISOString() },
      // Set activeFile = name ONLY if currently null (do not steal focus on overwrite)
      activeFile: current.activeFile === null ? name : current.activeFile,
    };
    persist(next);
    return next;
  }

  function deleteFile(name: string): StorageState {
    const current = loadState();
    const newFiles = { ...current.files };
    delete newFiles[name];

    // Cascade: also drop the comments and mtime entry for the deleted file.
    // Both are in the same next object literal, so they are atomic with the files deletion.
    const newComments = { ...current.comments };
    delete newComments[name];
    const newMtime = { ...current.mtime };
    delete newMtime[name];

    let newActiveFile = current.activeFile;
    if (current.activeFile === name) {
      const remainingKeys = Object.keys(newFiles);
      newActiveFile = remainingKeys.length > 0 ? remainingKeys[0] : null;
    }

    const next: StorageState = {
      ...current,
      files: newFiles,
      comments: newComments,
      mtime: newMtime,
      activeFile: newActiveFile,
    };
    persist(next);
    return next;
  }

  function renameFile(oldName: string, newName: string): StorageState {
    const current = loadState();

    // Case-insensitive collision check; preserve user casing on save
    const existingKeys = Object.keys(current.files);
    const collision = existingKeys.find(
      (k) => k !== oldName && k.toLowerCase() === newName.toLowerCase(),
    );
    // Throw BEFORE any rebuild so the operation is fully atomic:
    // if this throws, no map (files, comments, mtime) is touched.
    if (collision !== undefined) {
      throw new StorageRenameCollisionError();
    }

    // Rebuild files preserving insertion order: replace oldName key with newName
    const newFiles: Record<string, string> = {};
    for (const key of existingKeys) {
      if (key === oldName) {
        newFiles[newName] = current.files[oldName]!;
      } else {
        newFiles[key] = current.files[key]!;
      }
    }

    // Cascade: move comments[oldName] → comments[newName] and same for mtime.
    // Rebuild both maps preserving insertion order, just like newFiles above.
    const commentKeys = Object.keys(current.comments);
    const newComments: Record<string, Comment[]> = {};
    for (const key of commentKeys) {
      if (key === oldName) {
        newComments[newName] = current.comments[oldName]!;
      } else {
        newComments[key] = current.comments[key]!;
      }
    }
    // If oldName had no entry in comments, no key is added for newName (intentional).

    const mtimeKeys = Object.keys(current.mtime);
    const newMtime: Record<string, string> = {};
    for (const key of mtimeKeys) {
      if (key === oldName) {
        newMtime[newName] = current.mtime[oldName]!;
      } else {
        newMtime[key] = current.mtime[key]!;
      }
    }

    const next: StorageState = {
      ...current,
      files: newFiles,
      comments: newComments,
      mtime: newMtime,
      activeFile: current.activeFile === oldName ? newName : current.activeFile,
    };
    persist(next);
    return next;
  }

  function setActiveFile(name: string | null): StorageState {
    const current = loadState();
    const next: StorageState = { ...current, activeFile: name };
    persist(next);
    return next;
  }

  // ─── Comment CRUD (STORY-002-02) ─────────────────────────────────────────

  function addComment(
    file: string,
    partial: Omit<Comment, 'id' | 'createdAt' | 'updatedAt' | 'detached'>,
  ): Comment {
    const current = loadState();
    const now = new Date().toISOString();
    const newComment: Comment = {
      ...partial,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      detached: false,
    };
    const existingComments = current.comments[file] ?? [];
    const next: StorageState = {
      ...current,
      comments: {
        ...current.comments,
        [file]: [...existingComments, newComment],
      },
    };
    persist(next);
    return newComment;
  }

  function updateComment(
    file: string,
    id: string,
    patch: { comment?: string },
  ): Comment {
    const current = loadState();
    const fileComments = current.comments[file] ?? [];
    const idx = fileComments.findIndex((c) => c.id === id);
    if (idx === -1) {
      throw new Error(`Comment with id "${id}" not found in file "${file}"`);
    }
    const updated: Comment = {
      ...fileComments[idx]!,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    const newComments = [...fileComments];
    newComments[idx] = updated;
    const next: StorageState = {
      ...current,
      comments: { ...current.comments, [file]: newComments },
    };
    persist(next);
    return updated;
  }

  function deleteComment(file: string, id: string): void {
    const current = loadState();
    const fileComments = current.comments[file] ?? [];
    const next: StorageState = {
      ...current,
      comments: {
        ...current.comments,
        [file]: fileComments.filter((c) => c.id !== id),
      },
    };
    persist(next);
  }

  // ─── Anchor drift (STORY-002-03) ─────────────────────────────────────────

  /**
   * setCommentDetached — atomic flag flip.
   * No-op when the comment's `detached` flag already equals `detached`.
   * Only persists when the value would actually change (story §1.5 risk mitigation).
   */
  function setCommentDetached(file: string, id: string, detached: boolean): void {
    const current = loadState();
    const fileComments = current.comments[file] ?? [];
    const idx = fileComments.findIndex((c) => c.id === id);
    if (idx === -1) return; // comment not found — no-op
    const existing = fileComments[idx]!;
    if (existing.detached === detached) return; // no-op: already at target value
    const updated = { ...existing, detached };
    const newComments = [...fileComments];
    newComments[idx] = updated;
    const next: StorageState = {
      ...current,
      comments: { ...current.comments, [file]: newComments },
    };
    persist(next);
  }

  return {
    loadState,
    saveState,
    addFile,
    deleteFile,
    renameFile,
    setActiveFile,
    addComment,
    updateComment,
    deleteComment,
    setCommentDetached,
  };
}
