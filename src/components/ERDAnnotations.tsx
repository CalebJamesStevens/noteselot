import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode, type DragEvent } from "react";
import * as Y from "yjs";
import { Box, CircleDot, Code2, FileText, GitBranch, ImagePlus, Trash2, Waypoints } from "lucide-react";
import { createId } from "../id";
import { optimizeDiagramImage, MAX_DIAGRAM_IMAGE_CHARS, MAX_DIAGRAM_IMAGES } from "../erd/imageFiles";
import { ensureRichFragment, jsonFromFragment, type RichNode } from "../erd/richSchema";
import { RichTextInspector, RichTextPreview } from "./ERDRichText";

type Value = Y.Map<unknown>;
export type Kind = "note" | "api" | "boundary" | "control" | "entity" | "image";
export type Annotation = { id: string; kind: Kind; x: number; y: number; w: number; h: number; title: string; body: string; method: string; path: string; imageData?: string; richDoc?:RichNode };
export type ArchitectureLink = { id: string; from: string; to: string; fromColumn?:string; toColumn?:string; label: string };
export type TableReference = { id: string; name: string; x: number; y: number; w:number; h:number; columns: { id: string; name: string }[] };
const methods = ["GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"];
const kinds: { kind: Kind; name: string; Icon: typeof FileText }[] = [
  { kind: "note", name: "Text box", Icon: FileText },
  { kind: "api", name: "API endpoint", Icon: Code2 },
  { kind: "boundary", name: "Boundary", Icon: Box },
  { kind: "control", name: "Control", Icon: GitBranch },
  { kind: "entity", name: "Entity", Icon: CircleDot },
];
function readText(v: unknown) { return v instanceof Y.Text ? v.toString() : typeof v === "string" ? v : ""; }
/** Keep each text box as a Y.Text, applying a minimal delta instead of overwriting peer edits. */
export function editSharedText(map: Value, key: string, next: string) {
  let value = map.get(key);
  if (!(value instanceof Y.Text)) {
    const text = new Y.Text();
    if (typeof value === "string") text.insert(0, value);
    map.set(key, text);
    value = text;
  }
  const shared = value as Y.Text, before = shared.toString();
  if (before === next) return;
  let start = 0, end = 0;
  while (start < before.length && start < next.length && before[start] === next[start]) start++;
  while (end < before.length - start && end < next.length - start && before[before.length-end-1] === next[next.length-end-1]) end++;
  shared.doc?.transact(() => {
    if (before.length-start-end) shared.delete(start, before.length-start-end);
    if (next.length-start-end) shared.insert(start, next.slice(start, next.length-end));
  });
}
function readNode(id: string, v: Value): Annotation {
  const kind = String(v.get("kind"));
  return { id, kind: (["note","api","boundary","control","entity","image"].includes(kind) ? kind : "note") as Kind,
    x: Number(v.get("x") ?? 120), y: Number(v.get("y") ?? 120), w: Number(v.get("w") ?? 255), h: Number(v.get("h") ?? 165),
    title: readText(v.get("title")), body: readText(v.get("body")),
    method: String(v.get("method") ?? "GET"), path: readText(v.get("path")),
    imageData: kind === "image" ? String(v.get("imageData") ?? "") : undefined,
    richDoc:kind==="note" && v.get("richBody") instanceof Y.XmlFragment
      ? jsonFromFragment(v.get("richBody") as Y.XmlFragment) : undefined };
}
function readLink(id: string, v: Value): ArchitectureLink {
  return { id, from: String(v.get("from") ?? ""), to: String(v.get("to") ?? ""),
    fromColumn: String(v.get("fromColumn") ?? ""), toColumn:String(v.get("toColumn") ?? ""),
    label: readText(v.get("label")) };
}
/** Standard BCE robustness symbols: boundary T-bar, control arrow, entity baseline. */
function symbol(kind: Kind): ReactNode {
  if (kind === "note" || kind === "image") return null;
  if (kind === "api") return <Code2 size={32}/>;
  return <svg viewBox="0 0 64 64" width="56" height="56" fill="none" stroke="currentColor" strokeWidth="2.5" role="img" aria-label={kind + " symbol"}>
    <circle cx="34" cy="30" r="19" />
    {kind === "boundary" && <path d="M 8 12 V 50 M 8 30 H 15" />}
    {kind === "control" && <path d="M 43 12 L 35 3 L 45 5 M 35 3 V 12" strokeLinecap="round" />}
    {kind === "entity" && <path d="M 8 53 H 60" />}
  </svg>;
}
function center(id: string, tables: TableReference[], nodes: Annotation[]) {
  const n = nodes.find(x => x.id === id);
  if (n) return { x:n.x+n.w/2, y:n.y+n.h/2, w:n.w };
  const t = tables.find(x => x.id === id);
  return t ? { x:t.x+t.w/2, y:t.y+Math.max(t.h,36+t.columns.length*29)/2, w:t.w } : null;
}
function anchorPoint(id: string, columnId: string | undefined, right: boolean,
  tables: TableReference[], nodes: Annotation[]) {
  const t=tables.find(x=>x.id===id);
  if (t && columnId) {
    const idx=t.columns.findIndex(c=>c.id===columnId);
    if (idx>=0) return {x:t.x+(right?t.w:0),y:t.y+36+idx*29+14.5};
  }
  const c=center(id,tables,nodes);
  if(!c)return null;
  return {x:c.x+(right?c.w/2:-c.w/2),y:c.y};
}

