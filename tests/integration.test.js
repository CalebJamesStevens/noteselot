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


test("native ERD plans synchronize between coworkers and persist in PostgreSQL", async () => {
  const alice = await register("SchemaOwner"), bob = await register("SchemaPeer");
  const team = await request("/teams", { name: "Database planning" }, alice.cookie);
  assert.equal((await request("/teams/" + team.data.id + "/members", { email: bob.data.email }, alice.cookie)).status, 200);
  const result = await request("/notes", { title: "Customer database", kind: "erd", team_id: team.data.id }, alice.cookie);
  assert.equal(result.status, 201);
  const id = result.data.id;
  const a = connect(id, alice.cookie), b = connect(id, bob.cookie);
  await waitFor(() => a.provider.isSynced && b.provider.isSynced);
  // The optional IBM i dialect and library are shared Yjs document settings.
  a.doc.getMap("erd-settings").set("dialect", "db2i");
  a.doc.getMap("erd-settings").set("schema", "WEBTEST");
  await waitFor(() => b.doc.getMap("erd-settings").get("dialect") === "db2i"
    && b.doc.getMap("erd-settings").get("schema") === "WEBTEST");
  const table = new Y.Map();
  table.set("name", "customers");
  table.set("x", 120);
  table.set("y", 120);
  const columns = new Y.Array();
  const col = new Y.Map();
  col.set("id", "column-a");
  col.set("name", "id");
  col.set("type", "uuid");
  col.set("primary", true);
  col.set("nullable", false);
  columns.push([col]);
  table.set("columns", columns);
  a.doc.getMap("erd-tables").set("table-a", table);
  await waitFor(() => b.doc.getMap("erd-tables").get("table-a")?.get("name") === "customers");
  // Architecture notes, API endpoints, BCE nodes and their connections travel with the ERD.
  const api = new Y.Map();
  const apiTitle = new Y.Text();
  apiTitle.insert(0, "Customer API");
  const apiPath = new Y.Text();
  apiPath.insert(0, "/api/customers");
  const apiBody = new Y.Text();
  apiBody.insert(0, "Return active customers");
  api.set("kind", "api");
  api.set("title", apiTitle);
  api.set("path", apiPath);
  api.set("body", apiBody);
  api.set("method", "GET");
  api.set("x", 370); api.set("y", 150); api.set("w", 260); api.set("h", 170);
  a.doc.getMap("erd-annotations").set("api-a", api);
  await waitFor(() => b.doc.getMap("erd-annotations").get("api-a")?.get("title")?.toString() === "Customer API");
  const peerBody = b.doc.getMap("erd-annotations").get("api-a").get("body");
  peerBody.insert(peerBody.length, " via service");
  await waitFor(() => a.doc.getMap("erd-annotations").get("api-a")?.get("body")?.toString().includes("via service"));
  const boundary = new Y.Map();
  const boundaryTitle = new Y.Text();
  boundaryTitle.insert(0, "External boundary");
  boundary.set("kind", "boundary"); boundary.set("title", boundaryTitle);
  boundary.set("x", 100); boundary.set("y", 300);
  a.doc.getMap("erd-annotations").set("boundary-a", boundary);
  const connection = new Y.Map();
  const connectionLabel = new Y.Text();
  connectionLabel.insert(0, "uses");
  connection.set("from", "api-a"); connection.set("to", "table-a");
  connection.set("label", connectionLabel);
  a.doc.getMap("erd-architecture-links").set("flow-a", connection);
  await waitFor(() => b.doc.getMap("erd-architecture-links").get("flow-a")?.get("label")?.toString() === "uses");
  const peerTable = b.doc.getMap("erd-tables").get("table-a");
  peerTable.set("name", "client_accounts");
  await waitFor(() => a.doc.getMap("erd-tables").get("table-a")?.get("name") === "client_accounts");
  await waitFor(async () => {
    const { rows } = await sql.query("SELECT state, search_text FROM notes WHERE id=$1", [id]);
    if (!rows[0]?.state) return false;
    const restored = new Y.Doc();
    Y.applyUpdate(restored, rows[0].state);
    const correct = restored.getMap("erd-tables").get("table-a")?.get("name") === "client_accounts"
      && restored.getMap("erd-settings").get("dialect") === "db2i"
      && restored.getMap("erd-settings").get("schema") === "WEBTEST"
      && rows[0].search_text.includes("client_accounts")
      && rows[0].search_text.includes("/api/customers")
      && rows[0].search_text.includes("Return active customers via service")
      && rows[0].search_text.includes("External boundary")
      && restored.getMap("erd-annotations").get("api-a")?.get("body")?.toString().includes("via service")
      && restored.getMap("erd-architecture-links").get("flow-a")?.get("to") === "table-a";
    restored.destroy();
    return correct;
  });
  assert.equal((await request("/notes/" + id + "/comments", undefined, bob.cookie)).status, 200);
  const outsider = await register("SchemaOutsider");
  assert.equal((await request("/notes/" + id + "/comments", undefined, outsider.cookie)).status, 404);
});


