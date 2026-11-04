import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { validateDesign, buildImportedDesign } from "../server/erd-import.js";

function payload(version = 3) {
  return {
    version, dialect: "db2i", schema: "WEBTEST",
    tables: [
      { id: "t1", name: "CUSTOMERS", x: 200, y: 150, systemName: "", columns: [
        { id: "c1", name: "ID", type: "BIGINT", primary: true, nullable: false, systemName: "" },
        { id: "c2", name: "NAME", type: "VARCHAR(255)", primary: false, nullable: true, ccsid: 37 },
      ] },
      { id: "t2", name: "ORDERS", x: 650, y: 250, columns: [
        { id: "c3", name: "ID", type: "BIGINT", primary: true, nullable: false },
        { id: "c4", name: "CUSTOMER_ID", type: "BIGINT", primary: false, nullable: false },
      ] },
    ],
    relations: [{
      id: "r1", fromTable: "t1", fromColumn: "c1", toTable: "t2", toColumn: "c4",
      fromCard: "one", toCard: "zero-many",
    }],
    annotations: [{
      id: "a1", kind: "api", x: 440, y: 30, w: 260, h: 170,
      title: "Customer service", body: "Returns customer records", method: "GET", path: "/api/customers",
    }],
    architectureConnections: [{
      id: "l1", from: "a1", to: "t1", label: "queries",
    }],
  };
}
test("versions 1, 2 and 3 import with compatible defaults", () => {
  for (const version of [1, 2, 3]) {
    const raw = payload(version);
    if (version === 1) {
      delete raw.dialect; delete raw.schema; delete raw.annotations; delete raw.architectureConnections;
    }
    const parsed = validateDesign(raw);
    assert.equal(parsed.version, version);
    assert.equal(parsed.dialect, version === 1 ? "postgres" : "db2i");
    assert.equal(parsed.annotations.length, version === 1 ? 0 : 1);
  }
});
test("import reconstructs positions, fields, keys, Db2 settings, API annotations and connectors", () => {
  const imported = buildImportedDesign(payload());
  const doc = new Y.Doc();
  Y.applyUpdate(doc, imported.state);
  const settings = doc.getMap("erd-settings");
  assert.equal(settings.get("dialect"), "db2i");
  assert.equal(settings.get("schema"), "WEBTEST");
  const t1 = doc.getMap("erd-tables").get("t1");
  assert.equal(t1.get("x"), 200);
  assert.equal(t1.get("columns").toArray()[1].get("ccsid"), 37);
  assert.equal(doc.getMap("erd-relations").get("r1").get("toColumn"), "c4");
  const api = doc.getMap("erd-annotations").get("a1");
  assert.equal(api.get("title").toString(), "Customer service");
  assert.equal(api.get("path").toString(), "/api/customers");
  assert.equal(doc.getMap("erd-architecture-links").get("l1").get("to"), "t1");
  assert.ok(imported.search.includes("Customer service"));
  assert.deepEqual(imported.summary, {tables:2,relations:1,annotations:1,connectors:1});
  doc.destroy();
});
test("malformed JSON, broken references, duplicate IDs and unexpected versions are rejected", () => {
  assert.throws(() => validateDesign({version: 99, tables:[], relations:[]}), /Not a valid/);
  assert.throws(() => validateDesign({data:{tables:[],relations:[]}}), /Not a valid/);
  const bad = payload();
  bad.relations[0].toColumn = "missing-column";
  assert.throws(() => validateDesign(bad), /missing table or column/);
  const duplicate = payload();
  duplicate.tables[1].id = duplicate.tables[0].id;
  assert.throws(() => validateDesign(duplicate), /Duplicate table/);
  const broken = payload();
  broken.architectureConnections[0].to = "missing-node";
  assert.throws(() => validateDesign(broken), /missing diagram element/);
});


