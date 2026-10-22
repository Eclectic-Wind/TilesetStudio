// Rig: rigid bones over the models, keyframed clips, and the spritesheet the animation renders into.
//
// anim = { bones: [{id, name, parent|null, head: [x,y,z], tail: [x,y,z]}]   rest pose, world space (art px)
//          bind:  {modelId: boneId}                                          a model follows its bone rigidly
//          clips: [{id, name, fps, frames, tracks: {boneId: [{f, rot: [rx,ry,rz], pos: [x,y,z]}]}}]
//          clip: active clip id, frame: current frame, albedo: dataURL of the artist's sheet (or null)}
// A bone turns about its head (rot = degrees, applied Z·Y·X) and then moves by pos; its children ride along. A key holds a bone's
// whole local pose, so frames between keys blend linearly; before the first key a bone eases in from rest at frame 0, and after the last key it holds.
"use strict";
(function () {
	const m4 = TS.m4, v3 = TS.v3;
	const R = (TS.Rig = {});
	const RAD = Math.PI / 180;
	let nextBone = 1, nextClip = 1;

	R.newAnim = () => ({ bones: [], bind: {}, clips: [], clip: null, frame: 0, albedo: null });
	R.bumpIds = (anim) => {
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

	// A bone's local pose at a frame: its keys blended (none = rest).
	R.localPose = (clip, boneId, frame) => {
		const keys = (clip && clip.tracks[boneId]) || [];
		if (!keys.length) return { rot: [0, 0, 0], pos: [0, 0, 0] };
		// Before the first key the bone eases in from its rest pose at frame 0 (so keying only frame 3 leaves frame 0 at rest).
		if (frame <= keys[0].f) {
			const t = keys[0].f > 0 ? Math.max(0, frame / keys[0].f) : 1;
			return { rot: v3.lerp([0, 0, 0], keys[0].rot, t), pos: v3.lerp([0, 0, 0], keys[0].pos, t) };
		}
		const last = keys[keys.length - 1];
		if (frame >= last.f) return { rot: last.rot.slice(), pos: last.pos.slice() };
		let i = 0;
		while (keys[i + 1].f < frame) i++;
		const a = keys[i], b = keys[i + 1], t = (frame - a.f) / (b.f - a.f);
		return { rot: v3.lerp(a.rot, b.rot, t), pos: v3.lerp(a.pos, b.pos, t) };
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
		return { rot: R.matToEuler(rotPart(local)), pos: [h[0] - bone.head[0], h[1] - bone.head[1], h[2] - bone.head[2]] };
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
		const sig = main.id + "|" + stiff + "|" + list.map((b) => b.id + ":" + b.head + ":" + b.tail).join(";");
		const hit = weightCache.get(o);
		if (hit && hit.sig === sig && sameVerts(hit.verts, o.verts)) return hit.w;
		const weights = o.verts.map((p) => {
			let raw = list.map((b) => (b === main ? 4 : 1) / Math.pow(segDist(p, b.head, b.tail) + 0.5, stiff)), sum = raw.reduce((x, y) => x + y, 0);
			raw = raw.map((x) => (x / sum < 0.02 ? 0 : x)); sum = raw.reduce((x, y) => x + y, 0); // far bones don't tug at all
			return raw.map((x) => x / sum);
		});
		const w = { list, weights };
		weightCache.set(o, { sig, w, verts: Float64Array.from(o.verts.flat()) });
		return w;
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
