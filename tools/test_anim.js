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
test("mirror helpers: other side's bone, flipped values (for a pose clipboard)", () => {
	const a = { bones: [{ id: "l", name: "arm.L" }, { id: "r", name: "arm.R" }, { id: "s", name: "spine" }] };
	assert.strictEqual(R.mirrorBone(a, a.bones[0]).id, "r"); assert.strictEqual(R.mirrorBone(a, a.bones[2]).id, "s");
	const m = R.mirrorValues([10, 20, 30], [1, 2, 3]);
	near(m.rot, [10, -20, -30]); near(m.pos, [-1, 2, 3]);
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
	assert.strictEqual(s.clip.collision, "frames", "a moving piece that blocks carries its collision per frame");
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
test("a moving piece carries each frame's collision polygons, as the static collision of the posed piece", () => {
	const s = floorScene({ objects: [named(M.box([36, 60, 0], 4, 36, 40), "Leaf")], head: [36, 42, 0], tracks: swing(90) });
	assert.strictEqual(s.clip.collision, "frames");
	assert.strictEqual(s.t.collision.length, 4, "one polygon list per frame");
	const bbox = (polys) => { const pts = polys.flat(); return [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))]; };
	for (let f = 0; f < 4; f++) {
		const { r } = posedMaps(s, f);
		assert(s.t.collision[f].length > 0, `frame ${f} blocks`);
		assert.strictEqual(JSON.stringify(s.t.collision[f]), JSON.stringify(r.collision.models.flatMap((m) => m.polygons)), `frame ${f} matches the posed piece collision`);
	}
	const closed = bbox(s.t.collision[0]), open = bbox(s.t.collision[3]);
	assert(closed[3] - closed[2] > closed[1] - closed[0], "closed along y");
	assert(open[1] - open[0] > open[3] - open[2], "open along x");
});
test("a repaint-only clip keeps the static collision", () => {
	assert.strictEqual(scene({}, false).made.clips[0].collision, "static");
	assert.strictEqual(scene({}, false).made.clips[0].targets[0].collision, undefined);
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

// A .gltf with its data inline: parts are {data: TypedArray, type, extra}; returns the file and each part's accessor index.
const gltfOf = (json, parts) => {
	const bytes = [], accessors = [], bufferViews = [];
	for (const p of parts) {
		const b = new Uint8Array(p.data.buffer), n = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[p.type];
		bufferViews.push({ buffer: 0, byteOffset: bytes.length, byteLength: b.length });
		accessors.push(Object.assign({ bufferView: bufferViews.length - 1, componentType: p.data instanceof Uint32Array ? 5125 : 5126, count: p.data.length / n, type: p.type }, p.extra || {}));
		bytes.push(...b);
	}
	const buffers = [{ byteLength: bytes.length, uri: "data:application/octet-stream;base64," + Buffer.from(bytes).toString("base64") }];
	return new TextEncoder().encode(JSON.stringify(Object.assign({ asset: { version: "2.0" }, scene: 0, accessors, bufferViews, buffers }, json))).buffer;
};
const v3sub = (a, b) => a.map((v, i) => v - b[i]);
const animOf = (rig) => ({ bones: rig.bones, bind: rig.bind, paint: rig.paint, rigid: rig.rigid, clips: rig.clips, clip: rig.clips[0].id, frame: 0 });
const quad = { data: new Float32Array([0, 0, 0, 1, 0, 0, 1, 2, 0, 0, 2, 0]), type: "VEC3", extra: { min: [0, 0, 0], max: [1, 2, 0] } }, quadIdx = { data: new Uint32Array([0, 1, 2, 0, 2, 3]), type: "SCALAR" };
const times = { data: new Float32Array([0, 1]), type: "SCALAR", extra: { min: [0], max: [1] } };
test("a move under a scaled armature (0.01, as FBX-made files have) keeps its size", () => {
	// Armature (scale 0.01) > Hip joint 100 units up; the hip moves 50 units along its parent's Z, which is 0.5 units in the file's world.
	const file = gltfOf({ scenes: [{ nodes: [0, 2] }], nodes: [{ name: "Armature", scale: [0.01, 0.01, 0.01], children: [1] }, { name: "Hip", translation: [0, 100, 0] }, { name: "Body", mesh: 0, skin: 0 }],
		meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 2, WEIGHTS_0: 3 }, indices: 1 }] }], skins: [{ joints: [1], inverseBindMatrices: 4 }],
		animations: [{ samplers: [{ input: 5, output: 6 }], channels: [{ sampler: 0, target: { node: 1, path: "translation" } }] }] },
		[quad, quadIdx, { data: new Float32Array(16), type: "VEC4" }, { data: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), type: "VEC4" },
			{ data: new Float32Array([100, 0, 0, 0, 0, 100, 0, 0, 0, 0, 100, 0, 0, -100, 0, 1]), type: "MAT4" }, times, { data: new Float32Array([0, 100, 0, 0, 100, 50]), type: "VEC3" }]);
	const back = TS.Gltf.read(file, { scale: 10 }), clip = back.rig.clips[0], o = back.objects[0];
	const end = R.posedObjects(back.objects, animOf(back.rig), clip, clip.frames - 1)[0];
	o.verts.forEach((p, i) => near(v3sub(end.verts[i], p), [0, -5, 0], 0.01, "moved"));
});
test("an object animation with no armature comes in as a rigid bone and clip", () => {
	// A door on a hinge node 2 units along X, swinging 90 degrees about the up axis.
	const file = gltfOf({ scenes: [{ nodes: [0] }], nodes: [{ name: "Hinge", translation: [2, 0, 0], children: [1] }, { name: "Door", mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
		animations: [{ name: "Open", samplers: [{ input: 2, output: 3 }], channels: [{ sampler: 0, target: { node: 0, path: "rotation" } }] }] },
		[quad, quadIdx, times, { data: new Float32Array([0, 0, 0, 1, 0, Math.SQRT1_2, 0, Math.SQRT1_2]), type: "VEC4" }]);
	const back = TS.Gltf.read(file, { scale: 16 }), o = back.objects[0], clip = back.rig && back.rig.clips[0];
	assert(clip && clip.name === "Open", "the clip came in");
	assert.strictEqual(back.rig.bones[0].name, "Hinge");
	assert(back.rig.rigid[o.id], "the door follows its bone as one piece");
	const end = R.posedObjects(back.objects, animOf(back.rig), clip, clip.frames - 1)[0];
	end.verts.forEach((p) => assert(Math.abs(p[0] - 32) < 0.01, `turned edge-on to X: ${p}`)); // the hinge's X (2 units) for every corner
	const rig = TS.Transfer.rigFor(back.rig, [o.id]);
	assert(rig.rigid[o.id], "rigid comes along with the model");
});

console.log("IK");
// Upper arm (b1) 0,0,0 -> 0,0,10 and forearm (b2) 10 -> 20, connected, bent forward (+X) 60 degrees at the elbow.
const ikArm = (connected = true) => ({ bones: [{ id: "b1", name: "up", parent: null, head: [0, 0, 0], tail: [0, 0, 10] }, { id: "b2", name: "fore", parent: "b1", connected, head: [0, 0, 10], tail: [0, 0, 20] }], bind: {}, clips: [], clip: null, frame: 0 });
const bent = () => { const c = clipOf(4); R.setKey(c, "b2", 0, [0, 60, 0], [0, 0, 0]); return c; };
const tip2 = (a, c) => R.apply(R.matrices(a, c, 0).get("b2"), [0, 0, 20]);
const bake = (c, res) => res.forEach((r) => R.setKey(c, r.id, 0, r.rot, r.pos));
const dist3 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
test("a two-bone arm reaches a reachable target", () => {
	const a = ikArm(), c = bent(), t = [6, 3, 9];
	const res = R.solveIK(a, c, 0, "b2", t, 2);
	assert.strictEqual(res.map((r) => r.id).join(), "b1,b2");
	bake(c, res);
	assert(dist3(tip2(a, c), t) < 0.05, "tip " + tip2(a, c));
});
test("an unreachable target straightens the chain toward it", () => {
	const a = ikArm(), c = bent(), t = [0, 0, 60];
	bake(c, R.solveIK(a, c, 0, "b2", t, 2));
	near(tip2(a, c), [0, 0, 20], 0.1, "stretched straight at the target");
	const t2 = [30, 0, 0];
	bake(c, R.solveIK(a, c, 0, "b2", t2, 2));
	near(tip2(a, c), [20, 0, 0], 0.1, "reaching sideways");
});
test("the elbow keeps its bend direction", () => {
	const a = ikArm(), c = bent();
	const side = () => { const m = R.matrices(a, c, 0), e = R.apply(m.get("b2"), [0, 0, 10]), t = tip2(a, c); return Math.sign(t[0] * e[2] - t[2] * e[0]); };
	const before = side();
	assert(before !== 0);
	bake(c, R.solveIK(a, c, 0, "b2", [8, 0, 8], 2));
	assert.strictEqual(side(), before, "elbow on the same side of the shoulder-to-tip line");
	assert(dist3(tip2(a, c), [8, 0, 8]) < 0.05);
});
test("the chain stops at an unconnected parent", () => {
	const a = ikArm(false), c = bent();
	const res = R.solveIK(a, c, 0, "b2", [6, 3, 9], 2);
	assert.strictEqual(res.map((r) => r.id).join(), "b2");
	bake(c, res);
	near(R.apply(R.matrices(a, c, 0).get("b2"), [0, 0, 10]), [0, 0, 10], 1e-6, "head stays");
	assert(dist3(tip2(a, c), [6, 3, 9]) < 10.5, "tip moved as close as one bone can");
});
test("chainLen 1 turns only the bone itself", () => {
	const a = ikArm(), c = bent();
	assert.strictEqual(R.solveIK(a, c, 0, "b2", [6, 3, 9], 1).length, 1);
});
test("a plane-restricted solve leaves the depth coordinate alone", () => {
	const a = ikArm(), c = bent(), t = [6, 5, 9];
	const res = R.solveIK(a, c, 0, "b2", t, 2, 1); // Y is the depth axis
	bake(c, res);
	const tp = tip2(a, c), el = R.apply(R.matrices(a, c, 0).get("b2"), [0, 0, 10]);
	assert(Math.abs(tp[1]) < 1e-6 && Math.abs(el[1]) < 1e-6, "stays at Y=0: " + tp);
	assert(Math.abs(tp[0] - 6) < 0.05 && Math.abs(tp[2] - 9) < 0.05, "reaches X/Z: " + tp);
});

console.log("Inserting and removing frames");
const keyed = () => { const c = clipOf(6); [0, 2, 3, 5].forEach((f) => R.setKey(c, "b1", f, [f, 0, 0], [0, 0, 0])); return c; };
const framesOf = (c) => c.tracks.b1.map((k) => k.f).join(",");
test("insertFrames shifts keys at and after the playhead and grows the clip", () => {
	const c = keyed();
	assert.strictEqual(R.insertFrames(c, 2, 1), 1);
	assert.strictEqual(c.frames, 7);
	assert.strictEqual(framesOf(c), "0,3,4,6");
});
test("insertFrames stops at 64 frames", () => {
	const c = keyed();
	c.frames = 64;
	assert.strictEqual(R.insertFrames(c, 0, 1), 0);
	assert.strictEqual(framesOf(c), "0,2,3,5");
	c.frames = 63;
	assert.strictEqual(R.insertFrames(c, 0, 5), 1);
	assert.strictEqual(c.frames, 64);
});
test("removeFrames drops the keys on the frame and closes the gap", () => {
	const c = keyed();
	assert.strictEqual(R.removeFrames(c, 2, 1), 1);
	assert.strictEqual(c.frames, 5);
	assert.strictEqual(framesOf(c), "0,2,4");
});
test("removeFrames keeps one frame and removes an emptied track", () => {
	const c = clipOf(1, {});
	assert.strictEqual(R.removeFrames(c, 0, 1), 0);
	const d = clipOf(2); R.setKey(d, "b1", 1, [0, 0, 0], [0, 0, 0]);
	R.removeFrames(d, 1, 1);
	assert.strictEqual(d.frames, 1);
	assert(!d.tracks.b1, "the empty track is gone");
});
test("insert then remove at the same frame restores the keys", () => {
	const c = keyed();
	R.insertFrames(c, 3, 2); R.removeFrames(c, 3, 2);
	assert.strictEqual(c.frames, 6);
	assert.strictEqual(framesOf(c), "0,2,3,5");
});
test("allKeys names every key inside the clip", () => {
	const c = keyed(); R.setKey(c, "b2", 1, [0, 0, 0], [0, 0, 0]);
	assert.strictEqual(R.allKeys(c).length, 5);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
