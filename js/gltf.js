// glTF 2.0 (.glb) exchange for models, bones and animation clips, so a model can go to Blender and a refined one can come back.
//
// Axes: Studio is X east, Y south (depth), Z up; glTF is Y up, so Studio (x, y, z) is glTF (x, z, -y). That is Blender's own
// mapping, so Studio's axes read the same as Blender's. Distances: `scale` is pixels per glTF unit.
//
// Rig: a Studio bone turns about its head and moves by `pos`; its children ride along (see rig.js). That is exactly a glTF joint whose
// local translation is (head - parent head) + pos and whose local rotation is the bone's turn, with the inverse bind matrix a plain
// translation by -head. A bound model exports as a mesh skinned with its deform weights (automatic or painted; 100% to its bone if rigid).
// Reading goes the other way and accepts any rig: each skinned mesh is cut into one model per bone (by the bone with most weight on
// each face), because Studio bones do not bend a model.
"use strict";
(function () {
	const G = (TS.Gltf = {});
	const Rig = TS.Rig, Mesh = TS.Mesh, v3 = TS.v3, m3 = Rig.mat3;

	// --- small maths: Studio axes <-> glTF axes, quaternions, 4x4 (column-major) ---
	const C = [[1, 0, 0], [0, 0, 1], [0, -1, 0]], Ct = m3.transpose(C); // Studio -> glTF as a rotation
	const toG = (p) => [p[0], p[2], -p[1]];
	const toS = (p) => [p[0], -p[2], p[1]];
	const mulV = (m, p) => [0, 1, 2].map((i) => m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2]);
	const toGRot = (r) => m3.mul(m3.mul(C, r), Ct); // a Studio rotation expressed in glTF axes
	const toSRot = (r) => m3.mul(m3.mul(Ct, r), C);
	const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

	const quatFromMat = (m) => {
		const t = m[0][0] + m[1][1] + m[2][2];
		let x, y, z, w, s;
		if (t > 0) { s = Math.sqrt(t + 1) * 2; w = s / 4; x = (m[2][1] - m[1][2]) / s; y = (m[0][2] - m[2][0]) / s; z = (m[1][0] - m[0][1]) / s; }
		else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; w = (m[2][1] - m[1][2]) / s; x = s / 4; y = (m[0][1] + m[1][0]) / s; z = (m[0][2] + m[2][0]) / s; }
		else if (m[1][1] > m[2][2]) { s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; w = (m[0][2] - m[2][0]) / s; x = (m[0][1] + m[1][0]) / s; y = s / 4; z = (m[1][2] + m[2][1]) / s; }
		else { s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; w = (m[1][0] - m[0][1]) / s; x = (m[0][2] + m[2][0]) / s; y = (m[1][2] + m[2][1]) / s; z = s / 4; }
		const l = Math.hypot(x, y, z, w) || 1;
		return [x / l, y / l, z / l, w / l];
	};
	const matFromQuat = ([x, y, z, w]) => {
		const l = Math.hypot(x, y, z, w) || 1; x /= l; y /= l; z /= l; w /= l;
		return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
	};
	const slerp = (a, b, t) => {
		let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
		if (d < 0) { b = b.map((v) => -v); d = -d; }
		if (d > 0.9995) { const o = a.map((v, i) => v + (b[i] - v) * t), l = Math.hypot(...o); return o.map((v) => v / l); }
		const th = Math.acos(d), s = Math.sin(th), k1 = Math.sin((1 - t) * th) / s, k2 = Math.sin(t * th) / s;
		return a.map((v, i) => v * k1 + b[i] * k2);
	};
	const mat4Mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
	const mat4FromTRS = (t, q, s) => {
		const r = matFromQuat(q), o = new Array(16).fill(0);
		for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[j * 4 + i] = r[i][j] * s[j];
		o[12] = t[0]; o[13] = t[1]; o[14] = t[2]; o[15] = 1;
		return o;
	};
	const mat4Apply = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
	const mat4Rot = (m) => { const s = [0, 1, 2].map((c) => Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]) || 1); return [0, 1, 2].map((i) => [0, 1, 2].map((j) => m[j * 4 + i] / s[j])); };
	const mat4Decompose = (m) => [[m[12], m[13], m[14]], quatFromMat(mat4Rot(m)), [0, 1, 2].map((c) => Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]))];

	// ======================================================================= writing

	// objects: Studio models; anim: S.anim (bones, bind, clips). opts: {scale, rig (default true), allBones}.
	// Returns an ArrayBuffer holding a .glb.
	G.write = function (objects, anim, opts = {}) {
		if (!objects.length) throw new Error("There are no models to export.");
		const scale = opts.scale > 0 ? opts.scale : 1;
		const useRig = opts.rig !== false && anim && anim.bones && anim.bones.length > 0;

		// Bones to take: those the exported models follow (and their parents), or all of them when everything is exported.
		let bones = [];
		if (useRig) {
			const need = new Set();
			if (opts.allBones) anim.bones.forEach((b) => need.add(b.id));
			for (const o of objects) for (let b = Rig.bone(anim, anim.bind[o.id]), n = 0; b && n < 1000; n++, b = b.parent && Rig.bone(anim, b.parent)) need.add(b.id);
			bones = Rig.ordered(anim).filter((b) => need.has(b.id));
		}
		const boneIdx = new Map(bones.map((b, i) => [b.id, i]));
		const parentOf = (b) => { for (let p = b.parent && Rig.bone(anim, b.parent); p; p = p.parent && Rig.bone(anim, p.parent)) if (boneIdx.has(p.id)) return p; return null; };

		const chunks = [], views = [], accessors = [];
		let offset = 0;
		const addView = (bytes, target) => {
			const pad = (4 - (bytes.length % 4)) % 4, padded = new Uint8Array(bytes.length + pad);
			padded.set(bytes);
			views.push(Object.assign({ buffer: 0, byteOffset: offset, byteLength: bytes.length }, target ? { target } : {}));
			chunks.push(padded); offset += padded.length;
			return views.length - 1;
		};
		const addAcc = (arr, type, componentType, count, target, extra) => {
			accessors.push(Object.assign({ bufferView: addView(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), target), componentType, count, type }, extra));
			return accessors.length - 1;
		};
		const F = 5126, U16 = 5123, U32 = 5125;

		const nodes = [], sceneNodes = [];
		// joints first
		bones.forEach((b) => {
			const par = parentOf(b), h = b.head, hp = par ? par.head : [0, 0, 0];
			nodes.push({ name: b.name, translation: toG(v3.sub(h, hp)).map((v) => v / scale), extras: { studioBone: { id: b.id, tail: b.tail.slice() } } });
		});
		bones.forEach((b, i) => {
			const par = parentOf(b);
			if (par) (nodes[boneIdx.get(par.id)].children = nodes[boneIdx.get(par.id)].children || []).push(i); else sceneNodes.push(i);
		});

		let skin = null;
		if (bones.length) {
			const ibm = new Float32Array(bones.length * 16);
			bones.forEach((b, i) => { const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ...toG(b.head).map((v) => -v / scale), 1]; ibm.set(m, i * 16); });
			skin = { joints: bones.map((_, i) => i), inverseBindMatrices: addAcc(ibm, "MAT4", F, bones.length) };
		}

		const meshes = [];
		for (const o of objects) {
			const tris = Mesh.triangles(o);
			if (!tris.length) continue; // lines and points have no glTF counterpart worth keeping
			const pos = new Float32Array(o.verts.length * 3), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
			o.verts.forEach((p, i) => { const g = toG(p).map((v) => v / scale); pos.set(g, i * 3); for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], g[k]); max[k] = Math.max(max[k], g[k]); } });
			const idx = new Uint32Array(tris.length * 3);
			tris.forEach((t, i) => idx.set([t.a, t.b, t.c], i * 3));
			const attributes = { POSITION: addAcc(pos, "VEC3", F, o.verts.length, 34962, { min, max }) };
			const bone = useRig && Rig.bone(anim, anim.bind[o.id]);
			if (bone && boneIdx.has(bone.id)) {
				const j = new Uint16Array(o.verts.length * 4), w = new Float32Array(o.verts.length * 4);
				// A deforming model exports its skin weights (the automatic ones and anything painted): each vertex's four strongest bones.
				const sk = Rig.skinWeights(anim, o);
				for (let i = 0; i < o.verts.length; i++) {
					const top = sk ? sk.weights[i].map((x, k) => [x, k]).filter(([x, k]) => x > 0 && boneIdx.has(sk.list[k].id)).sort((p, q) => q[0] - p[0]).slice(0, 4) : [];
					const sum = top.reduce((s, [x]) => s + x, 0);
					if (!top.length || sum <= 0) { j[i * 4] = boneIdx.get(bone.id); w[i * 4] = 1; continue; }
					top.forEach(([x, k], n) => { j[i * 4 + n] = boneIdx.get(sk.list[k].id); w[i * 4 + n] = x / sum; });
				}
				attributes.JOINTS_0 = addAcc(j, "VEC4", U16, o.verts.length, 34962);
				attributes.WEIGHTS_0 = addAcc(w, "VEC4", F, o.verts.length, 34962);
			}
			meshes.push({ name: o.name, primitives: [{ attributes, indices: addAcc(idx, "SCALAR", U32, idx.length, 34963), mode: 4 }] });
			// Everything Studio knows about the model that glTF has no place for, so it can come back whole.
			const extra = {};
			for (const k of Object.keys(o)) if (!["id", "name", "verts", "faces", "lines", "hidden"].includes(k)) extra[k] = o[k];
			const studio = { props: extra, counts: { verts: o.verts.length, tris: tris.length }, faces: o.faces.map((f) => Object.assign({}, f)) };
			const node = { name: o.name, mesh: meshes.length - 1, extras: { studio } };
			if (bone && boneIdx.has(bone.id)) node.skin = 0;
			nodes.push(node); sceneNodes.push(nodes.length - 1);
		}
		if (!meshes.length) throw new Error("None of these models has a surface to export (glTF needs faces).");

		// Clips: every frame sampled for every bone that has keys.
		const animations = [];
		if (bones.length) for (const clip of anim.clips || []) {
			const animated = bones.filter((b) => (clip.tracks[b.id] || []).length);
			if (!animated.length) continue;
			const n = clip.frames, fps = clip.fps || 8, times = new Float32Array(n).map((_, f) => f / fps);
			const input = addAcc(times, "SCALAR", F, n, undefined, { min: [0], max: [times[n - 1]] });
			const samplers = [], channels = [];
			for (const b of animated) {
				const par = parentOf(b), hp = par ? par.head : [0, 0, 0], rest = v3.sub(b.head, hp);
				const tr = new Float32Array(n * 3), rt = new Float32Array(n * 4);
				let prev = null;
				for (let f = 0; f < n; f++) {
					const pose = Rig.localPose(clip, b.id, f);
					tr.set(toG(v3.add(rest, pose.pos)).map((v) => v / scale), f * 3);
					let q = quatFromMat(toGRot(Rig.eulerToMat(pose.rot)));
					if (prev && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0) q = q.map((v) => -v);
					rt.set(q, f * 4); prev = q;
				}
				samplers.push({ input, output: addAcc(tr, "VEC3", F, n), interpolation: "LINEAR" });
				channels.push({ sampler: samplers.length - 1, target: { node: boneIdx.get(b.id), path: "translation" } });
				samplers.push({ input, output: addAcc(rt, "VEC4", F, n), interpolation: "LINEAR" });
				channels.push({ sampler: samplers.length - 1, target: { node: boneIdx.get(b.id), path: "rotation" } });
			}
			animations.push({ name: clip.name, channels, samplers, extras: { studioClip: { fps, frames: n } } });
		}

		const json = { asset: { version: "2.0", generator: "Tileset Studio" }, scene: 0, scenes: [{ nodes: sceneNodes }], nodes, meshes, accessors, bufferViews: views, buffers: [{ byteLength: offset }] };
		if (skin) json.skins = [skin];
		if (animations.length) json.animations = animations;
		const jsonBytes = new TextEncoder().encode(JSON.stringify(json)), jpad = (4 - (jsonBytes.length % 4)) % 4;
		const jlen = jsonBytes.length + jpad, total = 12 + 8 + jlen + 8 + offset;
		const out = new Uint8Array(total), dv = new DataView(out.buffer);
		dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
		dv.setUint32(12, jlen, true); dv.setUint32(16, 0x4e4f534a, true);
		out.set(jsonBytes, 20); out.fill(0x20, 20 + jsonBytes.length, 20 + jlen);
		let p = 20 + jlen;
		dv.setUint32(p, offset, true); dv.setUint32(p + 4, 0x004e4942, true); p += 8;
		for (const c of chunks) { out.set(c, p); p += c.length; }
		return out.buffer;
	};

	// ======================================================================= reading

	const COMPS = { 5120: [1, Int8Array, "getInt8"], 5121: [1, Uint8Array, "getUint8"], 5122: [2, Int16Array, "getInt16"], 5123: [2, Uint16Array, "getUint16"], 5125: [4, Uint32Array, "getUint32"], 5126: [4, Float32Array, "getFloat32"] };
	const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

	function parseContainer(buf, files) {
		const dv = new DataView(buf), td = new TextDecoder();
		if (buf.byteLength >= 12 && dv.getUint32(0, true) === 0x46546c67) {
			let json = null, bin = null;
			for (let p = 12; p + 8 <= buf.byteLength;) {
				const len = dv.getUint32(p, true), type = dv.getUint32(p + 4, true), body = buf.slice(p + 8, p + 8 + len);
				if (type === 0x4e4f534a) json = JSON.parse(td.decode(body)); else if (type === 0x004e4942 && !bin) bin = body;
				p += 8 + len + ((4 - (len % 4)) % 4);
			}
			if (!json) throw new Error("This .glb has no scene data.");
			return { json, bufs: [bin] };
		}
		const json = JSON.parse(td.decode(buf)), bufs = (json.buffers || []).map((b) => {
			const m = /^data:[^;,]*;base64,(.*)$/s.exec(b.uri || "");
			if (!m) { const f = files && files[decodeURIComponent(b.uri || "")]; if (f) return f; throw new Error(`This .gltf keeps its data in “${b.uri}”. Pick that file with the .gltf (or export as “glTF Binary (.glb)”).`); }
			const bin = atob(m[1]), arr = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
			return arr.buffer;
		});
		return { json, bufs };
	}

	// An accessor as {data: array of numbers (flat), n: components per element, count}.
	function readAccessor(gl, bufs, index) {
		const a = gl.accessors[index];
		if (!a) throw new Error("This file points at data that is missing.");
		if (a.sparse) throw new Error("Sparse accessors are not supported.");
		const [size, , getter] = COMPS[a.componentType], n = NCOMP[a.type], count = a.count;
		const out = new Array(count * n);
		if (a.bufferView === undefined) return { data: out.fill(0), n, count };
		const view = gl.bufferViews[a.bufferView], buf = bufs[view.buffer || 0];
		if (!buf) throw new Error("This file's binary data is missing.");
		const dv = new DataView(buf), base = (view.byteOffset || 0) + (a.byteOffset || 0), stride = view.byteStride || size * n;
		const norm = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] : 0;
		for (let i = 0; i < count; i++) for (let k = 0; k < n; k++) {
			let v = dv[getter](base + i * stride + k * size, true);
			if (norm) v = Math.max(v / norm, -1);
			out[i * n + k] = v;
		}
		return { data: out, n, count };
	}

	// opts: {scale (pixels per glTF unit)}. Returns {objects, rig}; rig is null when the file has no bones or animation. Model ids
	// (1..) and bone ids ("b1"..) are the file's own and are re-numbered when added to a project.
	G.read = function (buffer, opts = {}) {
		const scale = opts.scale > 0 ? opts.scale : 1;
		const { json: gl, bufs } = parseContainer(buffer, opts.files);
		const nodes = gl.nodes || [];
		const parent = new Array(nodes.length).fill(-1);
		nodes.forEach((nd, i) => (nd.children || []).forEach((c) => { parent[c] = i; }));
		const local = nodes.map((nd) => (nd.matrix ? mat4Decompose(nd.matrix) : [nd.translation || [0, 0, 0], nd.rotation || [0, 0, 0, 1], nd.scale || [1, 1, 1]]));
		const world = new Array(nodes.length);
		const worldOf = (i) => world[i] || (world[i] = (parent[i] >= 0 ? mat4Mul(worldOf(parent[i]), mat4FromTRS(...local[i])) : mat4FromTRS(...local[i])));
		nodes.forEach((_, i) => worldOf(i));

		// joints
		const isJoint = new Set();
		for (const s of gl.skins || []) for (const j of s.joints) isJoint.add(j);
		const jointOrder = [];
		const visit = (i) => { if (isJoint.has(i)) jointOrder.push(i); (nodes[i].children || []).forEach(visit); };
		nodes.forEach((_, i) => { if (parent[i] < 0) visit(i); });
		const nearestJoint = (i) => { for (let p = parent[i]; p >= 0; p = parent[p]) if (isJoint.has(p)) return p; return -1; };

		const bones = [], boneOfNode = new Map(), info = new Map(); // info: per node {R0, t0, Rp0} in Studio axes and units
		for (const i of jointOrder) {
			const head = toS(mat4Apply(world[i], [0, 0, 0])).map((v) => v * scale);
			const par = nearestJoint(i);
			const bone = Rig.newBone(nodes[i].name || "Bone " + (bones.length + 1), head, [head[0], head[1], head[2] + 8], par >= 0 ? boneOfNode.get(par).id : null);
			bone.id = "b" + (bones.length + 1);
			bones.push(bone); boneOfNode.set(i, bone);
			const pw = parent[i] >= 0 ? world[parent[i]] : mat4FromTRS([0, 0, 0], [0, 0, 0, 1], [1, 1, 1]);
			info.set(i, { R0: toSRot(matFromQuat(local[i][1])), t0: toS(local[i][0]).map((v) => v * scale), Rp0: toSRot(mat4Rot(pw)) });
		}
		bones.forEach((b) => { // a tail toward the first child makes the bones draw sensibly
			const kid = bones.find((c) => c.parent === b.id);
			if (kid) b.tail = kid.head.slice();
		});

		// models
		const objects = [], bind = {};
		let nextId = 1;
		gl.meshes && nodes.forEach((nd, ni) => {
			if (nd.mesh === undefined) return;
			const mesh = gl.meshes[nd.mesh], skin = nd.skin !== undefined ? gl.skins[nd.skin] : null;
			const pts = [], tris = [], joints = [], weights = [];
			for (const prim of mesh.primitives) {
				const mode = prim.mode === undefined ? 4 : prim.mode;
				if (mode < 4 || !prim.attributes || prim.attributes.POSITION === undefined) continue;
				const P = readAccessor(gl, bufs, prim.attributes.POSITION), base = pts.length;
				for (let i = 0; i < P.count; i++) pts.push([P.data[i * 3], P.data[i * 3 + 1], P.data[i * 3 + 2]]);
				let ix;
				if (prim.indices !== undefined) ix = readAccessor(gl, bufs, prim.indices).data; else ix = Array.from({ length: P.count }, (_, i) => i);
				if (mode === 4) for (let i = 0; i + 2 < ix.length; i += 3) tris.push([ix[i] + base, ix[i + 1] + base, ix[i + 2] + base]);
				else if (mode === 5) for (let i = 0; i + 2 < ix.length; i++) tris.push(i % 2 ? [ix[i + 1] + base, ix[i] + base, ix[i + 2] + base] : [ix[i] + base, ix[i + 1] + base, ix[i + 2] + base]);
				else for (let i = 1; i + 1 < ix.length; i++) tris.push([ix[0] + base, ix[i] + base, ix[i + 1] + base]);
				if (skin && prim.attributes.JOINTS_0 !== undefined && prim.attributes.WEIGHTS_0 !== undefined) {
					const J = readAccessor(gl, bufs, prim.attributes.JOINTS_0), W = readAccessor(gl, bufs, prim.attributes.WEIGHTS_0);
					for (let i = 0; i < P.count; i++) { joints.push([0, 1, 2, 3].map((k) => skin.joints[J.data[i * 4 + k]])); weights.push([0, 1, 2, 3].map((k) => W.data[i * 4 + k])); }
				} else for (let i = 0; i < P.count; i++) { joints.push([-1, -1, -1, -1]); weights.push([0, 0, 0, 0]); }
			}
			if (!tris.length) return;

			// Rest position of each vertex in Studio space.
			let ibm = null;
			if (skin && skin.inverseBindMatrices !== undefined) { const d = readAccessor(gl, bufs, skin.inverseBindMatrices).data; ibm = skin.joints.map((_, k) => d.slice(k * 16, k * 16 + 16)); }
			const skinMat = new Map();
			const jointMat = (node) => {
				if (!skinMat.has(node)) { const k = skin.joints.indexOf(node); skinMat.set(node, ibm ? mat4Mul(world[node], ibm[k]) : world[node]); }
				return skinMat.get(node);
			};
			const rest = pts.map((p, i) => {
				let g;
				if (skin && weights[i][0] + weights[i][1] + weights[i][2] + weights[i][3] > 0) {
					g = [0, 0, 0];
					const wsum = weights[i].reduce((a, b) => a + b, 0);
					for (let k = 0; k < 4; k++) if (weights[i][k] > 0) { const q = mat4Apply(jointMat(joints[i][k]), p); g = [g[0] + q[0] * weights[i][k] / wsum, g[1] + q[1] * weights[i][k] / wsum, g[2] + q[2] * weights[i][k] / wsum]; }
				} else g = mat4Apply(world[ni], p);
				return toS(g).map((v) => v * scale);
			});

			// Which bone does each face follow?
			const owner = (a, b, c) => {
				const sum = new Map();
				for (const v of [a, b, c]) for (let k = 0; k < 4; k++) if (weights[v][k] > 0) sum.set(joints[v][k], (sum.get(joints[v][k]) || 0) + weights[v][k]);
				let best = -1, bw = 0;
				for (const [j, w] of sum) if (w > bw) { best = j; bw = w; }
				return best;
			};
			const fixed = nearestJoint(ni) >= 0 && !skin ? nearestJoint(ni) : -1; // parented to a bone
			const groups = new Map();
			for (const t of tris) {
				const key = skin ? owner(...t) : fixed;
				if (!groups.has(key)) groups.set(key, []);
				groups.get(key).push(t);
			}
			const label = nd.name || mesh.name || "Model";
			const ex = nd.extras && nd.extras.studio;
			for (const [key, list] of groups) {
				const used = new Map(), verts = [], faces = [];
				const add = (v) => { // weld vertices that sit on the same spot (glTF splits them along seams)
					const p = rest[v], k = p.map((x) => Math.round(x * 1e4)).join(",");
					if (!used.has(k)) { used.set(k, verts.length); verts.push(p.slice()); }
					return used.get(k);
				};
				let exact = false;
				if (ex && groups.size === 1 && ex.counts && ex.counts.verts === pts.length && ex.counts.tris === tris.length && Array.isArray(ex.faces)) {
					// Written by Studio and the mesh still has its size: keep its own faces (quads and all) and its vertices as they are.
					exact = true;
					rest.forEach((p) => verts.push(p.slice()));
					for (const f of ex.faces) faces.push(Object.assign({}, f));
				} else for (const t of list) { const f = t.map(add); if (new Set(f).size === 3) faces.push({ v: f }); }
				if (!faces.length) continue;
				const o = { id: nextId++, name: groups.size > 1 && key >= 0 && boneOfNode.get(key) ? `${label} · ${boneOfNode.get(key).name}` : label, verts, faces, mat: { roughness: 0.7, metallic: 0 }, solid: true, smooth: 30 };
				if (exact && ex.props) Object.assign(o, JSON.parse(JSON.stringify(ex.props)));
				objects.push(o);
				if (key >= 0 && boneOfNode.get(key)) bind[o.id] = boneOfNode.get(key).id;
			}
		});
		if (!objects.length) throw new Error("This file has no triangle meshes to import.");

		// clips
		const clips = [];
		if (bones.length) (gl.animations || []).forEach((an, ai) => {
			const chans = (an.channels || []).filter((c) => c.target && boneOfNode.has(c.target.node) && (c.target.path === "translation" || c.target.path === "rotation"));
			if (!chans.length) return;
			const samp = an.samplers.map((s) => ({ t: readAccessor(gl, bufs, s.input).data, v: readAccessor(gl, bufs, s.output), mode: s.interpolation || "LINEAR" }));
			let dur = 0;
			for (const c of chans) { const s = samp[c.sampler]; dur = Math.max(dur, s.t[s.t.length - 1] || 0); }
			const own = an.extras && an.extras.studioClip; // written by Studio: its own fps and frame count come back as they were
			let fps = own && own.fps > 0 ? own.fps : 12, frames = own && own.frames > 0 ? own.frames : Math.round(dur * fps) + 1;
			if (frames > 64) { frames = 64; fps = Math.max(1, 63 / dur); }
			frames = Math.max(1, frames);
			const sample = (s, time, n) => {
				const t = s.t, vals = (k) => { const stride = s.mode === "CUBICSPLINE" ? 3 : 1, at = (s.mode === "CUBICSPLINE" ? k * 3 + 1 : k) * n; return s.v.data.slice(at, at + n); };
				if (time <= t[0]) return vals(0);
				if (time >= t[t.length - 1]) return vals(t.length - 1);
				let k = 0; while (t[k + 1] < time) k++;
				const a = vals(k), b = vals(k + 1), u = (time - t[k]) / (t[k + 1] - t[k] || 1);
				if (s.mode === "STEP") return a;
				return n === 4 ? slerp(a, b, u) : a.map((v, i) => v + (b[i] - v) * u);
			};
			const tracks = {};
			for (const node of new Set(chans.map((c) => c.target.node))) {
				const bone = boneOfNode.get(node), inf = info.get(node), cT = chans.find((c) => c.target.node === node && c.target.path === "translation"), cR = chans.find((c) => c.target.node === node && c.target.path === "rotation");
				const keys = []; let prevEuler = null;
				for (let f = 0; f < frames; f++) {
					const time = f / fps;
					const tg = cT ? sample(samp[cT.sampler], time, 3) : local[node][0], qg = cR ? sample(samp[cR.sampler], time, 4) : local[node][1];
					const tS = toS(tg).map((v) => v * scale), Rl = toSRot(matFromQuat(qg));
					// A joint's turn about its head and its move, as Studio keeps them (see the header comment).
					const Rd = m3.mul(m3.mul(m3.mul(inf.Rp0, Rl), m3.transpose(inf.R0)), m3.transpose(inf.Rp0));
					let rot = Rig.matToEuler(Rd);
					if (prevEuler) rot = rot.map((v, i) => { while (v - prevEuler[i] > 180) v -= 360; while (v - prevEuler[i] < -180) v += 360; return v; });
					prevEuler = rot;
					keys.push({ f, rot: rot.map((v) => Math.round(v * 1000) / 1000), pos: mulV(inf.Rp0, v3.sub(tS, inf.t0)).map((v) => Math.round(v * 1000) / 1000) });
				}
				const pruned = prune(keys);
				if (pruned.length === 1 && pruned[0].rot.every((v) => Math.abs(v) < 0.01) && pruned[0].pos.every((v) => Math.abs(v) < 0.01)) continue;
				tracks[bone.id] = pruned;
			}
			if (Object.keys(tracks).length) clips.push({ id: "c" + (clips.length + 1), name: an.name || "Clip " + (ai + 1), fps: Math.round(fps * 100) / 100, frames, tracks });
		});
		return { objects, rig: bones.length || clips.length ? { bones, bind, clips } : null };
	};

	// Drop keys that a straight blend of their neighbours already gives (every frame is sampled, most are redundant).
	function prune(keys) {
		const out = keys.slice();
		const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.05);
		for (let i = out.length - 2; i >= 1; i--) {
			const a = out[i - 1], k = out[i], b = out[i + 1], u = (k.f - a.f) / (b.f - a.f);
			if (close(k.rot, a.rot.map((v, j) => v + (b.rot[j] - v) * u)) && close(k.pos, a.pos.map((v, j) => v + (b.pos[j] - v) * u))) out.splice(i, 1);
		}
		if (out.length === 2 && close(out[0].rot, out[1].rot) && close(out[0].pos, out[1].pos)) out.pop();
		return out;
	}

	G.looksLikeGltf = (name) => /\.(glb|gltf)$/i.test(name);
})();
