import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampDiagramZoom,
  fitDiagram,
  MAX_DIAGRAM_ZOOM,
  MIN_DIAGRAM_ZOOM,
  panAfterContentResize,
  panAfterViewportResize,
  wheelIntent,
} from "../src/diagram/viewport.ts";

// Panzoom applies scale(s) translate(x,y) about the HTML element's center.
function screen(view, content, point) {
  return {
    x: (1 - view.scale) * content.width / 2 + view.scale * (point.x + view.x),
    y: (1 - view.scale) * content.height / 2 + view.scale * (point.y + view.y),
  };
}
function close(a, b) { assert.ok(Math.abs(a - b) < 0.0001, `${a} should be ${b}`); }

test("fit frames a very tall Mermaid SVG, with no unnecessary upscaling", () => {
  const content = { width: 400, height: 12000 };
  const viewport = { width: 900, height: 650 };
  const view = fitDiagram(content, viewport);
  const topLeft = screen(view, content, { x: 0, y: 0 });
  const bottomRight = screen(view, content, { x: content.width, y: content.height });
  assert.ok(view.scale < 0.06);
  assert.ok(topLeft.x >= 48 && bottomRight.x <= 852);
  assert.ok(topLeft.y >= 48 && bottomRight.y <= 602);
  assert.equal(fitDiagram({ width: 150, height: 90 }, viewport).scale, 1);
});

test("fit width centers the full width while allowing tall content to overflow", () => {
  const content = { width: 2500, height: 16000 };
  const viewport = { width: 900, height: 600 };
  const view = fitDiagram(content, viewport, "width");
  assert.ok(view.scale > fitDiagram(content, viewport).scale);
  close(screen(view, content, { x: 0, y: 0 }).x, 48);
  close(screen(view, content, { x: content.width, y: 0 }).x, 852);
  close(screen(view, content, { x: 0, y: 0 }).y, 48);
});

test("extreme dimensions use bounded zoom and do not produce infinities", () => {
  assert.equal(clampDiagramZoom(0), MIN_DIAGRAM_ZOOM);
  assert.equal(clampDiagramZoom(999), MAX_DIAGRAM_ZOOM);
  assert.equal(clampDiagramZoom(NaN), 1);
  const view = fitDiagram({ width: 80000, height: 300000 }, { width: 800, height: 500 });
  assert.equal(view.scale, MIN_DIAGRAM_ZOOM);
  assert.ok(Number.isFinite(view.x) && Number.isFinite(view.y));
  close(screen(view, { width: 80000, height: 300000 }, { x: 0, y: 0 }).x, 48);
  close(screen(view, { width: 80000, height: 300000 }, { x: 0, y: 0 }).y, 48);
});

test("Mermaid rerenders preserve pan, zoom and the existing top-left anchor", () => {
  const oldSize = { width: 900, height: 1800 };
  const nextSize = { width: 1800, height: 3000 };
  const zoom = 0.65;
  const pan = { x: -125, y: 220 };
  const moved = panAfterContentResize(pan, oldSize, nextSize, zoom);
  const oldTop = screen({ ...pan, scale: zoom }, oldSize, { x: 0, y: 0 });
  const newTop = screen({ ...moved, scale: zoom }, nextSize, { x: 0, y: 0 });
  close(oldTop.x, newTop.x);
  close(oldTop.y, newTop.y);
});

test("resizing and fullscreen keep the world point at the viewport center", () => {
  const content = { width: 1400, height: 900 };
  const from = { width: 520, height: 450 };
  const to = { width: 1900, height: 1200 };
  const pan = { x: -200, y: -100 };
  const scale = 1.6;
  const next = panAfterViewportResize(pan, from, to, scale);
  const atOldCenter = screen({ ...pan, scale }, content, { x: 0, y: 0 });
  const atNewCenter = screen({ ...next, scale }, content, { x: 0, y: 0 });
  close(atNewCenter.x - atOldCenter.x, (to.width - from.width) / 2);
  close(atNewCenter.y - atOldCenter.y, (to.height - from.height) / 2);
});

test("physical mouse wheel zooms, trackpad scrolling pans and pinch zooms", () => {
  const event = (more) => ({ ctrlKey: false, metaKey: false, deltaMode: 0, deltaX: 0, deltaY: 0, ...more });
  assert.equal(wheelIntent(event({ deltaMode: 1, deltaY: 3 })), "zoom");
  assert.equal(wheelIntent(event({ deltaY: 100 })), "zoom");
  assert.equal(wheelIntent(event({ deltaY: 5 })), "pan");
  assert.equal(wheelIntent(event({ deltaX: 13, deltaY: 25 })), "pan");
  assert.equal(wheelIntent(event({ ctrlKey: true, deltaY: 1 })), "zoom");
});
