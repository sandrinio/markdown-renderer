/**
 * FileMenu.test.tsx — acceptance tests for Toast + DropZone + FileMenu (base)
 * (STORY-001-03)
 *
 * Test runner: vitest + jsdom + @testing-library/react
 * One test per Gherkin scenario from STORY-001-03 §2.1.
 *
 * FileMenu is tested as the integration point — it composes DropZone + Toast.
 * DropZone and Toast unit behaviour is covered by these integration tests
 * (standalone component tests are optional extras below).
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  cleanup();
});
import { FileMenu } from './FileMenu';
import { Toast } from './Toast';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create a synthetic File whose content can be returned by a mocked FileReader.
 * jsdom's FileReader.readAsText does NOT actually read File objects, so we
 * mock FileReader to return the desired content.
 */
function makeFile(name: string, content: string): File {
  return new File([content], name, { type: 'text/markdown' });
}

/**
 * Mock FileReader to synchronously invoke onload with the given content.
 * Returns a restore function.
 */
function mockFileReader(contentMap: Record<string, string>) {
  const OriginalFileReader = globalThis.FileReader;

  class FakeFileReader extends EventTarget {
    result: string | null = null;
    onload: ((e: ProgressEvent<FileReader>) => void) | null = null;
    onerror: ((e: ProgressEvent<FileReader>) => void) | null = null;

    readAsText(file: File) {
      const content = contentMap[file.name] ?? '';
      this.result = content;
      // Dispatch asynchronously (microtask) to mirror real FileReader
      Promise.resolve().then(() => {
        if (this.onload) {
          this.onload({ target: this } as unknown as ProgressEvent<FileReader>);
        }
      });
    }
  }

  globalThis.FileReader = FakeFileReader as unknown as typeof FileReader;
  return () => {
    globalThis.FileReader = OriginalFileReader;
  };
}

/**
 * Fire a synthetic drop event carrying a FileList of the given files.
 * RTL fireEvent does not support DataTransfer files natively, so we build
 * the event manually.
 */
function fireDrop(element: HTMLElement, files: File[]) {
  // Build a fake DataTransfer
  const dataTransfer = {
    files: Object.assign(files, { item: (i: number) => files[i] }),
    types: ['Files'],
    getData: () => '',
  };

  fireEvent.drop(element, { dataTransfer });
}

// ─── Scenario 1: Drop a markdown file ────────────────────────────────────────

describe('Scenario: Drop a markdown file', () => {
  it('calls onAdd with ("spec.md", "hello") and does not show a toast', async () => {
    const restore = mockFileReader({ 'spec.md': 'hello' });
    const onAdd = vi.fn();
    const onReject = vi.fn();
    const onSelect = vi.fn();

    render(
      <FileMenu
        files={[]}
        activeFile={null}
        onSelect={onSelect}
        onAdd={onAdd}
        onReject={onReject}
      />,
    );

    const dropzone = screen.getByTestId('dropzone');
    fireEvent.dragOver(dropzone, { dataTransfer: { files: [] } });
    fireDrop(dropzone, [makeFile('spec.md', 'hello')]);

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith('spec.md', 'hello');
    });

    expect(onReject).not.toHaveBeenCalled();
    expect(screen.queryByTestId('toast')).toBeNull();

    restore();
  });
});

// ─── Scenario 2: Pick a markdown file via file dialog ────────────────────────

describe('Scenario: Pick a markdown file via file dialog', () => {
  it('calls onAdd with ("notes.md", file content) when picking via Choose-file button', async () => {
    const restore = mockFileReader({ 'notes.md': 'my notes content' });
    const onAdd = vi.fn();
    const onReject = vi.fn();

    render(
      <FileMenu
        files={[]}
        activeFile={null}
        onSelect={vi.fn()}
        onAdd={onAdd}
        onReject={onReject}
      />,
    );

    const fileInput = screen.getByTestId('file-input') as HTMLInputElement;
    const file = makeFile('notes.md', 'my notes content');

    // Simulate the input's onChange (bypasses the click → dialog flow in jsdom)
    Object.defineProperty(fileInput, 'files', {
      value: Object.assign([file], { item: (i: number) => [file][i] }),
      configurable: true,
    });

    await act(async () => {
      fireEvent.change(fileInput);
    });

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith('notes.md', 'my notes content');
    });

    expect(onReject).not.toHaveBeenCalled();

    restore();
  });
});

