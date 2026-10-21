import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";
import pg from "pg";

const origin = "http://127.0.0.1:3099";
let embedded,
  socket,
  server,
  sql,
  logs = "";
const clients = [];
async function waitFor(predicate, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out. Server: ${logs}`);
}
async function request(
  path,
  body,
  cookie = "",
  method = body ? "POST" : "GET",
  requestOrigin = origin,
) {
  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      origin: requestOrigin,
      cookie,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    data: await response.json().catch(() => null),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
async function register(name) {
  const result = await request("/register", {
    name,
    email: `${name.toLowerCase()}-${Date.now()}@example.test`,
    password: "An excellent password 123",
  });
  assert.equal(result.status, 201);
  return result;
}
function connect(noteId, cookie) {
  class AuthSocket extends WebSocket {
    constructor(url, protocols) {
      super(url, protocols, { headers: { cookie, origin } });
    }
  }
  const transport = new HocuspocusProviderWebsocket({
    url: origin.replace("http", "ws") + "/collaboration",
    WebSocketPolyfill: AuthSocket,
  });
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    websocketProvider: transport,
    name: noteId,
    document: doc,
    token: "session",
  });
  provider.attach();
  const client = { doc, provider, transport };
  clients.push(client);
  return client;
}
before(async () => {
  let database = process.env.TEST_DATABASE_URL;
  if (!database) {
    embedded = await PGlite.create();
    socket = new PGLiteSocketServer({
      db: embedded,
      host: "127.0.0.1",
      port: 5544,
    });
    await socket.start();
    database = "postgres://postgres:postgres@127.0.0.1:5544/postgres";
  }
  sql = new pg.Pool({ connectionString: database, max: 1 });
  server = spawn(process.execPath, ["server/index.js"], {
    env: {
      ...process.env,
      DATABASE_URL: database,
      DB_POOL_SIZE: "1",
      APP_URL: origin,
      PORT: "3099",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => {
    logs += d;
  });
  server.stderr.on("data", (d) => {
    logs += d;
  });
  await waitFor(async () => {
    try {
      return (await fetch(origin + "/api/health")).ok;
    } catch {
      return false;
    }
  }, 20000);
});
after(async () => {
  for (const c of clients) {
    c.provider.destroy();
    c.transport.destroy();
    c.doc.destroy();
  }
  if (server) {
    server.kill("SIGTERM");
    await Promise.race([
      once(server, "exit"),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  await sql?.end();
  await socket?.stop();
  await embedded?.close();
});
test("local accounts, origin checks, and password/session lifecycle", async () => {
  assert.equal((await request("/me")).status, 401);
  assert.equal(
    (
      await request(
        "/register",
        {
          name: "Attacker",
          email: "csrf@example.test",
          password: "An excellent password 123",
        },
        "",
        "POST",
        "https://other.test",
      )
    ).status,
    403,
  );
  const alice = await register("Lifecycle");
  assert.equal(
    (await request("/me", undefined, alice.cookie)).data.name,
    "Lifecycle",
  );
  const login = await request("/login", {
    email: alice.data.email,
    password: "An excellent password 123",
  });
  assert.equal(login.status, 200);
  assert.equal(
    (
      await request(
        "/password",
        { currentPassword: "wrong", password: "A replacement password 456" },
        alice.cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/password",
        {
          currentPassword: "An excellent password 123",
          password: "A replacement password 456",
        },
        alice.cookie,
      )
    ).status,
    200,
  );
  assert.equal((await request("/me", undefined, login.cookie)).status, 401);
});
test("private notes stay private; team membership, trash, comments and recovery enforce access", async () => {
  const alice = await register("Alice"),
    bob = await register("Bob");
  const personal = await request(
    "/notes",
    { title: "Private thought" },
    alice.cookie,
  );
  assert.equal(
    (
      await request(
        `/notes/${personal.data.id}/comments`,
        undefined,
        bob.cookie,
      )
    ).status,
    404,
  );
  assert.equal((await request("/notes", undefined, bob.cookie)).data.length, 0);
  const team = await request("/teams", { name: "Product team" }, alice.cookie);
  assert.equal(
    (
      await request(
        `/teams/${team.data.id}/members`,
        { email: alice.data.email },
        bob.cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/teams/${team.data.id}/members`,
        { email: bob.data.email },
        alice.cookie,
      )
    ).status,
    200,
  );
  const shared = await request(
    "/notes",
    { title: "Team meeting", team_id: team.data.id },
    alice.cookie,
  );
  assert.equal(
    (await request("/notes", undefined, bob.cookie)).data[0].id,
    shared.data.id,
  );
  assert.equal(
    (
      await request(
        `/notes/${shared.data.id}/comments`,
        { body: "A useful question" },
        bob.cookie,
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await request(
        `/notes/${shared.data.id}/comments`,
        undefined,
        alice.cookie,
      )
    ).data[0].body,
    "A useful question",
  );
  assert.equal(
    (await request(`/notes/${shared.data.id}`, undefined, bob.cookie, "DELETE"))
      .status,
    200,
  );
  assert.equal(
    (
      await request(
        `/notes/${shared.data.id}/comments`,
        undefined,
        alice.cookie,
      )
    ).status,
    404,
  );
  assert.equal(
    (await request(`/trash/${shared.data.id}/restore`, {}, bob.cookie)).status,
    200,
  );
  await request(
    `/teams/${team.data.id}/members/${bob.data.id}`,
    undefined,
    alice.cookie,
    "DELETE",
  );
  assert.equal((await request("/notes", undefined, bob.cookie)).data.length, 0);
  assert.equal(
    (await request(`/notes/${shared.data.id}/comments`, undefined, bob.cookie))
      .status,
    404,
  );
});
test("two editors converge, PostgreSQL persists state, search and snapshots work, revocation closes sockets", async () => {
  const alice = await register("Writer"),
    bob = await register("Reader");
  const team = await request(
    "/teams",
    { name: "Collaboration team" },
    alice.cookie,
  );
  await request(
    `/teams/${team.data.id}/members`,
    { email: bob.data.email },
    alice.cookie,
  );
  const { data: note } = await request(
    "/notes",
    { title: "Shared diagram", kind: "diagram", team_id: team.data.id },
    alice.cookie,
  );
  const a = connect(note.id, alice.cookie),
    b = connect(note.id, bob.cookie);
  await waitFor(() => a.provider.isSynced && b.provider.isSynced);
  a.doc.getText("diagram").insert(0, "flowchart TD\n  A[hello] --> B[world]");
  await waitFor(() => b.doc.getText("diagram").toString().includes("world"));
  b.doc
    .getText("diagram")
    .insert(b.doc.getText("diagram").length, "\n  B --> C[collaboration]");
  await waitFor(() =>
    a.doc.getText("diagram").toString().includes("collaboration"),
  );
  await waitFor(async () => {
    const { rows } = await (embedded || sql).query(
      "SELECT state FROM notes WHERE id=$1",
      [note.id],
    );
    if (!rows[0].state) return false;
    const persisted = new Y.Doc();
    Y.applyUpdate(persisted, rows[0].state);
    const ok = persisted
      .getText("diagram")
      .toString()
      .includes("collaboration");
    persisted.destroy();
    return ok;
  });
  assert.equal(
    a.doc.getText("diagram").toString(),
    b.doc.getText("diagram").toString(),
  );
  assert.equal(
    (await request("/notes?q=collaboration", undefined, bob.cookie)).data[0].id,
    note.id,
  );
  const revisions = await request(
    `/notes/${note.id}/revisions`,
    undefined,
    alice.cookie,
  );
  assert.ok(revisions.data.length > 0);
  assert.equal(
    (
      await request(
        `/notes/${note.id}/revisions/${revisions.data[0].id}/copy`,
        {},
        alice.cookie,
      )
    ).status,
    200,
  );
  let disconnected = false;
  b.provider.on("disconnect", () => {
    disconnected = true;
  });
  await request(
    `/teams/${team.data.id}/members/${bob.data.id}`,
    undefined,
    alice.cookie,
    "DELETE",
  );
  await waitFor(() => disconnected);
  assert.equal(
    (await request(`/notes/${note.id}/comments`, undefined, bob.cookie)).status,
    404,
  );
});
test("a logged-in outsider cannot subscribe to another user’s document", async () => {
  const owner = await register("Owner"),
    outsider = await register("Outsider");
  const note = await request("/notes", { title: "Restricted" }, owner.cookie);
  const c = connect(note.data.id, outsider.cookie);
  let denied = false;
  c.provider.on("authenticationFailed", () => {
    denied = true;
  });
  await waitFor(() => denied);
  assert.equal(c.provider.isSynced, false);
});

