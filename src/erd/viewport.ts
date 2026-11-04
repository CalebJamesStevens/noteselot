/** Browser-local pan/zoom. World coordinates have no canvas edges and aren't shared via Yjs. */
export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 2.5;
const zoomStops = [0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5];
export type Point = { x: number; y: number };
export type Camera = Point & { zoom: number };
export type Rect = Point & { width: number; height: number };

export function clampZoom(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value)) * 1000) / 1000;
}
export function stepZoom(current: number, direction: -1 | 1) {
  if (direction > 0) return zoomStops.find(value => value > current + 0.0001) ?? MAX_ZOOM;
  return [...zoomStops].reverse().find(value => value < current - 0.0001) ?? MIN_ZOOM;
}
/** A camera's x/y are its translation in viewport pixels (not a scroll position). */
export function screenToWorld(camera: Camera, point: Point): Point {
  return {x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom};
}
export function worldToScreen(camera: Camera, point: Point): Point {
  return {x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y};
}
export function panCamera(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x + dx, y: camera.y + dy };
}
/** Keep the world point under the pointer fixed while zooming. Works at negative coordinates. */
export function zoomAround(camera: Camera, value: number, pointer: Point): Camera {
  const zoom = clampZoom(value);
  const world = screenToWorld(camera, pointer);
  return {zoom, x: pointer.x - world.x * zoom, y: pointer.y - world.y * zoom};
}
/** Fit ONLY real diagram elements; the old 1600×1050 page is not a boundary. */
export function fitCamera(rects: Rect[], viewport: {width: number; height: number}, padding = 48): Camera {
  const values = rects.length ? rects : [{x:0,y:0,width:600,height:400}];
  const left = Math.min(...values.map(r => r.x));
  const top = Math.min(...values.map(r => r.y));
  const right = Math.max(...values.map(r => r.x + r.width));
  const bottom = Math.max(...values.map(r => r.y + r.height));
  const width = Math.max(1, right - left), height = Math.max(1, bottom - top);
  const zoom = clampZoom(Math.min(1,
    Math.max(1,viewport.width - padding*2) / width,
    Math.max(1,viewport.height - padding*2) / height));
  return {
    zoom,
    x: viewport.width / 2 - ((left + right) / 2) * zoom,
    y: viewport.height / 2 - ((top + bottom) / 2) * zoom,
  };
}