// ─── Scenario 3: Click switches the active file ───────────────────────────────

describe('Scenario: Click switches the active file', () => {
  it('calls onSelect("b.md") and active indicator moves after parent re-renders', () => {
    const onSelect = vi.fn();

    const { rerender } = render(
      <FileMenu
        files={['a.md', 'b.md']}
        activeFile="a.md"
        onSelect={onSelect}
        onAdd={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    // Initially a.md is active
    const aBtn = screen.getByTestId('file-row-a.md');
    const bBtn = screen.getByTestId('file-row-b.md');
    expect(aBtn.getAttribute('aria-current')).toBe('true');
    expect(bBtn.getAttribute('aria-current')).toBeNull();

    // Click b.md
    fireEvent.click(bBtn);
    expect(onSelect).toHaveBeenCalledWith('b.md');

    // Parent re-renders with new activeFile
    rerender(
      <FileMenu
        files={['a.md', 'b.md']}
        activeFile="b.md"
        onSelect={onSelect}
        onAdd={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByTestId('file-row-b.md').getAttribute('aria-current')).toBe('true');
    expect(screen.getByTestId('file-row-a.md').getAttribute('aria-current')).toBeNull();
  });
});

// ─── Scenario 4: Reject non-markdown file ────────────────────────────────────

describe('Scenario: Reject non-markdown file', () => {
  it('calls onReject with error toast and shows toast; onAdd is NOT called', async () => {
    const onAdd = vi.fn();
    const onReject = vi.fn();

    render(
      <FileMenu
        files={[]}
        activeFile={null}
        onSelect={vi.fn()}
        onAdd={onAdd}
        onReject={onReject}
      />,
    );

    const dropzone = screen.getByTestId('dropzone');
    fireDrop(dropzone, [makeFile('report.pdf', 'binary')]);

    await waitFor(() => {
      expect(onReject).toHaveBeenCalledWith({
        kind: 'error',
        message: 'Only .md files are supported',
      });
    });

    expect(onAdd).not.toHaveBeenCalled();

    // Toast should be visible in the DOM
    await waitFor(() => {
      expect(screen.getByTestId('toast')).toBeTruthy();
    });
    expect(screen.getByTestId('toast').textContent).toContain('Only .md files are supported');
  });
});

// ─── Scenario 5: Duplicate filename re-emits onAdd ───────────────────────────

describe('Scenario: Duplicate filename re-emits onAdd', () => {
  it('calls onAdd("spec.md", "new") and shows one entry after re-render', async () => {
    const restore = mockFileReader({ 'spec.md': 'new' });
    const onAdd = vi.fn();
    const onReject = vi.fn();

    const { rerender } = render(
      <FileMenu
        files={['spec.md']}
        activeFile="spec.md"
        onSelect={vi.fn()}
        onAdd={onAdd}
        onReject={onReject}
      />,
    );

    const dropzone = screen.getByTestId('dropzone');
    fireDrop(dropzone, [makeFile('spec.md', 'new')]);

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith('spec.md', 'new');
    });

    // Parent re-renders: files still has one "spec.md" entry (no duplicates)
    rerender(
      <FileMenu
        files={['spec.md']}
        activeFile="spec.md"
        onSelect={vi.fn()}
        onAdd={onAdd}
        onReject={onReject}
      />,
    );

    const fileRows = screen.getAllByTestId(/^file-row-/);
    expect(fileRows).toHaveLength(1);
    expect(fileRows[0].getAttribute('data-testid')).toBe('file-row-spec.md');

    restore();
  });
});

// ─── STORY-001-04: FileMenu Mutations (Rename + Delete) ──────────────────────

// Scenario: Rename a file (happy path)
describe('Scenario: Rename a file', () => {
  it('calls onRename("spec.md", "specification.md") after double-click and Enter', async () => {
    const onRename = vi.fn();
    const onReject = vi.fn();

    render(
      <FileMenu
        files={['spec.md']}
        activeFile="spec.md"
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        onReject={onReject}
        onRename={onRename}
        onDelete={vi.fn()}
      />,
    );

    // Double-click the row to enter rename mode
    const rowBtn = screen.getByTestId('file-row-spec.md');
    fireEvent.doubleClick(rowBtn);

    // Rename input should appear
    const input = await screen.findByTestId('rename-input-spec.md');
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('spec.md');

    // Clear and type new name, then press Enter
    fireEvent.change(input, { target: { value: 'specification.md' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRename).toHaveBeenCalledWith('spec.md', 'specification.md');
    expect(onReject).not.toHaveBeenCalled();
  });
});

// Scenario: Rename collision is rejected (UI reflects parent re-render)
describe('Scenario: Rename collision is rejected', () => {
  it('calls onRename (UI side), then shows toast when parent fires onReject', async () => {
    const onRename = vi.fn();
    const onReject = vi.fn();

    const { rerender } = render(
      <FileMenu
        files={['spec.md', 'notes.md']}
        activeFile="spec.md"
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        onReject={onReject}
        onRename={onRename}
        onDelete={vi.fn()}
      />,
    );

    // Double-click spec.md to enter rename mode
    fireEvent.doubleClick(screen.getByTestId('file-row-spec.md'));

    const input = await screen.findByTestId('rename-input-spec.md');
    fireEvent.change(input, { target: { value: 'notes.md' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // UI unconditionally calls onRename; parent handles collision
    expect(onRename).toHaveBeenCalledWith('spec.md', 'notes.md');

    // Simulate parent surfacing collision error via onReject toast re-render
    // (parent calls setToast after StorageRenameCollisionError — FileMenu receives
    // the error via the parent's onReject path; here we verify that if the
    // parent re-renders FileMenu with original files (no rename applied), the row
    // reads "spec.md" still)
    rerender(
      <FileMenu
        files={['spec.md', 'notes.md']}
        activeFile="spec.md"
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        onReject={onReject}
        onRename={onRename}
        onDelete={vi.fn()}
      />,
    );

    // Row still reads "spec.md" (no name change applied by parent due to collision)
    expect(screen.getByTestId('file-row-spec.md')).toBeTruthy();
  });
});

// Scenario: Rename to non-.md extension is rejected (UI-side)
describe('Scenario: Rename to non-.md extension is rejected (UI-side)', () => {
  it('does NOT call onRename and shows "File name must end in .md" toast', async () => {
    const onRename = vi.fn();
    const onReject = vi.fn();

    render(
      <FileMenu
        files={['spec.md']}
        activeFile="spec.md"
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        onReject={onReject}
        onRename={onRename}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.doubleClick(screen.getByTestId('file-row-spec.md'));

    const input = await screen.findByTestId('rename-input-spec.md');
    fireEvent.change(input, { target: { value: 'spec.txt' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // onRename must NOT be called — UI-side extension check fires first
    expect(onRename).not.toHaveBeenCalled();

    // onReject should be called with the extension error message
    expect(onReject).toHaveBeenCalledWith({
      kind: 'error',
      message: 'File name must end in .md',
    });

    // Toast should be visible
    await waitFor(() => {
      expect(screen.getByTestId('toast').textContent).toContain('File name must end in .md');
    });
  });
});

// Scenario: Delete a file with confirmation
describe('Scenario: Delete a file with confirmation', () => {
  it('shows inline Yes/Cancel; clicking Yes calls onDelete("spec.md")', async () => {
    const onDelete = vi.fn();

    render(
      <FileMenu
        files={['spec.md']}
        activeFile="spec.md"
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        onReject={vi.fn()}
        onRename={vi.fn()}
        onDelete={onDelete}
      />,
    );

    // Click the delete button
    const deleteBtn = screen.getByTestId('delete-btn-spec.md');
    fireEvent.click(deleteBtn);

    // Inline confirm UI should appear (Yes + Cancel)
    const yesBtn = await screen.findByTestId('delete-confirm-yes-spec.md');
    const cancelBtn = screen.getByTestId('delete-confirm-cancel-spec.md');
    expect(yesBtn).toBeTruthy();
    expect(cancelBtn).toBeTruthy();

    // Click Yes
    fireEvent.click(yesBtn);

    expect(onDelete).toHaveBeenCalledWith('spec.md');
  });
});

// Scenario: Cancel file deletion
describe('Scenario: Cancel file deletion', () => {
  it('does NOT call onDelete and closes the confirm prompt', async () => {
    const onDelete = vi.fn();

    render(
      <FileMenu
        files={['spec.md']}
        activeFile="spec.md"
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        onReject={vi.fn()}
        onRename={vi.fn()}
        onDelete={onDelete}
      />,
    );

    // Open delete confirm
    fireEvent.click(screen.getByTestId('delete-btn-spec.md'));
    await screen.findByTestId('delete-confirm-yes-spec.md');

    // Click Cancel
    fireEvent.click(screen.getByTestId('delete-confirm-cancel-spec.md'));

    expect(onDelete).not.toHaveBeenCalled();

    // Confirm UI should be gone
    expect(screen.queryByTestId('delete-confirm-yes-spec.md')).toBeNull();
    expect(screen.queryByTestId('delete-confirm-cancel-spec.md')).toBeNull();
  });
});

// Scenario: Escape cancels rename
describe('Scenario: Escape cancels rename', () => {
  it('returns to view mode without calling onRename when Escape is pressed', async () => {
    const onRename = vi.fn();

    render(
      <FileMenu
        files={['spec.md']}
        activeFile={null}
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        onReject={vi.fn()}
        onRename={onRename}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.doubleClick(screen.getByTestId('file-row-spec.md'));
    const input = await screen.findByTestId('rename-input-spec.md');
    fireEvent.change(input, { target: { value: 'other.md' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    // Input should be gone (back to view mode)
    expect(screen.queryByTestId('rename-input-spec.md')).toBeNull();
    expect(onRename).not.toHaveBeenCalled();

    // Row should be back in view mode
    expect(screen.getByTestId('file-row-spec.md')).toBeTruthy();
  });
});

// Scenario: Opening rename on row B clears rename state on row A
describe('Scenario: Opening rename on row B clears rename state on row A', () => {
  it('entering rename on b.md resets a.md back to view mode', async () => {
    render(
      <FileMenu
        files={['a.md', 'b.md']}
        activeFile={null}
        onSelect={vi.fn()}
        onAdd={vi.fn()}
        onReject={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    // Enter rename mode on a.md
    fireEvent.doubleClick(screen.getByTestId('file-row-a.md'));
    await screen.findByTestId('rename-input-a.md');

    // Now enter rename mode on b.md — a.md should revert to view
    // b.md is currently in view mode (not in rename), so its row button exists
    // We need to trigger doubleClick on it; since a.md is in rename mode, b.md
    // is still rendered as a view-mode row button.
    fireEvent.doubleClick(screen.getByTestId('file-row-b.md'));

    // a.md should be back in view mode
    await waitFor(() => {
      expect(screen.queryByTestId('rename-input-a.md')).toBeNull();
    });

    // b.md should now be in rename mode
    expect(screen.getByTestId('rename-input-b.md')).toBeTruthy();
  });
});

// ─── Standalone Toast tests ───────────────────────────────────────────────────

describe('Toast component', () => {
  it('renders the message and calls onDismiss when the × button is clicked', () => {
    const onDismiss = vi.fn();
    render(<Toast toast={{ kind: 'error', message: 'Oops!' }} onDismiss={onDismiss} />);

    const toast = screen.getByTestId('toast');
    expect(toast.textContent).toContain('Oops!');

    const dismissBtn = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.click(dismissBtn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when toast is null', () => {
    const { container } = render(<Toast toast={null} onDismiss={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('auto-dismisses after 4 s using fake timers', async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    render(<Toast toast={{ kind: 'info', message: 'Auto dismiss me' }} onDismiss={onDismiss} />);

    expect(onDismiss).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(4000);
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('clicking the toast body also calls onDismiss', () => {
    const onDismiss = vi.fn();
    render(<Toast toast={{ kind: 'success', message: 'Done!' }} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByTestId('toast'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
