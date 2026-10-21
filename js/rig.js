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
			const pose = (override && override[b.id]) || R.localPose(clip, b.id, frame);
			const local = m4.mul(m4.mul(translate(v3.add(b.head, pose.pos)), rotate(pose.rot)), translate(v3.scale(b.head, -1)));
			const parent = b.parent && out.get(b.parent);
			out.set(b.id, parent ? m4.mul(parent, local) : local);
		}
		return out;
	};
	const apply = (m, p) => { const q = m4.apply(m, p); return [q[0], q[1], q[2]]; };
	R.apply = apply;

	// The models as they stand at a frame: copies (same ids) with the bound ones' vertices moved; the rest are shared as they are.
	R.posedObjects = (objects, anim, clip, frame) => {
		if (!anim.bones.length) return objects;
		const mats = R.matrices(anim, clip, frame);
		return objects.map((o) => {
			const m = mats.get(anim.bind[o.id]);
			return m ? Object.assign({}, o, { verts: o.verts.map((p) => apply(m, p)) }) : o;
		});
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
