/** Geometry for Panzoom's HTML transform: scale(s) translate(x, y) around 50% 50%. */
export const MIN_DIAGRAM_ZOOM = 0.01;
export const MAX_DIAGRAM_ZOOM = 6;

export type Size = { width: number; height: number };
export type Pan = { x: number; y: number };
export type View = Pan & { scale: number };

export function clampDiagramZoom(scale: number) {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_DIAGRAM_ZOOM, Math.max(MIN_DIAGRAM_ZOOM, scale));
}

export function fitDiagram(content: Size, viewport: Size, mode: "diagram" | "width" = "diagram", padding = 48): View {
  const width = Math.max(1, content.width);
  const height = Math.max(1, content.height);
  const scale = clampDiagramZoom(Math.min(
    1,
    Math.max(1, viewport.width - padding * 2) / width,
    mode === "diagram" ? Math.max(1, viewport.height - padding * 2) / height : Infinity,
  ));
  // When a diagram is too large even at the minimum scale (or when fitting
  // only its width), begin at the top/left rather than hiding the first node.
  function axisPan(length: number, available: number) {
    const scaled = length * scale;
    const offset = scaled > available - padding * 2 ? padding : (available - scaled) / 2;
    return (offset - (1 - scale) * length / 2) / scale;
  }
  return {
    scale,
    x: axisPan(width, viewport.width),
    y: axisPan(height, viewport.height),
  };
}

/** Avoid an unexpected jump in top-left SVG content when Mermaid's viewBox changes. */
export function panAfterContentResize(pan: Pan, previous: Size, next: Size, scale: number): Pan {
  return {
    x: pan.x + ((1 - scale) * (previous.width - next.width)) / (2 * scale),
    y: pan.y + ((1 - scale) * (previous.height - next.height)) / (2 * scale),
  };
}

/** Keep the same world point under the center of a resized canvas. */
export function panAfterViewportResize(pan: Pan, previous: Size, next: Size, scale: number): Pan {
  return {
    x: pan.x + (next.width - previous.width) / (2 * scale),
    y: pan.y + (next.height - previous.height) / (2 * scale),
  };
}

/** Mouse wheels zoom; continuous two-finger trackpad scrolling pans; pinch (Ctrl+wheel) zooms. */
export function wheelIntent(event: Pick<WheelEvent, "ctrlKey" | "metaKey" | "deltaMode" | "deltaX" | "deltaY">): "zoom" | "pan" {
  if (event.ctrlKey || event.metaKey || event.deltaMode !== 0) return "zoom";
  if (Math.abs(event.deltaX) > 0) return "pan";
  return Math.abs(event.deltaY) >= 60 ? "zoom" : "pan";
}
