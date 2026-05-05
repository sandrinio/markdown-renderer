import MarkdownReviewer from './MarkdownReviewer/index';

const DEMO_CONTENT = `# Welcome to Markdown Reviewer

This is a demo document seeded for you to explore the comment and review workflow.
Select any text in read mode to leave a comment — a floating button will appear.
Once you have added a few comments, click **Review** to generate a \`ReviewPayload\`
and hand it off to the host application (in this demo it is logged to the console).

## Features

- **Inline comments** — select text, click Comment, type your note.
- **Anchor drift detection** — comments follow the text if you edit around them
  and are flagged as detached when the original text disappears.
- **Persistent storage** — comments and files survive a page reload.
- **Review payload** — click Review to emit a typed \`ReviewPayload\` to the host.

## Getting started

1. Read this document (default mode).
2. Select a word or phrase — the floating **Comment** button appears.
3. Type your comment and press Enter to save.
4. Toggle **Edit** to modify the document — watch anchors drift or detach.
5. Click **Review** when you are done.

For more, see the [README](https://github.com/sandrinio/markdown-renderer).
`;

export default function App() {
  return (
    <div className="h-screen flex flex-col">
      <h2 className="px-4 py-2 text-sm font-medium text-gray-600 border-b bg-gray-50 shrink-0">
        Markdown Reviewer demo — drop your own .md file or comment on this one.
      </h2>
      <div className="flex-1 min-h-0">
        <MarkdownReviewer
          initialFiles={[{ name: 'welcome.md', content: DEMO_CONTENT }]}
          storageKey="markdown-reviewer-app"
          onSubmit={(p) => console.log('payload', p)}
        />
      </div>
    </div>
  );
}
