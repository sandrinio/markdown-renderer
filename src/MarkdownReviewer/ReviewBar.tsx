/**
 * ReviewBar.tsx — top-of-pane bar (STORY-002-04)
 *
 * Renders:
 *   Left:  active filename (or "No file selected")
 *   Right: Edit toggle (aria-pressed) + Review button (disabled when no active file)
 *
 * This component REPLACES the temporary inline Edit toggle from STORY-001-05
 * (index.tsx:381-392). It is purely presentational — all state lives in the parent.
 */

interface ReviewBarProps {
  activeFile: string | null;
  editMode: boolean;
  onToggleEditMode(): void;
  onReview(): void;
}

export function ReviewBar({ activeFile, editMode, onToggleEditMode, onReview }: ReviewBarProps) {
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b px-4 py-2"
      data-testid="review-bar"
    >
      {/* Left: active filename */}
      <span className="text-sm font-medium text-gray-600 truncate flex-1">
        {activeFile ?? 'No file selected'}
      </span>

      {/* Right: Edit toggle */}
      <button
        type="button"
        aria-pressed={editMode}
        data-testid="edit-toggle"
        onClick={onToggleEditMode}
        className="rounded border px-3 py-1 text-sm font-medium hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {editMode ? 'Done' : 'Edit'}
      </button>

      {/* Right: Review button */}
      <button
        type="button"
        data-testid="review-button"
        onClick={onReview}
        disabled={activeFile === null}
        className="rounded border px-3 py-1 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Review
      </button>
    </div>
  );
}
