import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import * as Y from "yjs";
import mermaid from "mermaid";
import Panzoom from "@panzoom/panzoom";
import { Download, GitBranch, Maximize2, Minimize2, Minus, MoveHorizontal, Plus, RotateCcw, Scan } from "lucide-react";
import { download } from "../api";
import {
  clampDiagramZoom,
  fitDiagram,
  MAX_DIAGRAM_ZOOM,
  MIN_DIAGRAM_ZOOM,
  panAfterContentResize,
  panAfterViewportResize,
  wheelIntent,
  type Size,
} from "../diagram/viewport";

const examples: Record<string, string> = {
  Flowchart:
    "flowchart TD\n  A[An idea] --> B{Worth exploring?}\n  B -->|Yes| C[Try something small]\n  B -->|Not yet| D[Keep thinking]\n  C --> E[Share what you learn]\n  D --> A",
  Sequence:
    "sequenceDiagram\n  participant A as Alex\n  participant B as Team\n  A->>B: Share an idea\n  B->>A: Ask questions\n  A->>B: Build a first draft",
  Mindmap:
    "mindmap\n  root((The next idea))\n    Why\n      The problem\n      The opportunity\n    How\n      First steps\n      People\n    What next",
};

export default function Diagram({
  doc,
  title,
  theme,
}: {
  doc: Y.Doc;
  title: string;
  theme: string;
}) {
  const text = doc.getText("diagram");
  const [source, setSource] = useState(text.toString());
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [panning, setPanning] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenFallback, setFullscreenFallback] = useState(false);
  const [stacked, setStacked] = useState(false);
  const [sourcePercent, setSourcePercent] = useState(38);
  const [sourceHeight, setSourceHeight] = useState(225);

  const sequence = useRef(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ReturnType<typeof Panzoom> | null>(null);
  const contentSize = useRef<Size | null>(null);
  const viewportSize = useRef<Size | null>(null);
  const hasFit = useRef(false);
  const dividerDrag = useRef<number | null>(null);

  useEffect(() => {
    const updateSource = () => setSource(text.toString());
    text.observe(updateSource);
    return () => text.unobserve(updateSource);
  }, [text]);

  useEffect(() => {
    const current = ++sequence.current;
    const timer = setTimeout(async () => {
      if (!source.trim()) {
        setSvg("");
        setError("");
        return;
      }
      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: theme === "dark" ? "dark" : "default",
          maxTextSize: 20000,
          suppressErrorRendering: true,
        });
        const result = await mermaid.render(`diagram-${current}-${Date.now()}`, source);
        if (current === sequence.current) {
          setSvg(result.svg);
          setError("");
        }
      } catch {
        if (current === sequence.current)
          setError("This diagram has a syntax error. Check the source and try again.");
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [source, theme]);

  // Panzoom owns all drag and multi-touch gesture handling. The source editor and
  // floating toolbar are outside this gesture surface.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const viewport = viewportRef.current;
    if (!stage || !viewport) return;

    const panzoom = Panzoom(stage, {
      canvas: true,
      cursor: "grab",
      minScale: MIN_DIAGRAM_ZOOM,
      maxScale: MAX_DIAGRAM_ZOOM,
      step: 0.23,
      duration: 170,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      pinchAndPan: true,
    });
    instanceRef.current = panzoom;
    const changed = () => setZoom(panzoom.getScale());
    const started = () => setPanning(true);
    const ended = () => setPanning(false);
    stage.addEventListener("panzoomchange", changed);
    stage.addEventListener("panzoomstart", started);
    stage.addEventListener("panzoomend", ended);

    function onWheel(event: WheelEvent) {
      if (event.cancelable) event.preventDefault();
      const scale = panzoom.getScale();
      if (wheelIntent(event) === "zoom") {
        const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport!.clientHeight : 1);
        const limited = Math.max(-240, Math.min(240, delta));
        panzoom.zoomToPoint(
          clampDiagramZoom(scale * Math.exp(-limited * (event.ctrlKey ? 0.012 : 0.0018))),
          { clientX: event.clientX, clientY: event.clientY },
          { animate: false },
        );
      } else {
        const pan = panzoom.getPan();
        panzoom.pan(pan.x - event.deltaX / scale, pan.y - event.deltaY / scale, { animate: false });
      }
    }
    viewport.addEventListener("wheel", onWheel, { passive: false });
    const observer = new ResizeObserver(() => {
      const next = { width: viewport.clientWidth, height: viewport.clientHeight };
      if (!next.width || !next.height) return;
      const prior = viewportSize.current;
      viewportSize.current = next;
      if (prior && (prior.width !== next.width || prior.height !== next.height)) {
        const moved = panAfterViewportResize(panzoom.getPan(), prior, next, panzoom.getScale());
        panzoom.pan(moved.x, moved.y, { animate: false });
      }
    });
    observer.observe(viewport);
    viewportSize.current = { width: viewport.clientWidth, height: viewport.clientHeight };
    return () => {
      observer.disconnect();
      viewport.removeEventListener("wheel", onWheel);
      stage.removeEventListener("panzoomchange", changed);
      stage.removeEventListener("panzoomstart", started);
      stage.removeEventListener("panzoomend", ended);
      instanceRef.current = null;
      panzoom.destroy();
      panzoom.resetStyle();
    };
  }, []);

  // Update the SVG's natural dimensions without scaling it to the viewport.
  // Only the first successful render is fitted; edits preserve the live camera.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const viewport = viewportRef.current;
    const panzoom = instanceRef.current;
    const graphic = stage?.querySelector("svg");
    if (!stage || !viewport || !panzoom || !graphic) return;
    const viewBox = graphic.viewBox.baseVal;
    const width = viewBox?.width || graphic.getBBox().width;
    const height = viewBox?.height || graphic.getBBox().height;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    const next = { width, height };
    const previous = contentSize.current;
    contentSize.current = next;
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;

    if (!hasFit.current) {
      hasFit.current = true;
      const fitted = fitDiagram(next, { width: viewport.clientWidth, height: viewport.clientHeight });
      panzoom.zoom(fitted.scale, { animate: false });
      panzoom.pan(fitted.x, fitted.y, { animate: false });
    } else if (previous) {
      const moved = panAfterContentResize(panzoom.getPan(), previous, next, panzoom.getScale());
      panzoom.pan(moved.x, moved.y, { animate: false });
    }
  }, [svg]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1000px)");
    const updateStacked = () => setStacked(media.matches);
    updateStacked();
    media.addEventListener("change", updateStacked);
    const onFullscreen = () => setFullscreen(document.fullscreenElement === outputRef.current);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      media.removeEventListener("change", updateStacked);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, []);

  useEffect(() => {
    if (!fullscreenFallback) return;
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setFullscreenFallback(false);
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [fullscreenFallback]);

  function frame(mode: "diagram" | "width", animate = true) {
    const viewport = viewportRef.current;
    const panzoom = instanceRef.current;
    if (!viewport || !panzoom || !contentSize.current) return;
    const target = fitDiagram(contentSize.current, { width: viewport.clientWidth, height: viewport.clientHeight }, mode);
    panzoom.zoom(target.scale, { animate });
    panzoom.pan(target.x, target.y, { animate });
  }

  function centerAt(scale: number) {
    const viewport = viewportRef.current;
    const panzoom = instanceRef.current;
    const size = contentSize.current;
    if (!viewport || !panzoom || !size) return;
    const bounded = clampDiagramZoom(scale);
    panzoom.zoom(bounded, { animate: true });
    panzoom.pan((viewport.clientWidth - size.width) / (2 * bounded), (viewport.clientHeight - size.height) / (2 * bounded), { animate: true });
  }

  function changeZoom(direction: -1 | 1) {
    const panzoom = instanceRef.current;
    const viewport = viewportRef.current;
    if (!panzoom || !viewport) return;
    const rect = viewport.getBoundingClientRect();
    panzoom.zoomToPoint(
      clampDiagramZoom(panzoom.getScale() * (direction === 1 ? 1.25 : 0.8)),
      { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 },
      { animate: true },
    );
  }

  async function toggleFullscreen() {
    const output = outputRef.current;
    if (!output) return;
    if (fullscreenFallback) {
      setFullscreenFallback(false);
    } else if (document.fullscreenElement === output) {
      await document.exitFullscreen();
    } else {
      try {
        await output.requestFullscreen();
      } catch {
        setFullscreenFallback(true);
      }
    }
  }

  function resizeSplit(event: PointerEvent<HTMLDivElement>) {
    if (dividerDrag.current !== event.pointerId || !splitRef.current) return;
    const rect = splitRef.current.getBoundingClientRect();
    if (stacked) {
      setSourceHeight(Math.max(120, Math.min(Math.max(120, rect.height - 230), event.clientY - rect.top)));
    } else {
      setSourcePercent(Math.max(20, Math.min(72, ((event.clientX - rect.left) / rect.width) * 100)));
    }
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (stacked && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      setSourceHeight((value) => Math.max(120, value + (event.key === "ArrowDown" ? 20 : -20)));
    } else if (!stacked && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      setSourcePercent((value) => Math.max(20, Math.min(72, value + (event.key === "ArrowRight" ? 2 : -2))));
    }
  }

  function update(value: string) {
    const previous = text.toString();
    let start = 0;
    while (start < previous.length && start < value.length && previous[start] === value[start]) start++;
    let end = 0;
    while (
      end < previous.length - start &&
      end < value.length - start &&
      previous[previous.length - 1 - end] === value[value.length - 1 - end]
    ) end++;
    doc.transact(() => {
      text.delete(start, previous.length - start - end);
      text.insert(start, value.slice(start, value.length - end));
    });
  }

  const expanded = fullscreen || fullscreenFallback;
  const splitStyle = {
    "--diagram-source-width": `${sourcePercent}%`,
    "--diagram-source-height": `${sourceHeight}px`,
  } as CSSProperties;

  return (
    <div className="diagram-editor">
      <div className="diagram-tools">
        <span><GitBranch size={17} /> Mermaid diagram</span>
        <select
          aria-label="Diagram examples"
          defaultValue=""
          onChange={(event) => {
            if (event.target.value && (!source || confirm("Replace the current diagram?")))
              update(examples[event.target.value]);
            event.target.value = "";
          }}
        >
          <option value="">Insert example</option>
          {Object.keys(examples).map((name) => <option key={name}>{name}</option>)}
        </select>
        <button disabled={!svg || !!error} onClick={() => download(`${title}.svg`, svg, "image/svg+xml")}>
          <Download size={16} /> Export SVG
        </button>
      </div>
      <div className="diagram-split" ref={splitRef} style={splitStyle}>
        <label className="diagram-source">
          <span>SOURCE</span>
          <textarea
            spellCheck={false}
            aria-label="Diagram source"
            maxLength={20000}
            value={source}
            onChange={(event) => update(event.target.value)}
            placeholder="Choose an example above, or write a Mermaid diagram."
          />
        </label>
        <div
          className="diagram-divider"
          role="separator"
          tabIndex={0}
          aria-label="Resize source and diagram panels"
          aria-orientation={stacked ? "horizontal" : "vertical"}
          aria-valuemin={stacked ? 120 : 20}
          aria-valuemax={stacked ? 1000 : 72}
          aria-valuenow={stacked ? sourceHeight : Math.round(sourcePercent)}
          onKeyDown={resizeWithKeyboard}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            dividerDrag.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
          }}
          onPointerMove={resizeSplit}
          onPointerUp={(event) => {
            if (dividerDrag.current === event.pointerId) dividerDrag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { dividerDrag.current = null; }}
        />
        <div ref={outputRef} className={`diagram-output${fullscreenFallback ? " diagram-fullscreen-fallback" : ""}`}>
          <div
            ref={viewportRef}
            className={`diagram-viewport${panning ? " is-panning" : ""}`}
            role="region"
            tabIndex={0}
            aria-label="Mermaid diagram canvas. Drag to pan, wheel or pinch to zoom."
            onPointerDownCapture={(event) => {
              if (event.pointerType === "mouse" && event.button === 2) event.stopPropagation();
            }}
            onAuxClick={(event) => { if (event.button === 1) event.preventDefault(); }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "+" || event.key === "=") { event.preventDefault(); changeZoom(1); }
              if (event.key === "-") { event.preventDefault(); changeZoom(-1); }
              if (event.key === "0") { event.preventDefault(); centerAt(1); }
            }}
          >
            <div className="diagram-stage" ref={stageRef}>
              <div className="diagram-svg" dangerouslySetInnerHTML={{ __html: svg }} />
            </div>
          </div>
          {error ? (
            <p className="error diagram-canvas-message" role="alert">{error}</p>
          ) : !svg ? (
            <div className="diagram-canvas-message empty">
              <GitBranch size={36} />
              <h3>Connect the dots.</h3>
              <p>Flowcharts, sequences, and mind maps.<br />Choose an example to get started.</p>
            </div>
          ) : null}
          <div className="diagram-canvas-hint" aria-hidden="true">Drag to pan · Scroll to explore · Pinch to zoom</div>
          <div className="diagram-canvas-toolbar" role="toolbar" aria-label="Diagram view">
            <button type="button" aria-label="Zoom out" title="Zoom out" disabled={zoom <= MIN_DIAGRAM_ZOOM} onClick={() => changeZoom(-1)}><Minus size={16} /></button>
            <output aria-label="Current zoom" aria-live="off">{Math.round(zoom * 100)}%</output>
            <button type="button" aria-label="Zoom in" title="Zoom in" disabled={zoom >= MAX_DIAGRAM_ZOOM} onClick={() => changeZoom(1)}><Plus size={16} /></button>
            <span className="diagram-toolbar-separator" />
            <button type="button" className="diagram-toolbar-text" disabled={!svg} title="Fit the whole diagram" onClick={() => frame("diagram")}><Scan size={16} /><span>Fit Diagram</span></button>
            <button type="button" className="diagram-toolbar-text" disabled={!svg} title="Fit diagram width" onClick={() => frame("width")}><MoveHorizontal size={16} /><span>Fit Width</span></button>
            <button type="button" title="Reset to centered 100%" aria-label="Reset view" disabled={!svg} onClick={() => centerAt(1)}><RotateCcw size={16} /></button>
            <span className="diagram-toolbar-separator" />
            <button type="button" aria-label={expanded ? "Exit fullscreen" : "Fullscreen canvas"} title={expanded ? "Exit fullscreen" : "Fullscreen canvas"} onClick={() => void toggleFullscreen()}>
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
