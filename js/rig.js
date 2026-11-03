// Rig: rigid bones over the models, keyframed clips, and the spritesheet the animation renders into.
//
// anim = { bones: [{id, name, parent|null, head: [x,y,z], tail: [x,y,z]}]   rest pose, world space (art px)
//          bind:  {modelId: boneId}                                          a model follows its bone rigidly
//          paint: {modelId: {n, rev, v: {vertex: {boneId: weight}}}}                 hand-painted skin weights (see R.painted)
//          clips: [{id, name, fps, frames, tracks: {boneId: [{f, rot: [rx,ry,rz], pos: [x,y,z]}]},
//                   optional: loop ("once" | "pingpong"; missing = loop), export (false = not in the bundle), models [object id] (the flipbook's
//                   models: the game swaps their pieces for the frames), albedo (this clip's sheet, a data URL)}]
//          clip: active clip id, frame: current frame, albedo: dataURL of the artist's sheet (or null)}
// A bone turns about its head (rot = degrees, applied Z·Y·X) and then moves by pos; its children ride along. A key holds a bone's
// whole local pose and an optional ease; frames between keys blend, turns the short way round (a quaternion blend); before the first
// key a bone eases in from rest at frame 0, and after the last key it holds.
"use strict";
(function () {
	const m4 = TS.m4, v3 = TS.v3;
	const R = (TS.Rig = {});
	const RAD = Math.PI / 180;
	let nextBone = 1, nextClip = 1;

	R.newAnim = () => ({ bones: [], bind: {}, clips: [], clip: null, frame: 0, albedo: null });
	R.bumpIds = (anim) => {
		R.migrate(anim);
		for (const b of anim.bones) nextBone = Math.max(nextBone, (parseInt(String(b.id).slice(1), 10) || 0) + 1);
		for (const c of anim.clips) nextClip = Math.max(nextClip, (parseInt(String(c.id).slice(1), 10) || 0) + 1);
	};
	R.newBone = (name, head, tail, parent) => ({ id: "b" + nextBone++, name, parent: parent || null, head, tail });
	R.newClip = (name, frames, fps) => ({ id: "c" + nextClip++, name, fps: fps || 8, frames: frames || 8, tracks: {} });
	R.bone = (anim, id) => anim.bones.find((b) => b.id === id) || null;
	R.clipOf = (anim, id) => anim.clips.find((c) => c.id === (id || anim.clip)) || null;

	// Bones deeper than their parent are always listed after it, so one pass poses the lot.
	R.ordered = (anim) => {
		const out = [], seen = new Set();
		const add = (b) => {
			if (seen.has(b.id)) return;
			seen.add(b.id);
			const p = b.parent && R.bone(anim, b.parent);
			if (p) add(p);
			out.push(b);
		};
		anim.bones.forEach(add);
		return out;
	};
	// Would giving `bone` this parent make a loop?
	R.wouldLoop = (anim, bone, parentId) => {
		for (let p = parentId && R.bone(anim, parentId), n = 0; p && n < 1000; p = p.parent && R.bone(anim, p.parent), n++) if (p.id === bone.id) return true;
		return false;
	};

	// Euler (degrees, Z·Y·X) <-> row-major 3x3.
	R.eulerToMat = (e) => {
		const [a, b, c] = e.map((d) => d * RAD), ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
		return [[cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa], [sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa], [-sb, cb * sa, cb * ca]];
	};
	R.matToEuler = (m) => {
		const sb = TS.clamp(-m[2][0], -1, 1), b = Math.asin(sb);
		let a, c;
		if (Math.abs(sb) > 0.99999) { a = Math.atan2(-m[1][2], m[1][1]); c = 0; }
		else { a = Math.atan2(m[2][1], m[2][2]); c = Math.atan2(m[1][0], m[0][0]); }
		return [a / RAD, b / RAD, c / RAD];
	};
	const mm3 = (a, b) => a.map((row, i) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
	const tr3 = (a) => [0, 1, 2].map((i) => [a[0][i], a[1][i], a[2][i]]);
	R.mat3 = { mul: mm3, transpose: tr3 };
	const rotPart = (m) => [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]];
	R.rotPart = rotPart;
	const translate = (t) => { const m = m4.identity(); m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; return m; };
	const rotate = (e) => {
		const r = R.eulerToMat(e), m = m4.identity();
		for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[j * 4 + i] = r[i][j];
		return m;
	};

	// The Euler angles for a rotation matrix closest to `ref`. The same rotation has two Euler forms (a 100 degree turn about Y reads
	// [180, 80, 180] from matToEuler), each repeating every 360: keys and fields stay on the one that continues from where the bone was.
	R.nearEuler = (m, ref) => {
		const wrap = (e) => e.map((v, i) => { while (v - ref[i] > 180) v -= 360; while (v - ref[i] < -180) v += 360; return v; });
		const e = R.matToEuler(m), p = wrap(e), q = wrap([e[0] + 180, 180 - e[1], e[2] + 180]);
		const off = (x) => Math.abs(x[0] - ref[0]) + Math.abs(x[1] - ref[1]) + Math.abs(x[2] - ref[2]);
		return off(q) < off(p) - 1e-6 ? q : p;
	};
	// Row-major 3x3 <-> quaternion [x, y, z, w], for blending turns.
	const matToQuat = (m) => {
		const t = m[0][0] + m[1][1] + m[2][2];
		let q;
		if (t > 0) { const s = Math.sqrt(t + 1) * 2; q = [(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s, s / 4]; }
		else if (m[0][0] >= m[1][1] && m[0][0] >= m[2][2]) { const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; q = [s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] - m[1][2]) / s]; }
		else if (m[1][1] >= m[2][2]) { const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; q = [(m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s, (m[0][2] - m[2][0]) / s]; }
		else { const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; q = [(m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4, (m[1][0] - m[0][1]) / s]; }
		return q;
	};
	const quatToMat = ([x, y, z, w]) => [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
	const slerp = (a, b, t) => {
		let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
		const s = d < 0 ? -1 : 1; d = Math.abs(d);
		if (d > 0.9995) { const o = a.map((v, i) => v + (s * b[i] - v) * t), l = Math.hypot(...o); return o.map((v) => v / l); }
		const th = Math.acos(Math.min(1, d)), u = Math.sin((1 - t) * th) / Math.sin(th), w = (s * Math.sin(t * th)) / Math.sin(th);
		return a.map((v, i) => u * v + w * b[i]);
	};
	// A turn part way from one Euler key to the next, the short way round.
	const blendRot = (a, b, t) => {
		if (t <= 0) return a.slice();
		if (t >= 1) return b.slice();
		if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) return a.slice();
		return R.nearEuler(quatToMat(slerp(matToQuat(R.eulerToMat(a)), matToQuat(R.eulerToMat(b)), t)), v3.lerp(a, b, t));
	};
	// How a key leaves for the next one (key.ease; missing = linear). Hold keeps its pose until the next key.
	R.EASES = [["linear", "Linear"], ["in", "Ease in"], ["out", "Ease out"], ["inout", "Ease in-out"], ["hold", "Hold"]];
	const eased = (ease, t) => (ease === "in" ? t * t : ease === "out" ? t * (2 - t) : ease === "inout" ? t * t * (3 - 2 * t) : ease === "hold" ? 0 : t);

	// A bone's local pose at a frame: its keys blended (none = rest).
	R.localPose = (clip, boneId, frame) => {
		const keys = (clip && clip.tracks[boneId]) || [];
		if (!keys.length) return { rot: [0, 0, 0], pos: [0, 0, 0] };
		// Before the first key the bone eases in from its rest pose at frame 0 (so keying only frame 3 leaves frame 0 at rest).
		if (frame <= keys[0].f) {
			const t = keys[0].f > 0 ? Math.max(0, frame / keys[0].f) : 1;
			return { rot: blendRot([0, 0, 0], keys[0].rot, t), pos: v3.lerp([0, 0, 0], keys[0].pos, t) };
		}
		const last = keys[keys.length - 1];
		if (frame >= last.f) return { rot: last.rot.slice(), pos: last.pos.slice() };
		let i = 0;
		while (keys[i + 1].f < frame) i++;
		const a = keys[i], b = keys[i + 1], t = eased(a.ease, (frame - a.f) / (b.f - a.f));
		return { rot: blendRot(a.rot, b.rot, t), pos: v3.lerp(a.pos, b.pos, t) };
	};
	// Which frame playback is on, `ticks` frames of the clock after starting on `start`, and whether a "once" clip has finished.
	R.playFrame = (clip, start, ticks) => {
		const n = clip.frames;
		if (clip.loop === "once") return { f: Math.min(start + ticks, n - 1), done: start + ticks >= n - 1 };
		if (clip.loop === "pingpong" && n > 1) { const span = 2 * (n - 1), p = (start + ticks) % span; return { f: p < n ? p : span - p, done: false }; }
		return { f: (start + ticks) % n, done: false };
	};
	// The pose of the whole rig at a frame as text: two frames with the same text have the same picture.
	R.frameSig = (anim, clip, frame) => anim.bones.map((b) => { const p = R.localPose(clip, b.id, frame); return p.rot.concat(p.pos).map((v) => Math.round(v * 100) / 100).join(","); }).join(";");
	// Does anything in this clip move the model? (A key that is not the rest pose on a bone it follows.)
	R.modelMoves = (anim, clip, o) => {
		const main = R.bone(anim, anim.bind[o.id]);
		if (!main) return false;
		const w = R.skinWeights(anim, o), list = w ? w.list : [];
		if (!w) for (let b = main, n = 0; b && n < 1000; b = b.parent && R.bone(anim, b.parent), n++) list.push(b);
		return list.some((b) => ((clip.tracks || {})[b.id] || []).some((k) => k.rot.some((v) => Math.abs(v) > 0.01) || k.pos.some((v) => Math.abs(v) > 0.01)));
	};
	// A project saved before each clip kept its own Albedo: the one sheet belongs to the clip that was active.
	R.migrate = (anim) => {
		if (!anim.albedo) return anim;
		const c = R.clipOf(anim);
		if (c && !c.albedo) c.albedo = anim.albedo;
		anim.albedo = null;
		return anim;
	};

	// --- editing keys as a group (the dopesheet). A key is named {id: bone id, f: frame}. ---

	// Move (or copy) keys df frames along, keeping them inside the clip as a block; a key already there is replaced. -> where they landed.
	R.moveKeys = (clip, picks, df, copy) => {
		const found = picks.map((p) => ({ id: p.id, key: R.keyAt(clip, p.id, p.f) })).filter((p) => p.key);
		if (!found.length) return [];
		const lo = Math.min(...found.map((p) => p.key.f)), hi = Math.max(...found.map((p) => p.key.f));
		df = TS.clamp(df, -lo, clip.frames - 1 - hi);
		const moved = found.map((p) => ({ id: p.id, key: Object.assign({}, p.key, { f: p.key.f + df }) }));
		if (!copy) for (const p of found) R.deleteKey(clip, p.id, p.key.f);
		for (const p of moved) putKey(clip, p.id, p.key);
		return moved.map((p) => ({ id: p.id, f: p.key.f }));
	};
	const putKey = (clip, id, key) => {
		const keys = clip.tracks[id] || (clip.tracks[id] = []), at = keys.findIndex((k) => k.f === key.f);
		if (at >= 0) keys[at] = key; else { keys.push(key); keys.sort((a, b) => a.f - b.f); }
	};
	// Copied keys: their frames are relative to the earliest. Pasting puts the earliest on `frame`; anything past the end is left out.
	R.copyKeys = (clip, picks) => {
		const keys = picks.map((p) => ({ id: p.id, key: R.keyAt(clip, p.id, p.f) })).filter((p) => p.key);
		if (!keys.length) return null;
		const lo = Math.min(...keys.map((p) => p.key.f));
		return keys.map((p) => ({ id: p.id, key: Object.assign({}, JSON.parse(JSON.stringify(p.key)), { f: p.key.f - lo }) }));
	};
	R.pasteKeys = (clip, copied, frame, anim) => {
		const out = [];
		for (const p of copied) {
			const f = p.key.f + frame;
			if (f >= clip.frames || !R.bone(anim, p.id)) continue;
			putKey(clip, p.id, Object.assign(JSON.parse(JSON.stringify(p.key)), { f }));
			out.push({ id: p.id, f });
		}
		return out;
	};
	// The last frame takes the first frame's pose, so a loop has no jump at the seam.
	R.closeLoop = (clip, ids) => {
		for (const id of ids) { const p = R.localPose(clip, id, 0); R.setKey(clip, id, clip.frames - 1, p.rot, p.pos); }
	};
	// Left / right bone names: arm.L <-> arm.R, Arm_L <-> Arm_R, LeftArm <-> RightArm. The name itself when it has no side.
	R.mirrorName = (name) => {
		const swap = { L: "R", R: "L", l: "r", r: "l", Left: "Right", Right: "Left", left: "right", right: "left" };
		const end = name.match(/^(.*[._\- ])(L|R|l|r|Left|Right|left|right)$/);
		if (end) return end[1] + swap[end[2]];
		const start = name.match(/^(Left|Right|left|right)(.*)$/);
		return start ? swap[start[1]] + start[2] : name;
	};
	// Flip a pose across the X axis onto the other side's bones on this frame (a bone with no other side flips itself). Turns about X
	// stay; turns about Y and Z and a move along X change sign.
	R.mirrorPose = (anim, clip, frame, ids) => {
		const out = [];
		for (const id of ids) {
			const b = R.bone(anim, id), name = b && R.mirrorName(b.name), other = (name && anim.bones.find((x) => x.name === name)) || b;
			if (!b) continue;
			const p = R.localPose(clip, id, frame);
			out.push([other.id, [p.rot[0], -p.rot[1], -p.rot[2]], [-p.pos[0], p.pos[1], p.pos[2]]]);
		}
		for (const [id, rot, pos] of out) R.setKey(clip, id, frame, rot, pos);
	};
	R.keyAt = (clip, boneId, frame) => ((clip && clip.tracks[boneId]) || []).find((k) => k.f === frame) || null;
	R.setKey = (clip, boneId, frame, rot, pos) => {
		const keys = clip.tracks[boneId] || (clip.tracks[boneId] = []);
		const key = keys.find((k) => k.f === frame);
		if (key) { key.rot = rot; key.pos = pos; } else { keys.push({ f: frame, rot, pos }); keys.sort((a, b) => a.f - b.f); }
	};
	R.deleteKey = (clip, boneId, frame) => {
		const keys = clip.tracks[boneId];
		if (!keys) return;
		clip.tracks[boneId] = keys.filter((k) => k.f !== frame);
		if (!clip.tracks[boneId].length) delete clip.tracks[boneId];
	};

	// boneId -> 4x4 matrix taking a rest-pose world point to where it is at this frame.
	R.matrices = (anim, clip, frame, override) => {
		const out = new Map();
		for (const b of R.ordered(anim)) {
			let pose = (override && override[b.id]) || R.localPose(clip, b.id, frame);
			// A connected bone's head stays on its parent's tip: it can turn but not slide off.
			if (b.connected && b.parent) pose = { rot: pose.rot, pos: [0, 0, 0] };
			const local = m4.mul(m4.mul(translate(v3.add(b.head, pose.pos)), rotate(pose.rot)), translate(v3.scale(b.head, -1)));
			const parent = b.parent && out.get(b.parent);
			out.set(b.id, parent ? m4.mul(parent, local) : local);
		}
		return out;
	};
	const apply = (m, p) => { const q = m4.apply(m, p); return [q[0], q[1], q[2]]; };
	R.apply = apply;

	// A world move or turn applied on top of a bone's pose at a frame, as the local pose to key.
	// x = {d: [dx, dy, dz]} (a move) or {c, u, rad} (a turn of rad about axis u through the world point c).
	R.poseAfter = (anim, clip, frame, bone, x) => {
		const mats = R.matrices(anim, clip, frame), world = mats.get(bone.id);
		let X;
		if (x.d) X = translate(x.d);
		else {
			const [ux, uy, uz] = v3.norm(x.u), c = Math.cos(x.rad), s = Math.sin(x.rad), t = 1 - c, r = m4.identity();
			const a = [[t * ux * ux + c, t * ux * uy - s * uz, t * ux * uz + s * uy], [t * ux * uy + s * uz, t * uy * uy + c, t * uy * uz - s * ux], [t * ux * uz - s * uy, t * uy * uz + s * ux, t * uz * uz + c]];
			for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[j * 4 + i] = a[i][j];
			X = m4.mul(m4.mul(translate(x.c), r), translate(v3.scale(x.c, -1)));
		}
		let local = m4.mul(X, world);
		const parent = bone.parent && mats.get(bone.parent);
		if (parent) local = m4.mul(m4.invert(parent), local);
		const h = apply(local, bone.head);
		return { rot: R.nearEuler(rotPart(local), R.localPose(clip, bone.id, frame).rot), pos: [h[0] - bone.head[0], h[1] - bone.head[1], h[2] - bone.head[2]] };
	};

	// The models as they stand at a frame: copies (same ids) with the bound ones' vertices moved; the rest are shared as they are.
	R.posedObjects = (objects, anim, clip, frame) => {
		if (!anim.bones.length) return objects;
		const mats = R.matrices(anim, clip, frame);
		return objects.map((o) => {
			const w = R.skinWeights(anim, o);
			if (w) return Object.assign({}, o, { verts: o.verts.map((p, i) => skinPoint(w.list, w.weights[i], mats, p)) });
			const m = mats.get(anim.bind[o.id]);
			return m ? Object.assign({}, o, { verts: o.verts.map((p) => apply(m, p)) }) : o;
		});
	};

	// Every bound model deforms by default: each vertex follows the bones of its bound bone's skeleton (the bones sharing its top
	// parent, so a bone made for another model never tugs at this one), weighted by how near it is to that bone's rest segment
	// (head to tip), 1 / distance^stiff, with the model's own bound bone favoured. A higher stiffness keeps vertices glued to their
	// nearest bone and a low one blends over a wide span (anim.skin[modelId].stiff, else 3). anim.rigid[modelId] = true opts a model
	// out: it follows its bound bone as one solid piece, and so does a model whose bone is alone in its skeleton. Linear blend
	// skinning: the posed point is the weighted sum of each bone's matrix applied to the rest point.
	const segDist = (p, a, b) => {
		const ab = v3.sub(b, a), t = TS.clamp(v3.dot(v3.sub(p, a), ab) / (v3.dot(ab, ab) || 1), 0, 1);
		return v3.len(v3.sub(p, v3.add(a, v3.scale(ab, t))));
	};
	const rootOf = (anim, b) => { for (let n = 0; b.parent && R.bone(anim, b.parent) && n < 1000; n++) b = R.bone(anim, b.parent); return b; };
	// Weights depend only on the rest pose, so they are kept per model until its vertices, the skeleton's rest or the stiffness change.
	// The vertex positions are compared by value: some tools (Mirror) write into a vertex in place, and a model edited outside animation
	// mode must be weighted afresh when it returns.
	const weightCache = new WeakMap();
	const sameVerts = (a, flat) => a.length * 3 === flat.length && a.every((p, i) => p[0] === flat[i * 3] && p[1] === flat[i * 3 + 1] && p[2] === flat[i * 3 + 2]);
	R.skinWeights = (anim, o) => {
		if (anim.rigid && anim.rigid[o.id]) return null;
		const main = R.bone(anim, anim.bind[o.id]);
		if (!main) return null;
		const top = rootOf(anim, main), list = anim.bones.filter((b) => rootOf(anim, b) === top);
		if (list.length < 2) return null;
		const stiff = TS.clamp((anim.skin && anim.skin[o.id] && anim.skin[o.id].stiff) || 3, 0.5, 12);
		const pt = R.painted(anim, o), sig = main.id + "|" + stiff + "|" + (pt ? pt.rev : 0) + "|" + list.map((b) => b.id + ":" + b.head + ":" + b.tail).join(";");
		const hit = weightCache.get(o);
		if (hit && hit.sig === sig && sameVerts(hit.verts, o.verts)) return hit.w;
		const weights = o.verts.map((p) => {
			let raw = list.map((b) => (b === main ? 4 : 1) / Math.pow(segDist(p, b.head, b.tail) + 0.5, stiff)), sum = raw.reduce((x, y) => x + y, 0);
			raw = raw.map((x) => (x / sum < 0.02 ? 0 : x)); sum = raw.reduce((x, y) => x + y, 0); // far bones don't tug at all
			return raw.map((x) => x / sum);
		});
		// Painted vertices keep the weights the artist gave them; a bone since deleted just drops out of the row.
		if (pt) for (const i of Object.keys(pt.v)) {
			const row = list.map((b) => pt.v[i][b.id] || 0), s = row.reduce((x, y) => x + y, 0);
			if (s > 1e-6 && weights[i]) weights[i] = row.map((x) => x / s);
		}
		const w = { list, weights };
		weightCache.set(o, { sig, w, verts: Float64Array.from(o.verts.flat()) });
		return w;
	};
	// Weight painting. anim.paint[modelId] = {n: vertex count, rev, v: {vertexIndex: {boneId: weight}}}: those vertices use the painted
	// row (normalised to 1) instead of the automatic one. rev bumps on every change so the cached weights are rebuilt. Painting is
	// dropped if the model's vertex count has changed since (the indices would no longer mean the same vertices).
	R.painted = (anim, o) => {
		const pt = anim.paint && anim.paint[o.id];
		return pt && pt.n === o.verts.length && Object.keys(pt.v).length ? pt : null;
	};
	R.paintCount = (anim, o) => { const pt = R.painted(anim, o); return pt ? Object.keys(pt.v).length : 0; };
	R.paintStale = (anim, o) => { const pt = anim.paint && anim.paint[o.id]; return !!pt && pt.n !== o.verts.length && Object.keys(pt.v).length > 0; };
	R.clearPaint = (anim, o) => { if (anim.paint) delete anim.paint[o.id]; };
	// Neighbouring vertices (sharing an edge), for Smooth.
	const nbrCache = new WeakMap();
	const neighbours = (o) => {
		let hit = nbrCache.get(o.faces);
		if (hit && hit.n === o.verts.length) return hit.nb;
		const nb = o.verts.map(() => new Set());
		for (const f of o.faces) for (let i = 0; i < f.v.length; i++) { const a = f.v[i], b = f.v[(i + 1) % f.v.length]; if (nb[a] && nb[b]) { nb[a].add(b); nb[b].add(a); } }
		nbrCache.set(o.faces, { n: o.verts.length, nb });
		return nb;
	};
	// Move `row` (weights per bone of `list`, summing to 1) so bone t holds `to`, the others sharing the rest in proportion; when t is
	// the only bone holding weight and is being lowered, the rest goes to its parent (else the first other bone).
	const setShare = (row, t, to, list, anim) => {
		to = TS.clamp(to, 0, 1);
		const others = row.reduce((s, x, i) => (i === t ? s : s + x), 0), out = row.slice();
		out[t] = to;
		if (others > 1e-6) { for (let i = 0; i < row.length; i++) if (i !== t) out[i] = (row[i] * (1 - to)) / others; return out; }
		if (list.length < 2) return out.map((_, i) => (i === t ? 1 : 0));
		let sink = list.findIndex((b) => b.id === list[t].parent);
		if (sink < 0 || sink === t) sink = t === 0 ? 1 : 0;
		out[sink] = 1 - to;
		return out;
	};
	// Brush dab. hits: [{model, i, f}] (f = 0..1 falloff). mode: mix (toward `value`), add, sub, smooth. Returns how many vertices changed.
	R.paintDab = (anim, boneId, hits, mode, strength, value) => {
		let changed = 0;
		const byModel = new Map();
		for (const h of hits) { if (!byModel.has(h.model)) byModel.set(h.model, []); byModel.get(h.model).push(h); }
		for (const [o, list] of byModel) {
			const w = R.skinWeights(anim, o), t = w && w.list.findIndex((b) => b.id === boneId);
			if (!w || t < 0) continue;
			const pt = (anim.paint = anim.paint || {})[o.id] && anim.paint[o.id].n === o.verts.length ? anim.paint[o.id] : (anim.paint[o.id] = { n: o.verts.length, rev: 0, v: {} });
			const nb = mode === "smooth" ? neighbours(o) : null, next = new Map();
			for (const { i, f } of list) {
				const row = w.weights[i], s = strength * f;
				let out;
				if (mode === "add") out = setShare(row, t, row[t] + s, w.list, anim);
				else if (mode === "sub") out = setShare(row, t, row[t] - s, w.list, anim);
				else if (mode === "mix") out = setShare(row, t, row[t] + (value - row[t]) * Math.min(1, s), w.list, anim);
				else {
					const near = [...nb[i]];
					if (!near.length) continue;
					const avg = row.map((_, k) => near.reduce((x, j) => x + w.weights[j][k], 0) / near.length);
					out = row.map((x, k) => x + (avg[k] - x) * Math.min(1, s));
					const sum = out.reduce((x, y) => x + y, 0);
					out = out.map((x) => x / sum);
				}
				next.set(i, out);
			}
			for (const [i, out] of next) {
				const rec = {};
				out.forEach((x, k) => { if (x > 0.002) rec[w.list[k].id] = Math.round(x * 1000) / 1000; });
				pt.v[i] = rec; changed++;
			}
			pt.rev++;
		}
		return changed;
	};
	// A model edited, moved or resized outside animation mode can end up away from the bones it was rigged to; every vertex then
	// belongs to the one nearest bone and nothing bends. True when no vertex is within `tol` of any bone of its skeleton.
	R.awayFromBones = (anim, o, tol) => {
		const main = R.bone(anim, anim.bind[o.id]);
		if (!main || !o.verts.length) return false;
		const top = rootOf(anim, main), list = anim.bones.filter((b) => rootOf(anim, b) === top);
		// Far is measured against the model's own size: a wide box is a long way from its centre bone even at rest.
		const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
		for (const p of o.verts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
		const far = Math.max(tol || 40, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]));
		return o.verts.every((p) => list.every((b) => segDist(p, b.head, b.tail) > far));
	};
	// A copy of a model follows the same bone, with the same deform / rigid choice and stiffness.
	R.inherit = (anim, fromId, toId) => {
		if (anim.bind[fromId]) anim.bind[toId] = anim.bind[fromId];
		if (anim.rigid && anim.rigid[fromId]) anim.rigid[toId] = true;
		if (anim.skin && anim.skin[fromId]) anim.skin[toId] = Object.assign({}, anim.skin[fromId]);
		if (anim.paint && anim.paint[fromId]) anim.paint[toId] = JSON.parse(JSON.stringify(anim.paint[fromId]));
	};
	const skinPoint = (list, w, mats, p) => {
		const q = [0, 0, 0];
		list.forEach((b, i) => {
			if (w[i] < 1e-5) return;
			const m = mats.get(b.id);
			const x = m ? apply(m, p) : p;
			for (let k = 0; k < 3; k++) q[k] += x[k] * w[i];
		});
		return q;
	};

	// Frames go in a grid of power-of-two columns and rows, cell by cell in reading order, so a cell of 2^n px always makes a sheet of
	// 2^n px (what the Aseprite link accepts).
	const pow2up = (n) => { let p = 1; while (p < n) p *= 2; return p; };
	R.isPow2 = (n) => n >= 1 && (n & (n - 1)) === 0 && Number.isInteger(n);
	R.layout = (cw, ch, frames) => {
		const cols = pow2up(Math.ceil(Math.sqrt(frames))), rows = pow2up(Math.ceil(frames / cols));
		return { cols, rows, cw, ch, w: cols * cw, h: rows * ch, frames };
	};
	R.cellOrigin = (lay, i) => [(i % lay.cols) * lay.cw, Math.floor(i / lay.cols) * lay.ch];

	// Normal map of one frame: transparent outside the posed models. (The art is not involved: the artist draws the pixels.)
	R.frameNormals = (objects, anim, clip, frame, w, h, settings) => {
		const posed = R.posedObjects(objects, anim, clip, frame);
		const alpha = new Uint8Array(w * h).fill(255);
		const art = { w, h, data: new Uint8ClampedArray(w * h * 4), alpha };
		const st = Object.assign({}, settings, { fill: 0, relief: 0, alphaCut: 0 });
		const r = TS.Process.run(posed, art, st);
		for (let i = 0; i < w * h; i++) if (isNaN(r.height[i])) alpha[i] = 0;
		r.alpha = alpha;
		return TS.Process.images(r, st).normal;
	};

	// The tileset's art carried along with the posed models: each pixel of the frame takes the colour of the rest-pose pixel its surface
	// point came from (the nearest surface wins). Transparent where no model covers; art = {w, h, data} (RGBA).
	R.frameColours = (objects, anim, clip, frame, w, h, settings, art) => {
		const posed = R.posedObjects(objects, anim, clip, frame), proj = TS.Proj.of(settings, { w, h });
		const out = new ImageData(w, h), depth = new Float32Array(w * h).fill(-Infinity), Mesh = TS.Mesh;
		posed.forEach((obj, oi) => {
			const rest = objects[oi];
			obj.faces.forEach((f) => {
				for (const ids of Mesh.faceTriangles(obj, f)) {
					const p = ids.map((k) => obj.verts[f.v[k]]), q = ids.map((k) => rest.verts[f.v[k]]);
					const s = p.map((v) => proj.toCanvas(v)), r = q.map((v) => proj.toCanvas(v)), d = p.map((v) => proj.depth(v));
					const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[1][1] - s[0][1]) * (s[2][0] - s[0][0]);
					if (area < 1e-9) continue; // edge-on or facing away
					const x0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), x1 = Math.min(w - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
					const y0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), y1 = Math.min(h - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
					for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
						const px = x + 0.5, py = y + 0.5;
						const w0 = ((s[1][0] - px) * (s[2][1] - py) - (s[1][1] - py) * (s[2][0] - px)) / area;
						const w1 = ((s[2][0] - px) * (s[0][1] - py) - (s[2][1] - py) * (s[0][0] - px)) / area, w2 = 1 - w0 - w1;
						if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
						const dz = w0 * d[0] + w1 * d[1] + w2 * d[2], i = y * w + x;
						if (dz <= depth[i]) continue;
						const ax = Math.floor(w0 * r[0][0] + w1 * r[1][0] + w2 * r[2][0]), ay = Math.floor(w0 * r[0][1] + w1 * r[1][1] + w2 * r[2][1]);
						const ok = ax >= 0 && ay >= 0 && ax < art.w && ay < art.h && art.data[(ay * art.w + ax) * 4 + 3];
						depth[i] = dz;
						if (ok) out.data.set(art.data.subarray((ay * art.w + ax) * 4, (ay * art.w + ax) * 4 + 4), i * 4);
						else out.data.fill(0, i * 4, i * 4 + 4);
					}
				}
			});
		});
		return out;
	};

	// All frames of a clip as one ImageData sheet.
	R.normalSheet = (objects, anim, clip, cw, ch, settings) => {
		const lay = R.layout(cw, ch, clip.frames), sheet = new ImageData(lay.w, lay.h);
		for (let f = 0; f < clip.frames; f++) {
			const img = R.frameNormals(objects, anim, clip, f, cw, ch, settings), [ox, oy] = R.cellOrigin(lay, f);
			for (let y = 0; y < ch; y++) sheet.data.set(img.data.subarray(y * cw * 4, (y + 1) * cw * 4), ((oy + y) * lay.w + ox) * 4);
		}
		return { sheet, layout: lay };
	};
})();
