import {test} from "node:test";
import assert from "node:assert/strict";
import {
  MIN_ZOOM, MAX_ZOOM, ERD_WIDTH, ERD_HEIGHT,
  clampZoom, stepZoom, anchoredScroll, fitZoom,
} from "../src/erd/viewport.ts";

test("zoom levels are bounded, deterministic and navigate common stops", () => {
  assert.equal(clampZoom(0.01), MIN_ZOOM);
  assert.equal(clampZoom(5), MAX_ZOOM);
  assert.equal(clampZoom(Number.NaN), 1);
  assert.equal(stepZoom(1,1), 1.25);
  assert.equal(stepZoom(1,-1), 0.75);
  assert.equal(stepZoom(1.1,1), 1.25);
  assert.equal(stepZoom(1.1,-1), 1);
  assert.equal(stepZoom(MAX_ZOOM,1), MAX_ZOOM);
  assert.equal(stepZoom(MIN_ZOOM,-1), MIN_ZOOM);
});

test("zooming around the mouse maintains the same diagram coordinate under the pointer", () => {
  const previous = {left:300,top:200};
  const pointer = {x:150,y:75};
  const newScroll = anchoredScroll(1,2,previous,pointer);
  assert.deepEqual(newScroll,{left:750,top:475});
  assert.equal((previous.left+pointer.x)/1,(newScroll.left+pointer.x)/2);
  assert.equal((previous.top+pointer.y)/1,(newScroll.top+pointer.y)/2);
  const back = anchoredScroll(2,1,newScroll,pointer);
  assert.deepEqual(back,previous);
});

test("fit to diagram uses the bounding rectangle of all elements", () => {
  const result = fitZoom([
    {x:100,y:100,width:236,height:130},
    {x:750,y:500,width:240,height:200},
  ],{width:700,height:500},40);
  assert.equal(result.zoom,0.697);
  // The point at the center of the drawn content remains centered in the viewport.
  const diagramMidX = (100+990)/2, diagramMidY = (100+700)/2;
  assert.ok(Math.abs(result.scroll.left-(diagramMidX*result.zoom-350))<0.01);
  assert.ok(Math.abs(result.scroll.top-(diagramMidY*result.zoom-250))<0.01);
});

test("fit an empty diagram shows the standard stage, without exceeding 100%", () => {
  const result = fitZoom([],{width:2400,height:1600});
  assert.equal(result.zoom,1);
  assert.equal(result.scroll.left,(ERD_WIDTH-2400)/2);
  assert.equal(result.scroll.top,(ERD_HEIGHT-1600)/2);
});
