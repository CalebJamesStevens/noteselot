/** Viewport coordinates are local UI state. They are not part of the shared ERD JSON/Yjs document. */
export const ERD_WIDTH = 1600;
export const ERD_HEIGHT = 1050;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2.5;
const zoomStops = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5];
export type Rect = { x: number; y: number; width: number; height: number };
export type ScrollPosition = { left: number; top: number };
export function clampZoom(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value)) * 1000) / 1000;
}
export function stepZoom(current: number, direction: -1 | 1) {
  if (direction > 0) return zoomStops.find(value => value > current + 0.0001) ?? MAX_ZOOM;
  return [...zoomStops].reverse().find(value => value < current - 0.0001) ?? MIN_ZOOM;
}
/** Recalculate scrolling so the point under the cursor stays in the same place after zoom. */
export function anchoredScroll(
  currentZoom: number, newZoom: number, scroll: ScrollPosition, pointer: {x: number; y: number},
): ScrollPosition {
  return {
    left: (scroll.left + pointer.x) * newZoom / currentZoom - pointer.x,
    top: (scroll.top + pointer.y) * newZoom / currentZoom - pointer.y,
  };
}
export function fitZoom(rects: Rect[], viewport: {width: number; height: number}, padding = 48) {
  let left = 0, top = 0, right = ERD_WIDTH, bottom = ERD_HEIGHT;
  if (rects.length) {
    left = Math.min(...rects.map(r => r.x));
    top = Math.min(...rects.map(r => r.y));
    right = Math.max(...rects.map(r => r.x + r.width));
    bottom = Math.max(...rects.map(r => r.y + r.height));
  }
  const width = Math.max(1, right - left), height = Math.max(1, bottom - top);
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const zoom = clampZoom(Math.min(1, availableWidth / width, availableHeight / height));
  const contentCenterX = (left + right) / 2, contentCenterY = (top + bottom) / 2;
  return {
    zoom,
    scroll: {
      left: contentCenterX * zoom - viewport.width / 2,
      top: contentCenterY * zoom - viewport.height / 2,
    },
  };
}
