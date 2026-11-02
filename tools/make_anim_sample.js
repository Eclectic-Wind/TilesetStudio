// Builds samples/AnimSample.studio.json (a project) and samples/AnimSample.export.json (its version 6 bundle): two flipbook clips on
// a 256 x 256 tileset, made headless with the Studio's own Process and Bundle code. No Aseprite needed: the colour frames (what
// the Albedo group sends) are painted here and stored in the project like the link would, as each clip's `albedo` sheet.
//   TvStatic   8 frames, 12 fps, on "TV": a box 40 px high (a piece with real height; the screen is the animated part)
//   FloorDrip  6 frames, 8 fps, on "FloorDrip": a flat puddle (kind floor; ripples)
// Usage: node tools/make_anim_sample.js [outDir]   (default samples/)
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), { spawnSync } = require("child_process");
const { encodePNG } = require("./png");
const root = path.join(__dirname, "..");
const ctx = { console, Math, JSON, Map, Set, Float32Array, Uint8Array, Int32Array, Int16Array, Uint8ClampedArray, btoa };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["math", "proj", "shape", "mesh", "rig", "process", "bundle"]) vm.runInContext(fs.readFileSync(path.join(root, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
const TS = ctx.TS, M = TS.Mesh, P = TS.Process, Rig = TS.Rig;
const outDir = process.argv[2] || path.join(root, "samples");

const W = 256, H = 256;
const tv = M.box([96, 150, 0], 48, 32, 40); tv.name = "TV"; tv.tags = "tv";
const drip = M.box([176, 170, 0], 40, 28, 2); drip.name = "FloorDrip";
const objects = [tv, drip];
const settings = Object.assign(P.defaultSettings(), {});

// Which model owns each canvas pixel, its height and facing: what the painting below follows.
const probe = P.run(objects, { w: W, h: H, alpha: new Uint8Array(W * H).fill(255), data: new Uint8ClampedArray(W * H * 4) }, settings);
const own = (i) => probe.owner[i], frontFace = (i) => probe.normal[i * 3 + 1] > 0.7;
const hash = (x, y, f) => { let h = (x * 374761393 + y * 668265263 + f * 1274126177) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
// The TV's screen: the front face between 8 and 34 px high, 6 px in from its sides.
const tvB = M.bounds(tv, Array.from(tv.verts.keys()));
const screen = (i) => { const x = i % W; return own(i) === 0 && frontFace(i) && probe.height[i] > 8 && probe.height[i] < 34 && x > tvB.min[0] + 6 && x < tvB.max[0] - 6; };
const dripB = M.bounds(drip, Array.from(drip.verts.keys())), dcx = (dripB.min[0] + dripB.max[0]) / 2, dcy = (dripB.min[1] + dripB.max[1]) / 2;

// The base frame (the atlas): TV with a dark screen, the puddle.
const atlas = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) {
	const o = own(i);
	if (o < 0) continue;
	let c;
	if (o === 0) c = screen(i) ? [18, 28, 52] : frontFace(i) ? [72, 70, 78] : [150, 148, 156];
	else c = [38, 66, 88];
	atlas.set([...c, 255], i * 4);
}

// A clip's Albedo sheet: Rig.layout cells of the whole tileset, frame f painted where its model is.
function sheet(frames, paint) {
	const lay = Rig.layout(W, H, frames), img = new Uint8ClampedArray(lay.w * lay.h * 4);
	for (let f = 0; f < frames; f++) {
		const [ox, oy] = Rig.cellOrigin(lay, f);
		for (let i = 0; i < W * H; i++) {
			const c = paint(i, f);
			if (c) img.set([...c, 255], ((oy + ((i / W) | 0)) * lay.w + ox + (i % W)) * 4);
		}
	}
	return "data:image/png;base64," + encodePNG(img, lay.w, lay.h).toString("base64");
}
const tvSheet = sheet(8, (i, f) => {
	if (own(i) !== 0) return null;
	if (!screen(i)) return frontFace(i) ? [72, 70, 78] : [150, 148, 156];
	const y = (i / W) | 0, x = i % W, n = hash(x, y, f), bar = Math.abs(((y + f * 5) % 28) - 14) < 2;
	const v = Math.round(60 + n * 170 + (bar ? 25 : 0));
	return [Math.min(255, v - 20), Math.min(255, v), Math.min(255, v + 25)];
});
const dripSheet = sheet(6, (i, f) => {
	if (own(i) !== 1) return null;
	const d = Math.hypot((i % W) + 0.5 - dcx, ((i / W) | 0) + 0.5 - dcy), ring = Math.abs(d - (2 + f * 3.2));
	const k = Math.max(0, 1 - ring / 2);
	return [38 + Math.round(k * 120), 66 + Math.round(k * 120), 88 + Math.round(k * 120)];
});

const clips = [
	{ id: "c1", name: "TvStatic", fps: 12, frames: 8, tracks: {}, models: [tv.id], albedo: tvSheet },
	{ id: "c2", name: "FloorDrip", fps: 8, frames: 6, tracks: {}, models: [drip.id], albedo: dripSheet },
];
const project = {
	format: "tileset-studio", version: 2, bundleId: "5b0a8f3e-6a1c-4d2e-9f47-3c8a1d2e7b90", name: "AnimSample", exportName: "AnimSample",
	tileset: "data:image/png;base64," + encodePNG(atlas, W, H).toString("base64"), cursor: [128, 128, 0], snap: 1, settings,
	objects, anim: { bones: [], bind: {}, clips, clip: "c1", frame: 0, albedo: tvSheet }, references: [],
};
fs.mkdirSync(outDir, { recursive: true });
const proj = path.join(outDir, "AnimSample.studio.json"), bundle = path.join(outDir, "AnimSample.export.json");
fs.writeFileSync(proj, JSON.stringify(project, null, 1));
const r = spawnSync(process.execPath, [path.join(__dirname, "export_project.js"), proj, bundle], { encoding: "utf8" });
process.stdout.write(r.stdout + r.stderr);
process.exit(r.status || 0);