export function useERDAnnotations(doc: Y.Doc, tables: TableReference[], selectedTableId: string | null,
  deselectRelational: () => void, zoom = 1, getCenter: () => {x:number;y:number} = () => ({x:300,y:200}),
  pointFromViewport: (x:number,y:number) => {x:number;y:number} = (x,y) => ({x:x/zoom,y:y/zoom})) {
  const nodes = useMemo(() => doc.getMap<Value>("erd-annotations"), [doc]);
  const connectors = useMemo(() => doc.getMap<Value>("erd-architecture-links"), [doc]);
  const read = () => ({ items: Array.from(nodes.entries()).map(([id,v]) => readNode(id,v)),
    lines: Array.from(connectors.entries()).map(([id,v]) => readLink(id,v)) });
  const [data,setData] = useState(read), [selected,setSelected] = useState<string|null>(null),
    [selectedLine,setSelectedLine] = useState<string|null>(null), [feedback,setFeedback] = useState("");
  const drag = useRef<{id:string; action:"move"|"resize"; sx:number; sy:number; x:number; y:number; w:number; h:number}|null>(null);
  const imagePicker = useRef<HTMLInputElement>(null);
  const replaceImageId = useRef<string|null>(null);
  useEffect(() => { const update=()=>setData(read());
    nodes.observeDeep(update); connectors.observeDeep(update);
    return () => { nodes.unobserveDeep(update); connectors.unobserveDeep(update); };
  }, [nodes,connectors]);
  const active = data.items.find(x=>x.id===selected);
  const activeLine = data.lines.find(x=>x.id===selectedLine);
  const choices = [...tables.map(t=>({id:t.id,name:"Table: "+t.name})),
    ...data.items.map(n=>({id:n.id,name:n.kind.toUpperCase()+": "+n.title}))];
  function clearSelection() { setSelected(null); setSelectedLine(null); }
  function pickNode(id:string) {
    const v=nodes.get(id);
    if(v?.get("kind")==="note") ensureRichFragment(v);
    setSelected(id); setSelectedLine(null); deselectRelational();
  }
  function pickLine(id:string) { setSelectedLine(id); setSelected(null); deselectRelational(); }
  function add(kind:Kind) {
    const id=createId(), value=new Y.Map<unknown>(), title=new Y.Text(), body=new Y.Text(), path=new Y.Text();
    title.insert(0, {note:"Note",api:"API endpoint",boundary:"Boundary",control:"Control",entity:"Entity",image:"Picture"}[kind]);
    if(kind==="api") path.insert(0,"/api/example");
    value.set("kind",kind); value.set("title",title); value.set("body",body);
    value.set("path",path); value.set("method","GET");
    if(kind==="note")value.set("richBody",new Y.XmlFragment());
    const center = getCenter();
    value.set("x",center.x-130+(data.items.length%3)*24);
    value.set("y",center.y-85+(data.items.length%3)*24);
    value.set("w",kind==="note"||kind==="api"?260:210);
    value.set("h",kind==="note"?180:kind==="api"?170:145);
    nodes.set(id,value); pickNode(id); setFeedback("");
  }
  async function uploadImage(file: File, targetId: string | null = null, pos?: {x:number;y:number}) {
    try {
      const imageData = await optimizeDiagramImage(file);
      const existing = data.items.filter(item => item.kind === "image");
      const others = existing.filter(item => item.id !== targetId);
      if (!targetId && existing.length >= MAX_DIAGRAM_IMAGES)
        throw new Error("This diagram already has the maximum of " + MAX_DIAGRAM_IMAGES + " pictures.");
      if (others.reduce((total, item) => total + (item.imageData?.length || 0), 0) + imageData.length > MAX_DIAGRAM_IMAGE_CHARS)
        throw new Error("Diagram picture storage is full. Remove an existing image before uploading another.");
      const previous = targetId ? nodes.get(targetId) : undefined;
      if (targetId && (!previous || previous.get("kind") !== "image"))
        throw new Error("The picture you're replacing is no longer available.");
      if (previous) {
        previous.set("imageData", imageData);
        setSelected(targetId);
      } else {
        const id = createId(), value = new Y.Map<unknown>();
        const title = new Y.Text(), body = new Y.Text(), path = new Y.Text();
        title.insert(0, file.name.replace(/\.[^.]+$/, "").slice(0, 160) || "Picture");
        value.set("kind", "image"); value.set("title", title);
        value.set("body", body); value.set("path", path);
        value.set("method", "GET"); value.set("imageData", imageData);
        const center = getCenter();
        value.set("x", pos?.x ?? center.x-165);
        value.set("y", pos?.y ?? center.y-120);
        value.set("w", 330); value.set("h", 240);
        nodes.set(id, value);
        pickNode(id);
      }
      setFeedback("");
    } catch (error) {
      setFeedback((error as Error).message);
    }
  }
  function chooseImage(replacementId: string | null = null) {
    replaceImageId.current = replacementId;
    imagePicker.current?.click();
  }
  function dropImage(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith("image/"));
    if (!file) { setFeedback("Drop a PNG, JPEG, or WebP picture."); return; }
    const box = e.currentTarget.getBoundingClientRect();
    void uploadImage(file, null, pointFromViewport(e.clientX-box.left,e.clientY-box.top));
  }
  function dragOverImage(e: DragEvent<HTMLElement>) {
    if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
  }
  function addLine() {
    if (choices.length<2) { setFeedback("Add two diagram elements before connecting them."); return; }
    const from=selected||selectedTableId||choices[0].id, to=choices.find(x=>x.id!==from)?.id;
    if(!to) return;
    const id=createId(), l=new Y.Map<unknown>();
    l.set("from",from); l.set("to",to); l.set("label",new Y.Text());
    connectors.set(id,l); pickLine(id); setFeedback("");
  }
  function removeReferences(id:string) {
    for(const [key,l] of connectors.entries())
      if(l.get("from")===id||l.get("to")===id) connectors.delete(key);
  }
  function deleteNode(id:string) {
    doc.transact(()=>{nodes.delete(id);removeReferences(id);});clearSelection();
  }
  function pointerDown(e:PointerEvent<HTMLElement>, n:Annotation, action:"move"|"resize") {
    if(e.button!==0) return; e.stopPropagation();
    drag.current={id:n.id,action,sx:e.clientX,sy:e.clientY,x:n.x,y:n.y,w:n.w,h:n.h};
    e.currentTarget.setPointerCapture(e.pointerId);pickNode(n.id);
  }
  function pointerMove(e:PointerEvent<HTMLElement>) {
    const d=drag.current;
    if(!d) return;
    const v=nodes.get(d.id);if(!v)return;
    const dx=(e.clientX-d.sx)/zoom,dy=(e.clientY-d.sy)/zoom;
    doc.transact(()=>{
      if(d.action==="move") {
        v.set("x",d.x+dx);
        v.set("y",d.y+dy);
      } else {
        v.set("w",Math.max(180,Math.min(2500,d.w+dx)));
        v.set("h",Math.max(105,Math.min(2500,d.h+dy)));
      }
    });
  }
  function field(id:string,key:string,value:string) {
    const v=nodes.get(id);if(v)editSharedText(v,key,value);
  }
  const toolbar=<>
    <span className="erd-tools-divider" />
    {kinds.map(({kind,name,Icon})=><button key={kind} onClick={()=>add(kind)} title={name} aria-label={"Add "+name}>
      <Icon size={15}/> {name}</button>)}
    <button onClick={() => chooseImage()} title="Upload PNG, JPEG or WebP picture"><ImagePlus size={15}/> Picture</button>
    <input ref={imagePicker} type="file" accept="image/png,image/jpeg,image/webp"
      aria-label="Choose diagram picture" style={{display:"none"}} onChange={e => {
        const file = e.target.files?.[0]; e.target.value = "";
        const target = replaceImageId.current; replaceImageId.current = null;
        if (file) void uploadImage(file, target);
      }} />
    <button onClick={addLine} title="Visual connector, not a SQL foreign key">
      <Waypoints size={15}/> Connect</button>
  </>;
  const layer=<>
    <svg className="erd-architecture-lines" width="1600" height="1050" viewBox="0 0 1600 1050" aria-label="Architecture connectors">
      <defs><marker id="erd-arch-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor"/></marker></defs>
      {data.lines.map(line=>{
        const a=center(line.from,tables,data.items),b=center(line.to,tables,data.items);
        if(!a||!b)return null;
        const dir=b.x>=a.x?1:-1;
        const p1=anchorPoint(line.from,line.fromColumn,dir>0,tables,data.items);
        const p2=anchorPoint(line.to,line.toColumn,dir<0,tables,data.items);
        if(!p1||!p2)return null;
        const bend=Math.max(32,Math.abs(p2.x-p1.x)/2);
        const d="M "+p1.x+" "+p1.y+" C "+(p1.x+dir*bend)+" "+p1.y+", "+(p2.x-dir*bend)+" "+p2.y+", "+p2.x+" "+p2.y;
        return <g key={line.id} className={"erd-architecture-link"+(selectedLine===line.id?" active":"")}
            onClick={()=>pickLine(line.id)}>
          <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="7 5" markerEnd="url(#erd-arch-arrow)"/>
          <path d={d} fill="none" stroke="transparent" strokeWidth="16" pointerEvents="stroke"/>
          {line.label&&<text x={(p1.x+p2.x)/2} y={(p1.y+p2.y)/2-9} textAnchor="middle">{line.label.slice(0,65)}</text>}
        </g>;
      })}
    </svg>
    {data.items.map(n=><article key={n.id} className={"erd-architecture-card kind-"+n.kind+(selected===n.id?" selected":"")}
       style={{left:n.x,top:n.y,width:n.w,height:n.h}} onClick={e=>{e.stopPropagation();pickNode(n.id);}}>
      <header onPointerDown={e=>pointerDown(e,n,"move")} onPointerMove={pointerMove}
        onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
        <span className="erd-card-heading">
          {n.kind==="note"?<FileText size={15}/>:
            n.kind==="image"?<ImagePlus size={15}/>:
            n.kind==="api"?<Code2 size={15}/>:
            n.kind==="boundary"?<Box size={15}/>:
            n.kind==="control"?<GitBranch size={15}/>:<CircleDot size={15}/>}
          <strong title={n.title}>{n.title||"Untitled"}</strong>
        </span>
        <span className="erd-drag-grip" aria-hidden="true">⋮⋮</span>
      </header>
      <div className="erd-architecture-content">
        {n.kind==="image" && n.imageData && <img className="erd-picture" src={n.imageData}
          alt={n.title || "Diagram picture"} draggable={false} />}
        {["boundary","control","entity"].includes(n.kind)&&<div className="erd-uml-symbol">{symbol(n.kind)}</div>}
        {n.kind==="api"&&<div className="erd-api-route"><b>{n.method}</b><code>{n.path}</code></div>}
        {n.kind==="note" ? (
          n.richDoc ? <RichTextPreview content={n.richDoc}/> :
          n.body ? <p>{n.body}</p> : <p className="erd-placeholder">Select to write a note...</p>
        ) : n.body ? <p>{n.body}</p> : null}
      </div>
      <button className="erd-resize-grip" type="button" aria-label={"Resize "+n.title}
        onPointerDown={e=>pointerDown(e,n,"resize")} onPointerMove={pointerMove}
        onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}/>
    </article>)}
    {feedback&&<div className="erd-architecture-notice" role="status">{feedback}</div>}
  </>;
  const inspector: ReactNode=active?<section className="erd-architecture-inspector">
    <h3>{active.kind==="note"?"Text box":active.kind==="api"?"API endpoint":active.kind==="image"?"Picture":"«"+active.kind+"»"}</h3>
    <p className="erd-hint">Drag the header to move. Drag the lower-right corner to resize. These notes are shared and autosaved.</p>
    <label>Title<input aria-label="Architecture element title" maxLength={160} value={active.title}
      onChange={e=>field(active.id,"title",e.target.value)}/></label>
    {active.kind==="api"&&<>
      <label>HTTP method<select aria-label="API HTTP method" value={active.method}
        onChange={e=>nodes.get(active.id)?.set("method",e.target.value)}>
        {methods.map(m=><option key={m}>{m}</option>)}</select></label>
      <label>Endpoint path<input aria-label="API endpoint path" value={active.path} maxLength={240}
        onChange={e=>field(active.id,"path",e.target.value)}/></label>
    </>}
    {active.kind==="image" && <button type="button" onClick={() => chooseImage(active.id)}>
      <ImagePlus size={14}/> Replace picture
    </button>}
    {active.kind==="note" ? (
      <RichTextInspector key={active.id} node={nodes.get(active.id)!}/>
    ) : (
      <label>{active.kind==="image"?"Caption / description":"Notes / responsibilities"}
        <textarea aria-label="Architecture element notes" rows={6} maxLength={5000} value={active.body}
          onChange={e=>field(active.id,"body",e.target.value)}/>
      </label>
    )}
    <button className="erd-danger" onClick={()=>deleteNode(active.id)}><Trash2 size={14}/> Delete element</button>
  </section>:activeLine?<section className="erd-architecture-inspector">
    <h3>Architecture connection</h3>
    <p className="erd-hint">A visual connection for API flows and architecture. It does not generate a SQL foreign key.</p>
    {(["from","to"] as const).map(side=><label key={side}>{side==="from"?"From":"To"}
      <select aria-label={"Architecture connection "+side} value={activeLine[side]}
        onChange={e=>{
          const link=connectors.get(activeLine.id);
          doc.transact(()=>{
            link?.set(side,e.target.value);
            link?.delete(side+"Column");
          });
        }}>
        {choices.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
      {tables.some(t=>t.id===activeLine[side]) && (
        <select aria-label={"Architecture connection "+side+" table field"}
          value={activeLine[side+"Column"]||""}
          onChange={e=>{
            const link=connectors.get(activeLine.id);
            if(e.target.value)link?.set(side+"Column",e.target.value);
            else link?.delete(side+"Column");
          }}>
          <option value="">Whole table</option>
          {tables.find(t=>t.id===activeLine[side])?.columns.map(col=>(
            <option value={col.id} key={col.id}>{col.name}</option>
          ))}
        </select>
      )}</label>)}
    <label>Label<input aria-label="Architecture connection label" maxLength={120} value={activeLine.label}
      onChange={e=>{const v=connectors.get(activeLine.id);if(v)editSharedText(v,"label",e.target.value);}}/></label>
    <button className="erd-danger" onClick={()=>{connectors.delete(activeLine.id);clearSelection();}}>
      <Trash2 size={14}/> Delete connector</button>
  </section>:null;
  return {toolbar,layer,inspector,clearSelection,removeReferences,dropImage,dragOverImage,
    snapshot:()=>({annotations:data.items,architectureConnections:data.lines})};
}
