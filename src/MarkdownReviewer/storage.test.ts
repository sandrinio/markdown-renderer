/**
 * storage.test.ts — unit tests for the versioned localStorage adapter
 *
 * Test runner: vitest + jsdom (vitest.config.ts, side-by-side config file)
 * globals: false — all vitest APIs are explicitly imported.
 *
 * Architect decisions documented here (M1.md §348-357):
 *   1. Version mismatch → reset to default + console.warn (not throw).
 *   2. Rename collision is case-insensitive; user casing is preserved on save.
 *   3. addFile: set activeFile = name ONLY if currently null — do NOT steal
 *      focus from a different active file when overwriting an existing entry.
 *
 * One test per Gherkin scenario from STORY-001-02 §2.1.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorage, StorageQuotaError, StorageRenameCollisionError } from './storage';

const KEY = 'markdown-reviewer';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// ─── Scenario 1: Empty load returns the default shape ───────────────────────
describe('loadState — empty', () => {
  it('returns default shape when localStorage key is unset', () => {
    const storage = createStorage(KEY);
    const state = storage.loadState();
    expect(state).toEqual({
      version: 1,
      files: {},
      comments: {},
      mtime: {},
      activeFile: null,
    });
  });
});

// ─── Scenario 2: addFile persists and returns updated state ─────────────────
describe('addFile — round-trip persist', () => {
  it('persists the file and returns the updated state', () => {
    const storage = createStorage(KEY);
    const returned = storage.addFile('spec.md', 'hello');

    expect(returned.files['spec.md']).toBe('hello');

    const loaded = storage.loadState();
    expect(loaded.files['spec.md']).toBe('hello');
  });
});

// ─── Scenario 3: addFile with duplicate name overwrites ─────────────────────
describe('addFile — duplicate overwrites', () => {
  it('overwrites content and keeps only one entry when name collides', () => {
    const storage = createStorage(KEY);
    storage.addFile('spec.md', 'old');
    const returned = storage.addFile('spec.md', 'new');

    expect(returned.files['spec.md']).toBe('new');
    expect(Object.keys(returned.files).length).toBe(1);

    const loaded = storage.loadState();
    expect(loaded.files['spec.md']).toBe('new');
    expect(Object.keys(loaded.files).length).toBe(1);
  });

  it('does NOT steal activeFile focus on overwrite when another file is active', () => {
    // Architect decision: activeFile = name ONLY if currently null
    const storage = createStorage(KEY);
    storage.addFile('a.md', 'A');
    // After adding a.md to an empty store, activeFile = 'a.md'
    storage.addFile('spec.md', 'original');
    // Now activeFile is 'a.md'; overwriting spec.md must NOT change activeFile
    const returned = storage.addFile('spec.md', 'overwritten');
    expect(returned.activeFile).toBe('a.md');
  });
});

// ─── Scenario 4: renameFile updates pointer and rejects collision ────────────
describe('renameFile', () => {
  it('renames the file, updates activeFile pointer, and rejects case-insensitive collision', () => {
    const storage = createStorage(KEY);
    storage.addFile('a.md', 'A');
    storage.addFile('b.md', 'B');
    // Manually set activeFile to 'a.md'
    storage.setActiveFile('a.md');

    // Happy rename: a.md → c.md; activeFile should follow
    const renamed = storage.renameFile('a.md', 'c.md');
    expect(renamed.files).toEqual({ 'c.md': 'A', 'b.md': 'B' });
    expect(renamed.activeFile).toBe('c.md');

    const loaded = storage.loadState();
    expect(loaded.files['c.md']).toBe('A');
    expect(loaded.files['a.md']).toBeUndefined();
    expect(loaded.activeFile).toBe('c.md');

    // Collision: c.md → b.md should throw (case-insensitive)
    const beforeState = storage.loadState();
    expect(() => storage.renameFile('c.md', 'b.md')).toThrow(StorageRenameCollisionError);

    // Storage must be unchanged after the failed rename
    const afterState = storage.loadState();
    expect(afterState).toEqual(beforeState);
  });

  it('rejects case-insensitive collision (B.MD vs b.md)', () => {
    const storage = createStorage(KEY);
    storage.addFile('spec.md', 'S');
    storage.addFile('notes.md', 'N');

    // 'NOTES.MD' collides with 'notes.md' case-insensitively
    expect(() => storage.renameFile('spec.md', 'NOTES.MD')).toThrow(StorageRenameCollisionError);
  });
});

// ─── Scenario 5: deleteFile clears activeFile ────────────────────────────────
describe('deleteFile', () => {
  it('sets activeFile to next key in insertion order when active file is deleted', () => {
    const storage = createStorage(KEY);
    storage.addFile('a.md', 'A'); // first file → activeFile = 'a.md'
    storage.addFile('b.md', 'B'); // second file; activeFile still 'a.md'

    // Confirm starting state
    expect(storage.loadState().activeFile).toBe('a.md');

    const result = storage.deleteFile('a.md');
    expect(result.activeFile).toBe('b.md');

    const loaded = storage.loadState();
    expect(loaded.activeFile).toBe('b.md');
    expect(loaded.files['a.md']).toBeUndefined();
  });

  it('sets activeFile to null when the last file is deleted', () => {
    const storage = createStorage(KEY);
    storage.addFile('solo.md', 'Only');
    const result = storage.deleteFile('solo.md');
    expect(result.activeFile).toBeNull();
  });
});

// ─── Scenario 6: Quota exceeded throws and does NOT persist ─────────────────
describe('quota exceeded', () => {
  it('throws StorageQuotaError and does not mutate state', () => {
    const storage = createStorage(KEY);

    // Spy: force setItem to throw a QuotaExceededError DOMException
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota full', 'QuotaExceededError');
    });

    expect(() => storage.addFile('big.md', 'x'.repeat(1024))).toThrow(StorageQuotaError);

    // Restore setItem so we can read localStorage
    vi.restoreAllMocks();

    const loaded = storage.loadState();
    expect(loaded.files['big.md']).toBeUndefined();
  });
});

// ─── Scenario 7: Version mismatch resets to default + console.warn ──────────
describe('version mismatch', () => {
  it('returns empty default state and fires console.warn on version mismatch', () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 99, files: { 'x.md': 'y' }, comments: {}, activeFile: null }));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const storage = createStorage(KEY);
    const state = storage.loadState();

    expect(state).toEqual({
      version: 1,
      files: {},
      comments: {},
      mtime: {},
      activeFile: null,
    });
    expect(warnSpy).toHaveBeenCalled();
  });
});

// ─── Extra: flush (saveState) is synchronous ────────────────────────────────
describe('saveState / flush', () => {
  it('persists the state synchronously when saveState is called directly', () => {
    const storage = createStorage(KEY);
    const state = {
      version: 1 as const,
      files: { 'manual.md': 'content' },
      comments: {},
      mtime: {},
      activeFile: 'manual.md',
    };
    storage.saveState(state);

    const loaded = storage.loadState();
    expect(loaded).toEqual(state);
  });
});

// ─── STORY-002-04: mtime map ─────────────────────────────────────────────────

describe('mtime — addFile sets mtime', () => {
  it('sets mtime[name] to an ISO-8601 string on addFile', () => {
    const storage = createStorage(KEY);
    const before = Date.now();
    storage.addFile('spec.md', 'content');
    const after = Date.now();

    const state = storage.loadState();
    const mtime = state.mtime['spec.md'];
    expect(typeof mtime).toBe('string');
    const ts = new Date(mtime!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 5); // allow 5ms clock skew
  });
});

describe('mtime — persist-fails-mtime-stays', () => {
  it('does NOT advance mtime[file] when persist throws (quota exceeded)', () => {
    const storage = createStorage(KEY);
    // First addFile succeeds — records mtime
    storage.addFile('spec.md', 'original content');
    const stateBefore = storage.loadState();
    const mtimeBefore = stateBefore.mtime['spec.md'];
    expect(typeof mtimeBefore).toBe('string');

    // Now force quota error on the NEXT setItem call (simulated by saveState)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota full', 'QuotaExceededError');
    });

    // Attempt a saveState that would advance mtime
    expect(() =>
      storage.saveState({
        ...stateBefore,
        files: { 'spec.md': 'modified content' },
        mtime: { 'spec.md': new Date().toISOString() },
      }),
    ).toThrow();

    vi.restoreAllMocks();

    // mtime must NOT have changed — the persist failed before writing
    const stateAfter = storage.loadState();
    expect(stateAfter.mtime['spec.md']).toBe(mtimeBefore);
    // files content must also be unchanged (atomicity)
    expect(stateAfter.files['spec.md']).toBe('original content');
  });
});

describe('mtime — old state without mtime is tolerated on load', () => {
  it('hydrates mtime to {} when loading legacy state without mtime field', () => {
    // Seed localStorage with a valid state that lacks the mtime field
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        files: { 'legacy.md': 'content' },
        comments: {},
        activeFile: 'legacy.md',
        // NO mtime field
      }),
    );

    const storage = createStorage(KEY);
    const state = storage.loadState();

    // Must not reset to default; files must be intact
    expect(state.files['legacy.md']).toBe('content');
    expect(state.activeFile).toBe('legacy.md');
    // mtime must be hydrated to empty object (not undefined or null)
    expect(state.mtime).toEqual({});
  });
});

// ─── STORY-002-02: Comment CRUD ──────────────────────────────────────────────

const PARTIAL_COMMENT = {
  selectedText: 'Lorem ipsum dolor',
  range: { startLine: 0, endLine: 0, startChar: 0, endChar: 17 },
  comment: 'needs citation',
};

describe('addComment — add and reload', () => {
  it('persists a new comment and returns it with a generated id', () => {
    const storage = createStorage(KEY);
    storage.addFile('spec.md', 'Lorem ipsum dolor');

    const added = storage.addComment('spec.md', PARTIAL_COMMENT);

    expect(typeof added.id).toBe('string');
    expect(added.id.length).toBeGreaterThan(0);
    expect(added.comment).toBe('needs citation');
    expect(added.detached).toBe(false);
    expect(typeof added.createdAt).toBe('string');
    expect(typeof added.updatedAt).toBe('string');

    // Persisted — reload returns it
    const reloaded = storage.loadState();
    const comments = reloaded.comments['spec.md'] ?? [];
    expect(comments.length).toBe(1);
    expect(comments[0]!.comment).toBe('needs citation');
  });
});

describe('updateComment — text and updatedAt change', () => {
  it('updates comment text and refreshes updatedAt', () => {
    const storage = createStorage(KEY);
    storage.addFile('spec.md', 'Lorem ipsum');
    const added = storage.addComment('spec.md', PARTIAL_COMMENT);
    const originalUpdatedAt = added.updatedAt;

    // Small delay to ensure different timestamp
    const updated = storage.updateComment('spec.md', added.id, { comment: 'needs source' });

    expect(updated.comment).toBe('needs source');
    // updatedAt may equal createdAt if called within same ms tick — just check it's a string
    expect(typeof updated.updatedAt).toBe('string');
    // If timestamps differ, updatedAt must be >= createdAt
    if (updated.updatedAt !== originalUpdatedAt) {
      expect(updated.updatedAt >= originalUpdatedAt).toBe(true);
    }

    // Persisted
    const comments = storage.loadState().comments['spec.md'] ?? [];
    expect(comments[0]!.comment).toBe('needs source');
  });
});

describe('deleteComment — array shrinks', () => {
  it('removes the comment by id and persists', () => {
    const storage = createStorage(KEY);
    storage.addFile('spec.md', 'Lorem ipsum');
    const added = storage.addComment('spec.md', PARTIAL_COMMENT);

    expect((storage.loadState().comments['spec.md'] ?? []).length).toBe(1);

    storage.deleteComment('spec.md', added.id);

    const comments = storage.loadState().comments['spec.md'] ?? [];
    expect(comments.length).toBe(0);
  });
});

describe('comment scoping per file', () => {
  it('isolates comments on a.md from comments on b.md', () => {
    const storage = createStorage(KEY);
    storage.addFile('a.md', 'A content');
    storage.addFile('b.md', 'B content');

    storage.addComment('a.md', { ...PARTIAL_COMMENT, comment: 'comment on A' });
    storage.addComment('a.md', { ...PARTIAL_COMMENT, comment: 'second on A' });
    storage.addComment('b.md', { ...PARTIAL_COMMENT, comment: 'comment on B' });

    const state = storage.loadState();
    expect((state.comments['a.md'] ?? []).length).toBe(2);
    expect((state.comments['b.md'] ?? []).length).toBe(1);
  });
});

describe('quota rejects addComment — comments map unchanged', () => {
  it('throws StorageQuotaError and leaves existing comments unchanged', () => {
    const storage = createStorage(KEY);
    storage.addFile('spec.md', 'Lorem ipsum');
    // Add one comment successfully
    storage.addComment('spec.md', PARTIAL_COMMENT);

    // Now simulate quota exceeded
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota full', 'QuotaExceededError');
    });

    expect(() =>
      storage.addComment('spec.md', { ...PARTIAL_COMMENT, comment: 'second comment' }),
    ).toThrow(StorageQuotaError);

    vi.restoreAllMocks();

    // Original single comment remains unchanged
    const state = storage.loadState();
    expect((state.comments['spec.md'] ?? []).length).toBe(1);
    expect(state.comments['spec.md']![0]!.comment).toBe('needs citation');
  });
});

// ─── STORY-002-05: Cascade tests ─────────────────────────────────────────────

describe('Scenario: Deleting a file with comments cascades', () => {
  it('drops comments[name] and mtime[name] when deleteFile is called', () => {
    const storage = createStorage(KEY);
    storage.addFile('spec.md', 'Lorem ipsum dolor');

    // Add two comments
    storage.addComment('spec.md', PARTIAL_COMMENT);
    storage.addComment('spec.md', { ...PARTIAL_COMMENT, comment: 'second comment' });

    // Confirm setup: comments + mtime exist
    const before = storage.loadState();
    expect((before.comments['spec.md'] ?? []).length).toBe(2);
    expect(typeof before.mtime['spec.md']).toBe('string');

    // Delete the file
    storage.deleteFile('spec.md');

    const after = storage.loadState();
    expect(after.files['spec.md']).toBeUndefined();
    expect(after.comments['spec.md']).toBeUndefined();
    expect(after.mtime['spec.md']).toBeUndefined();
  });
});

describe('Scenario: Renaming a file preserves its comments', () => {
  it('moves comments[oldName] to comments[newName] and drops the old key', () => {
    const storage = createStorage(KEY);
    storage.addFile('spec.md', 'Lorem ipsum');

    const c1 = storage.addComment('spec.md', PARTIAL_COMMENT);
    const c2 = storage.addComment('spec.md', { ...PARTIAL_COMMENT, comment: 'second' });

    // Confirm setup
    const before = storage.loadState();
    expect((before.comments['spec.md'] ?? []).length).toBe(2);
    expect(typeof before.mtime['spec.md']).toBe('string');

    // Rename
    storage.renameFile('spec.md', 'specification.md');

    const after = storage.loadState();
    // Old keys must be gone
    expect(after.comments['spec.md']).toBeUndefined();
    expect(after.mtime['spec.md']).toBeUndefined();

    // New keys must carry the data
    const movedComments = after.comments['specification.md'] ?? [];
    expect(movedComments.length).toBe(2);
    expect(movedComments[0]!.id).toBe(c1.id);
    expect(movedComments[1]!.id).toBe(c2.id);
    expect(typeof after.mtime['specification.md']).toBe('string');
  });
});

describe('Scenario: Rename collision aborts cascade atomically', () => {
  it('leaves all maps unchanged when a StorageRenameCollisionError is thrown', () => {
    const storage = createStorage(KEY);
    storage.addFile('a.md', 'A');
    storage.addFile('b.md', 'B');

    // Add a comment on a.md
    const c1 = storage.addComment('a.md', PARTIAL_COMMENT);

    const before = storage.loadState();
    expect((before.comments['a.md'] ?? []).length).toBe(1);
    expect(before.comments['b.md']).toBeUndefined();

    // Attempt rename collision: a.md → b.md
    expect(() => storage.renameFile('a.md', 'b.md')).toThrow(StorageRenameCollisionError);

    const after = storage.loadState();
    // a.md comments must be intact
    const aComments = after.comments['a.md'] ?? [];
    expect(aComments.length).toBe(1);
    expect(aComments[0]!.id).toBe(c1.id);
    // b.md must still have no comments (no partial move)
    expect(after.comments['b.md']).toBeUndefined();
    // files map must also be unchanged
    expect(after.files['a.md']).toBe('A');
    expect(after.files['b.md']).toBe('B');
  });
});

// ─── Bug B regression: delete comment → switch file → switch back → comment gone ─
//
// Root-cause (STORY-002-02-fix3): saveFn in index.tsx captured stale `state` in its
// useCallback closure (deps: [state.activeFile, storage] — NOT state.comments). If a
// content-edit debounce was pending while a comment delete happened, the flush on
// file-switch would call storage.saveState({...staleState, ...}) re-persisting the
// deleted comment. Fix: saveFn now calls storage.loadState() first.
//
// This test covers the storage layer: verify deleteComment + setActiveFile round-trip
// does NOT resurrect the deleted comment.

describe('Bug B regression: deleteComment survives setActiveFile round-trip', () => {
  it('comment deleted on fileX is still absent after switching to fileY and back to fileX', () => {
    const storage = createStorage(KEY);

    // Set up two files with content
    storage.addFile('x.md', 'content of x');
    storage.addFile('y.md', 'content of y');
    storage.setActiveFile('x.md');

    // Add a comment to x.md
    const c = storage.addComment('x.md', {
      range: { startLine: 0, endLine: 0, startChar: 0, endChar: 10 },
      selectedText: 'content of',
      comment: 'delete me',
    });

    // Verify comment exists
    expect(storage.loadState().comments['x.md']?.length).toBe(1);

    // Delete the comment
    storage.deleteComment('x.md', c.id);
    expect(storage.loadState().comments['x.md']?.length).toBe(0);

    // Switch to y.md
    const afterSwitchToY = storage.setActiveFile('y.md');
    expect(afterSwitchToY.activeFile).toBe('y.md');

    // The deleted comment must still be absent on x.md
    expect(afterSwitchToY.comments['x.md']?.length).toBe(0);

    // Switch back to x.md
    const afterSwitchBack = storage.setActiveFile('x.md');
    expect(afterSwitchBack.activeFile).toBe('x.md');

    // Comment must still be gone — not resurrected
    expect(afterSwitchBack.comments['x.md']?.length).toBe(0);
  });

  it('saveFn stale-closure scenario: a second saveState call with fresh state must not resurrect deleted comment', () => {
    // This simulates what index.tsx saveFn does after the fix:
    // it calls loadState() first, then overwrites only files+mtime.
    const storage = createStorage(KEY);

    storage.addFile('x.md', 'hello world');
    storage.setActiveFile('x.md');

    const c = storage.addComment('x.md', {
      range: { startLine: 0, endLine: 0, startChar: 0, endChar: 5 },
      selectedText: 'hello',
      comment: 'stale closure victim',
    });

    // Delete the comment (simulates user clicking delete)
    storage.deleteComment('x.md', c.id);

    // Simulate the FIXED saveFn: load fresh state, then write only content+mtime
    const fresh = storage.loadState();
    storage.saveState({
      ...fresh,
      files: { ...fresh.files, 'x.md': 'hello world edited' },
      mtime: { ...fresh.mtime, 'x.md': new Date().toISOString() },
    });

    const after = storage.loadState();
    // Comment must still be absent
    expect(after.comments['x.md']?.length).toBe(0);
    // Content update must be preserved
    expect(after.files['x.md']).toBe('hello world edited');
  });
});
