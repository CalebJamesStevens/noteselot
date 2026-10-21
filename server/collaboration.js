import { Hocuspocus } from "@hocuspocus/server";
import * as Y from "yjs";
import { db, canAccess } from "./db.js";
import { findSession } from "./auth.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function plainText(document) {
  const fragment = document.getXmlFragment("default");
  const collect = (node) =>
    node instanceof Y.XmlText
      ? node.toString().replace(/<[^>]*>/g, "")
      : node.toArray().map(collect).join(" ");
  return [
    collect(fragment),
    document.getText("diagram").toString(),
    ...Array.from(document.getMap("shapes").values()).map((s) => s.text || ""),
  ]
    .join(" ")
    .slice(0, 200000);
}
export function createCollaboration(origin) {
  const collaboration = new Hocuspocus({
    debounce: 350,
    maxDebounce: 1500,
    quiet: true,
    async onAuthenticate({ documentName, requestHeaders }) {
      if (requestHeaders.get("origin") !== origin || !uuid.test(documentName))
        throw new Error("Access denied");
      const user = await findSession(requestHeaders.get("cookie") || "");
      if (!user || !(await canAccess(user.id, documentName)))
        throw new Error("Access denied");
      return { user };
    },
    async beforeHandleMessage({ context, documentName }) {
      const { rows } = await db.query(
        "SELECT 1 FROM sessions WHERE token_hash=$1 AND expires_at>now()",
        [context.user.token_hash],
      );
      if (!rows.length || !(await canAccess(context.user.id, documentName)))
        throw new Error("Access revoked");
    },
    async onLoadDocument({ documentName, document }) {
      const { rows } = await db.query(
        "SELECT state FROM notes WHERE id=$1 AND deleted_at IS NULL",
        [documentName],
      );
      if (!rows.length) throw new Error("Note unavailable");
      if (rows[0].state) Y.applyUpdate(document, rows[0].state);
      return document;
    },
    async onChange({ document }) {
      document.broadcastStateless(JSON.stringify({ type: "saving" }));
    },
    async onStoreDocument({ documentName, document }) {
      const state = Buffer.from(Y.encodeStateAsUpdate(document));
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "UPDATE notes SET state=$2,search_text=$3,updated_at=now() WHERE id=$1",
          [documentName, state, plainText(document)],
        );
        await client.query(
          `INSERT INTO revisions(note_id,state) SELECT $1,$2 WHERE NOT EXISTS
          (SELECT 1 FROM revisions WHERE note_id=$1 AND created_at>now()-interval '5 minutes')`,
          [documentName, state],
        );
        await client.query(
          "DELETE FROM revisions WHERE note_id=$1 AND id NOT IN (SELECT id FROM revisions WHERE note_id=$1 ORDER BY id DESC LIMIT 100)",
          [documentName],
        );
        await client.query("COMMIT");
        document.broadcastStateless(JSON.stringify({ type: "saved" }));
      } catch (error) {
        await client.query("ROLLBACK");
        document.broadcastStateless(JSON.stringify({ type: "save-error" }));
        throw error;
      } finally {
        client.release();
      }
    },
  });
  return collaboration;
}
