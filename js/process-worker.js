// Runs the model -> maps processing (TS.Process) off the page's thread, so editing stays smooth while it works. The app sends the
// models and settings, plus the art when it changed; the arrays of the result come back as transfers (no copy). Export and the
// other callers that need the result at once still process on the page (app.js processNow), as does a page opened from file://,
// where browsers refuse workers.
"use strict";
self.window = self;
importScripts("math.js", "proj.js", "shape.js", "mesh.js", "process.js");

let art = null, prev = null;
self.onmessage = ({ data: { gen, objects, settings, newArt } }) => {
	if (newArt) { art = newArt; prev = null; }
	const P = TS.Process, r = P.run(objects, art, settings);
	r.pieceMap = P.pieces(objects, r, settings);
	const litNormal = P.litNormals(r, settings, prev);
	// The next run's normals only redo what changed since this one: keep what they compare against (the originals are transferred).
	prev = { result: { art, proj: r.proj, height: r.height.slice(), normal: r.normal.slice(), owner: r.owner.slice() }, normals: litNormal.slice(), relief: settings.relief, cavity: settings.cavity };
	const checks = { columns: P.clashes(r.pieceMap), shared: P.cellOwnership(objects, r, settings).clashes.filter((c) => !c.samePiece) };
	// The page puts its own art and projection (which holds functions) back.
	delete r.art; delete r.alpha; delete r.proj;
	const f = r.floor, c = r.collision, pm = r.pieceMap;
	const moved = [r.height, r.normal, r.rough, r.metal, r.owner, r.hole, r.clipped, f.top, f.bottom, f.owner, f.spanStart, f.spanData, f.pairStart, f.pairA, f.pairB, f.pairObj, c.mask, c.owner, pm.pieceOf, pm.artPiece, pm.floorPiece, litNormal];
	self.postMessage({ gen, result: r, litNormal, checks }, moved.map((a) => a.buffer));
};
