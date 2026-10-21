import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  Table,
  TableRow,
  TableHeader,
  TableCell,
} from "@tiptap/extension-table";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Typography from "@tiptap/extension-typography";
import {
  Bold,
  Italic,
  Strikethrough,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Code2,
  Link,
  Highlighter,
  Table2,
  Undo2,
  Redo2,
  Minus,
  Download,
  ImagePlus,
} from "lucide-react";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type * as Y from "yjs";
import type { Note, User } from "../types";
import { useRef, useState } from "react";
import { download } from "../api";
export default function NoteEditor({
  doc,
  provider,
  note,
  user,
}: {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  note: Note;
  user: User;
}) {
  const [, redraw] = useState(0);
  const imageInput = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState("");
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ document: doc }),
        CollaborationCaret.configure({
          provider,
          user: { name: user.name, color: "#a8bb92" },
        }),
        Placeholder.configure({
          placeholder: "Start writing, or use the toolbar to make it yours…",
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        Highlight,
        Typography,
        Image.configure({ allowBase64: true }),
      ],
      editorProps: {
        attributes: { class: "writing-surface", "aria-label": "Note content" },
      },
      onTransaction: () => redraw((n) => n + 1),
    },
    [doc],
  );
  if (!editor) return null;
  const actions = [
    {
      name: "Bold",
      Icon: Bold,
      active: editor.isActive("bold"),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      name: "Italic",
      Icon: Italic,
      active: editor.isActive("italic"),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      name: "Strikethrough",
      Icon: Strikethrough,
      active: editor.isActive("strike"),
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      name: "Highlight",
      Icon: Highlighter,
      active: editor.isActive("highlight"),
      run: () => editor.chain().focus().toggleHighlight().run(),
    },
    {
      name: "Bullet list",
      Icon: List,
      active: editor.isActive("bulletList"),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      name: "Numbered list",
      Icon: ListOrdered,
      active: editor.isActive("orderedList"),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      name: "Checklist",
      Icon: ListTodo,
      active: editor.isActive("taskList"),
      run: () => editor.chain().focus().toggleTaskList().run(),
    },
    {
      name: "Quote",
      Icon: Quote,
      active: editor.isActive("blockquote"),
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      name: "Code block",
      Icon: Code2,
      active: editor.isActive("codeBlock"),
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
  ];
  return (
    <>
      {imageError && (
        <p className="error editor-message" role="alert">
          {imageError}
        </p>
      )}
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (
            !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
            file.size > 300 * 1024
          ) {
            setImageError(
              "Choose a PNG, JPEG, or WebP image smaller than 300 KB.",
            );
            return;
          }
          setImageError("");
          const reader = new FileReader();
          reader.onload = () =>
            editor
              .chain()
              .focus()
              .setImage({ src: String(reader.result), alt: file.name })
              .run();
          reader.readAsDataURL(file);
        }}
      />
      <div className="editor-toolbar" aria-label="Formatting">
        <select
          aria-label="Text style"
          value={
            editor.isActive("heading", { level: 1 })
              ? "1"
              : editor.isActive("heading", { level: 2 })
                ? "2"
                : editor.isActive("heading", { level: 3 })
                  ? "3"
                  : "0"
          }
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v)
              editor
                .chain()
                .focus()
                .toggleHeading({ level: v as 1 | 2 | 3 })
                .run();
            else editor.chain().focus().setParagraph().run();
          }}
        >
          <option value="0">Text</option>
          <option value="1">Heading 1</option>
          <option value="2">Heading 2</option>
          <option value="3">Heading 3</option>
        </select>
        <span className="toolbar-divider" />
        {actions.map(({ name, Icon, active, run }) => (
          <button
            key={name}
            title={name}
            aria-label={name}
            aria-pressed={active}
            className={active ? "active" : ""}
            onClick={run}
          >
            <Icon size={17} />
          </button>
        ))}
        <span className="toolbar-divider" />
        <button
          title="Insert link"
          aria-label="Insert link"
          onClick={() => {
            const url = prompt(
              "Link URL (https://…) ",
              editor.getAttributes("link").href || "",
            );
            if (url === null) return;
            if (!url) editor.chain().focus().unsetLink().run();
            else if (/^https?:\/\//i.test(url))
              editor.chain().focus().setLink({ href: url }).run();
          }}
        >
          <Link size={17} />
        </button>
        <button
          title="Insert table"
          aria-label="Insert table"
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
        >
          <Table2 size={17} />
        </button>
        <button
          title="Divider"
          aria-label="Divider"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <Minus size={17} />
        </button>
        <button
          title="Insert image"
          aria-label="Insert image"
          onClick={() => imageInput.current?.click()}
        >
          <ImagePlus size={17} />
        </button>
        <span className="toolbar-divider" />
        <button
          title="Undo"
          aria-label="Undo"
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 size={17} />
        </button>
        <button
          title="Redo"
          aria-label="Redo"
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 size={17} />
        </button>
        <button
          title="Export text"
          aria-label="Export text"
          onClick={() =>
            download(
              `${note.title}.txt`,
              `${note.title}\n\n${editor.getText()}`,
            )
          }
        >
          <Download size={17} />
        </button>
      </div>
      {editor.isActive("table") && (
        <div className="table-actions">
          <button onClick={() => editor.chain().focus().addRowAfter().run()}>
            Add row
          </button>
          <button onClick={() => editor.chain().focus().addColumnAfter().run()}>
            Add column
          </button>
          <button onClick={() => editor.chain().focus().deleteRow().run()}>
            Delete row
          </button>
          <button onClick={() => editor.chain().focus().deleteColumn().run()}>
            Delete column
          </button>
          <button onClick={() => editor.chain().focus().deleteTable().run()}>
            Remove table
          </button>
        </div>
      )}
      <EditorContent editor={editor} />
      <footer className="editor-footer">
        {editor.getText().trim().split(/\s+/).filter(Boolean).length} words
        <span>Markdown shortcuts supported</span>
      </footer>
    </>
  );
}