test("templates are initialized once on the server and whiteboard changes persist", async () => {
  const owner = await register("Templates");
  const { data: note } = await request(
    "/notes",
    { title: "Planning", template: "meeting" },
    owner.cookie,
  );
  const a = connect(note.id, owner.cookie);
  const b = connect(note.id, owner.cookie);
  await waitFor(() => a.provider.isSynced && b.provider.isSynced);
  const content = a.doc.getXmlFragment("default").toString();
  assert.ok(content.includes("On the agenda"));
  assert.equal(content.split("On the agenda").length, 2);
  assert.equal(content, b.doc.getXmlFragment("default").toString());
  const { data: board } = await request(
    "/notes",
    { title: "Ideas", kind: "board" },
    owner.cookie,
  );
  const drawing = connect(board.id, owner.cookie);
  await waitFor(() => drawing.provider.isSynced);
  drawing.doc
    .getMap("shapes")
    .set("one", {
      id: "one",
      type: "sticky",
      x: 20,
      y: 30,
      w: 190,
      h: 130,
      text: "A fresh perspective",
      color: "#c2cfa7",
    });
  await waitFor(async () => {
    const result = await request(
      "/notes?q=perspective",
      undefined,
      owner.cookie,
    );
    return result.data.some((n) => n.id === board.id);
  });
  const { rows } = await (embedded || sql).query(
    "SELECT state FROM notes WHERE id=$1",
    [board.id],
  );
  const persisted = new Y.Doc();
  Y.applyUpdate(persisted, rows[0].state);
  assert.equal(
    persisted.getMap("shapes").get("one").text,
    "A fresh perspective",
  );
  persisted.destroy();
});
