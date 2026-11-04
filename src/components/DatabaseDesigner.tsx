import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import * as Y from "yjs";
import { ChevronDown, Database, Download, Link2, Maximize2, Minimize2, Minus, PanelRightClose, PanelRightOpen, Plus, Scan, Shapes, Table2, Trash2 } from "lucide-react";
import { createId } from "../id";
import { download } from "../api";
import { useERDAnnotations } from "./ERDAnnotations";
import { MIN_ZOOM, MAX_ZOOM, fitCamera, panCamera, screenToWorld, stepZoom, zoomAround, type Camera } from "../erd/viewport";

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
    w: Number(value.get("w") ?? 236),
    h: Number(value.get("h") ?? Math.max(90,36+(columns?.length ?? 1)*29)),
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
  return { x: table.x + (right ? table.w : 0), y: table.y + 36 + index * 29 + 14.5 };
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
  const [camera, setCamera] = useState<Camera>({x:32,y:32,zoom:1});
  const cameraRef = useRef(camera);
  const canvasRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{id:number;screenX:number;screenY:number;x:number;y:number}|null>(null);
  const spaceHeld = useRef(false);
  const canvasHovered = useRef(false);
  const [isPanning, setIsPanning] = useState(false);
  function updateCamera(next:Camera) {
    cameraRef.current = next;
    setCamera(next);
  }
  function centerWorld() {
    const area = canvasRef.current;
    return screenToWorld(cameraRef.current,{
      x:area ? area.clientWidth/2 : 420,
      y:area ? area.clientHeight/2 : 260,
    });
  }
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedRelation, setSelectedRelation] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const annotations = useERDAnnotations(doc, model.tables, selected,
    () => { setSelected(null); setSelectedRelation(null); }, camera.zoom, centerWorld,
    (x,y) => screenToWorld(cameraRef.current,{x,y}));
  const drag = useRef<{ id: string; action:"move"|"resize"; x: number; y: number; w:number; h:number; pointerX: number; pointerY: number } | null>(null);
  const [inspectorWidth,setInspectorWidth] = useState(380);
  const [inspectorOpen,setInspectorOpen] = useState(() =>
    typeof window === "undefined" || window.innerWidth > 1550);
  const [focusMode,setFocusMode] = useState(false);
  const plannerRef = useRef<HTMLDivElement>(null);
  const inspectorWidthRef = useRef<{start:number;width:number;id:number}|null>(null);
  useEffect(() => {
    if(selected || selectedRelation || annotations.selectedId || annotations.selectedLineId)
      setInspectorOpen(true);
  }, [selected,selectedRelation,annotations.selectedId,annotations.selectedLineId]);
  useEffect(() => {
    function fullscreenChanged() {
      if (!document.fullscreenElement) setFocusMode(false);
    }
    document.addEventListener("fullscreenchange", fullscreenChanged);
    return () => document.removeEventListener("fullscreenchange", fullscreenChanged);
  }, []);
  useEffect(() => {
    if (!focusMode) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if(event.key === "Escape") {
        setFocusMode(false);
        if (document.fullscreenElement === plannerRef.current)
          void document.exitFullscreen().catch(() => {});
      }
    }
    window.addEventListener("keydown",onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown",onKeyDown);
    };
  }, [focusMode]);
  function toggleFocusMode() {
    if (focusMode) {
      setFocusMode(false);
      if (document.fullscreenElement === plannerRef.current)
        void document.exitFullscreen().catch(() => {});
    } else {
      setFocusMode(true);
      // True browser fullscreen when permitted; the fixed overlay remains a fallback.
      const request = plannerRef.current?.requestFullscreen?.();
      if (request) void request.catch(() => {});
    }
  }
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
  function zoomTo(nextValue: number, point?: {x:number;y:number}) {
    const area = canvasRef.current;
    if (!area) return;
    const anchor = point || {x:area.clientWidth/2,y:area.clientHeight/2};
    updateCamera(zoomAround(cameraRef.current,nextValue,anchor));
  }
  function fitToContent() {
    const area = canvasRef.current;
    if (!area) return;
    const shapes = [
      ...model.tables.map(table => ({
        x:table.x,y:table.y,width:table.w,height:Math.max(table.h,36+table.columns.length*29),
      })),
      ...annotations.snapshot().annotations.map(item => ({
        x:item.x,y:item.y,width:item.w,height:item.h,
      })),
    ];
    updateCamera(fitCamera(shapes,{width:area.clientWidth,height:area.clientHeight}));
  }
  function startPan(event:PointerEvent<HTMLDivElement>) {
    panRef.current = {
      id:event.pointerId,screenX:event.clientX,screenY:event.clientY,
      x:cameraRef.current.x,y:cameraRef.current.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    setIsPanning(true);
  }
  function onPanCapture(event:PointerEvent<HTMLDivElement>) {
    if (event.button === 1 || (event.button === 0 && spaceHeld.current)) {
      event.stopPropagation();
      startPan(event);
    }
  }
  function onBlankPan(event:PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || panRef.current) return;
    const element = event.target;
    if (element instanceof Element && element.closest(
      ".erd-table, .erd-architecture-card, .erd-line, .erd-architecture-link, .erd-architecture-notice, .erd-zoom-controls"
    )) return;
    startPan(event);
  }
  function movePan(event:PointerEvent<HTMLDivElement>) {
    const drag=panRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    updateCamera({...cameraRef.current,
      x:drag.x+event.clientX-drag.screenX,
      y:drag.y+event.clientY-drag.screenY});
  }
  function endPan(event:PointerEvent<HTMLDivElement>) {
    if (panRef.current?.id !== event.pointerId) return;
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setIsPanning(false);
  }
  useEffect(() => {
    const area = canvasRef.current;
    if (!area) return;
    function wheel(event:WheelEvent) {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? area!.clientHeight : 1;
      if (event.ctrlKey || event.metaKey) {
        const rect=area!.getBoundingClientRect();
        const zoom=cameraRef.current.zoom*Math.exp(-event.deltaY*unit*0.004);
        updateCamera(zoomAround(cameraRef.current,zoom,{
          x:event.clientX-rect.left,y:event.clientY-rect.top,
        }));
      } else {
        updateCamera(panCamera(cameraRef.current,-event.deltaX*unit,-event.deltaY*unit));
      }
    }
    const typing=(target:EventTarget|null) =>
      target instanceof Element && !!target.closest("input,textarea,select,[contenteditable=true]");
    function keydown(event:KeyboardEvent) {
      if (event.code === "Space" && !typing(event.target)) {
        spaceHeld.current=true;
        if (canvasHovered.current) event.preventDefault();
      }
    }
    function keyup(event:KeyboardEvent) { if (event.code === "Space") spaceHeld.current=false; }
    function blur() { spaceHeld.current=false; }
    area.addEventListener("wheel",wheel,{passive:false});
    window.addEventListener("keydown",keydown);
    window.addEventListener("keyup",keyup);
    window.addEventListener("blur",blur);
    return () => {
      area.removeEventListener("wheel",wheel);
      window.removeEventListener("keydown",keydown);
      window.removeEventListener("keyup",keyup);
      window.removeEventListener("blur",blur);
    };
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
    const center = centerWorld();
    table.set("x", center.x - 118 + (model.tables.length%3)*24);
    table.set("y", center.y - 48 + (model.tables.length%3)*24);
    table.set("columns", columns);
    table.set("w",236);
    table.set("h",100);
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
      const connectors=doc.getMap<MapValue>("erd-architecture-links");
      for(const link of connectors.values()){
        if(link.get("from")===tableId && link.get("fromColumn")===columnId)
          link.delete("fromColumn");
        if(link.get("to")===tableId && link.get("toColumn")===columnId)
          link.delete("toColumn");
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
    const dx=(event.clientX-d.pointerX)/cameraRef.current.zoom;
    const dy=(event.clientY-d.pointerY)/cameraRef.current.zoom;
    doc.transact(() => {
      if (d.action==="move") {
        table.set("x", d.x + dx);
        table.set("y", d.y + dy);
      } else {
        table.set("w", Math.max(190,Math.min(2400,d.w+dx)));
        const columns=table.get("columns") as Y.Array<MapValue> | undefined;
        table.set("h", Math.max(90,36+(columns?.length ?? 0)*29,
          Math.min(2400,d.h+dy)));
      }
    });
  }
  function resizeInspector(event:PointerEvent<HTMLDivElement>) {
    const move=inspectorWidthRef.current;
    if (!move||event.pointerId!==move.id) return;
    const maxWidth=Math.max(290,Math.min(900,
      (event.currentTarget.parentElement?.clientWidth ?? 1200)-300));
    setInspectorWidth(Math.max(280,Math.min(maxWidth,
      move.width+move.start-event.clientX)));
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
    <div ref={plannerRef} className={focusMode ? "erd-planner erd-focus-mode" : "erd-planner"}>
      <div className="erd-toolbar" role="toolbar" aria-label="Diagram editor">
        <div className="erd-toolbar-document" title={title}>
          <Database size={18}/><strong>{title || "Database design"}</strong>
        </div>
        <div className="erd-toolbar-actions" role="group" aria-label="Create diagram elements">
          <button className="erd-action-button" type="button" onClick={addTable} title="Add table" aria-label="Add table">
            <Table2 size={17}/><span className="erd-action-label">Table</span>
          </button>
          <button className="erd-action-button" type="button" onClick={addRelation} title="Add foreign-key relationship"
            aria-label="Add foreign-key relationship">
            <Link2 size={17}/><span className="erd-action-label">Relation</span>
          </button>
          {annotations.toolbar}
        </div>
        <div className="erd-toolbar-options">
          <details className="erd-toolbar-menu" onKeyDown={e=>{if(e.key==="Escape")e.currentTarget.open=false;}}>
            <summary aria-label="More diagram elements" title="More diagram elements">
              <Shapes size={17}/><span className="erd-option-label">More</span><ChevronDown size={12}/>
            </summary>
            <div className="erd-toolbar-menu-panel" onClick={e=>{
              if ((e.target as Element).closest("button"))
                (e.currentTarget.parentElement as HTMLDetailsElement).open=false;
            }}>
              {annotations.extraToolbar}
            </div>
          </details>
          <label className="erd-dialect-control" title="SQL target">
            <span className="erd-visually-hidden">SQL target</span>
            <select aria-label="Database SQL dialect" value={dialect} onChange={(e)=>{
              const next=e.target.value as Dialect;
              settings.set("dialect",next);
              setFeedback(next==="db2i"
                ? "IBM i Db2 enabled. Review PostgreSQL-specific types before exporting SQL." : "");
            }}>
              <option value="postgres">PostgreSQL</option>
              <option value="db2i">IBM i Db2</option>
            </select>
          </label>
          <details className="erd-toolbar-menu" onKeyDown={e=>{if(e.key==="Escape")e.currentTarget.open=false;}}>
            <summary aria-label="Export diagram" title="Export diagram">
              <Download size={17}/><span className="erd-option-label">Export</span><ChevronDown size={12}/>
            </summary>
            <div className="erd-toolbar-menu-panel erd-toolbar-export" onClick={e=>{
              if ((e.target as Element).closest("button"))
                (e.currentTarget.parentElement as HTMLDetailsElement).open=false;
            }}>
              <label className="erd-export-dialect">SQL target
                <select aria-label="Export SQL target" value={dialect} onChange={e=>{
                  settings.set("dialect",e.target.value as Dialect);
                }}>
                  <option value="postgres">PostgreSQL</option>
                  <option value="db2i">IBM i Db2</option>
                </select>
              </label>
              <button type="button" onClick={exportJSON}><Download size={15}/> Noteselot JSON</button>
              <button type="button" onClick={exportDDL}>
                <Database size={15}/> {dialect==="db2i" ? "IBM i Db2 SQL" : "PostgreSQL SQL"}
              </button>
            </div>
          </details>
          <button className="erd-icon-control" type="button" aria-label={inspectorOpen?"Hide properties":"Show properties"}
            title={inspectorOpen?"Hide properties":"Show properties"} aria-pressed={inspectorOpen}
            onClick={()=>setInspectorOpen(v=>!v)}>
            {inspectorOpen?<PanelRightClose size={18}/>:<PanelRightOpen size={18}/>}
          </button>
          <button className="erd-icon-control" type="button"
            aria-label={focusMode?"Exit full screen":"Open full screen"}
            title={focusMode?"Exit full screen (Esc)":"Open full screen"} aria-pressed={focusMode}
            onClick={toggleFocusMode}>
            {focusMode?<Minimize2 size={18}/>:<Maximize2 size={18}/>}
          </button>
        </div>
      </div>
      {feedback && <p className="erd-feedback" role="status">{feedback}</p>}
      <div className="erd-layout">
        <div className={isPanning ? "erd-scroll is-panning" : "erd-scroll"} ref={canvasRef}
          aria-label="Infinite diagram canvas, drag empty space to pan"
          onDragOver={annotations.dragOverImage} onDrop={annotations.dropImage}
          onPointerEnter={() => {canvasHovered.current=true;}}
          onPointerLeave={() => {canvasHovered.current=false;}}
          onPointerDownCapture={onPanCapture} onPointerDown={onBlankPan}
          onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}
          style={{backgroundSize:`${22*camera.zoom}px ${22*camera.zoom}px`,
            backgroundPosition:`${camera.x}px ${camera.y}px`}}>
          <div className="erd-stage" style={{transform:`translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`,
            transformOrigin:"top left"}}>
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
                style={{ left: table.x, top: table.y, width:table.w,
                  height: Math.max(table.h,36+table.columns.length*29) }}
                onClick={() => { annotations.clearSelection(); setSelected(table.id); setSelectedRelation(null); }}>
                <header onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  drag.current = { id: table.id, action:"move", x: table.x, y: table.y, w:table.w, h:table.h, pointerX: e.clientX, pointerY: e.clientY };
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
                <button className="erd-table-resize-grip" type="button" aria-label={"Resize table "+table.name}
                  onPointerDown={e=>{
                    if(e.button!==0)return;
                    e.stopPropagation();
                    drag.current={id:table.id,action:"resize",x:table.x,y:table.y,w:table.w,h:table.h,
                      pointerX:e.clientX,pointerY:e.clientY};
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setSelected(table.id);
                    setSelectedRelation(null);
                    annotations.clearSelection();
                  }}
                  onPointerMove={moveTable} onPointerUp={()=>{drag.current=null;}}
                  onPointerCancel={()=>{drag.current=null;}}/>
              </article>
            ))}
            {!model.tables.length && (
              <div className="erd-empty">Create your first table to begin planning a database.</div>
            )}
          </div>
          <div className="erd-pan-hint" aria-hidden="true">Drag empty space to pan · Wheel to pan · Ctrl/Cmd + wheel to zoom</div>
          <div className="erd-zoom-controls" role="group" aria-label="Diagram zoom">
            <button type="button" aria-label="Zoom out" title="Zoom out" disabled={camera.zoom <= MIN_ZOOM}
              onClick={() => zoomTo(stepZoom(cameraRef.current.zoom,-1))}><Minus size={16}/></button>
            <output aria-live="off" aria-label="Current zoom">{Math.round(camera.zoom*100)}%</output>
            <button type="button" aria-label="Zoom in" title="Zoom in" disabled={camera.zoom >= MAX_ZOOM}
              onClick={() => zoomTo(stepZoom(cameraRef.current.zoom,1))}><Plus size={16}/></button>
            <button type="button" title="Fit diagram to view" aria-label="Fit diagram to view"
              onClick={fitToContent}><Scan size={16}/><span>Fit</span></button>
            <button type="button" title="Reset to 100% zoom" aria-label="Reset zoom to 100%"
              onClick={() => zoomTo(1)}>100%</button>
          </div>
        </div>
        {inspectorOpen && (<>
        <div role="separator" aria-orientation="vertical" aria-label="Resize properties panel" tabIndex={0}
          className="erd-inspector-resizer" style={{right:inspectorWidth}}
          onKeyDown={e=>{
            if(e.key==="ArrowLeft"||e.key==="ArrowRight"){
              e.preventDefault();
              setInspectorWidth(w=>Math.max(280,Math.min(900,w+(e.key==="ArrowLeft"?20:-20))));
            }
          }}
          onPointerDown={e=>{
            if(e.button!==0)return;
            inspectorWidthRef.current={id:e.pointerId,start:e.clientX,width:inspectorWidth};
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={resizeInspector}
          onPointerUp={e=>{
            if(inspectorWidthRef.current?.id===e.pointerId)inspectorWidthRef.current=null;
          }}
          onPointerCancel={()=>{inspectorWidthRef.current=null;}}/>
        <aside className="erd-inspector" style={{width:inspectorWidth}}>
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
              <div className="erd-table-size">
                <label>Width (px)<input type="number" min="190" max="2400" value={Math.round(active.w)}
                  onChange={e=>getTable(active.id)?.set("w",Math.max(190,Math.min(2400,Number(e.target.value)||190)))} /></label>
                <label>Height (px)<input type="number" min={36+active.columns.length*29} max="2400"
                  value={Math.round(Math.max(active.h,36+active.columns.length*29))}
                  onChange={e=>getTable(active.id)?.set("h",Math.max(36+active.columns.length*29,Math.min(2400,Number(e.target.value)||90)))} /></label>
              </div>
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
                    <label>{side === "from" ? "Referenced field (line attaches here)" : "Foreign-key field (line attaches here)"}
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
        </>)}
      </div>
      <datalist id="erd-sql-type-options">
        {dataTypes[dialect].map((type) => <option key={type} value={type} />)}
      </datalist>
    </div>
  );
}
