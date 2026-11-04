// Tests for the animation data and maths, run headless with the Studio's own code in a vm. Usage: node tools/test_anim.js
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const root = path.join(__dirname, "..");
const ctx = { console, btoa, atob, TextEncoder, TextDecoder };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["math", "proj", "shape", "mesh", "rig", "process", "bundle", "gltf", "transfer"]) vm.runInContext(fs.readFileSync(path.join(root, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
const TS = ctx.TS, R = TS.Rig, P = TS.Process, M = TS.Mesh;

let failed = 0, passed = 0;
const test = (name, fn) => {
	try { fn(); passed++; console.log("  ok  " + name); }
	catch (e) { failed++; console.log("FAIL  " + name + "\n      " + e.message); }
};
const near = (a, b, tol = 0.01, what = "") => {
	const x = Array.from(a), y = Array.from(b);
	x.forEach((v, i) => assert(Math.abs(v - y[i]) <= tol, `${what} [${x.map((n) => n.toFixed(2))}] should be [${y.map((n) => n.toFixed(2))}]`));
};
const arm = () => ({ bones: [{ id: "b1", name: "arm", parent: null, head: [0, 0, 0], tail: [0, 0, 24] }], bind: {}, clips: [], clip: null, frame: 0 });
const clipOf = (frames, tracks = {}, extra = {}) => Object.assign({ id: "c1", name: "c", fps: 8, frames, tracks }, extra);
const tipAt = (a, c, f) => R.apply(R.matrices(a, c, f).get("b1"), [0, 0, 24]);
const rad = (d) => (d * Math.PI) / 180;

console.log("Rotation");
for (const deg of [60, 89, 100, 135, 170, 179]) test(`a ${deg} degree swing about Y stays in its plane at the right angle`, () => {
	const a = arm(), c = clipOf(9);
	const p = R.poseAfter(a, c, 8, a.bones[0], { c: [0, 0, 0], u: [0, 1, 0], rad: rad(deg) });
	R.setKey(c, "b1", 0, [0, 0, 0], [0, 0, 0]);
	R.setKey(c, "b1", 8, p.rot, p.pos);
	near(p.rot, [0, deg, 0], 0.01, "key euler");
	for (let f = 0; f <= 8; f++) near(tipAt(a, c, f), [24 * Math.sin(rad((deg * f) / 8)), 0, 24 * Math.cos(rad((deg * f) / 8))], 0.01, `frame ${f}`);
});
test("keys saved in the flipped form ([180, 80, 180]) still blend correctly", () => {
	const a = arm(), c = clipOf(9, { b1: [{ f: 0, rot: [0, 0, 0], pos: [0, 0, 0] }, { f: 8, rot: [180, 80, 180], pos: [0, 0, 0] }] });
	near(tipAt(a, c, 4), [24 * Math.sin(rad(50)), 0, 24 * Math.cos(rad(50))]);
});
test("170 to -170 goes the short way round through 180", () => {
	const c = clipOf(3, { b1: [{ f: 0, rot: [0, 0, 170], pos: [0, 0, 0] }, { f: 2, rot: [0, 0, -170], pos: [0, 0, 0] }] });
	assert(Math.abs(Math.abs(R.localPose(c, "b1", 1).rot[2]) - 180) < 0.01);
});
test("nearEuler keeps continuing past 180", () => { near(R.nearEuler(R.eulerToMat([0, 0, -170]), [0, 0, 175]), [0, 0, 190]); });
test("every key form gives back the same rotation", () => {
	for (const e of [[10, 20, 30], [120, 80, -40], [-170, 5, 95], [0, 90, 0]]) {
		const m = R.eulerToMat(e), back = R.eulerToMat(R.nearEuler(m, [40, -30, 200]));
		near(back.flat(), m.flat(), 1e-6, "matrix");
	}
});
test("a frame before the first key still eases in from rest, past 90 too", () => {
	const a = arm(), c = clipOf(9, { b1: [{ f: 8, rot: [0, 120, 0], pos: [0, 0, 0] }] });
	near(tipAt(a, c, 4), [24 * Math.sin(rad(60)), 0, 24 * Math.cos(rad(60))]);
});

console.log("Easing and playback");
const eased = (ease) => R.localPose(clipOf(5, { b1: [Object.assign({ f: 0, rot: [0, 0, 0], pos: [0, 0, 0] }, ease ? { ease } : {}), { f: 4, rot: [0, 0, 0], pos: [8, 0, 0] }] }), "b1", 1).pos[0];
test("linear", () => near([eased()], [2]));
test("ease in starts slow", () => near([eased("in")], [0.5]));
test("ease out starts fast", () => near([eased("out")], [3.5]));
test("ease in-out", () => near([eased("inout")], [8 * (0.0625 * 3 - 0.125 * 0.25 * 2)], 0.3));
test("hold keeps the pose until the next key", () => {
	near([eased("hold")], [0]);
	const c = clipOf(5, { b1: [{ f: 0, ease: "hold", rot: [0, 0, 0], pos: [0, 0, 0] }, { f: 4, rot: [0, 0, 0], pos: [8, 0, 0] }] });
	near(R.localPose(c, "b1", 4).pos, [8, 0, 0]);
});
test("setKey on an existing key keeps its ease", () => {
	const c = clipOf(5, { b1: [{ f: 0, ease: "hold", rot: [0, 0, 0], pos: [0, 0, 0] }] });
	R.setKey(c, "b1", 0, [1, 2, 3], [0, 0, 0]);
	assert.strictEqual(c.tracks.b1[0].ease, "hold");
});
const seq = (c, start, n) => Array.from({ length: n }, (_, t) => R.playFrame(c, start, t).f).join("");
test("loop wraps", () => assert.strictEqual(seq(clipOf(4), 0, 9), "012301230"));
test("once stops on the last frame", () => {
	const c = clipOf(4, {}, { loop: "once" });
	assert.strictEqual(seq(c, 0, 6), "012333");
	assert.strictEqual(R.playFrame(c, 0, 2).done, false);
	assert.strictEqual(R.playFrame(c, 0, 3).done, true);
});
test("ping-pong bounces without repeating the ends", () => assert.strictEqual(seq(clipOf(4, {}, { loop: "pingpong" }), 0, 9), "012321012"));
test("ping-pong of one frame stands still", () => assert.strictEqual(seq(clipOf(1, {}, { loop: "pingpong" }), 0, 3), "000"));

console.log("Editing keys");
const key = (f, v) => ({ f, rot: [v, 0, 0], pos: [0, 0, 0] });
test("moving keys keeps them as a block inside the clip", () => {
	const c = clipOf(8, { b1: [key(1, 1), key(3, 3)] });
	const out = R.moveKeys(c, [{ id: "b1", f: 1 }, { id: "b1", f: 3 }], 100);
	assert.strictEqual(c.tracks.b1.map((k) => k.f).join(), "5,7");
	assert.strictEqual(out.length, 2);
});
test("a moved key replaces what it lands on; Alt copies", () => {
	const c = clipOf(8, { b1: [key(1, 1), key(2, 2)] });
	R.moveKeys(c, [{ id: "b1", f: 1 }], 1);
	assert.strictEqual(c.tracks.b1.map((k) => [k.f, k.rot[0]]).join(";"), "2,1");
	R.moveKeys(c, [{ id: "b1", f: 2 }], 3, true);
	assert.strictEqual(c.tracks.b1.map((k) => k.f).join(), "2,5");
});
test("paste goes at the playhead, keeps ease, and drops what falls past the end", () => {
	const a = arm(), c = clipOf(8, { b1: [Object.assign(key(1, 1), { ease: "in" }), key(4, 4)] });
	const copied = R.copyKeys(c, [{ id: "b1", f: 1 }, { id: "b1", f: 4 }]);
	assert.strictEqual(R.pasteKeys(c, copied, 6, a).length, 1);
	assert.strictEqual(R.keyAt(c, "b1", 6).ease, "in");
});
test("close loop", () => {
	const c = clipOf(8, { b1: [key(0, 30), key(3, 60)] });
	R.closeLoop(c, ["b1"]);
	near(R.keyAt(c, "b1", 7).rot, [30, 0, 0]);
});
test("mirror names", () => {
	for (const [x, y] of [["arm.L", "arm.R"], ["Leg_r", "Leg_l"], ["LeftArm", "RightArm"], ["spine", "spine"], ["Lid", "Lid"], ["foot-R", "foot-L"]]) assert.strictEqual(R.mirrorName(x), y);
});
test("mirror pose swaps sides and flips Y, Z and move X", () => {
	const a = { bones: [{ id: "l", name: "arm.L", head: [0, 0, 0], tail: [0, 0, 8] }, { id: "r", name: "arm.R", head: [0, 0, 0], tail: [0, 0, 8] }], bind: {}, clips: [] };
	const c = clipOf(2, { l: [{ f: 0, rot: [10, 20, 30], pos: [1, 2, 3] }], r: [{ f: 0, rot: [40, 50, 60], pos: [4, 5, 6] }] });
	R.mirrorPose(a, c, 0, ["l", "r"]);
	near(R.keyAt(c, "r", 0).rot, [10, -20, -30]); near(R.keyAt(c, "r", 0).pos, [-1, 2, 3]);
	near(R.keyAt(c, "l", 0).rot, [40, -50, -60]); near(R.keyAt(c, "l", 0).pos, [-4, 5, 6]);
});
test("an old project's one Albedo sheet goes to the active clip only", () => {
	const a = { bones: [], clips: [{ id: "c1", tracks: {} }, { id: "c2", tracks: {} }], clip: "c2", albedo: "data:x" };
	R.bumpIds(a);
	assert.strictEqual(a.albedo, null); assert.strictEqual(a.clips[1].albedo, "data:x"); assert.strictEqual(a.clips[0].albedo, undefined);
});
test("frames with the same pose share a signature", () => {
	const a = arm(), c = clipOf(4, { b1: [key(0, 10), key(1, 10), key(3, 40)] });
	assert.strictEqual(R.frameSig(a, c, 0), R.frameSig(a, c, 1));
	assert.notStrictEqual(R.frameSig(a, c, 1), R.frameSig(a, c, 3));
});

console.log("Flipbook export");
// A 96 x 96 tileset: a box, and a clip whose painted frames cover the whole canvas in every cell.
function scene(tracks, bind) {
	const W = 96, H = 96, box = M.box([24, 40, 0], 24, 16, 16);
	box.name = "Door";
	const objects = [box], settings = P.defaultSettings();
	const anim = { bones: [{ id: "b1", name: "door", parent: null, head: [36, 48, 0], tail: [36, 48, 16] }], bind: bind ? { [box.id]: "b1" } : {}, clips: [], clip: "c1", frame: 0 };
	const clip = { id: "c1", name: "Open", fps: 8, frames: 4, tracks, models: [box.id] };
	anim.clips.push(clip);
	const alpha = new Uint8Array(W * H).fill(255), art = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4).fill(255), alpha };
	const result = P.run(objects, art, settings);
	result.pieceMap = P.pieces(objects, result, settings);
	const lay = R.layout(W, H, 4);
	const sheet = { width: lay.w, height: lay.h, data: new Uint8ClampedArray(lay.w * lay.h * 4).fill(255) };
	const maps = P.maps(result, settings);
	const made = TS.Bundle.anim({ anim, objects, settings, result, art, materials: maps.materials, albedoOf: () => sheet, encodePNG: () => "png" });
	return { made, result, objects, settings, anim, clip, W, H };
}
const decode = (b64) => Uint8Array.from(Buffer.from(b64, "base64"));
test("a clip that only repaints has no per-frame data", () => {
	const { made } = scene({}, false);
	assert.strictEqual(made.clips[0].targets[0].data, undefined);
	assert.strictEqual(made.clips[0].targets[0].source, "flipbook");
});
test("keys at the rest pose don't count as moving", () => {
	const { made } = scene({ b1: [{ f: 0, rot: [0, 0, 0], pos: [0, 0, 0] }] }, true);
	assert.strictEqual(made.clips[0].targets[0].data, undefined);
});
test("a clip whose bones move the piece carries height and normals per frame", () => {
	const lift = 20, s = scene({ b1: [{ f: 0, rot: [0, 0, 0], pos: [0, 0, 0] }, { f: 3, rot: [0, 0, 0], pos: [0, 0, lift] }] }, true);
	const t = s.made.clips[0].targets[0], [rx, ry, rw, rh] = t.rect, data = decode(t.data);
	assert.strictEqual(data.length, t.cols * rw * t.rows * rh * 4);
	const at = (f, x, y) => { const dx = (f % t.cols) * rw, dy = Math.floor(f / t.cols) * rh, o = ((dy + y - ry) * t.cols * rw + dx + x - rx) * 4; return Array.from(data.subarray(o, o + 4)); };
	// Frame 0 matches the base frame, frame 3 matches the box processed at its lifted pose, pixel for pixel.
	const posed = P.run(R.posedObjects(s.objects, s.anim, s.clip, 3), { w: s.W, h: s.H, data: new Uint8ClampedArray(s.W * s.H * 4).fill(255), alpha: new Uint8Array(s.W * s.H).fill(255) }, s.settings);
	let compared = 0, differ = 0;
	for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) {
		const i = y * s.W + x, base = s.result, a0 = at(0, x, y), a3 = at(3, x, y);
		if (!isNaN(base.height[i])) { assert.strictEqual(a0[0], Math.round(base.height[i])); assert(a0[3] > 0, "material"); compared++; }
		if (!isNaN(posed.height[i])) { assert.strictEqual(a3[0], TS.clamp(Math.round(posed.height[i]), 0, 255)); }
		if (a0[0] !== a3[0] || a0[1] !== a3[1] || a0[2] !== a3[2]) differ++;
	}
	assert(compared > 100, "too few pixels compared: " + compared);
	assert(differ > 100, "frames should differ, " + differ + " pixels do");
});
test("the dry run (the panel's note) says it moves and builds nothing", () => {
	const s = scene({ b1: [{ f: 3, rot: [0, 0, 0], pos: [0, 0, 8] }] }, true);
	const out = TS.Bundle.anim({ anim: s.anim, objects: s.objects, settings: s.settings, result: s.result, art: { w: s.W, h: s.H }, albedoOf: () => { const l = R.layout(s.W, s.H, 4); return { width: l.w, height: l.h, data: new Uint8ClampedArray(l.w * l.h * 4).fill(255) }; }, dry: true });
	assert.strictEqual(out.clips[0].targets[0].moves, true);
	assert.strictEqual(out.clips[0].targets[0].data, undefined);
});


