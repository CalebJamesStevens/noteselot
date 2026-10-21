import { useEffect, useRef, useState, type PointerEvent } from "react";
import * as Y from "yjs";
import {
  MousePointer2,
  StickyNote,
  Square,
  Circle,
  ArrowUpRight,
  Pencil,
  Type,
  Trash2,
  Undo2,
  Redo2,
  Download,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { createId } from "../id";
import { download } from "../api";
type Tool = "select" | "sticky" | "rect" | "ellipse" | "arrow" | "pen" | "text";
interface Shape {
  id: string;
  type: Tool;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  text: string;
  points?: number[][];
}
const colors = ["#c2cfa7", "#edc794", "#b3bfd9", "#d4b3c5", "#a7cdcc"];
export default function Board({ doc, title }: { doc: Y.Doc; title: string }) {
  const shapes = doc.getMap<Shape>("shapes");
  const [items, setItems] = useState<Shape[]>([]),
    [tool, setTool] = useState<Tool>("select"),
    [color, setColor] = useState(colors[0]),
    [selected, setSelected] = useState<string | null>(null),
    [zoom, setZoom] = useState(1);
  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<{
      id: string;
      x: number;
      y: number;
      original: Shape;
      drawing: boolean;
    } | null>(null);
  const undo = useRef<Y.UndoManager | null>(null);
  useEffect(() => {
    undo.current = new Y.UndoManager(shapes);
    const update = () => setItems(Array.from(shapes.values()));
    update();
    shapes.observe(update);
    return () => {
      shapes.unobserve(update);
      undo.current?.destroy();
    };
  }, [shapes]);
  function point(e: PointerEvent<SVGSVGElement>) {
    const p = svg.current!.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const v = p.matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return { x: v.x, y: v.y };
  }
  function down(e: PointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    const p = point(e);
    const target = (e.target as Element)
      .closest("[data-shape]")
      ?.getAttribute("data-shape");
    if (tool === "select") {
      setSelected(target || null);
      if (target) {
        const s = shapes.get(target);
        if (s) drag.current = { id: target, ...p, original: s, drawing: false };
      }
    } else {
      const id = createId();
      const s: Shape = {
        id,
        type: tool,
        ...p,
        w: tool === "arrow" || tool === "pen" ? 0 : 190,
        h: tool === "text" ? 45 : 130,
        color,
        text:
          tool === "sticky"
            ? "A new thought"
            : tool === "text"
              ? "Add text"
              : "",
        points: tool === "pen" ? [[0, 0]] : undefined,
      };
      shapes.set(id, s);
      setSelected(id);
      drag.current = {
        id,
        ...p,
        original: s,
        drawing: tool === "arrow" || tool === "pen",
      };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    if (!d) return;
    const p = point(e),
      dx = p.x - d.x,
      dy = p.y - d.y;
    const current = shapes.get(d.id);
    if (!current) return;
    if (d.drawing) {
      if (current.type === "pen")
        shapes.set(d.id, {
          ...current,
          points: [...(current.points || []), [dx, dy]],
        });
      else shapes.set(d.id, { ...current, w: dx, h: dy });
    } else
      shapes.set(d.id, {
        ...current,
        x: d.original.x + dx,
        y: d.original.y + dy,
      });
  }
  const chosen = items.find((s) => s.id === selected);
  const tools: { key: Tool; label: string; Icon: typeof Square }[] = [
    { key: "select", label: "Select / move", Icon: MousePointer2 },
    { key: "sticky", label: "Sticky note", Icon: StickyNote },
    { key: "rect", label: "Rectangle", Icon: Square },
    { key: "ellipse", label: "Ellipse", Icon: Circle },
    { key: "arrow", label: "Arrow", Icon: ArrowUpRight },
    { key: "pen", label: "Freehand", Icon: Pencil },
    { key: "text", label: "Text", Icon: Type },
  ];
  return (
    <div className="board">
      <div className="board-toolbar">
        {tools.map(({ key, label, Icon }) => (
          <button
            className={tool === key ? "active" : ""}
            aria-label={label}
            title={label}
            key={key}
            onClick={() => setTool(key)}
          >
            <Icon size={19} />
          </button>
        ))}
        <span className="toolbar-divider" />
        {colors.map((c) => (
          <button
            key={c}
            title={`Color ${c}`}
            aria-label={`Color ${c}`}
            className={`color-swatch ${color === c ? "selected" : ""}`}
            style={{ background: c }}
            onClick={() => {
              setColor(c);
              if (chosen) shapes.set(chosen.id, { ...chosen, color: c });
            }}
          />
        ))}
        <span className="toolbar-divider" />
        <button
          aria-label="Undo"
          title="Undo"
          onClick={() => undo.current?.undo()}
        >
          <Undo2 size={18} />
        </button>
        <button
          aria-label="Redo"
          title="Redo"
          onClick={() => undo.current?.redo()}
        >
          <Redo2 size={18} />
        </button>
        <button
          aria-label="Delete selected"
          title="Delete selected"
          disabled={!selected}
          onClick={() => {
            if (selected) shapes.delete(selected);
            setSelected(null);
          }}
        >
          <Trash2 size={18} />
        </button>
        <button
          aria-label="Export SVG"
          title="Export SVG"
          onClick={() => {
            const clone = svg.current!.cloneNode(true) as SVGSVGElement;
            clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
            download(`${title}.svg`, clone.outerHTML, "image/svg+xml");
          }}
        >
          <Download size={18} />
        </button>
      </div>
      <div className="board-scroll">
        <svg
          ref={svg}
          width={1600 * zoom}
          height={1000 * zoom}
          viewBox="0 0 1600 1000"
          aria-label="Collaborative whiteboard"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={() => {
            drag.current = null;
            undo.current?.stopCapturing();
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <defs>
            <pattern
              id="dots"
              width="24"
              height="24"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="1" cy="1" r="1" fill="#757b78" opacity=".28" />
            </pattern>
            <marker
              id="arrowhead"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
          </defs>
          <rect width="1600" height="1000" fill="url(#dots)" />
          {items.map((s) => (
            <g
              key={s.id}
              data-shape={s.id}
              transform={`translate(${s.x} ${s.y})`}
              style={{ cursor: tool === "select" ? "move" : "crosshair" }}
            >
              {s.type === "arrow" ? (
                <line
                  x1="0"
                  y1="0"
                  x2={s.w}
                  y2={s.h}
                  stroke={s.color}
                  strokeWidth="4"
                  markerEnd="url(#arrowhead)"
                />
              ) : s.type === "pen" ? (
                <polyline
                  points={s.points?.map((p) => p.join(",")).join(" ")}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : s.type === "ellipse" ? (
                <ellipse
                  cx={s.w / 2}
                  cy={s.h / 2}
                  rx={s.w / 2}
                  ry={s.h / 2}
                  fill={s.color}
                  opacity=".9"
                />
              ) : (
                <rect
                  width={s.w}
                  height={s.h}
                  rx={s.type === "sticky" ? 3 : 10}
                  fill={s.type === "text" ? "transparent" : s.color}
                  opacity=".95"
                />
              )}
              {!["arrow", "pen"].includes(s.type) && (
                <text
                  x="16"
                  y="30"
                  fill={s.type === "text" ? s.color : "#252b25"}
                  fontFamily="system-ui"
                  fontSize="16"
                >
                  {s.text
                    .split("\n")
                    .slice(0, 5)
                    .map((line, i) => (
                      <tspan key={i} x="16" dy={i ? 22 : 0}>
                        {line.slice(0, 24)}
                      </tspan>
                    ))}
                </text>
              )}
              {selected === s.id && (
                <rect
                  x="-5"
                  y="-5"
                  width={Math.max(Math.abs(s.w), 20) + 10}
                  height={Math.max(Math.abs(s.h), 20) + 10}
                  fill="none"
                  stroke="#90b8ff"
                  strokeDasharray="5 4"
                />
              )}
            </g>
          ))}
        </svg>
      </div>
      {items.length === 0 && (
        <div className="board-hint">
          <StickyNote size={30} />
          <h3>Give your ideas some space.</h3>
          <p>Choose a tool above, then click anywhere to start.</p>
        </div>
      )}
      {chosen && !["arrow", "pen"].includes(chosen.type) && (
        <div className="shape-properties">
          <label>
            Selected item
            <textarea
              aria-label="Shape text"
              value={chosen.text}
              maxLength={500}
              onChange={(e) =>
                shapes.set(chosen.id, { ...chosen, text: e.target.value })
              }
            />
          </label>
          <div className="shape-size">
            <label>
              Width
              <input
                type="number"
                min="60"
                max="600"
                value={chosen.w}
                onChange={(e) =>
                  shapes.set(chosen.id, {
                    ...chosen,
                    w: Math.max(60, Math.min(600, Number(e.target.value))),
                  })
                }
              />
            </label>
            <label>
              Height
              <input
                type="number"
                min="40"
                max="600"
                value={chosen.h}
                onChange={(e) =>
                  shapes.set(chosen.id, {
                    ...chosen,
                    h: Math.max(40, Math.min(600, Number(e.target.value))),
                  })
                }
              />
            </label>
          </div>
        </div>
      )}
      <div className="board-zoom">
        <button
          aria-label="Zoom out"
          onClick={() => setZoom((v) => Math.max(0.5, v - 0.1))}
        >
          <ZoomOut size={17} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          aria-label="Zoom in"
          onClick={() => setZoom((v) => Math.min(2, v + 0.1))}
        >
          <ZoomIn size={17} />
        </button>
      </div>
    </div>
  );
}
