import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { z } from "zod";
import { db, migrate, transaction, canAccess } from "./db.js";
import {
  hashPassword,
  verifyPassword,
  findSession,
  issueSession,
  clearSession,
} from "./auth.js";
import { createCollaboration } from "./collaboration.js";
import { initialState } from "./templates.js";

const origin = new URL(process.env.APP_URL || "http://localhost:3000").origin;
const secure = origin.startsWith("https:");
const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY)
  app.set("trust proxy", Number(process.env.TRUST_PROXY));
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'", origin.replace(/^http/, "ws")],
        "style-src": ["'self'", "'unsafe-inline'"],
        "script-src": ["'self'"],
        "upgrade-insecure-requests": secure ? [] : null,
      },
    },
    strictTransportSecurity: secure ? undefined : false,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(
  "/api",
  rateLimit({
    windowMs: 60000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.get("origin") !== origin
  )
    return res.status(403).json({ error: "Request origin is not allowed." });
  next();
});
const authLimit = rateLimit({
  windowMs: 15 * 60000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(12).max(128),
});
const title = z.string().trim().min(1).max(200);
const id = z.uuid();
app.get("/api/health", async (_req, res) => {
  await db.query("SELECT 1");
  res.json({ status: "ok" });
});
app.post("/api/register", authLimit, async (req, res) => {
  if (process.env.ALLOW_REGISTRATION === "false")
    return res.status(403).json({ error: "Registration is disabled." });
  const input = credentials
    .extend({ name: z.string().trim().min(1).max(80) })
    .parse(req.body);
  const userId = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)",
    [userId, input.email, input.name, await hashPassword(input.password)],
  );
  await issueSession(res, userId, secure);
  res.status(201).json({ id: userId, name: input.name, email: input.email });
});
const dummyHash = await hashPassword(randomUUID());
app.post("/api/login", authLimit, async (req, res) => {
  const input = credentials.parse(req.body);
  const { rows } = await db.query("SELECT * FROM users WHERE email=$1", [
    input.email,
  ]);
  const valid = await verifyPassword(
    input.password,
    rows[0]?.password_hash || dummyHash,
  );
  if (!rows[0] || !valid)
    return res.status(401).json({ error: "Email or password is incorrect." });
  await issueSession(res, rows[0].id, secure);
  res.json({ id: rows[0].id, name: rows[0].name, email: rows[0].email });
});
app.use("/api", async (req, res, next) => {
  req.user = await findSession(req.headers.cookie);
  if (!req.user) return res.status(401).json({ error: "Please sign in." });
  next();
});
app.get("/api/me", (req, res) => {
  const { id, name, email } = req.user;
  res.json({ id, name, email });
});
app.post("/api/logout", async (req, res) => {
  await db.query("DELETE FROM sessions WHERE token_hash=$1", [
    req.user.token_hash,
  ]);
  closeUserSockets(req.user.id, req.user.token_hash);
  clearSession(res, secure);
  res.json({ ok: true });
});
app.post("/api/password", async (req, res) => {
  const input = z
    .object({
      currentPassword: z.string().max(128),
      password: z.string().min(12).max(128),
    })
    .parse(req.body);
  const { rows } = await db.query(
    "SELECT password_hash FROM users WHERE id=$1",
    [req.user.id],
  );
  if (!(await verifyPassword(input.currentPassword, rows[0].password_hash)))
    return res.status(400).json({ error: "Current password is incorrect." });
  await transaction(async (client) => {
    await client.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
      req.user.id,
      await hashPassword(input.password),
    ]);
    await client.query("DELETE FROM sessions WHERE user_id=$1", [req.user.id]);
  });
  closeUserSockets(req.user.id);
  await issueSession(res, req.user.id, secure);
  res.json({ ok: true });
});
app.get("/api/teams", async (req, res) => {
  const { rows } = await db.query(
    "SELECT t.* FROM teams t JOIN members m ON m.team_id=t.id WHERE m.user_id=$1 ORDER BY t.name",
    [req.user.id],
  );
  res.json(rows);
});
app.post("/api/teams", async (req, res) => {
  const { name } = z.object({ name: title }).parse(req.body);
  const teamId = randomUUID();
  await transaction(async (client) => {
    await client.query("INSERT INTO teams(id,name,owner_id) VALUES($1,$2,$3)", [
      teamId,
      name,
      req.user.id,
    ]);
    await client.query("INSERT INTO members VALUES($1,$2)", [
      teamId,
      req.user.id,
    ]);
  });
  res.status(201).json({ id: teamId, name, owner_id: req.user.id });
});
app.get("/api/teams/:id/members", async (req, res) => {
  const teamId = id.parse(req.params.id);
  const member = await db.query(
    "SELECT 1 FROM members WHERE team_id=$1 AND user_id=$2",
    [teamId, req.user.id],
  );
  if (!member.rowCount) return res.sendStatus(404);
  const { rows } = await db.query(
    "SELECT u.id,u.name,u.email FROM users u JOIN members m ON u.id=m.user_id WHERE m.team_id=$1 ORDER BY u.name",
    [teamId],
  );
  res.json(rows);
});
app.post("/api/teams/:id/members", async (req, res) => {
  const teamId = id.parse(req.params.id);
  const { email } = z
    .object({ email: z.email().transform((v) => v.toLowerCase()) })
    .parse(req.body);
  const owner = await db.query(
    "SELECT 1 FROM teams WHERE id=$1 AND owner_id=$2",
    [teamId, req.user.id],
  );
  if (!owner.rowCount) return res.sendStatus(403);
  const { rows } = await db.query("SELECT id FROM users WHERE email=$1", [
    email,
  ]);
  if (!rows.length)
    return res
      .status(404)
      .json({ error: "Ask this person to create an account first." });
  await db.query("INSERT INTO members VALUES($1,$2) ON CONFLICT DO NOTHING", [
    teamId,
    rows[0].id,
  ]);
  res.json({ ok: true });
});
app.delete("/api/teams/:id/members/:userId", async (req, res) => {
  const teamId = id.parse(req.params.id),
    userId = id.parse(req.params.userId);
  const owner = await db.query(
    "SELECT 1 FROM teams WHERE id=$1 AND owner_id=$2",
    [teamId, req.user.id],
  );
  if (!owner.rowCount || userId === req.user.id) return res.sendStatus(403);
  await db.query("DELETE FROM members WHERE team_id=$1 AND user_id=$2", [
    teamId,
    userId,
  ]);
  // Closing the affected rooms prevents revoked members receiving later broadcasts.
  const { rows } = await db.query("SELECT id FROM notes WHERE team_id=$1", [
    teamId,
  ]);
  closeUserSockets(userId);
  res.json({ ok: true });
});
app.get("/api/notes", async (req, res) => {
  const q = String(req.query.q || "").slice(0, 200);
  const { rows } = await db.query(
    `SELECT n.id,n.title,n.kind,n.template,n.team_id,n.owner_id,n.updated_at,n.deleted_at,
    left(n.search_text,160) AS excerpt, f.note_id IS NOT NULL AS favorite FROM notes n
    LEFT JOIN favorites f ON f.note_id=n.id AND f.user_id=$1 WHERE
    ((n.team_id IS NULL AND n.owner_id=$1) OR EXISTS(SELECT 1 FROM members m WHERE m.team_id=n.team_id AND m.user_id=$1))
    AND ($2='' OR n.title ILIKE '%' || $2 || '%' OR n.search_text ILIKE '%' || $2 || '%') ORDER BY n.updated_at DESC LIMIT 1000`,
    [req.user.id, q],
  );
  res.json(rows);
});
app.post("/api/notes", async (req, res) => {
  const input = z
    .object({
      title: title.default("Untitled"),
      kind: z.enum(["note", "board", "diagram"]).default("note"),
      template: z
        .enum(["blank", "meeting", "ideas", "project"])
        .default("blank"),
      team_id: id.nullable().default(null),
    })
    .parse(req.body);
  if (input.team_id) {
    const m = await db.query(
      "SELECT 1 FROM members WHERE team_id=$1 AND user_id=$2",
      [input.team_id, req.user.id],
    );
    if (!m.rowCount) return res.sendStatus(403);
  }
  const { rows } = await db.query(
    "INSERT INTO notes(id,owner_id,team_id,title,kind,template,state) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,title,kind,template,team_id,owner_id,updated_at",
    [
      randomUUID(),
      req.user.id,
      input.team_id,
      input.title,
      input.kind,
      input.template,
      initialState(input.kind, input.template),
    ],
  );
  res.status(201).json(rows[0]);
});
app.use("/api/notes/:id", async (req, res, next) => {
  const noteId = id.parse(req.params.id);
  const note = await canAccess(req.user.id, noteId);
  if (!note)
    return res.status(404).json({ error: "Note not found or access removed." });
  req.note = note;
  next();
});
app.patch("/api/notes/:id", async (req, res) => {
  const input = z
    .object({ title: title.optional(), favorite: z.boolean().optional() })
    .parse(req.body);
  if (input.title)
    await db.query("UPDATE notes SET title=$2,updated_at=now() WHERE id=$1", [
      req.note.id,
      input.title,
    ]);
  if (input.favorite !== undefined) {
    if (input.favorite)
      await db.query(
        "INSERT INTO favorites VALUES($1,$2) ON CONFLICT DO NOTHING",
        [req.user.id, req.note.id],
      );
    else
      await db.query("DELETE FROM favorites WHERE user_id=$1 AND note_id=$2", [
        req.user.id,
        req.note.id,
      ]);
  }
  res.json({ ok: true });
});
app.delete("/api/notes/:id", async (req, res) => {
  await db.query("UPDATE notes SET deleted_at=now() WHERE id=$1", [
    req.note.id,
  ]);
  collaboration.closeConnections(req.note.id);
  res.json({ ok: true });
});
app.post("/api/trash/:id/restore", async (req, res) => {
  const noteId = id.parse(req.params.id);
  const { rowCount } = await db.query(
    `UPDATE notes n SET deleted_at=NULL WHERE id=$1 AND ((team_id IS NULL AND owner_id=$2) OR EXISTS(SELECT 1 FROM members m WHERE m.team_id=n.team_id AND m.user_id=$2))`,
    [noteId, req.user.id],
  );
  if (!rowCount) return res.sendStatus(404);
  res.json({ ok: true });
});
app.get("/api/notes/:id/comments", async (req, res) => {
  const { rows } = await db.query(
    "SELECT c.*,u.name FROM comments c JOIN users u ON c.user_id=u.id WHERE note_id=$1 ORDER BY created_at",
    [req.note.id],
  );
  res.json(rows);
});
app.post("/api/notes/:id/comments", async (req, res) => {
  const { body } = z
    .object({ body: z.string().trim().min(1).max(4000) })
    .parse(req.body);
  await db.query(
    "INSERT INTO comments(id,note_id,user_id,body) VALUES($1,$2,$3,$4)",
    [randomUUID(), req.note.id, req.user.id, body],
  );
  res.status(201).json({ ok: true });
});
app.get("/api/notes/:id/revisions", async (req, res) => {
  const { rows } = await db.query(
    "SELECT id,created_at FROM revisions WHERE note_id=$1 ORDER BY id DESC LIMIT 100",
    [req.note.id],
  );
  res.json(rows);
});
app.post("/api/notes/:id/revisions/:revisionId/copy", async (req, res) => {
  const revisionId = z.string().regex(/^\d+$/).parse(req.params.revisionId);
  const { rows } = await db.query(
    "SELECT state FROM revisions WHERE id=$1 AND note_id=$2",
    [revisionId, req.note.id],
  );
  if (!rows.length) return res.sendStatus(404);
  const noteId = randomUUID();
  await db.query(
    "INSERT INTO notes(id,owner_id,team_id,title,kind,state) VALUES($1,$2,$3,$4,$5,$6)",
    [
      noteId,
      req.user.id,
      req.note.team_id,
      `${req.note.title.slice(0, 175)} (recovered)`,
      req.note.kind,
      rows[0].state,
    ],
  );
  res.json({ id: noteId });
});
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
app.use(express.static(fileURLToPath(new URL("../dist", import.meta.url))));
app.get("/{*path}", (_req, res) =>
  res.sendFile(fileURLToPath(new URL("../dist/index.html", import.meta.url))),
);
app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError)
    return res.status(400).json({
      error: error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    });
  if (error.code === "23505")
    return res
      .status(409)
      .json({ error: "An account with that email already exists." });
  if (error.type === "entity.too.large")
    return res.status(413).json({ error: "Request is too large." });
  console.error(error);
  res.status(500).json({ error: "Unable to complete the request." });
});
await migrate();
const collaboration = createCollaboration(origin);
const server = createServer(app);
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 16 * 1024 * 1024,
});
function closeUserSockets(userId, sessionHash) {
  for (const ws of wss.clients) {
    if (
      ws.userId === userId &&
      (!sessionHash || ws.sessionHash === sessionHash)
    )
      ws.close(1008, "Session or membership changed");
  }
}
const expiryCheck = setInterval(() => {
  for (const ws of wss.clients)
    if (ws.sessionExpiry <= Date.now()) ws.close(1008, "Session expired");
}, 30000);
expiryCheck.unref();
server.on("upgrade", async (req, socket, head) => {
  try {
    const user = await findSession(req.headers.cookie);
    if (
      req.url !== "/collaboration" ||
      req.headers.origin !== origin ||
      !user
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = user.id;
      ws.sessionHash = user.token_hash;
      ws.sessionExpiry = new Date(user.expires_at).getTime();
      const request = new Request(new URL(req.url, origin), {
        headers: new Headers(
          Object.entries(req.headers).flatMap(([key, value]) =>
            value
              ? [[key, Array.isArray(value) ? value.join(", ") : value]]
              : [],
          ),
        ),
      });
      const connection = collaboration.handleConnection(ws, request);
      ws.on("message", (data) =>
        connection.handleMessage(new Uint8Array(data)),
      );
      ws.on("close", (code, reason) =>
        connection.handleClose({ code, reason: reason.toString() }),
      );
      ws.on("pong", () => connection.touch());
      ws.on("error", () => ws.close(1011, "Connection error"));
    });
  } catch {
    socket.destroy();
  }
});
const cleanup = setInterval(
  () =>
    db
      .query("DELETE FROM sessions WHERE expires_at<now()")
      .catch(console.error),
  3600000,
);
cleanup.unref();
server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log("Noteselot is listening on port", process.env.PORT || 3000),
);
async function shutdown() {
  clearInterval(cleanup);
  clearInterval(expiryCheck);
  server.close();
  await collaboration.destroy();
  wss.close();
  await db.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