console.log("Per-frame floor spans");
// A scene of models bound to one bone, a clip over all of them, and the sheet's painted area (default: everything).
function floorScene({ objects, tracks, frames = 4, head = [36, 48, 0], paint = null, size = [96, 96] }) {
	const [W, H] = size, settings = P.defaultSettings();
	const anim = { bones: [{ id: "b1", name: "door", parent: null, head, tail: [head[0], head[1], head[2] + 16] }], bind: Object.fromEntries(objects.map((o) => [o.id, "b1"])), clips: [], clip: "c1", frame: 0 };
	const clip = { id: "c1", name: "Open", fps: 8, frames, tracks, models: objects.map((o) => o.id) };
	anim.clips.push(clip);
	const alpha = new Uint8Array(W * H).fill(255), art = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4).fill(255), alpha };
	const result = P.run(objects, art, settings);
	result.pieceMap = P.pieces(objects, result, settings);
	const lay = R.layout(W, H, frames), sheet = { width: lay.w, height: lay.h, data: new Uint8ClampedArray(lay.w * lay.h * 4) };
	for (let f = 0; f < frames; f++) {
		const [ox, oy] = R.cellOrigin(lay, f);
		for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!paint || paint(x, y)) sheet.data.set([200, 200, 200, 255], ((oy + y) * lay.w + ox + x) * 4);
	}
	const maps = P.maps(result, settings);
	const made = TS.Bundle.anim({ anim, objects, settings, result, art, materials: maps.materials, albedoOf: () => sheet, encodePNG: () => "png" });
	const t = made && made.clips[0] ? made.clips[0].targets[0] : null;
	// The frame's floor point (absolute floor x, y) as [R, G, B, A].
	const floorAt = (f, x, y) => {
		const [rx, ry, rw] = t.rect, bytes = decode(t.floor), fx = (f % t.cols) * rw, fy = Math.floor(f / t.cols) * t.floorH, j = y - (ry + t.floorDy), i = x - rx;
		if (i < 0 || i >= rw || j < 0 || j >= t.floorH) return [0, 0, 0, 0];
		const o = ((fy + j) * t.cols * rw + fx + i) * 4;
		return Array.from(bytes.subarray(o, o + 4));
	};
	return { made, clip: made && made.clips[0], t, anim, objects, settings, W, H, floorAt, art };
}
// The frame's posed models processed on their own, as the static floor rows would be exported.
const posedMaps = (s, f) => {
	const objs = R.posedObjects(s.objects, s.anim, s.anim.clips[0], f), r = P.run(objs, s.art, s.settings);
	r.pieceMap = P.pieces(objs, r, s.settings);
	return { r, maps: P.maps(r, s.settings) };
};
const swing = (deg) => ({ b1: [{ f: 0, rot: [0, 0, 0], pos: [0, 0, 0] }, { f: 3, rot: [0, 0, deg], pos: [0, 0, 0] }] });
const named = (box, name) => { box.name = name; return box; };

