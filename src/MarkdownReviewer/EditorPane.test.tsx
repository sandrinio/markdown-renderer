/**
 * EditorPane.test.tsx — unit tests for EditorPane (STORY-001-05)
 *
 * Crepe is mocked to avoid pulling a real ProseMirror view into jsdom.
 * The tests verify:
 *   - Crepe constructor called with correct config on mount
 *   - create() called on mount
 *   - setReadonly() called with the readOnly prop
 *   - destroy() called on unmount
 *   - markdownUpdated listener registered and calls onChange
 *   - No DOM pollution after mount/unmount cycle
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

afterEach(() => {
  cleanup();
});

// ─── Crepe mock ───────────────────────────────────────────────────────────────

// We mock the @milkdown/crepe module before importing EditorPane
// so all tests share the fake Crepe class.

let capturedOnFns: Array<(api: MockListenerManager) => void> = [];

interface MockListenerManager {
  markdownUpdated: Mock;
}

class MockCrepe {
  static instances: MockCrepe[] = [];
  root: unknown;
  defaultValue: string;
  _readonly: boolean = false;
  _onFns: Array<(api: MockListenerManager) => void> = [];

  constructor(config: { root?: unknown; defaultValue?: string }) {
    this.root = config.root;
    this.defaultValue = config.defaultValue ?? '';
    MockCrepe.instances.push(this);
  }

  on = vi.fn((fn: (api: MockListenerManager) => void) => {
    this._onFns.push(fn);
    capturedOnFns.push(fn);
    return this;
  });

  create = vi.fn(() => Promise.resolve({} as unknown));
  destroy = vi.fn(() => Promise.resolve({} as unknown));
  setReadonly = vi.fn((v: boolean) => {
    this._readonly = v;
    return this;
  });
  getMarkdown = vi.fn(() => '');

  /** Helper: fire markdownUpdated to simulate editor content change */
  triggerMarkdownUpdated(markdown: string) {
    const mockApi: MockListenerManager = {
      markdownUpdated: vi.fn((fn: (ctx: unknown, md: string) => void) => {
        fn({}, markdown);
        return mockApi;
      }),
    };
    for (const fn of this._onFns) {
      fn(mockApi);
    }
  }
}

vi.mock('@milkdown/crepe', () => ({
  Crepe: MockCrepe,
}));

// Import AFTER mock is set up
const { EditorPane } = await import('./EditorPane');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('EditorPane: Crepe lifecycle', () => {
  beforeEach(() => {
    MockCrepe.instances = [];
    capturedOnFns = [];
  });

  it('creates a Crepe instance with the given value on mount', async () => {
    await act(async () => {
      render(<EditorPane value="# Hello" onChange={vi.fn()} readOnly={false} />);
    });

    expect(MockCrepe.instances).toHaveLength(1);
    expect(MockCrepe.instances[0].defaultValue).toBe('# Hello');
  });

  it('calls create() on mount', async () => {
    await act(async () => {
      render(<EditorPane value="# Hi" onChange={vi.fn()} readOnly={false} />);
    });

    expect(MockCrepe.instances[0].create).toHaveBeenCalledTimes(1);
  });

  it('calls setReadonly(true) when readOnly prop is true', async () => {
    await act(async () => {
      render(<EditorPane value="content" onChange={vi.fn()} readOnly={true} />);
    });

    expect(MockCrepe.instances[0].setReadonly).toHaveBeenCalledWith(true);
  });

  it('calls destroy() on unmount', async () => {
    let unmount!: () => void;

    await act(async () => {
      const result = render(<EditorPane value="content" onChange={vi.fn()} readOnly={false} />);
      unmount = result.unmount;
    });

    const instance = MockCrepe.instances[0];
    expect(instance.destroy).not.toHaveBeenCalled();

    await act(async () => {
      unmount();
    });

    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });

  it('calls onChange when markdownUpdated fires', async () => {
    const onChange = vi.fn();

    await act(async () => {
      render(<EditorPane value="start" onChange={onChange} readOnly={false} />);
    });

    const instance = MockCrepe.instances[0];

    await act(async () => {
      instance.triggerMarkdownUpdated('updated content');
    });

    expect(onChange).toHaveBeenCalledWith('updated content');
  });

  it('leaves no DOM editor containers after mount/unmount cycle', async () => {
    let unmount!: () => void;

    await act(async () => {
      const result = render(<EditorPane value="text" onChange={vi.fn()} readOnly={false} />);
      unmount = result.unmount;
    });

    expect(document.querySelectorAll('[data-testid="editor-pane"]')).toHaveLength(1);

    await act(async () => {
      unmount();
    });

    // After unmount, the mounted element is removed from document
    expect(document.querySelectorAll('[data-testid="editor-pane"]')).toHaveLength(0);
  });

  it('emits console.info once for dark theme on mount', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    await act(async () => {
      render(<EditorPane value="text" onChange={vi.fn()} readOnly={false} theme="dark" />);
    });

    expect(infoSpy).toHaveBeenCalledWith('dark theme arrives in v2');
    infoSpy.mockRestore();
  });
});
