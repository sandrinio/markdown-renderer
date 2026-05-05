# Markdown Reviewer

## 1. What it is

`<MarkdownReviewer />` is a self-contained React component that lets readers leave
inline comments on any Markdown document. Users select text in read mode to attach
a comment; comments are stored in `localStorage`, survive page reloads, and are
bundled into a typed `ReviewPayload` when the host calls the Review action. The
component also detects anchor drift — when the document is edited and the commented
text moves or disappears, the comment is flagged as detached rather than silently
lost.

## 2. Install

The package is distributed as a **folder copy**, not an npm package. Clone the repo,
copy the source folder into your project, and install the peer dependencies.

```bash
# 1. Clone or download
git clone https://github.com/sandrinio/markdown-renderer.git

# 2. Install dependencies (first-time setup or to run the demo)
npm install

# 3. Start the dev server (Vite)
npm run dev
# → http://localhost:5173
```

To use `<MarkdownReviewer />` in your own host app, copy the entire
`src/MarkdownReviewer/` directory into your project. The component has no runtime
dependencies beyond React and `@milkdown/crepe` (already in `package.json`).

## 3. Usage

### Minimal example

```tsx
import MarkdownReviewer from './MarkdownReviewer/index';

export default function App() {
  return (
    <div style={{ height: '100vh' }}>
      <MarkdownReviewer />
    </div>
  );
}
```

### With seeded files and a custom submit handler

```tsx
import MarkdownReviewer from './MarkdownReviewer/index';
import type { ReviewPayload } from './MarkdownReviewer/types';

async function handleReview(payload: ReviewPayload): Promise<void> {
  const response = await fetch('/api/reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('Review submission failed');
}

export default function App() {
  return (
    <div style={{ height: '100vh' }}>
      <MarkdownReviewer
        initialFiles={[{ name: 'spec.md', content: '# My Document\n\nReview me.' }]}
        storageKey="my-app-reviewer"
        onSubmit={handleReview}
      />
    </div>
  );
}
```

When `onSubmit` is provided it **replaces** the default clipboard handler — the
default does not also fire (no double-copy).

## 4. Prop reference

| Prop | Type | Default | Description |
|---|---|---|---|
| `initialFiles` | `FileEntry[]` | `undefined` | Files seeded into the workspace on first mount (only when storage is empty). Each entry is `{ name: string; content: string }`. |
| `storageKey` | `string` | `"markdown-reviewer"` | `localStorage` key used to persist files and comments. Use a unique key per reviewer instance to avoid cross-instance bleed. |
| `theme` | `'light' \| 'dark'` | `'light'` | Visual theme. Dark theme is a stub in v1 and falls back to light styling. |
| `className` | `string` | `undefined` | CSS class merged onto the root element for host-level sizing or styling. |
| `onSubmit` | `(payload: ReviewPayload) => Promise<void> \| void` | `undefined` | Called when the user clicks **Review**. When provided, replaces the default clipboard handler. Receives a fully typed `ReviewPayload`. |

## 5. ReviewPayload schema

```ts
export interface ReviewPayload {
  file: { name: string; content: string; lastModified: string };
  comments: Comment[];
  submittedAt: string; // ISO-8601, fresh at click time
}
```

Where `Comment` is:

```ts
export interface Comment {
  id: string;
  selectedText: string;
  range: { startLine: number; endLine: number; startChar: number; endChar: number };
  comment: string;
  createdAt: string;
  updatedAt: string;
  detached: boolean;
}
```

**`file.lastModified`** reflects the ISO-8601 timestamp of the most-recent persisted
edit to the file. For files seeded via `initialFiles` that were **never edited**,
there is no mtime write at seed time; `lastModified` falls back to the submit
timestamp (i.e., `new Date().toISOString()` at the moment Review is clicked).
Integrators that need a reliable modification time should ensure the file is edited
at least once before the first review, or treat a `lastModified` value equal to
`submittedAt` as "unmodified since seeding".

`detached: true` on a comment means the anchor text was edited away during the
current session. Detached comments are included in the payload — the host decides
whether to surface or suppress them.

## 6. What's not in v1

- **Authentication / authorisation** — no user identity, no ACL; all state is local.
- **Math rendering** — KaTeX / MathJax blocks are not rendered.
- **Diagram rendering** — Mermaid blocks are not rendered.
- **Comment threads** — each comment is a flat note; replies are not supported.
- **Dark theme** — the `theme="dark"` prop is accepted but falls back to light
  styling in v1; full dark-mode CSS is planned for a future sprint.
- **npm publish** — the package is distributed as a folder copy only; there is no
  `npm install @sandrinio/markdown-reviewer` path in v1.
- **Collaborative / multi-user** — all comments are local to the browser session.