test("a moving piece carries each frame's floor spans in the static floor-row form, and its clip says shadow: frames", () => {
	const lift = 20, s = floorScene({ objects: [named(M.box([24, 40, 0], 24, 16, 16), "Door")], tracks: { b1: [{ f: 0, rot: [0, 0, 0], pos: [0, 0, 0] }, { f: 3, rot: [0, 0, 0], pos: [0, 0, lift] }] } });
	assert.strictEqual(s.clip.shadow, "frames");
	assert.strictEqual(s.clip.collision, "static");
	assert(Number.isInteger(s.t.floorDy) && s.t.floorH > 0, "floorDy / floorH");
	assert.strictEqual(decode(s.t.floor).length, s.t.cols * s.t.rect[2] * s.t.rows * s.t.floorH * 4);
	// x 12..35, y 32..47, 0..16 high: top 16 -> R 17, underside 0. Lifted 20: top 36 -> R 37, underside 20.
	assert.deepStrictEqual(s.floorAt(0, 20, 40), [17, 0, 0, 0]);
	assert.deepStrictEqual(s.floorAt(3, 20, 40), [37, 20, 0, 0]);
	assert.deepStrictEqual(s.floorAt(3, 40, 40), [0, 0, 0, 0], "nothing east of the box");
});
test("every frame's floor block is byte for byte what the static floor rows say of the posed piece", () => {
	const s = floorScene({ objects: [named(M.box([36, 56, 0], 4, 28, 40), "Door")], head: [36, 42, 0], tracks: swing(75) });
	let compared = 0;
	for (let f = 0; f < 4; f++) {
		const { maps } = posedMaps(s, f);
		for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
			const o = (96 * 96 + y * 96 + x) * 4, want = y < maps.rows ? Array.from(maps.data.subarray(o, o + 4)) : [0, 0, 0, 0];
			assert.deepStrictEqual(s.floorAt(f, x, y), want, `frame ${f} floor point ${x},${y}`);
			if (want[0]) compared++;
		}
	}
	assert(compared > 100, "too few floor points compared: " + compared);
});
test("a gap between a piece's parts (shelves, a grille) is in the frame's spans, and moves with it", () => {
	const s = floorScene({ objects: [named(M.box([36, 48, 0], 24, 16, 8), "Shelf low"), named(M.box([36, 48, 20], 24, 16, 8), "Shelf top")], tracks: { b1: [{ f: 0, rot: [0, 0, 0], pos: [0, 0, 0] }, { f: 3, rot: [0, 0, 0], pos: [0, 0, 4] }] } });
	assert.strictEqual(s.made.clips[0].targets.length, 1, "one piece");
	assert.deepStrictEqual(s.floorAt(0, 36, 48), [29, 0, 9, 20], "top 28, under 0, gap 8..20");
	assert.deepStrictEqual(s.floorAt(3, 36, 48), [33, 4, 13, 24], "lifted 4: top 32, under 4, gap 12..24");
});
test("a thin leaf swung side-on is a solid line on the floor in every frame, not dots", () => {
	const s = floorScene({ objects: [named(M.box([36, 60, 0], 3, 36, 40), "Leaf")], head: [36, 42, 0], tracks: swing(90) });
	for (let f = 0; f < 4; f++) {
		const pts = [];
		for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) if (s.floorAt(f, x, y)[0]) pts.push([x, y]);
		assert(pts.length >= 100, `frame ${f}: ${pts.length} points`);
		const key = new Set(pts.map((p) => p.join())), seen = new Set([pts[0].join()]), todo = [pts[0]];
		while (todo.length) {
			const [x, y] = todo.pop();
			for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = `${x + dx},${y + dy}`; if (key.has(k) && !seen.has(k)) { seen.add(k); todo.push([x + dx, y + dy]); } }
		}
		assert.strictEqual(seen.size, pts.length, `frame ${f}: the footprint is one connected piece`);
	}
	// Opened to 90 degrees the 36 px leaf lies along x from the hinge row.
	let along = 0;
	for (let x = 0; x < 96; x++) if (s.floorAt(3, x, 42)[0] || s.floorAt(3, x, 43)[0]) along++;
	assert(along >= 30, "the open leaf runs " + along + " px along the floor");
});
test("the rect holds every floor column of every frame, even where nothing is painted", () => {
	// A 40 px leaf closed along y at x 18..22; only the cells it stands in (x < 32) are painted, but opened it lies along x out to ~60.
	const s = floorScene({ objects: [named(M.box([20, 60, 0], 4, 40, 30), "Leaf")], head: [20, 40, 0], tracks: swing(-90), paint: (x) => x < 32 });
	const [rx, , rw] = s.t.rect;
	for (let f = 0; f < 4; f++) {
		const { r } = posedMaps(s, f);
		for (let k = 0; k < r.floor.top.length; k++) if (r.floor.top[k] >= 0) { const x = k % 96; assert(x >= rx && x < rx + rw, `frame ${f}: floor column ${x} is outside the rect ${rx}..${rx + rw - 1}`); }
	}
	assert(rx + rw >= 64, "the rect grew past the painted columns to " + (rx + rw));
});
test("a repaint-only clip keeps the static shadow and writes no floor block; the dry run says it will", () => {
	const { made } = scene({}, false);
	assert.strictEqual(made.clips[0].shadow, "static");
	assert.strictEqual(made.clips[0].targets[0].floor, undefined);
	assert.strictEqual(made.clips[0].targets[0].floorH, undefined);
	const s = scene({ b1: [{ f: 3, rot: [0, 0, 0], pos: [0, 0, 8] }] }, true);
	const out = TS.Bundle.anim({ anim: s.anim, objects: s.objects, settings: s.settings, result: s.result, art: { w: s.W, h: s.H }, albedoOf: () => { const l = R.layout(s.W, s.H, 4); return { width: l.w, height: l.h, data: new Uint8ClampedArray(l.w * l.h * 4).fill(255) }; }, dry: true });
	assert.strictEqual(out.clips[0].targets[0].floor, true);
});
console.log("glTF");
test("a skinned model comes back as one model with its weights", () => {
	const box = M.box([0, 0, 0], 8, 8, 32);
	const a = { bones: [{ id: "b1", name: "low", parent: null, head: [4, 4, 0], tail: [4, 4, 16] }, { id: "b2", name: "up", parent: "b1", head: [4, 4, 16], tail: [4, 4, 32], connected: true }], bind: { [box.id]: "b1" }, clips: [], clip: null, frame: 0 };
	const sent = R.skinWeights(a, box);
	const file = TS.Gltf.write([box], a, { scale: 1 });
	const back = TS.Gltf.read(file.buffer ? file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) : file, { scale: 1 });
	assert.strictEqual(back.objects.length, 1, "one model");
	const o = back.objects[0], pt = back.rig.paint[o.id];
	assert(pt && pt.n === o.verts.length, "painted rows match the vertices");
	const anim = { bones: back.rig.bones, bind: back.rig.bind, paint: back.rig.paint, clips: [], clip: null, frame: 0 }, got = R.skinWeights(anim, o);
	const lowName = (w, i) => w.weights[i][w.list.findIndex((b) => b.name === "low")];
	o.verts.forEach((p, i) => {
		const j = box.verts.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < 0.01);
		assert(j >= 0, "a vertex moved");
		assert(Math.abs(lowName(got, i) - lowName(sent, j)) < 0.01, `weight of vertex ${i}: ${lowName(got, i)} sent ${lowName(sent, j)}`);
	});
	const rig = TS.Transfer.rigFor(back.rig, [o.id]);
	assert(rig.paint[o.id] && rig.bones.length === 2, "the weights and both bones come along with the model");
});
test("eased keys survive export by being sampled", () => {
	const box = M.box([0, 0, 0], 8, 8, 8);
	const a = arm(); a.bind[box.id] = "b1";
	a.clips.push(clipOf(4, { b1: [{ f: 0, ease: "hold", rot: [0, 0, 0], pos: [0, 0, 0] }, { f: 3, rot: [0, 0, 0], pos: [9, 0, 0] }] }));
	const file = TS.Gltf.write([box], a, { scale: 1 });
	const back = TS.Gltf.read(file.buffer ? file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) : file, { scale: 1 });
	near(R.localPose(back.rig.clips[0], back.rig.bones[0].id, 2).pos, [0, 0, 0], 0.01, "held");
	near(R.localPose(back.rig.clips[0], back.rig.bones[0].id, 3).pos, [9, 0, 0], 0.01, "last");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
