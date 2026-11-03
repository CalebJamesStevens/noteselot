import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import * as Y from "yjs";
import { Database, Download, Link2, Minus, Plus, Scan, Trash2 } from "lucide-react";
import { createId } from "../id";
import { download } from "../api";
import { useERDAnnotations } from "./ERDAnnotations";
import { ERD_WIDTH, ERD_HEIGHT, anchoredScroll, clampZoom, fitZoom, stepZoom } from "../erd/viewport";

import { 
  dataTypes, db2iFieldPresets, defaultColumnType, generateSQL,
  type Dialect, type Cardinality, type Column, type Table, type Relation,
} from "../erd/dialects";

type MapValue = Y.Map<unknown>;
const cards: { value: Cardinality; label: string }[] = [
  { value: "one", label: "Exactly one (1)" },
  { value: "zero-one", label: "Zero or one (0..1)" },
  { value: "many", label: "One or many (1..N)" },
  { value: "zero-many", label: "Zero or many (0..N)" },
];
function newColumn(dialect: Dialect, name = "id", primary = false, type = defaultColumnType(dialect, primary)): MapValue {
  const value = new Y.Map<unknown>();
  value.set("id", createId());
  value.set("name", name);
  value.set("type", type);
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
    systemName: String(c.get("systemName") ?? ""),
    ccsid: typeof c.get("ccsid") === "number" ? Number(c.get("ccsid")) : undefined,
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
    systemName: String(value.get("systemName") ?? ""),
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
  const settings = useMemo(() => doc.getMap<unknown>("erd-settings"), [doc]);
  const snapshot = () => ({
    tables: Array.from(tableStore.entries()).map(([id, value]) => tableState(id, value)),
    relations: Array.from(relationStore.entries()).map(([id, value]) => relationState(id, value)),
    dialect: settings.get("dialect") === "db2i" ? "db2i" as Dialect : "postgres" as Dialect,
    schema: String(settings.get("schema") ?? ""),
  });
  const [model, setModel] = useState(snapshot);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingScrollRef = useRef<{left:number;top:number}|null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedRelation, setSelectedRelation] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const annotations = useERDAnnotations(doc, model.tables, selected, () => { setSelected(null); setSelectedRelation(null); }, zoom);
  const drag = useRef<{ id: string; x: number; y: number; pointerX: number; pointerY: number } | null>(null);
  useEffect(() => {
    const update = () => setModel(snapshot());
    tableStore.observeDeep(update);
    relationStore.observeDeep(update);
    settings.observeDeep(update);
    return () => {
      tableStore.unobserveDeep(update);
      relationStore.unobserveDeep(update);
      settings.unobserveDeep(update);
    };
  }, [tableStore, relationStore, settings]);
  useLayoutEffect(() => {
    const area = scrollRef.current;
    const pending = pendingScrollRef.current;
    if (!area || !pending) return;
    area.scrollLeft = Math.max(0, pending.left);
    area.scrollTop = Math.max(0, pending.top);
    pendingScrollRef.current = null;
  }, [zoom]);
  function zoomTo(nextValue: number, point?: {x:number;y:number}) {
    const area = scrollRef.current;
    if (!area) return;
    const before = zoomRef.current, next = clampZoom(nextValue);
    if (before === next) return;
    const anchor = point || {x: area.clientWidth/2, y: area.clientHeight/2};
    // Successive wheel events can arrive before React paints the previous zoom.
    // Anchor against the pending position instead of stale DOM scroll values.
    pendingScrollRef.current = anchoredScroll(before,next,
      pendingScrollRef.current || {left:area.scrollLeft,top:area.scrollTop},anchor);
    zoomRef.current = next;
    setZoom(next);
  }
  function fitToContent() {
    const area = scrollRef.current;
    if (!area) return;
    const shapes = [
      ...model.tables.map(table => ({
        x:table.x,y:table.y,width:236,height:36+table.columns.length*29,
      })),
      ...annotations.snapshot().annotations.map(item => ({
        x:item.x,y:item.y,width:item.w,height:item.h,
      })),
    ];
    const result = fitZoom(shapes,{width:area.clientWidth,height:area.clientHeight});
    if (result.zoom === zoomRef.current) {
      area.scrollLeft = Math.max(0,result.scroll.left);
      area.scrollTop = Math.max(0,result.scroll.top);
    } else {
      pendingScrollRef.current = result.scroll;
      zoomRef.current = result.zoom;
      setZoom(result.zoom);
    }
  }
  useEffect(() => {
    const area = scrollRef.current;
    if (!area) return;
    function wheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = area!.getBoundingClientRect();
      // Trackpad pinch and Ctrl/Cmd + wheel zoom around the pointer.
      const change = Math.exp(-event.deltaY * 0.004);
      zoomTo(zoomRef.current * change, {x:event.clientX-rect.left,y:event.clientY-rect.top});
    }
    area.addEventListener("wheel",wheel,{passive:false});
    return () => area.removeEventListener("wheel",wheel);
  }, []);
  const dialect = model.dialect;
  const active = model.tables.find((t) => t.id === selected);
  const link = model.relations.find((r) => r.id === selectedRelation);
  const getTable = (id: string) => tableStore.get(id);
  const getRelation = (id: string) => relationStore.get(id);
  function addTable() {
    const id = createId();
    const table = new Y.Map<unknown>();
    const columns = new Y.Array<MapValue>();
    columns.push([newColumn(dialect, dialect === "db2i" ? "ID" : "id", true)]);
    table.set("name", dialect === "db2i" ? "TABLE" + (model.tables.length + 1) : "new_table_" + (model.tables.length + 1));
    table.set("x", 100 + (model.tables.length % 4) * 280);
    table.set("y", 100 + Math.floor(model.tables.length / 4) * 280);
    table.set("columns", columns);
    tableStore.set(id, table);
    setSelected(id);
    setSelectedRelation(null);
  }
  function addColumn(id: string) {
    const columns = getTable(id)?.get("columns") as Y.Array<MapValue> | undefined;
    if (columns) columns.push([newColumn(dialect, (dialect === "db2i" ? "COL" : "column_") + (columns.length + 1))]);
  }
  function addDb2Preset(tableId: string, name: string, type: string) {
    const columns = getTable(tableId)?.get("columns") as Y.Array<MapValue> | undefined;
    if (!columns) return;
    const names = new Set(columns.toArray().map((c) => String(c.get("name")).toUpperCase()));
    let next = name;
    for (let i = 2; names.has(next.toUpperCase()); i++) next = name + "_" + i;
    columns.push([newColumn("db2i", next.toUpperCase(), false, type)]);
  }
  function editColumn(tableId: string, columnId: string, key: keyof Column, value: unknown) {
    const columns = getTable(tableId)?.get("columns") as Y.Array<MapValue> | undefined;
    const column = columns?.toArray().find((c) => c.get("id") === columnId);
    if (!column) return;
    doc.transact(() => {
      if (key === "ccsid" && value === undefined) column.delete(key);
      else column.set(key, value);
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
      annotations.removeReferences(id);
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
      table.set("x", Math.max(8, d.x + (event.clientX - d.pointerX) / zoomRef.current));
      table.set("y", Math.max(8, d.y + (event.clientY - d.pointerY) / zoomRef.current));
    });
  }
  function exportJSON() {
    download(title + ".erd.json", JSON.stringify({ version: 3, ...model, ...annotations.snapshot() }, null, 2), "application/json");
  }
  function exportDDL() {
    try {
      download(title + (dialect === "db2i" ? ".db2i.sql" : ".postgres.sql"),
        generateSQL(model.tables, model.relations, { dialect, schema: model.schema }), "text/plain");
      setFeedback("");
    } catch (error) {
      setFeedback("SQL export blocked: " + (error as Error).message);
    }
  }
  return (
    <div className="erd-planner">
      <div className="erd-toolbar">
        <span><Database size={17} /> Database design</span>
        <label className="erd-dialect-control">SQL target
          <select aria-label="Database SQL dialect" value={dialect} onChange={(e) => {
            const next = e.target.value as Dialect;
            settings.set("dialect", next);
            setFeedback(next === "db2i" ? "IBM i Db2 enabled. Review any existing PostgreSQL-specific column types before SQL export." : "");
          }}>
            <option value="postgres">PostgreSQL</option>
            <option value="db2i">IBM i Db2</option>
          </select>
        </label>
        <button onClick={addTable}><Plus size={15} /> Table</button>
        <button onClick={addRelation}><Link2 size={15} /> Relationship</button>
        {annotations.toolbar}
        <button onClick={exportJSON}><Download size={15} /> JSON</button>
        <button onClick={exportDDL}>
          <Download size={15} /> {dialect === "db2i" ? "IBM i Db2 SQL" : "PostgreSQL SQL"}
        </button>
        <div className="erd-zoom-controls" role="group" aria-label="Diagram zoom">
          <button type="button" aria-label="Zoom out" title="Zoom out" disabled={zoom <= 0.25}
            onClick={() => zoomTo(stepZoom(zoomRef.current,-1))}><Minus size={15}/></button>
          <output aria-live="polite" aria-label="Current zoom">{Math.round(zoom*100)}%</output>
          <button type="button" aria-label="Zoom in" title="Zoom in" disabled={zoom >= 2.5}
            onClick={() => zoomTo(stepZoom(zoomRef.current,1))}><Plus size={15}/></button>
          <button type="button" title="Show all diagram elements" aria-label="Fit diagram to view"
            onClick={fitToContent}><Scan size={15}/> Fit</button>
          <button type="button" title="Reset to 100% zoom" onClick={() => zoomTo(1)}>100%</button>
        </div>
      </div>
      {feedback && <p className="erd-feedback" role="status">{feedback}</p>}
      <div className="erd-layout">
        <div className="erd-scroll" ref={scrollRef} aria-label="Scrollable diagram canvas">
          <div className="erd-zoom-space" style={{width:ERD_WIDTH*zoom,height:ERD_HEIGHT*zoom}}>
          <div className="erd-stage" style={{transform:`scale(${zoom})`,transformOrigin:"top left"}}
            onDragOver={annotations.dragOverImage} onDrop={annotations.dropImage}>
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
                    onClick={() => { annotations.clearSelection(); setSelectedRelation(r.id); setSelected(null); }}>
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
            {annotations.layer}
            {model.tables.map((table) => (
              <article key={table.id} className={selected === table.id ? "erd-table selected" : "erd-table"}
                style={{ left: table.x, top: table.y }}
                onClick={() => { annotations.clearSelection(); setSelected(table.id); setSelectedRelation(null); }}>
                <header onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  drag.current = { id: table.id, x: table.x, y: table.y, pointerX: e.clientX, pointerY: e.clientY };
                  e.currentTarget.setPointerCapture(e.pointerId);
                  annotations.clearSelection();
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
        </div>
        <aside className="erd-inspector">
          {dialect === "db2i" && (
            <section className="erd-db2-settings">
              <h3>IBM i Db2 helpers</h3>
              <label>Library / SQL schema
                <input aria-label="IBM i library" placeholder="e.g. WEBTEST" value={model.schema}
                  maxLength={10} onChange={(e) => settings.set("schema", e.target.value.toUpperCase())} />
              </label>
              <p className="erd-hint">Optional library qualifier. Exports SQL naming (SCHEMA.TABLE), not DDS source or physical/logical file recovery.</p>
            </section>
          )}
          {annotations.inspector ? annotations.inspector : active ? (
            <>
              <h3>Table properties</h3>
              <label>Table name<input value={active.name} maxLength={80} onChange={(e) => getTable(active.id)?.set("name", e.target.value)} /></label>
              {dialect === "db2i" && (
                <label>Optional system file name (10 chars)
                  <input aria-label="IBM i system file name" maxLength={10} placeholder="e.g. CUSTMASTER"
                    value={active.systemName || ""} onChange={(e) => getTable(active.id)?.set("systemName", e.target.value.toUpperCase())} />
                  <small>Only use when the SQL table name is longer than 10 characters or otherwise not a valid system name.</small>
                </label>
              )}
              <div className="erd-inspector-heading">
                <h4>Columns</h4>
                <button onClick={() => addColumn(active.id)}><Plus size={15} /> Add</button>
              </div>
              {dialect === "db2i" && (
                <label>Quick add IBM i field
                  <select aria-label="IBM i field preset" value="" onChange={(e) => {
                    const preset = db2iFieldPresets.find((p) => p.type === e.target.value);
                    if (preset) addDb2Preset(active.id, preset.name, preset.type);
                  }}>
                    <option value="">Choose field template...</option>
                    {db2iFieldPresets.map((preset) => (
                      <option key={preset.type} value={preset.type}>{preset.label}</option>
                    ))}
                  </select>
                  <small>DECIMAL = DDS packed (P), NUMERIC = DDS zoned (S). Types remain editable.</small>
                </label>
              )}
              {active.columns.map((col) => (
                <div className="erd-column-form" key={col.id}>
                  <div className="erd-field-row">
                    <input aria-label="Column name" value={col.name} maxLength={80}
                      onChange={(e) => editColumn(active.id, col.id, "name", e.target.value)} />
                    <button aria-label={"Remove column " + col.name} title="Remove column"
                      onClick={() => removeColumn(active.id, col.id)}><Trash2 size={14} /></button>
                  </div>
                  <input aria-label={"Type for " + col.name} list="erd-sql-type-options" spellCheck={false}
                    value={col.type} onChange={(e) => editColumn(active.id, col.id, "type", e.target.value)} />
                  {dialect === "db2i" && (
                    <>
                      <label>System column name (optional)
                        <input aria-label={"System column name for " + col.name} maxLength={10}
                          placeholder="e.g. CUSTNO" value={col.systemName || ""}
                          onChange={(e) => editColumn(active.id, col.id, "systemName", e.target.value.toUpperCase())} />
                      </label>
                      <label>CCSID override
                        <select aria-label={"CCSID for " + col.name} value={col.ccsid ?? ""}
                          onChange={(e) => editColumn(active.id, col.id, "ccsid",
                            e.target.value ? Number(e.target.value) : undefined)}>
                          <option value="">Inherit table/job default</option>
                          <option value="37">37 (US EBCDIC)</option>
                          <option value="500">500 (international EBCDIC)</option>
                          <option value="1208">1208 (UTF-8)</option>
                          <option value="65535">65535 (binary/no translation)</option>
                        </select>
                      </label>
                    </>
                  )}
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
      <datalist id="erd-sql-type-options">
        {dataTypes[dialect].map((type) => <option key={type} value={type} />)}
      </datalist>
    </div>
  );
}
