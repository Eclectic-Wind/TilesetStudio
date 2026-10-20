// Polygon meshes (n-gon faces) and the modelling operations. Objects keep their vertices in world space (art px).
// object: {id, name, verts: [[x, y, z]], faces: [{v: [i, ...], mat?: {roughness, metallic, turn?}}], mat: {roughness, metallic, turn?},
//          (turn: degrees the normals are turned about the vertical, + south toward east; see shadingNormals)
//          solid: bool (collision), smooth: degrees (auto-smooth angle for shading),
//          lines?: [[a, b]] loose edges (drawing aids: picked and edited like edges, no surface, never processed),
//          basis?: [[x], [y], [z]] the model's own axes (turned with it; for local turns / moves; missing = the world's)}
// Faces wind counter-clockwise seen from outside (right-handed: X east, Y south, Z up).
"use strict";
(function () {
	const v3 = TS.v3;
	let nextId = 1;

	const M = (TS.Mesh = {});

	M.newObject = (name, verts, faces) => {
		const obj = { id: nextId++, name, verts, faces: faces.map((v) => ({ v })), mat: { roughness: 0.7, metallic: 0 }, solid: true, smooth: 30 };
		M.orientOutward(obj);
		return obj;
	};
	M.bumpIds = (objects) => { for (const o of objects) nextId = Math.max(nextId, o.id + 1); };
	M.clone = (obj) => JSON.parse(JSON.stringify(obj));
	M.cloneNew = (obj) => { const c = M.clone(obj); c.id = nextId++; return c; };

	// --- primitives (base = centre of the bottom, on the floor plan, at height base[2]) ---

	M.box = (base, w, d, h) => {
		const [cx, cy, z] = base, x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2;
		const verts = [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [x0, y0, z + h], [x1, y0, z + h], [x1, y1, z + h], [x0, y1, z + h]];
		return M.newObject("Box", verts, [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]);
	};

	M.plane = (base, w, d) => {
		const [cx, cy, z] = base;
		const verts = [[cx - w / 2, cy - d / 2, z], [cx + w / 2, cy - d / 2, z], [cx + w / 2, cy + d / 2, z], [cx - w / 2, cy + d / 2, z]];
		const obj = M.newObject("Plane", verts, [[0, 1, 2, 3]]);
		if (M.faceNormal(obj, obj.faces[0])[2] < 0) obj.faces[0].v.reverse();
		return obj;
	};

	// A ramp: full height at the back (north), floor level at the front (south).
	M.wedge = (base, w, d, h) => {
		const [cx, cy, z] = base, x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2;
		const verts = [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [x0, y0, z + h], [x1, y0, z + h]];
		return M.newObject("Wedge", verts, [[0, 3, 2, 1], [0, 1, 5, 4], [3, 4, 5, 2], [0, 4, 3], [1, 2, 5]]);
	};

	// Upright cylinder; ry (depth radius) lets rims match flat-drawn ellipses.
	M.cylinder = (base, rx, ry, h, segments) => {
		const [cx, cy, z] = base, n = segments || 16, verts = [], faces = [];
		for (let ring = 0; ring < 2; ring++)
			for (let i = 0; i < n; i++) {
				const a = (i / n) * Math.PI * 2;
				verts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, z + ring * h]);
			}
		for (let i = 0; i < n; i++) faces.push([i, (i + 1) % n, n + (i + 1) % n, n + i]);
		faces.push([...Array(n).keys()].reverse());
		faces.push([...Array(n).keys()].map((i) => n + i));
		const obj = M.newObject("Cylinder", verts, faces);
		obj.smooth = 40;
		return obj;
	};

	M.sphere = (base, rx, ry, rz, segments, rings) => {
		const [cx, cy, z] = base, n = segments || 12, m = rings || 8, verts = [[cx, cy, z]], faces = [];
		for (let r = 1; r < m; r++) {
			const t = (r / m) * Math.PI, s = Math.sin(t), c = -Math.cos(t);
			for (let i = 0; i < n; i++) {
				const a = (i / n) * Math.PI * 2;
				verts.push([cx + Math.cos(a) * rx * s, cy + Math.sin(a) * ry * s, z + rz + c * rz]);
			}
		}
		verts.push([cx, cy, z + 2 * rz]);
		const top = verts.length - 1, ringAt = (r, i) => 1 + (r - 1) * n + (i % n);
		for (let i = 0; i < n; i++) faces.push([0, ringAt(1, i + 1), ringAt(1, i)]);
		for (let r = 1; r < m - 1; r++)
			for (let i = 0; i < n; i++) faces.push([ringAt(r, i), ringAt(r, i + 1), ringAt(r + 1, i + 1), ringAt(r + 1, i)]);
		for (let i = 0; i < n; i++) faces.push([ringAt(m - 1, i), ringAt(m - 1, i + 1), top]);
		const obj = M.newObject("Sphere", verts, faces);
		obj.smooth = 60;
		return obj;
	};

	// --- geometry queries ---

	M.faceNormal = (obj, face) => {
		const v = face.v, n = [0, 0, 0];
		for (let i = 0; i < v.length; i++) {
			const a = obj.verts[v[i]], b = obj.verts[v[(i + 1) % v.length]];
			n[0] += (a[1] - b[1]) * (a[2] + b[2]);
			n[1] += (a[2] - b[2]) * (a[0] + b[0]);
			n[2] += (a[0] - b[0]) * (a[1] + b[1]);
		}
		return v3.norm(n);
	};

	M.faceCentre = (obj, face) => {
		const c = [0, 0, 0];
		for (const i of face.v) { c[0] += obj.verts[i][0]; c[1] += obj.verts[i][1]; c[2] += obj.verts[i][2]; }
		return v3.scale(c, 1 / face.v.length);
	};

	M.centre = (obj) => {
		const b = M.bounds(obj);
		return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
	};

	M.bounds = (obj, indices) => {
		const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
		for (const i of indices || obj.verts.keys())
			for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], obj.verts[i][k]); max[k] = Math.max(max[k], obj.verts[i][k]); }
		return { min, max };
	};

	// Flip faces whose normal points toward the object's centre (convex primitives after creation).
	M.orientOutward = (obj) => {
		const c = M.centre(obj);
		for (const f of obj.faces) {
			const n = M.faceNormal(obj, f), fc = M.faceCentre(obj, f);
			if (v3.dot(n, v3.sub(fc, c)) < -1e-9) f.v.reverse();
		}
	};

	const key = (a, b) => (a < b ? a + "_" + b : b + "_" + a);
	M.edgeKey = key;

	// edge key -> {a, b, faces: [face index]} (loose lines included, with no faces)
	M.edges = (obj) => {
		const map = new Map();
		obj.faces.forEach((f, fi) => {
			for (let i = 0; i < f.v.length; i++) {
				const a = f.v[i], b = f.v[(i + 1) % f.v.length], k = key(a, b);
				if (!map.has(k)) map.set(k, { a: Math.min(a, b), b: Math.max(a, b), faces: [] });
				map.get(k).faces.push(fi);
			}
		});
		for (const [a, b] of obj.lines || []) { const k = key(a, b); if (!map.has(k)) map.set(k, { a: Math.min(a, b), b: Math.max(a, b), faces: [] }); }
		return map;
	};

	// Vertices some face uses (what the surface is made of).
	M.faceVerts = (obj) => { const s = new Set(); for (const f of obj.faces) for (const i of f.v) s.add(i); return [...s]; };

	// Closed and consistently wound: every directed edge has its reverse, none twice.
	M.isClosed = (obj) => {
		const seen = new Set();
		for (const f of obj.faces)
			for (let i = 0; i < f.v.length; i++) {
				const k = f.v[i] + ">" + f.v[(i + 1) % f.v.length];
				if (seen.has(k)) return false;
				seen.add(k);
			}
		for (const k of seen) { const [a, b] = k.split(">"); if (!seen.has(b + ">" + a)) return false; }
		return obj.faces.length > 0;
	};

	// Does some face run a -> b (in that direction)?
	const runs = (obj, a, b) => obj.faces.some((f) => f.v.some((v, i) => v === a && f.v[(i + 1) % f.v.length] === b));

	// Project onto the face's dominant plane, then triangulate without filling concave notches.
	// Return corner indices so material/smooth normals stay attached to the right vertices.
	M.faceTriangles = (obj, face) => {
		const n = M.faceNormal(obj, face).map(Math.abs), drop = n.indexOf(Math.max(...n));
		const axes = [0, 1, 2].filter((i) => i !== drop);
		return TS.Shape.triangulate(face.v.map((i) => axes.map((k) => obj.verts[i][k])));
	};
	// [{a, b, c, face}] (vertex indices).
	M.triangles = (obj) => {
		const tris = [];
		obj.faces.forEach((f, fi) => {
			for (const [a, b, c] of M.faceTriangles(obj, f)) tris.push({ a: f.v[a], b: f.v[b], c: f.v[c], face: fi });
		});
		return tris;
	};

	// Per face corner normals with auto-smooth: a corner averages the normals of the faces round its vertex within obj.smooth
	// degrees of its own face. Returns faceIndex -> [normal per corner].
	M.cornerNormals = (obj) => {
		const fn = obj.faces.map((f) => M.faceNormal(obj, f));
		const around = obj.verts.map(() => []);
		obj.faces.forEach((f, fi) => f.v.forEach((vi) => around[vi].push(fi)));
		const limit = Math.cos(((obj.smooth || 0) * Math.PI) / 180);
		return obj.faces.map((f, fi) =>
			f.v.map((vi) => {
				if (!obj.smooth) return fn[fi];
				let s = [0, 0, 0];
				for (const other of around[vi]) if (v3.dot(fn[other], fn[fi]) >= limit) s = v3.add(s, fn[other]);
				return v3.norm(s);
			}));
	};

	M.faceMat = (obj, face) => face.mat || obj.mat;

	// Mirror a whole object across the plane where axis k = c. Faces are rewound so they still face outward, and facing turns
	// flip with it (a turn east becomes a turn west), except for a height mirror.
	M.mirror = (obj, k, c) => {
		for (const p of obj.verts) p[k] = 2 * c - p[k];
		for (const f of obj.faces) f.v.reverse();
		if (obj.basis) for (const a of obj.basis) a[k] = -a[k];
		if (k !== 2) for (const m of [obj.mat, ...obj.faces.map((f) => f.mat)]) if (m && m.turn) m.turn = -m.turn;
	};

	// A normal's level part turned `deg` degrees about the vertical (+ = from south toward east).
	M.turnNormal = (n, deg) => {
		if (!deg) return n;
		const a = Math.atan2(n[0], n[1]) + (deg * Math.PI) / 180, l = Math.hypot(n[0], n[1]);
		return [Math.sin(a) * l, Math.cos(a) * l, n[2]];
	};

	// Corner normals as shaded and processed: smoothed, then turned by each face's material `turn` (the surface's intended
	// facing when the art draws it at another angle than its fitted shape; height and footprint are unchanged).
	M.shadingNormals = (obj) => {
		const corners = M.cornerNormals(obj);
		return obj.faces.map((f, fi) => {
			const deg = M.faceMat(obj, f).turn || 0;
			return deg ? corners[fi].map((n) => M.turnNormal(n, deg)) : corners[fi];
		});
	};

	// Drop vertices no face or line uses (`keep`: indices to keep anyway, e.g. a lone drawn point), and lines a face edge covers.
	// Kept vertices keep their order (so a selection by index stays meaningful).
	M.cleanup = (obj, keep) => {
		obj.faces = obj.faces.filter((f) => f.v.length >= 3);
		const faceEdges = new Set();
		for (const f of obj.faces) for (let i = 0; i < f.v.length; i++) faceEdges.add(key(f.v[i], f.v[(i + 1) % f.v.length]));
		if (obj.lines) {
			const seen = new Set();
			obj.lines = obj.lines.filter(([a, b]) => {
				const k = key(a, b);
				if (a === b || faceEdges.has(k) || seen.has(k)) return false;
				seen.add(k);
				return true;
			});
		}
		const usedSet = new Set(keep || []);
		for (const f of obj.faces) for (const i of f.v) usedSet.add(i);
		for (const [a, b] of obj.lines || []) { usedSet.add(a); usedSet.add(b); }
		const used = new Map(), verts = [];
		obj.verts.forEach((p, i) => { if (usedSet.has(i)) { used.set(i, verts.length); verts.push(p); } });
		for (const f of obj.faces) f.v = f.v.map((i) => used.get(i));
		if (obj.lines) { obj.lines = obj.lines.map(([a, b]) => [used.get(a), used.get(b)]); if (!obj.lines.length) delete obj.lines; }
		obj.verts = verts;
		return used;
	};

	// --- building from points and lines ---

	M.addLine = (obj, a, b) => {
		if (a === b) return;
		const k = key(a, b);
		if (M.edges(obj).has(k)) return;
		(obj.lines || (obj.lines = [])).push([a, b]);
	};

	// The vertex order a new face over `idx` takes: round a closed chain of existing edges through all of them if there is one
	// (a hole's rim, a drawn outline), else by angle round their middle in their plane. null if they're all on one line.
	function ringOrder(obj, idx) {
		const set = new Set(idx), adj = new Map(idx.map((i) => [i, []]));
		for (const e of M.edges(obj).values()) if (set.has(e.a) && set.has(e.b) && e.faces.length < 2) { adj.get(e.a).push(e.b); adj.get(e.b).push(e.a); }
		if ([...adj.values()].every((n) => n.length === 2)) {
			const ring = [idx[0]];
			let prev = -1, cur = idx[0];
			for (;;) {
				const next = adj.get(cur).find((n) => n !== prev);
				if (next === idx[0] || next === undefined) break;
				ring.push(next); prev = cur; cur = next;
			}
			if (ring.length === idx.length) return ring;
		}
		const c = v3.scale(idx.reduce((s, i) => v3.add(s, obj.verts[i]), [0, 0, 0]), 1 / idx.length);
		let p0 = idx[0], best = -1;
		for (const i of idx) { const d = v3.dist(obj.verts[i], c); if (d > best) { best = d; p0 = i; } }
		const u = v3.norm(v3.sub(obj.verts[p0], c));
		let n = [0, 0, 0];
		best = 1e-6;
		for (const i of idx) { const x = v3.cross(u, v3.sub(obj.verts[i], c)), l = v3.len(x); if (l > best) { best = l; n = v3.norm(x); } }
		if (best <= 1e-6) return null;
		const w = v3.cross(n, u);
		return idx.slice().sort((a, b) => {
			const pa = v3.sub(obj.verts[a], c), pb = v3.sub(obj.verts[b], c);
			return Math.atan2(v3.dot(pa, w), v3.dot(pa, u)) - Math.atan2(v3.dot(pb, w), v3.dot(pb, u));
		});
	}

	// F: two points -> a line; three or more -> a face through them, wound to match the faces round it (so a filled hole closes
	// the model), or facing the viewer (`toViewer`: a direction from the scene toward the eye) when nothing is next to it.
	// Returns {face} (its index), {line: true}, or {error}.
	M.fill = (obj, idx, toViewer) => {
		idx = [...new Set(idx)];
		if (idx.length < 2) return { error: "Select two or more vertices (or edges) to join." };
		if (idx.length === 2) {
			if (M.edges(obj).has(key(idx[0], idx[1]))) return { error: "Those two are already joined." };
			M.addLine(obj, idx[0], idx[1]);
			return { line: true };
		}
		const ring = ringOrder(obj, idx);
		if (!ring) return { error: "Those vertices lie on one line: there is no face through them." };
		const f = { v: ring };
		let decided = false;
		for (let i = 0; i < ring.length && !decided; i++) {
			const a = ring[i], b = ring[(i + 1) % ring.length];
			if (runs(obj, a, b)) { f.v.reverse(); decided = true; } else if (runs(obj, b, a)) decided = true;
		}
		if (!decided && toViewer && v3.dot(M.faceNormal(obj, f), toViewer) < 0) f.v.reverse();
		obj.faces.push(f);
		M.cleanup(obj, obj.verts.map((p, i) => i));
		return { face: obj.faces.length - 1 };
	};

	// Extrude points: each gets a new point joined to it by a line (the modal then moves the new ones). Returns their indices.
	M.extrudeVerts = (obj, idx) => idx.map((i) => { obj.verts.push(v3.copy(obj.verts[i])); const n = obj.verts.length - 1; M.addLine(obj, i, n); return n; });

	// Extrude edges: each becomes a quad toward a copy of itself, wound against the face already on it (loose edges: either way,
	// fixed by orientLoose). Returns {verts: the copies, edges: the copied edges' keys, normal: which way they'd naturally go}.
	M.extrudeEdges = (obj, keys) => {
		const remap = new Map(), dup = (i) => { if (!remap.has(i)) { remap.set(i, obj.verts.length); obj.verts.push(v3.copy(obj.verts[i])); } return remap.get(i); };
		const edges = M.edges(obj), out = [], quads = [];
		let normal = [0, 0, 0];
		for (const k of keys) {
			const e = edges.get(k);
			if (!e) continue;
			for (const fi of e.faces) normal = v3.add(normal, M.faceNormal(obj, obj.faces[fi]));
			const [a, b] = runs(obj, e.a, e.b) ? [e.b, e.a] : [e.a, e.b];
			const q = { v: [a, b, dup(b), dup(a)] };
			if (!e.faces.length) q._loose = true;
			else if (obj.faces[e.faces[0]].mat) q.mat = obj.faces[e.faces[0]].mat;
			quads.push(q);
			out.push(key(dup(a), dup(b)));
		}
		obj.faces.push(...quads);
		return { verts: [...remap.values()], edges: out, normal: v3.len(normal) > 1e-6 ? v3.norm(normal) : [0, 0, 1] };
	};
	// After moving: quads grown from loose edges turn to face the viewer (strips stay consistent: neighbours flip together).
	M.orientLoose = (obj, toViewer) => {
		const loose = obj.faces.filter((f) => f._loose);
		for (const f of loose) delete f._loose;
		if (!loose.length || !toViewer) return;
		const s = loose.reduce((acc, f) => acc + v3.dot(M.faceNormal(obj, f), toViewer), 0);
		if (s < 0) for (const f of loose) f.v.reverse();
	};

	// --- bridging ---

	// Ordered vertex chains from a set of edge keys: [{v: [...], closed}] or {error}.
	M.chains = (obj, keys) => {
		const adj = new Map(), add = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
		for (const k of keys) { const [a, b] = k.split("_").map(Number); add(a, b); add(b, a); }
		if ([...adj.values()].some((n) => n.length > 2)) return { error: "The selected edges branch: select two separate loops or strips." };
		const seen = new Set(), out = [];
		for (const start of [...adj.keys()].sort((a, b) => adj.get(a).length - adj.get(b).length)) {
			if (seen.has(start)) continue;
			const v = [start];
			seen.add(start);
			let prev = -1, cur = start;
			for (;;) {
				const next = adj.get(cur).find((n) => n !== prev && !seen.has(n));
				if (next === undefined) break;
				v.push(next); seen.add(next); prev = cur; cur = next;
			}
			out.push({ v, closed: v.length > 2 && adj.get(start).length === 2 && adj.get(cur).includes(start) });
		}
		return out;
	};

	// Turn a chain so a face beside it runs along it (v[i] -> v[i+1]); true if some face decided it.
	function orientByNeighbour(obj, ch) {
		const n = ch.v.length, segs = ch.closed ? n : n - 1;
		for (let i = 0; i < segs; i++) {
			const a = ch.v[i], b = ch.v[(i + 1) % n];
			if (runs(obj, a, b)) return true;
			if (runs(obj, b, a)) { ch.v.reverse(); return true; }
		}
		return false;
	}

	// Bridge two chains of equal length with a band of quads (closed loops make a tube). Wound against the faces already on each
	// rim, matched up so the band twists least. Returns {faces: new face indices} or {error}.
	M.bridge = (obj, A, B) => {
		if (A.closed !== B.closed) return { error: "Bridge needs two closed loops or two open strips, not one of each." };
		const n = A.v.length;
		if (B.v.length !== n) return { error: `The two need the same number of vertices (${n} and ${B.v.length}): loop cut the smaller one.` };
		if (n < 2) return { error: "Nothing to bridge." };
		const fixedA = orientByNeighbour(obj, A), fixedB = orientByNeighbour(obj, B);
		const P = (i) => obj.verts[i];
		// m(i): the B vertex matched to A.v[i]. Facing rims run opposite ways round the band.
		// A rim without a face beside it may run either way: try both.
		let best = null;
		for (const av of fixedA ? [A.v] : [A.v, A.v.slice().reverse()])
			for (const bv of fixedB ? [B.v] : [B.v, B.v.slice().reverse()]) {
				const shifts = A.closed ? [...Array(n).keys()] : [n - 1];
				for (const k of shifts) {
					const m = (i) => bv[(((k - i) % n) + n) % n];
					let cost = 0;
					for (let i = 0; i < n; i++) cost += v3.dist(P(av[i]), P(m(i)));
					if (!best || cost < best.cost - 1e-9) best = { cost, m, av };
				}
			}
		A = { v: best.av, closed: A.closed };
		const m = best.m, made = [], band = [];
		const segs = A.closed ? n : n - 1;
		for (let i = 0; i < segs; i++) {
			const a0 = A.v[i], a1 = A.v[(i + 1) % n];
			const f = { v: [a1, a0, m(i), m((i + 1) % n)] };
			if (new Set(f.v).size < 3) continue;
			if (new Set(f.v).size === 3) f.v = [...new Set(f.v)];
			band.push(f);
		}
		// A band face on the same corners as an existing face would double it (the rims are already joined by faces between them).
		const corners = (f) => f.v.slice().sort((x, y) => x - y).join(",");
		const existing = new Set(obj.faces.map(corners));
		if (band.some((f) => existing.has(corners(f)))) return { error: "Those rims are already joined by faces between them: a bridge would only double them." };
		for (const f of band) { obj.faces.push(f); made.push(obj.faces.length - 1); }
		// Neither rim had a face to follow (two drawn lines): face the band outward from its middle, as primitives do.
		if (!fixedA && !fixedB && made.length) {
			const c = M.centre(obj);
			const s = made.reduce((acc, fi) => acc + v3.dot(M.faceNormal(obj, obj.faces[fi]), v3.sub(M.faceCentre(obj, obj.faces[fi]), c)), 0);
			if (s < 0) for (const fi of made) obj.faces[fi].v.reverse();
		}
		return { faces: made };
	};

	// Bridge two faces: both are removed and their rims joined (a tunnel through a model, or two pieces joined by a neck).
	M.bridgeFaces = (obj, f1, f2) => {
		const A = { v: obj.faces[f1].v.slice().reverse(), closed: true }, B = { v: obj.faces[f2].v.slice().reverse(), closed: true };
		if (A.v.length !== B.v.length) return { error: `The two faces need the same number of corners (${A.v.length} and ${B.v.length}): loop cut or inset to match.` };
		if (A.v.some((v) => B.v.includes(v))) return { error: "Those faces touch: bridge faces that are apart." };
		// Worked on a copy, so a refused bridge leaves the model as it was.
		const work = M.clone(obj);
		work.faces = work.faces.filter((f, fi) => fi !== f1 && fi !== f2);
		const r = M.bridge(work, A, B);
		if (r.error) return r;
		M.cleanup(work);
		obj.verts = work.verts; obj.faces = work.faces;
		if (work.lines) obj.lines = work.lines; else delete obj.lines;
		return r;
	};

	// Merge models into the first (Ctrl+J). Faces keep their own model's material.
	M.join = (into, others) => {
		for (const o of others) {
			const base = into.verts.length;
			into.verts.push(...o.verts.map((p) => p.slice()));
			for (const f of o.faces) into.faces.push({ v: f.v.map((i) => i + base), mat: f.mat || (JSON.stringify(o.mat) !== JSON.stringify(into.mat) ? Object.assign({}, o.mat) : undefined) });
			for (const [a, b] of o.lines || []) (into.lines || (into.lines = [])).push([a + base, b + base]);
		}
		for (const f of into.faces) if (!f.mat) delete f.mat;
	};

	M.deleteVerts = (obj, idx) => {
		const drop = new Set(idx);
		obj.faces = obj.faces.filter((f) => !f.v.some((i) => drop.has(i)));
		if (obj.lines) obj.lines = obj.lines.filter(([a, b]) => !drop.has(a) && !drop.has(b));
		M.cleanup(obj);
	};
	M.deleteEdges = (obj, keys) => {
		const drop = new Set(keys);
		obj.faces = obj.faces.filter((f) => !f.v.some((v, i) => drop.has(key(v, f.v[(i + 1) % f.v.length]))));
		if (obj.lines) obj.lines = obj.lines.filter(([a, b]) => !drop.has(key(a, b)));
		M.cleanup(obj);
	};

	// --- knife ---

	// Knife one stroke: the plane through A and B containing the view direction `d` (so it looks like the line drawn on screen)
	// splits every face it crosses right through, where `inside(X)` says the crossing X is within the stroke and `use(fi, X1, X2)`
	// lets the caller skip faces (hidden ones, without X-ray). New points on an edge are shared by both faces beside it; faces the
	// stroke only touches get the point too (no T-junctions). A face the stroke enters but doesn't cross isn't cut.
	// Returns the new cut edges' keys.
	M.knife = (obj, A, B, d, inside, use) => {
		const n = v3.norm(v3.cross(v3.sub(B, A), d));
		if (v3.len(n) < 0.5) return [];
		const side = (p) => v3.dot(n, v3.sub(p, A)), EPS = 1e-6;
		const plans = [];
		obj.faces.forEach((f, fi) => {
			const s = f.v.map((i) => side(obj.verts[i])), m = f.v.length, cross = [];
			for (let i = 0; i < m; i++) {
				const j = (i + 1) % m;
				if (Math.abs(s[i]) < EPS) { cross.push({ at: i, vert: f.v[i], p: obj.verts[f.v[i]] }); continue; }
				if (Math.abs(s[j]) < EPS || (s[i] > 0) === (s[j] > 0)) continue;
				const t = s[i] / (s[i] - s[j]);
				cross.push({ at: i, edge: [f.v[i], f.v[j]], t, p: v3.lerp(obj.verts[f.v[i]], obj.verts[f.v[j]], t) });
			}
			if (cross.length !== 2 || !cross.every((c) => inside(c.p))) return;
			// Both crossings at corners next to each other (or the same): that edge exists already.
			if (cross.every((c) => c.vert !== undefined) && (Math.abs(cross[0].at - cross[1].at) === 1 || Math.abs(cross[0].at - cross[1].at) === m - 1)) return;
			if (use && !use(fi, cross[0].p, cross[1].p)) return;
			plans.push({ fi, cross });
		});
		if (!plans.length) return [];
		const made = new Map(), point = (c) => {
			if (c.vert !== undefined) return c.vert;
			const k = key(c.edge[0], c.edge[1]);
			if (!made.has(k)) { made.set(k, obj.verts.length); obj.verts.push(c.p); }
			return made.get(k);
		};
		const cuts = [], split = new Set();
		for (const { fi, cross } of plans) {
			const f = obj.faces[fi], loop = [];
			let ia = -1, ib = -1;
			f.v.forEach((v, i) => {
				loop.push(v);
				for (const [ci, c] of cross.entries()) {
					if (c.at !== i) continue;
					if (c.vert !== undefined) { if (ci === 0) ia = loop.length - 1; else ib = loop.length - 1; }
					else { loop.push(point(c)); if (ci === 0) ia = loop.length - 1; else ib = loop.length - 1; }
				}
			});
			const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia];
			const one = loop.slice(lo, hi + 1), two = loop.slice(hi).concat(loop.slice(0, lo + 1));
			if (one.length < 3 || two.length < 3) continue;
			f.v = one;
			const g = { v: two };
			if (f.mat) g.mat = f.mat;
			obj.faces.push(g);
			split.add(f); split.add(g);
			cuts.push(key(loop[lo], loop[hi]));
		}
		// Faces next to a cut edge that weren't cut themselves take its new point.
		obj.faces.forEach((f) => {
			if (split.has(f)) return;
			for (let i = 0; i < f.v.length; i++) {
				const k = key(f.v[i], f.v[(i + 1) % f.v.length]);
				if (made.has(k)) { f.v.splice(i + 1, 0, made.get(k)); i++; }
			}
		});
		return cuts;
	};

	// --- manifold extrude ---

	// After an extrude moved by a non-zero amount: a wall lying in the plane of the face beyond its rim edge is folded into it.
	// Pushed in, a wall overlaps that face back to back: the wall goes and the face's edge moves down to the cap (the model is
	// cut, not doubled inside). Pulled out flush with it, the wall and face merge into one. walls: from M.extrude.
	M.manifold = (obj, walls) => {
		const dropWalls = new Set(), cut = [], merge = [];
		for (const w of walls) {
			if (w.nb < 0) continue;
			const wf = obj.faces[w.fi], nf = obj.faces[w.nb], wn = M.faceNormal(obj, wf), nn = M.faceNormal(obj, nf);
			if (v3.len(wn) < 0.5 || Math.abs(v3.dot(wn, nn)) < 0.999) continue;
			if (Math.abs(v3.dot(v3.sub(M.faceCentre(obj, wf), obj.verts[nf.v[0]]), nn)) > 1e-4) continue;
			(v3.dot(wn, nn) < 0 ? cut : merge).push(w);
		}
		for (const w of cut) {
			const nf = obj.faces[w.nb];
			nf.v = nf.v.map((v) => (v === w.a ? w.da : v === w.b ? w.db : v));
			dropWalls.add(w.fi);
		}
		// Vertices the cut moved off: every face still using them follows (a corner where two cut faces meet).
		const moved = new Map(cut.flatMap((w) => [[w.a, w.da], [w.b, w.db]]));
		if (moved.size) {
			const cutFaces = new Set(cut.map((w) => w.nb));
			for (const [fi, f] of obj.faces.entries()) if (!dropWalls.has(fi) && !cutFaces.has(fi) && !walls.some((w) => w.fi === fi)) f.v = f.v.map((v) => (moved.has(v) && !f.v.includes(moved.get(v)) ? moved.get(v) : v));
		}
		for (const w of merge) {
			const nf = obj.faces[w.nb], i = nf.v.findIndex((v, k) => v === w.b && nf.v[(k + 1) % nf.v.length] === w.a);
			if (i < 0) continue;
			nf.v.splice(i + 1, 0, w.db, w.da);
			dropWalls.add(w.fi);
		}
		obj.faces = obj.faces.filter((f, fi) => !dropWalls.has(fi));
		// Faces that collapsed (a corner wall that lost both sides) and repeated corners go.
		for (const f of obj.faces) f.v = f.v.filter((v, k) => v !== f.v[(k + 1) % f.v.length]);
		M.cleanup(obj);
		return { cut: cut.length, merged: merge.length };
	};

	// --- operations (each mutates obj; returns what the modal tool moves next) ---

	M.translate = (obj, indices, d) => { for (const i of indices) obj.verts[i] = v3.add(obj.verts[i], d); };

	M.scaleAbout = (obj, indices, c, s) => {
		for (const i of indices) {
			const p = obj.verts[i];
			obj.verts[i] = [c[0] + (p[0] - c[0]) * s[0], c[1] + (p[1] - c[1]) * s[1], c[2] + (p[2] - c[2]) * s[2]];
		}
	};

	M.rotateAbout = (obj, indices, c, rad) => { for (const i of indices) obj.verts[i] = v3.rotZ(obj.verts[i], c, rad); };

	// Turn about a world axis ("x", "y" or "z") through c.
	M.rotateAxis = (obj, indices, c, axis, rad) => {
		const s = Math.sin(rad), k = Math.cos(rad);
		const [a, b] = axis === "x" ? [1, 2] : axis === "y" ? [2, 0] : [0, 1];
		for (const i of indices) {
			const p = obj.verts[i].slice(), u = p[a] - c[a], w = p[b] - c[b];
			p[a] = c[a] + u * k - w * s;
			p[b] = c[b] + u * s + w * k;
			obj.verts[i] = p;
		}
	};

	// Turn about any axis `u` (unit) through c (right-handed: + turns by the right-hand rule about u).
	M.rotateAround = (obj, indices, c, u, rad) => { for (const i of indices) obj.verts[i] = M.turnVec(v3.sub(obj.verts[i], c), u, rad).map((v, k) => v + c[k]); };
	M.turnVec = (p, u, rad) => {
		const s = Math.sin(rad), k = Math.cos(rad), d = v3.dot(u, p), x = v3.cross(u, p);
		return [0, 1, 2].map((i) => p[i] * k + x[i] * s + u[i] * d * (1 - k));
	};
	// The model's own axes (turned with it), the world's if it never turned.
	M.basis = (obj) => obj.basis || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

	// Region extrude: the selected faces move out as one cap; walls fill each boundary edge. Returns the cap's vertex indices
	// and the region's average normal (the modal moves the cap along it).
	M.extrude = (obj, faceIdx) => {
		const sel = new Set(faceIdx);
		const edges = M.edges(obj);
		const remap = new Map();
		const dup = (i) => { if (!remap.has(i)) { remap.set(i, obj.verts.length); obj.verts.push(v3.copy(obj.verts[i])); } return remap.get(i); };
		let normal = [0, 0, 0];
		const walls = [];
		for (const fi of sel) {
			const f = obj.faces[fi];
			normal = v3.add(normal, M.faceNormal(obj, f));
			for (let i = 0; i < f.v.length; i++) {
				const a = f.v[i], b = f.v[(i + 1) % f.v.length], on = edges.get(key(a, b)).faces;
				if (on.filter((x) => sel.has(x)).length === 1) {
					const nb = on.find((x) => !sel.has(x));
					walls.push({ v: [a, b, dup(b), dup(a)], a, b, da: dup(a), db: dup(b), nb: nb === undefined ? -1 : nb });
				}
			}
		}
		// A lone sheet (nothing beside its rim: a plane, a drawn outline filled with F) keeps a flipped copy where it was, so
		// pulling it out makes a closed solid rather than an open-bottomed shell.
		const sheet = walls.length && walls.every((w) => w.nb < 0);
		const bottoms = sheet ? [...sel].map((fi) => ({ v: obj.faces[fi].v.slice().reverse(), mat: obj.faces[fi].mat })) : [];
		for (const fi of sel) obj.faces[fi].v = obj.faces[fi].v.map(dup);
		for (const w of walls) { w.fi = obj.faces.length; obj.faces.push({ v: w.v }); delete w.v; }
		for (const b of bottoms) { if (!b.mat) delete b.mat; obj.faces.push(b); }
		return { verts: [...remap.values()], normal: v3.norm(normal), walls };
	};

	// Individual inset: every edge of each selected face moves inward by exactly `amount` px (in the face's plane), so the new
	// rim is equally wide all round whatever the face's shape; a ring of quads joins it to the old outline. Corners are mitred
	// (each inner corner sits where the two offset edges cross), capped so a spike can't shoot off.
	M.inset = (obj, faceIdx, amount) => {
		const inner = [];
		for (const fi of faceIdx) {
			const f = obj.faces[fi], n = M.faceNormal(obj, f), count = f.v.length, ring = [];
			const pts = f.v.map((vi) => obj.verts[vi]);
			// Inward normal of the edge from point i to i + 1 (faces wind counter-clockwise seen from outside).
			const inward = (i) => v3.norm(v3.cross(n, v3.sub(pts[(i + 1) % count], pts[i])));
			for (let i = 0; i < count; i++) {
				const a = inward((i - 1 + count) % count), b = inward(i);
				const miter = 1 + v3.dot(a, b);
				const offset = miter > 0.05 ? v3.scale(v3.add(a, b), amount / miter) : v3.scale(v3.norm(v3.add(a, b)), amount);
				ring.push(obj.verts.length);
				obj.verts.push(v3.add(pts[i], offset));
			}
			for (let i = 0; i < count; i++) {
				const j = (i + 1) % count;
				obj.faces.push({ v: [f.v[i], f.v[j], ring[j], ring[i]], mat: f.mat });
			}
			f.v = ring;
			inner.push(...ring);
		}
		return inner;
	};
	// Chamfer bevel of edges between two faces, `amount` px into each. Edges are given by their end positions (indices change
	// as each edge is bevelled).
	M.bevel = (obj, edgePositions, amount) => {
		for (const [pa, pb] of edgePositions) {
			const a = obj.verts.findIndex((p) => v3.dist(p, pa) < 1e-6), b = obj.verts.findIndex((p) => v3.dist(p, pb) < 1e-6);
			if (a < 0 || b < 0) continue;
			const e = M.edges(obj).get(key(a, b));
			if (!e || e.faces.length !== 2) continue;
			const [f1, f2] = e.faces.map((fi) => obj.faces[fi]);
			const dir = v3.norm(v3.sub(obj.verts[b], obj.verts[a]));
			const inward = (f) => {
				const n = M.faceNormal(obj, f);
				let p = v3.norm(v3.cross(n, dir));
				if (v3.dot(p, v3.sub(M.faceCentre(obj, f), obj.verts[a])) < 0) p = v3.scale(p, -1);
				return p;
			};
			const d1 = inward(f1), d2 = inward(f2);
			const add = (p) => { obj.verts.push(p); return obj.verts.length - 1; };
			const a1 = add(v3.add(obj.verts[a], v3.scale(d1, amount))), b1 = add(v3.add(obj.verts[b], v3.scale(d1, amount)));
			const a2 = add(v3.add(obj.verts[a], v3.scale(d2, amount))), b2 = add(v3.add(obj.verts[b], v3.scale(d2, amount)));
			const has = (f, x, y) => f.v.some((v, i) => key(v, f.v[(i + 1) % f.v.length]) === key(x, y));
			// The other faces round each end, walked from f1 round to f2: those on f1's side take e1, those on f2's side e2, and
			// the one where the sides meet takes both (the chamfer's end), the side next to f1 first. A corner with only three
			// faces has just that one.
			const nbrs = (f, v) => { const i = f.v.indexOf(v), n = f.v.length; return [f.v[(i - 1 + n) % n], f.v[(i + 1) % n]]; };
			for (const [end, partner, e1, e2] of [[a, b, a1, a2], [b, a, b1, b2]]) {
				const around = obj.faces.filter((f) => f !== f1 && f !== f2 && f.v.includes(end));
				const walk = (from) => {
					const out = [];
					let x = nbrs(from, end).find((v) => v !== partner);
					for (;;) {
						const g = around.find((f) => !out.includes(f) && has(f, end, x));
						if (!g) return { out, x };
						out.push(g);
						x = nbrs(g, end).find((v) => v !== x);
					}
				};
				const A = walk(f1), meets = A.out.length && has(f2, end, A.x);
				const B = meets ? { out: [] } : walk(f2);
				const side1 = new Set([f1, ...(meets ? A.out.slice(0, -1) : A.out)]);
				// Decided before any face changes: the split face's edge before `end` borders f1's side -> e1 comes first.
				const split = meets ? A.out[A.out.length - 1] : null;
				let pair = null;
				if (split) { const i = split.v.indexOf(end), prev = split.v[(i - 1 + split.v.length) % split.v.length]; pair = [...side1].some((g) => has(g, prev, end)) ? [e1, e2] : [e2, e1]; }
				for (const f of around) {
					const i = f.v.indexOf(end);
					if (f === split) f.v.splice(i, 1, ...pair);
					else if (side1.has(f)) f.v[i] = e1;
					else if (B.out.includes(f)) f.v[i] = e2;
					else {
						// Not reachable round the corner (a pinched vertex): the old rule.
						const prev = f.v[(i - 1 + f.v.length) % f.v.length];
						f.v.splice(i, 1, ...(has(f1, prev, end) ? [e1, e2] : has(f2, prev, end) ? [e2, e1] : [e1, e2]));
					}
				}
			}
			f1.v = f1.v.map((v) => (v === a ? a1 : v === b ? b1 : v));
			f2.v = f2.v.map((v) => (v === a ? a2 : v === b ? b2 : v));
			// Wound against f1's new edge (f1 and f2 ran the old edge opposite ways, so it agrees with f2 too); the faces' normals
			// can't decide it at a knife-sharp edge, where they nearly cancel.
			const cham = { v: runs(obj, a1, b1) ? [b1, a1, a2, b2] : [a1, b1, b2, a2], mat: f1.mat };
			obj.faces.push(cham);
			M.cleanup(obj);
		}
	};

	// The ring of quads a loop cut through edge (a, b) crosses, walked both ways from that edge: {faces: [{fi, i}], edges: [key],
	// orient: key -> [from, to]}. i is the index in the face of the ring edge it enters by; orient gives every ring edge a
	// direction matching a -> b on the start edge, so a cut at fraction t lies on the same side all the way round.
	M.edgeRing = (obj, a, b) => {
		const edges = M.edges(obj), start = key(a, b);
		const result = { faces: [], edges: [start], orient: new Map([[start, [a, b]]]) };
		const seen = new Set();
		for (const fi0 of edges.get(start) ? edges.get(start).faces : []) {
			let fi = fi0, cur = start;
			while (fi !== undefined && !seen.has(fi)) {
				const f = obj.faces[fi];
				if (f.v.length !== 4) break;
				seen.add(fi);
				const i = f.v.findIndex((v, k) => key(v, f.v[(k + 1) % 4]) === cur);
				result.faces.push({ fi, i });
				const v = [0, 1, 2, 3].map((k) => f.v[(i + k) % 4]);
				const opp = key(v[2], v[3]);
				if (opp === start) break;
				// Across a quad, v0 -> v1 runs alongside v3 -> v2.
				if (!result.orient.has(opp)) result.orient.set(opp, result.orient.get(cur)[0] === v[0] ? [v[3], v[2]] : [v[2], v[3]]);
				if (!result.edges.includes(opp)) result.edges.push(opp);
				cur = opp;
				fi = edges.get(opp).faces.find((x) => x !== fi);
			}
		}
		return result;
	};

	// Loop cut through edge (a, b) at fraction t from a toward b (the same side on every ring edge). Returns the new loop's
	// vertex indices.
	M.loopCut = (obj, a, b, t) => {
		const ring = M.edgeRing(obj, a, b);
		if (!ring.faces.length) return [];
		const at = t === undefined ? 0.5 : t;
		const mids = new Map();
		const mid = (x, y) => {
			const k = key(x, y);
			if (!mids.has(k)) {
				const [from, to] = ring.orient.get(k);
				mids.set(k, obj.verts.length);
				obj.verts.push(v3.lerp(obj.verts[from], obj.verts[to], at));
			}
			return mids.get(k);
		};
		const crossed = new Set(ring.faces.map((r) => r.fi));
		const newFaces = [];
		for (const { fi, i } of ring.faces) {
			const f = obj.faces[fi], v = [0, 1, 2, 3].map((k) => f.v[(i + k) % 4]);
			const m01 = mid(v[0], v[1]), m23 = mid(v[2], v[3]);
			newFaces.push({ v: [v[0], m01, m23, v[3]], mat: f.mat }, { v: [m01, v[1], v[2], m23], mat: f.mat });
		}
		// Other faces on a ring edge get its new point, so no T-junctions.
		obj.faces.forEach((f, fi) => {
			if (crossed.has(fi)) return;
			for (let i = 0; i < f.v.length; i++) {
				const k = key(f.v[i], f.v[(i + 1) % f.v.length]);
				if (mids.has(k)) { f.v.splice(i + 1, 0, mids.get(k)); i++; }
			}
		});
		obj.faces = obj.faces.filter((f, fi) => !crossed.has(fi)).concat(newFaces);
		return [...mids.values()];
	};
	M.deleteFaces = (obj, faceIdx) => {
		const drop = new Set(faceIdx);
		obj.faces = obj.faces.filter((f, fi) => !drop.has(fi));
		M.cleanup(obj);
	};

	// Vertices of a selection: faces -> their corners, edges -> both ends.
	M.selectionVerts = (obj, mode, sel) => {
		const out = new Set();
		if (mode === "vert") sel.forEach((i) => out.add(i));
		else if (mode === "edge") sel.forEach((k) => k.split("_").forEach((i) => out.add(+i)));
		else if (mode === "face") sel.forEach((fi) => obj.faces[fi] && obj.faces[fi].v.forEach((i) => out.add(i)));
		else obj.verts.forEach((p, i) => out.add(i));
		return [...out];
	};
})();
