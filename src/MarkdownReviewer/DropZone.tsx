/**
 * DropZone.tsx — native drag-and-drop zone (STORY-001-03)
 *
 * Wraps its children. On drag-enter shows an overlay. Validates dropped files:
 *   - Non-.md extension → onReject({ kind: 'error', message: 'Only .md files are supported' })
 *   - Accepted .md files → reads via FileReader.readAsText → onAccept(name, content)
 *
 * Per architect decision: per-file processing — valid .md files are ingested
 * individually; rejected files each trigger a separate onReject call.
 *
 * RISK mitigation (§1.5): preventDefault is called in both onDragOver AND onDrop
 * to prevent the browser from swallowing drop events.
 *
 * NO react-dropzone dependency. Native browser drag-drop events only.
 */

import { useState, type DragEvent, type ReactNode } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ToastPayload {
  kind: 'success' | 'error' | 'info';
  message: string;
}

export interface DropZoneProps {
  children: ReactNode;
  onAccept: (name: string, content: string) => void;
  onReject: (toast: ToastPayload) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isMdFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.md');
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve((e.target?.result as string) ?? '');
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsText(file);
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DropZone({ children, onAccept, onReject }: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); // required — otherwise onDrop won't fire
    e.stopPropagation();
    setIsDragOver(true);
  }

  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    // Only clear overlay if leaving the root drop element (not a child)
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragOver(false);
  }

  async function processFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    for (const file of fileArray) {
      if (!isMdFile(file)) {
        onReject({ kind: 'error', message: 'Only .md files are supported' });
        continue;
      }
      try {
        const content = await readFileAsText(file);
        onAccept(file.name, content);
      } catch {
        onReject({ kind: 'error', message: `Failed to read ${file.name}` });
      }
    }
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); // required — prevents browser default (open file)
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    await processFiles(files);
  }

  return (
    <div
      data-testid="dropzone"
      className="relative"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div
          data-testid="dropzone-overlay"
          className="absolute inset-0 z-10 flex items-center justify-center rounded border-2 border-dashed border-blue-400 bg-blue-50/80"
          aria-hidden="true"
        >
          <span className="text-sm font-medium text-blue-600">Drop .md files here</span>
        </div>
      )}
      {children}
    </div>
  );
}

// Expose processFiles for reuse in FileMenu (click-to-pick path)
export { readFileAsText, isMdFile };
