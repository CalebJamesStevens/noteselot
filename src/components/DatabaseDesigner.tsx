import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import * as Y from "yjs";
import { Database, Download, Link2, Plus, Trash2 } from "lucide-react";
import { createId } from "../id";
import { download } from "../api";

type Cardinality = "one" | "zero-one" | "many" | "zero-many";
type Column = { id: string; name: string; type: string; primary: boolean; nullable: boolean };
type Table = { id: string; name: string; x: number; y: number; columns: Column[] };
type Relation = {
  id: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  fromCard: Cardinality;
  toCard: Cardinality;
};
type MapValue = Y.Map<unknown>;
const types = ["uuid", "text", "varchar(255)", "integer", "bigint", "boolean", "date", "timestamp", "timestamptz", "numeric(12,2)", "jsonb"];
const cards: { value: Cardinality; label: string }[] = [
  { value: "one", label: "Exactly one (1)" },
  { value: "zero-one", label: "Zero or one (0..1)" },
  { value: "many", label: "One or many (1..N)" },
  { value: "zero-many", label: "Zero or many (0..N)" },
];

function newColumn(name = "id", primary = false): MapValue {
  const value = new Y.Map<unknown>();
  value.set("id", createId());
  value.set("name", name);
  value.set("type", primary ? "uuid" : "text");
  value.set("primary", primary);
  value.set("nullable", !primary);
  return value;
}
function columnState(c: MapValue): Column {
  return {
    id: String(c.get("id")),
    name: String(c.get("name") ?? ""),
    type: String(c.get("type") ?? "text"),
    primary: !!c.get("primary"),
    nullable: !!c.get("nullable"),
  };
}
function tableState(id: string, value: MapValue): Table {
  const columns = value.get("columns") as Y.Array<MapValue> | undefined;
  return {
    id,
    name: String(value.get("name") ?? "Untitled"),
    x: Number(value.get("x") ?? 120),
    y: Number(value.get("y") ?? 120),
    columns: columns ? columns.toArray().map(columnState) : [],
  };
}
function relationState(id: string, value: MapValue): Relation {
  return {
    id,
    fromTable: String(value.get("fromTable") ?? ""),
    fromColumn: String(value.get("fromColumn") ?? ""),
    toTable: String(value.get("toTable") ?? ""),
    toColumn: String(value.get("toColumn") ?? ""),
    fromCard: (value.get("fromCard") as Cardinality) || "one",
    toCard: (value.get("toCard") as Cardinality) || "zero-many",
  };
}
function quote(name: string) {
  return '"' + name.replace(/"/g, '""') + '"';
}
export function generateSQL(tables: Table[], relations: Relation[]): string {
  const statements: string[] = ["-- Noteselot database design (PostgreSQL)", "-- Review the schema before executing it."];
  for (const table of tables) {
    const definitions = table.columns.map((col) => {
      const type = types.includes(col.type) ? col.type : "text";
      return "  " + quote(col.name) + " " + type + (col.primary ? " PRIMARY KEY" : col.nullable ? "" : " NOT NULL");
    });
    statements.push("CREATE TABLE " + quote(table.name) + " (\n" + definitions.join(",\n") + "\n);");
  }
  for (const r of relations) {
    const parent = tables.find((t) => t.id === r.fromTable);
    const child = tables.find((t) => t.id === r.toTable);
    const parentColumn = parent?.columns.find((c) => c.id === r.fromColumn);
    const childColumn = child?.columns.find((c) => c.id === r.toColumn);
    if (!parent || !child || !parentColumn || !childColumn) continue;
    statements.push(
      "ALTER TABLE " + quote(child.name) + " ADD FOREIGN KEY (" + quote(childColumn.name) +
      ") REFERENCES " + quote(parent.name) + " (" + quote(parentColumn.name) + ");",
    );
  }
  return statements.join("\n\n") + "\n";
}
function endpoint(table: Table, columnId: string, right: boolean) {
  const index = Math.max(0, table.columns.findIndex((c) => c.id === columnId));
  return { x: table.x + (right ? 236 : 0), y: table.y + 42 + index * 29 + 15 };
}
function CardinalityMark({ x, y, dir, kind }: { x: number; y: number; dir: number; kind: Cardinality }) {
  const many = kind === "many" || kind === "zero-many";
  const optional = kind === "zero-one" || kind === "zero-many";
  const inner = x + dir * 9;
  const outer = x + dir * 23;
  return (
    <g stroke="currentColor" strokeWidth="2" fill="none" pointerEvents="none">
      {many ? (
        <>
          <path d={"M " + inner + " " + (y - 8) + " L " + x + " " + y + " L " + inner + " " + (y + 8)} />
          <line x1={inner} y1={y - 8} x2={inner} y2={y + 8} />
        </>
      ) : (
        <line x1={inner} y1={y - 8} x2={inner} y2={y + 8} />
      )}
      {optional ? (
        <circle cx={outer} cy={y} r="4.5" fill="var(--panel, var(--bg))" />
      ) : (
        <line x1={outer} y1={y - 8} x2={outer} y2={y + 8} />
      )}
    </g>
  );
}

export default function DatabaseDesigner({ doc, title }: { doc: Y.Doc; title: string }) {
  const tableStore = useMemo(() => doc.getMap<MapValue>("erd-tables"), [doc]);
  const relationStore = useMemo(() => doc.getMap<MapValue>("erd-relations"), [doc]);
  const snapshot = () => ({
    tables: Array.from(tableStore.entries()).map(([id, value]) => tableState(id, value)),
    relations: Array.from(relationStore.entries()).map(([id, value]) => relationState(id, value)),
  });
  const [model, setModel] = useState(snapshot);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedRelation, setSelectedRelation] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const drag = useRef<{ id: string; x: number; y: number; pointerX: number; pointerY: number } | null>(null);
  useEffect(() => {
    const update = () => setModel(snapshot());
    tableStore.observeDeep(update);
    relationStore.observeDeep(update);
    return () => {
      tableStore.unobserveDeep(update);
      relationStore.unobserveDeep(update);
    };
  }, [tableStore, relationStore]);
  const active = model.tables.find((t) => t.id === selected);
  const link = model.relations.find((r) => r.id === selectedRelation);
  const getTable = (id: string) => tableStore.get(id);
  const getRelation = (id: string) => relationStore.get(id);
  function addTable() {
    const id = createId();
    const table = new Y.Map<unknown>();
    const columns = new Y.Array<MapValue>();
    columns.push([newColumn("id", true)]);
    table.set("name", "new_table_" + (model.tables.length + 1));
    table.set("x", 100 + (model.tables.length % 4) * 280);
    table.set("y", 100 + Math.floor(model.tables.length / 4) * 280);
    table.set("columns", columns);
    tableStore.set(id, table);
    setSelected(id);
    setSelectedRelation(null);
  }
  function addColumn(id: string) {
    const columns = getTable(id)?.get("columns") as Y.Array<MapValue> | undefined;
    if (columns) columns.push([newColumn("column_" + (columns.length + 1))]);
  }
  function editColumn(tableId: string, columnId: string, key: keyof Column, value: unknown) {
    const columns = getTable(tableId)?.get("columns") as Y.Array<MapValue> | undefined;
    const column = columns?.toArray().find((c) => c.get("id") === columnId);
    if (!column) return;
    doc.transact(() => {
      column.set(key, value);
      if (key === "primary" && value === true) column.set("nullable", false);
    });
  }
  function removeColumn(tableId: string, columnId: string) {
    const columns = getTable(tableId)?.get("columns") as Y.Array<MapValue> | undefined;
    const index = columns?.toArray().findIndex((c) => c.get("id") === columnId) ?? -1;
    if (index < 0) return;
    doc.transact(() => {
      columns?.delete(index, 1);
      for (const [id, relation] of relationStore.entries()) {
        if ((relation.get("fromTable") === tableId && relation.get("fromColumn") === columnId) ||
            (relation.get("toTable") === tableId && relation.get("toColumn") === columnId)) relationStore.delete(id);
      }
    });
  }
  function removeTable(id: string) {
    if (!confirm("Remove this table and its relationships?")) return;
    doc.transact(() => {
      tableStore.delete(id);
      for (const [relId, rel] of relationStore.entries()) {
        if (rel.get("fromTable") === id || rel.get("toTable") === id) relationStore.delete(relId);
      }
    });
    setSelected(null);
  }
  function addRelation() {
    if (model.tables.length < 2) {
      setFeedback("Create two tables before adding a relationship.");
      return;
    }
    const from = model.tables[0], to = model.tables[1], id = createId();
    const rel = new Y.Map<unknown>();
    rel.set("fromTable", from.id);
    rel.set("fromColumn", from.columns.find((c) => c.primary)?.id || from.columns[0]?.id || "");
    rel.set("toTable", to.id);
    rel.set("toColumn", to.columns.find((c) => !c.primary)?.id || to.columns[0]?.id || "");
    rel.set("fromCard", "one");
    rel.set("toCard", "zero-many");
    relationStore.set(id, rel);
    setSelectedRelation(id);
    setSelected(null);
    setFeedback("");
  }
  function moveTable(event: PointerEvent<HTMLElement>) {
    if (!drag.current) return;
    const d = drag.current;
    const table = getTable(d.id);
    if (!table) return;
    doc.transact(() => {
      table.set("x", Math.max(8, d.x + event.clientX - d.pointerX));
      table.set("y", Math.max(8, d.y + event.clientY - d.pointerY));
    });
  }
  function exportJSON() {
    download(title + ".erd.json", JSON.stringify({ version: 1, ...model }, null, 2), "application/json");
  }
  return (
    <div className="erd-planner">
      <div className="erd-toolbar">
        <span><Database size={17} /> Database design</span>
        <button onClick={addTable}><Plus size={15} /> Table</button>
        <button onClick={addRelation}><Link2 size={15} /> Relationship</button>
        <button onClick={exportJSON}><Download size={15} /> JSON</button>
        <button onClick={() => download(title + ".sql", generateSQL(model.tables, model.relations), "text/plain")}>
          <Download size={15} /> PostgreSQL SQL
        </button>
      </div>
      {feedback && <p className="erd-feedback" role="status">{feedback}</p>}
      <div className="erd-layout">
        <div className="erd-scroll">
          <div className="erd-stage">
            <svg className="erd-lines" width="1600" height="1050" viewBox="0 0 1600 1050" aria-label="Crow's foot relationships">
              {model.relations.map((r) => {
                const from = model.tables.find((t) => t.id === r.fromTable);
                const to = model.tables.find((t) => t.id === r.toTable);
                if (!from || !to) return null;
                const right = from.x + 118 < to.x + 118;
                const a = endpoint(from, r.fromColumn, right);
                const b = endpoint(to, r.toColumn, !right);
                const dx = right ? 1 : -1;
                return (
                  <g key={r.id} className={selectedRelation === r.id ? "erd-line selected" : "erd-line"}
                    onClick={() => { setSelectedRelation(r.id); setSelected(null); }}>
                    <path d={"M " + a.x + " " + a.y + " C " + (a.x + dx * 85) + " " + a.y + ", " + (b.x - dx * 85) + " " + b.y + ", " + b.x + " " + b.y}
                      fill="none" stroke="currentColor" strokeWidth="2" />
                    <CardinalityMark x={a.x} y={a.y} dir={dx} kind={r.fromCard} />
                    <CardinalityMark x={b.x} y={b.y} dir={-dx} kind={r.toCard} />
                    <path d={"M " + a.x + " " + a.y + " C " + (a.x + dx * 85) + " " + a.y + ", " + (b.x - dx * 85) + " " + b.y + ", " + b.x + " " + b.y}
                      fill="none" stroke="transparent" strokeWidth="16" />
                  </g>
                );
              })}
            </svg>
            {model.tables.map((table) => (
              <article key={table.id} className={selected === table.id ? "erd-table selected" : "erd-table"}
                style={{ left: table.x, top: table.y }}
                onClick={() => { setSelected(table.id); setSelectedRelation(null); }}>
                <header onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  drag.current = { id: table.id, x: table.x, y: table.y, pointerX: e.clientX, pointerY: e.clientY };
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setSelected(table.id);
                  setSelectedRelation(null);
                }} onPointerMove={moveTable} onPointerUp={() => { drag.current = null; }}
                  onPointerCancel={() => { drag.current = null; }}>
                  <Database size={15} /> <strong>{table.name}</strong>
                </header>
                <div className="erd-table-columns">
                  {table.columns.map((col) => (
                    <div className="erd-table-column" key={col.id}>
                      <span className="erd-key">{col.primary ? "PK" : ""}</span>
                      <span>{col.name}</span>
                      <small>{col.type}</small>
                    </div>
                  ))}
                  {!table.columns.length && <p>No columns</p>}
                </div>
              </article>
            ))}
            {!model.tables.length && (
              <div className="erd-empty">Create your first table to begin planning a database.</div>
            )}
          </div>
        </div>
        <aside className="erd-inspector">
          {active ? (
            <>
              <h3>Table properties</h3>
              <label>Table name<input value={active.name} maxLength={80} onChange={(e) => getTable(active.id)?.set("name", e.target.value)} /></label>
              <div className="erd-inspector-heading">
                <h4>Columns</h4>
                <button onClick={() => addColumn(active.id)}><Plus size={15} /> Add</button>
              </div>
              {active.columns.map((col) => (
                <div className="erd-column-form" key={col.id}>
                  <div className="erd-field-row">
                    <input aria-label="Column name" value={col.name} maxLength={80}
                      onChange={(e) => editColumn(active.id, col.id, "name", e.target.value)} />
                    <button aria-label={"Remove column " + col.name} title="Remove column"
                      onClick={() => removeColumn(active.id, col.id)}><Trash2 size={14} /></button>
                  </div>
                  <select aria-label={"Type for " + col.name} value={col.type}
                    onChange={(e) => editColumn(active.id, col.id, "type", e.target.value)}>
                    {types.map((type) => <option key={type}>{type}</option>)}
                  </select>
                  <div className="erd-field-row">
                    <label><input type="checkbox" checked={col.primary}
                      onChange={(e) => editColumn(active.id, col.id, "primary", e.target.checked)} /> Primary key</label>
                    <label><input type="checkbox" checked={col.nullable} disabled={col.primary}
                      onChange={(e) => editColumn(active.id, col.id, "nullable", e.target.checked)} /> Nullable</label>
                  </div>
                </div>
              ))}
              <button className="erd-danger" onClick={() => removeTable(active.id)}><Trash2 size={14} /> Delete table</button>
            </>
          ) : link ? (
            <>
              <h3>Relationship</h3>
              {(["from", "to"] as const).map((side) => {
                const tableId = side === "from" ? link.fromTable : link.toTable;
                const columnId = side === "from" ? link.fromColumn : link.toColumn;
                const table = model.tables.find((t) => t.id === tableId);
                return (
                  <div className="erd-relation-group" key={side}>
                    <h4>{side === "from" ? "Referenced table" : "Referencing table"}</h4>
                    <label>Table
                      <select value={tableId} onChange={(e) => {
                        const next = model.tables.find((t) => t.id === e.target.value);
                        doc.transact(() => {
                          getRelation(link.id)?.set(side + "Table", e.target.value);
                          getRelation(link.id)?.set(side + "Column", next?.columns[0]?.id || "");
                        });
                      }}>
                        {model.tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </label>
                    <label>Column
                      <select value={columnId} onChange={(e) => getRelation(link.id)?.set(side + "Column", e.target.value)}>
                        {table?.columns.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}
                      </select>
                    </label>
                    <label>Cardinality
                      <select value={side === "from" ? link.fromCard : link.toCard}
                        onChange={(e) => getRelation(link.id)?.set(side + "Card", e.target.value)}>
                        {cards.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </label>
                  </div>
                );
              })}
              <p className="erd-hint">The referencing column becomes a foreign key in exported SQL.</p>
              <button className="erd-danger" onClick={() => { relationStore.delete(link.id); setSelectedRelation(null); }}>
                <Trash2 size={14} /> Delete relationship
              </button>
            </>
          ) : (
            <>
              <h3>Design inspector</h3>
              <p>Select a table to edit its columns, or select a relationship to set cardinality and foreign keys.</p>
              <p className="erd-hint">Every change is synchronized through your Noteselot workspace and saved in PostgreSQL.</p>
              <h4>Relationships</h4>
              {model.relations.map((r) => (
                <button className="erd-link-choice" key={r.id} onClick={() => setSelectedRelation(r.id)}>
                  {model.tables.find((t) => t.id === r.fromTable)?.name || "Unknown"}
                  {" → "}
                  {model.tables.find((t) => t.id === r.toTable)?.name || "Unknown"}
                </button>
              ))}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
