import { z } from "zod";
import * as Y from "yjs";

const identifier = z.string().min(1).max(120).regex(/^[\w-]+$/);
const name = z.string().min(1).max(200);
const text = z.string().max(5000);
const coordinate = z.number().finite().min(-10000).max(100000);
const column = z.object({
  id: identifier, name, type: z.string().min(1).max(100),
  primary: z.boolean(), nullable: z.boolean(),
  systemName: z.string().max(10).optional(),
  ccsid: z.number().int().min(0).max(65535).optional(),
}).strip();
const table = z.object({
  id: identifier, name, x: coordinate, y: coordinate,
  columns: z.array(column).max(200),
  systemName: z.string().max(10).optional(),
}).strip();
const cardinality = z.enum(["one", "zero-one", "many", "zero-many"]);
const relationship = z.object({
  id: identifier, fromTable: identifier, toTable: identifier,
  fromColumn: identifier, toColumn: identifier,
  fromCard: cardinality, toCard: cardinality,
}).strip();
const annotation = z.object({
  id: identifier, kind: z.enum(["note", "api", "boundary", "control", "entity"]),
  x: coordinate, y: coordinate,
  w: z.number().finite().min(40).max(2000),
  h: z.number().finite().min(30).max(2000),
  title: text, body: text, method: z.enum(["GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"]).default("GET"),
  path: z.string().max(240).default(""),
}).strip();
const link = z.object({
  id: identifier, from: identifier, to: identifier, label: z.string().max(120),
}).strip();

/** Noteselot-native .erd.json exports only. Does not accept the unrelated dineug format. */
const designSchema = z.object({
  version: z.union([z.literal(1),z.literal(2),z.literal(3)]),
  tables: z.array(table).max(200),
  relations: z.array(relationship).max(1000),
  dialect: z.enum(["postgres","db2i"]).default("postgres"),
  schema: z.string().max(10).default(""),
  annotations: z.array(annotation).max(300).default([]),
  architectureConnections: z.array(link).max(1000).default([]),
}).strip();

function ensureUnique(ids, label) {
  if (ids.length !== new Set(ids).size) throw new Error("Duplicate " + label + " identifiers in file.");
}
export function validateDesign(input) {
  const parsed = designSchema.safeParse(input);
  if (!parsed.success) throw new Error("Not a valid Noteselot .erd.json diagram (versions 1–3).");
  const design = parsed.data;
  ensureUnique(design.tables.map(t => t.id), "table");
  ensureUnique(design.relations.map(r => r.id), "relationship");
  ensureUnique(design.annotations.map(n => n.id), "annotation");
  ensureUnique(design.architectureConnections.map(l => l.id), "connector");
  const tables = new Map(design.tables.map(t => [t.id, new Map(t.columns.map(c => [c.id, c]))]));
  for (const table of design.tables) ensureUnique(table.columns.map(c => c.id), "column in " + table.name);
  const nodes = new Set([...design.tables.map(t => t.id), ...design.annotations.map(n => n.id)]);
  if (nodes.size !== design.tables.length + design.annotations.length)
    throw new Error("Diagram element IDs must be unique across tables and annotations.");
  for (const rel of design.relations) {
    if (!tables.get(rel.fromTable)?.has(rel.fromColumn) || !tables.get(rel.toTable)?.has(rel.toColumn))
      throw new Error("A database relationship refers to a missing table or column.");
  }
  for (const l of design.architectureConnections)
    if (!nodes.has(l.from) || !nodes.has(l.to))
      throw new Error("An architecture connection refers to a missing diagram element.");
  return design;
}
function mapOf(fields) {
  const map = new Y.Map();
  for (const [key,value] of Object.entries(fields)) if (value !== undefined) map.set(key,value);
  return map;
}
function sharedText(value) {
  const t = new Y.Text();
  if (value) t.insert(0,value);
  return t;
}
export function buildImportedDesign(input) {
  const design = validateDesign(input), doc = new Y.Doc();
  try {
    doc.transact(() => {
      doc.getMap("meta").set("initialized",true);
      const settings = doc.getMap("erd-settings");
      settings.set("dialect",design.dialect);
      settings.set("schema",design.schema);
      const tables = doc.getMap("erd-tables");
      for (const table of design.tables) {
        const columns = new Y.Array();
        const t = mapOf({name:table.name,x:table.x,y:table.y,systemName:table.systemName ?? ""});
        columns.push(table.columns.map(c => mapOf({
          id:c.id,name:c.name,type:c.type,primary:c.primary,nullable:c.nullable,
          systemName:c.systemName ?? "",ccsid:c.ccsid,
        })));
        t.set("columns",columns);
        tables.set(table.id,t);
      }
      const rels = doc.getMap("erd-relations");
      for (const r of design.relations) rels.set(r.id,mapOf(r));
      const annotations = doc.getMap("erd-annotations");
      for (const n of design.annotations) annotations.set(n.id,mapOf({
        kind:n.kind,x:n.x,y:n.y,w:n.w,h:n.h,method:n.method,
        title:sharedText(n.title),body:sharedText(n.body),path:sharedText(n.path),
      }));
      const links = doc.getMap("erd-architecture-links");
      for (const l of design.architectureConnections) links.set(l.id,mapOf({
        from:l.from,to:l.to,label:sharedText(l.label),
      }));
    });
    const search = [
      ...design.tables.flatMap(t => [t.name,...t.columns.map(c => c.name)]),
      ...design.annotations.flatMap(n => [n.title,n.body,n.path]),
      ...design.architectureConnections.map(l => l.label),
    ].join(" ").slice(0,200000);
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    if (state.length > 1024 * 1024) throw new Error("Imported diagram exceeds the 1 MB document limit.");
    return {state,search,summary:{tables:design.tables.length,relations:design.relations.length,annotations:design.annotations.length,connectors:design.architectureConnections.length}};
  } finally {
    doc.destroy();
  }
}
