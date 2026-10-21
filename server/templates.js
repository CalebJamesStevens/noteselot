import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { prosemirrorJSONToYDoc } from "y-prosemirror";
import * as Y from "yjs";

const paragraph = (text) => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
const heading = (text) => ({
  type: "heading",
  attrs: { level: 2 },
  content: [{ type: "text", text }],
});
const checklist = (text) => ({
  type: "taskList",
  content: [
    { type: "taskItem", attrs: { checked: false }, content: [paragraph(text)] },
  ],
});
const templates = {
  blank: [paragraph("")],
  meeting: [
    paragraph("Date · Attendees"),
    heading("On the agenda"),
    paragraph("What are we here to discuss?"),
    heading("Discussion"),
    paragraph(""),
    heading("Decisions"),
    paragraph(""),
    heading("Next steps"),
    checklist("Action · Owner · Due date"),
  ],
  ideas: [
    paragraph("Start with a question. Follow your curiosity."),
    heading("The question"),
    paragraph(""),
    heading("Ideas, big and small"),
    paragraph(""),
    heading("Worth exploring"),
    paragraph(""),
  ],
  project: [
    heading("What are we trying to achieve?"),
    paragraph(""),
    heading("What we know"),
    paragraph(""),
    heading("Open questions"),
    paragraph(""),
    heading("Next steps"),
    checklist("Take the first small step"),
  ],
};
const schema = getSchema([
  StarterKit,
  TaskList,
  TaskItem.configure({ nested: true }),
]);
export function initialState(kind, template) {
  const doc =
    kind === "note"
      ? prosemirrorJSONToYDoc(
          schema,
          { type: "doc", content: templates[template] || templates.blank },
          "default",
        )
      : new Y.Doc();
  doc.getMap("meta").set("initialized", true);
  const state = Buffer.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return state;
}