const ONE_PIXEL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+bN1sAAAAASUVORK5CYII=";
test("pictures survive Noteselot JSON import and the shared Yjs state", () => {
  const design = payload();
  design.annotations.push({
    id:"img1", kind:"image", x:540, y:390, w:320, h:220,
    title:"API screenshot", body:"A reference picture", path:"", method:"GET",
    imageData:ONE_PIXEL_PNG,
  });
  design.architectureConnections.push({id:"image-connection",from:"img1",to:"t1",label:"illustrates"});
  const imported = buildImportedDesign(design);
  assert.deepEqual(imported.summary,{tables:2,relations:1,annotations:2,connectors:2});
  const restored = new Y.Doc();
  Y.applyUpdate(restored, imported.state);
  const picture = restored.getMap("erd-annotations").get("img1");
  assert.equal(picture.get("kind"),"image");
  assert.equal(picture.get("imageData"),ONE_PIXEL_PNG);
  assert.equal(picture.get("x"),540);
  assert.equal(picture.get("h"),220);
  assert.equal(picture.get("title").toString(),"API screenshot");
  assert.equal(restored.getMap("erd-architecture-links").get("image-connection").get("from"),"img1");
  restored.destroy();
});

test("picture import refuses SVG, malicious data URLs, spoofed formats and missing content", () => {
  const src = payload();
  src.annotations.push({
    id:"img1",kind:"image",x:0,y:0,w:300,h:200,title:"Picture",
    body:"",method:"GET",path:"",imageData:ONE_PIXEL_PNG,
  });
  assert.doesNotThrow(() => validateDesign(src));
  src.annotations[1].imageData = "data:image/svg+xml;base64," + Buffer.from("<svg onload='alert(1)'/>").toString("base64");
  assert.throws(() => validateDesign(src), /Unsupported embedded picture/);
  src.annotations[1].imageData = "data:image/png;base64," + Buffer.from("<script>alert(1)</script>").toString("base64");
  assert.throws(() => validateDesign(src), /does not match/);
  src.annotations[1].imageData = "https://untrusted.example.com/pic.png";
  assert.throws(() => validateDesign(src), /Unsupported embedded picture/);
  src.annotations[1].imageData = "";
  assert.throws(() => validateDesign(src), /Unsupported embedded picture/);
  delete src.annotations[1].imageData;
  assert.throws(() => validateDesign(src), /Unsupported embedded picture/);
});

test("picture import enforces image count, type and encoded size budgets", () => {
  const src = payload();
  for(let i=0;i<9;i++) src.annotations.push({
    id:"img"+i,kind:"image",x:i,y:0,w:300,h:220,title:"Picture",body:"",method:"GET",path:"",
    imageData:ONE_PIXEL_PNG,
  });
  assert.throws(() => validateDesign(src), /storage limit/);
  src.annotations.length = 1;
  src.annotations[0].imageData = ONE_PIXEL_PNG;
  assert.throws(() => validateDesign(src), /Only picture elements/);
});


test("infinite-canvas coordinates survive JSON import without artificial page limits", () => {
  const raw = payload();
  raw.tables[0].x = -1_250_000;
  raw.tables[0].y = 2_650_000;
  raw.tables[1].x = 3_700_000;
  raw.tables[1].y = -5_800_000;
  raw.annotations[0].x = -6_700_000;
  raw.annotations[0].y = 4_300_000;
  assert.doesNotThrow(() => validateDesign(raw));
  const imported = buildImportedDesign(raw);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, imported.state);
  assert.equal(doc.getMap("erd-tables").get("t1").get("x"), -1_250_000);
  assert.equal(doc.getMap("erd-tables").get("t2").get("y"), -5_800_000);
  assert.equal(doc.getMap("erd-annotations").get("a1").get("x"), -6_700_000);
  doc.destroy();
  raw.tables[0].x = Infinity;
  assert.throws(() => validateDesign(raw), /valid Noteselot/);
});