test("personal ERD can be imported as a team copy or moved in place with access controls", async () => {
  const owner = await register("TransferOwner"), member = await register("TransferMember");
  const outsider = await register("TransferOutsider");
  const team = await request("/teams", {name:"Diagram transfer team"}, owner.cookie);
  assert.equal(team.status,201);
  assert.equal((await request("/teams/" + team.data.id + "/members",
    {email:member.data.email},owner.cookie)).status,200);
  const personal = await request("/notes",
    {title:"My private design",kind:"erd",team_id:null},owner.cookie);
  assert.equal(personal.status,201);
  const originalId = personal.data.id;
  assert.equal((await request("/notes/" + originalId + "/comments",
    undefined,member.cookie)).status,404);

  const editor = connect(originalId, owner.cookie);
  await waitFor(() => editor.provider.isSynced);
  const value = new Y.Map();
  value.set("name","PERSONAL_TABLE");
  value.set("x",175); value.set("y",230);
  const cols = new Y.Array();
  const col = new Y.Map();
  col.set("id","personal-key"); col.set("name","ID"); col.set("type","BIGINT");
  col.set("primary",true); col.set("nullable",false);
  cols.push([col]); value.set("columns",cols);
  editor.doc.getMap("erd-tables").set("personal-table",value);
  await waitFor(async () => {
    const {rows} = await sql.query("SELECT state FROM notes WHERE id=$1",[originalId]);
    if (!rows[0]?.state) return false;
    const restored = new Y.Doc();
    Y.applyUpdate(restored,rows[0].state);
    const result = restored.getMap("erd-tables").get("personal-table")?.get("name") === "PERSONAL_TABLE";
    restored.destroy();
    return result;
  });

  const design = {
    version:3,dialect:"db2i",schema:"WEBTEST",
    tables:[{id:"tb1",name:"CUSTOMERS",x:200,y:250,columns:[
      {id:"col1",name:"ID",type:"BIGINT",primary:true,nullable:false},
    ]}],
    relations:[],
    annotations:[{id:"an1",kind:"note",x:400,y:200,w:240,h:145,title:"Team notes",
      body:"Documented behavior",method:"GET",path:""}],
    architectureConnections:[{id:"al1",from:"an1",to:"tb1",label:"documents"}],
  };
  const forbiddenImport = await request("/erd/import",
    {title:"Not authorized",team_id:team.data.id,design},outsider.cookie);
  assert.equal(forbiddenImport.status,403);
  const invalidImport = await request("/erd/import",
    {title:"Bad",team_id:team.data.id,design:{version:999,tables:[],relations:[]}},owner.cookie);
  assert.equal(invalidImport.status,400);
  const imported = await request("/erd/import",
    {title:"Team copy",team_id:team.data.id,design},owner.cookie);
  assert.equal(imported.status,201);
  assert.notEqual(imported.data.id,originalId);
  assert.equal(imported.data.team_id,team.data.id);
  assert.equal((await request("/notes/" + imported.data.id + "/comments",
    undefined,member.cookie)).status,200);
  assert.equal((await request("/notes/" + imported.data.id + "/comments",
    undefined,outsider.cookie)).status,404);
  const {rows:copyRows} = await sql.query("SELECT state FROM notes WHERE id=$1",[imported.data.id]);
  const restored = new Y.Doc();
  Y.applyUpdate(restored,copyRows[0].state);
  assert.equal(restored.getMap("erd-tables").get("tb1").get("name"),"CUSTOMERS");
  assert.equal(restored.getMap("erd-annotations").get("an1").get("body").toString(),"Documented behavior");
  assert.equal(restored.getMap("erd-architecture-links").get("al1").get("to"),"tb1");
  restored.destroy();
  const stillPersonal = await sql.query("SELECT team_id FROM notes WHERE id=$1",[originalId]);
  assert.equal(stillPersonal.rows[0].team_id,null);

  const denied = await request("/notes/" + originalId + "/move-to-team",
    {team_id:team.data.id},member.cookie);
  assert.equal(denied.status,404);
  const outsiderTeam = await request("/teams",{name:"Other team"},outsider.cookie);
  const noMembership = await request("/notes/" + originalId + "/move-to-team",
    {team_id:outsiderTeam.data.id},owner.cookie);
  assert.equal(noMembership.status,403);
  const moved = await request("/notes/" + originalId + "/move-to-team",
    {team_id:team.data.id},owner.cookie);
  assert.equal(moved.status,200);
  assert.equal(moved.data.id,originalId);
  assert.equal(moved.data.team_id,team.data.id);
  assert.equal((await request("/notes/" + originalId + "/comments",
    undefined,member.cookie)).status,200);
  assert.equal((await request("/notes/" + originalId + "/comments",
    undefined,outsider.cookie)).status,404);
  const repeat = await request("/notes/" + originalId + "/move-to-team",
    {team_id:team.data.id},owner.cookie);
  assert.equal(repeat.status,403);
  const persisted = await sql.query("SELECT state,team_id FROM notes WHERE id=$1",[originalId]);
  assert.equal(persisted.rows[0].team_id,team.data.id);
  const verified = new Y.Doc();
  Y.applyUpdate(verified,persisted.rows[0].state);
  assert.equal(verified.getMap("erd-tables").get("personal-table").get("name"),"PERSONAL_TABLE");
  verified.destroy();
});
