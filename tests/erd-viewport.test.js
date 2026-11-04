import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_ZOOM, MAX_ZOOM, clampZoom, stepZoom, screenToWorld, worldToScreen,
  panCamera, zoomAround, fitCamera,
} from "../src/erd/viewport.ts";

test("zoom is clamped and button stops include detailed and very wide views", () => {
  assert.equal(clampZoom(0), MIN_ZOOM);
  assert.equal(clampZoom(100), MAX_ZOOM);
  assert.equal(clampZoom(Number.NaN), 1);
  assert.equal(stepZoom(1, 1), 1.25);
  assert.equal(stepZoom(1, -1), 0.75);
  assert.equal(stepZoom(0.03, 1), 0.05);
  assert.equal(stepZoom(MIN_ZOOM, -1), MIN_ZOOM);
  assert.equal(stepZoom(MAX_ZOOM, 1), MAX_ZOOM);
});
test("world coordinates are unrestricted in every direction", () => {
  const camera = {x: -400, y: 800, zoom: 0.5};
  const point = {x: -135000, y: 252000};
  const screen = worldToScreen(camera, point);
  assert.deepEqual(screenToWorld(camera, screen), point);
  const moved = panCamera(camera, -5_000_000, 7_000_000);
  assert.equal(moved.x, -5_000_400);
  assert.equal(moved.y, 7_000_800);
  assert.deepEqual(screenToWorld(moved, worldToScreen(moved,point)),point);
});
test("cursor-based zoom keeps the same world coordinate under a pointer", () => {
  const camera = {x:-220, y:165, zoom:1};
  const pointer = {x:300, y:175};
  const target = screenToWorld(camera,pointer);
  const zoomed = zoomAround(camera,2,pointer);
  assert.deepEqual(screenToWorld(zoomed,pointer),target);
  assert.deepEqual(zoomAround(zoomed,1,pointer),camera);
  const negative = zoomAround({x:5000,y:-4500,zoom:0.5},0.125,{x:50,y:70});
  assert.deepEqual(screenToWorld(negative,{x:50,y:70}),
    screenToWorld({x:5000,y:-4500,zoom:0.5},{x:50,y:70}));
});
test("fit frames actual content far beyond old page borders", () => {
  const rects = [
    {x:-1300,y:-900,width:250,height:170},
    {x:2300,y:1350,width:280,height:190},
  ];
  const camera = fitCamera(rects,{width:850,height:520},40);
  assert.ok(camera.zoom < 0.25 && camera.zoom > 0.01);
  const left = Math.min(...rects.map(r=>worldToScreen(camera,{x:r.x,y:r.y}).x));
  const right = Math.max(...rects.map(r=>worldToScreen(camera,{x:r.x+r.width,y:r.y+r.height}).x));
  const top = Math.min(...rects.map(r=>worldToScreen(camera,{x:r.x,y:r.y}).y));
  const bottom = Math.max(...rects.map(r=>worldToScreen(camera,{x:r.x+r.width,y:r.y+r.height}).y));
  assert.ok(left >= 39 && right <= 811);
  assert.ok(top >= 39 && bottom <= 481);
});
test("fit-to-view with no elements gives a comfortable origin-centered canvas", () => {
  const camera = fitCamera([],{width:1000,height:700});
  assert.equal(camera.zoom,1);
  assert.deepEqual(worldToScreen(camera,{x:300,y:200}),{x:500,y:350});
});
