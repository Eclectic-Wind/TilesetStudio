// Closed-volume subtraction for the drawing tool. No changes reach the scene until Apply.
"use strict";
(function () {
	const C = TS.Carve = {}, V = TS.v3, M = TS.Mesh, EPS = 1e-6;
	const fail = () => { throw new Error("This cut is too complex. Simplify the outline or cut a smaller model."); };
	function polygon(points, data) {
		const p = points.filter((v, i) => V.dist(v, points[(i + 1) % points.length]) > EPS);
		if (p.length < 3) return null;
		let n = [0, 0, 0];
		for (let i = 1; i + 1 < p.length; i++) n = V.add(n, V.cross(V.sub(p[i], p[0]), V.sub(p[i + 1], p[0])));
		if (V.len(n) < EPS * EPS) return null;
		n = V.norm(n);
		return { p, data, n, w: V.dot(n, p[0]) };
	}
	function flip(p) { p.p.reverse(); p.n = V.scale(p.n, -1); p.w = -p.w; }
	// Split convex polygons against planes; a BSP stores the boundary of a solid.
	class Node {
		constructor(polys, budget, depth = 0) {
			this.polys = []; this.front = this.back = null; this.plane = null;
			this.budget = budget; this.depth = depth;
			if (depth > 220) fail();
			if (polys.length) this.build(polys);
		}
		split(p, same, opposite, front, back) {
			if (++this.budget.count > 2000000) fail();
			const ds = p.p.map(v => V.dot(this.plane.n, v) - this.plane.w);
			const types = ds.map(d => d > EPS ? 1 : d < -EPS ? 2 : 0), type = types.reduce((a, b) => a | b, 0);
			if (!type) { (V.dot(this.plane.n, p.n) >= 0 ? same : opposite).push(p); return; }
			if (type === 1) { front.push(p); return; }
			if (type === 2) { back.push(p); return; }
			const f = [], b = [];
			for (let i = 0; i < p.p.length; i++) {
				const j = (i + 1) % p.p.length, a = p.p[i], z = p.p[j];
				if (types[i] !== 2) f.push(a);
				if (types[i] !== 1) b.push(a);
				if ((types[i] | types[j]) === 3) {
					const v = V.lerp(a, z, ds[i] / (ds[i] - ds[j])); f.push(v); b.push(v);
				}
			}
			const pf = polygon(f, p.data), pb = polygon(b, p.data);
			if (pf) front.push(pf); if (pb) back.push(pb);
		}
		build(polys) {
			if (!polys.length) return;
			if (!this.plane) this.plane = { n: polys[0].n.slice(), w: polys[0].w };
			const f = [], b = [];
			for (const p of polys) this.split(p, this.polys, this.polys, f, b);
			if (f.length) { if (this.front) this.front.build(f); else this.front = new Node(f, this.budget, this.depth + 1); }
			if (b.length) { if (this.back) this.back.build(b); else this.back = new Node(b, this.budget, this.depth + 1); }
		}
		invert() {
			this.polys.forEach(flip);
			if (this.plane) { this.plane.n = V.scale(this.plane.n, -1); this.plane.w = -this.plane.w; }
			if (this.front) this.front.invert(); if (this.back) this.back.invert();
			[this.front, this.back] = [this.back, this.front];
		}
		clipPolys(polys) {
			if (!this.plane) return polys.slice();
			let f = [], b = [];
			for (const p of polys) this.split(p, f, b, f, b);
			if (this.front) f = this.front.clipPolys(f);
			b = this.back ? this.back.clipPolys(b) : [];
			return f.concat(b);
		}
		clipTo(other) {
			this.polys = other.clipPolys(this.polys);
			if (this.front) this.front.clipTo(other); if (this.back) this.back.clipTo(other);
		}
		all() { return this.polys.concat(this.front ? this.front.all() : [], this.back ? this.back.all() : []); }
	}
	function polygons(obj) {
		const out = [];
		for (const f of obj.faces) {
			const data = { ...f }; delete data.v;
			const points = f.v.map(i => obj.verts[i].slice()), whole = polygon(points, data);
			// Preserve broad planar faces. Only concave or warped faces need triangulation.
			if (whole && points.every(p => Math.abs(V.dot(whole.n, p) - whole.w) < EPS) && points.every((p, i) => {
				const b = points[(i + 1) % points.length], c = points[(i + 2) % points.length];
				return V.dot(V.cross(V.sub(b, p), V.sub(c, b)), whole.n) >= -EPS;
			})) { out.push(whole); continue; }
			for (const t of M.faceTriangles(obj, f)) {
				const p = polygon(t.map(i => obj.verts[f.v[i]].slice()), data);
				if (p) out.push(p);
			}
		}
		if (out.length > 6000) fail();
		return out;
	}
	// Weld coincident OBJ vertices, then insert shared edge points so the result has no T-junctions.
	function meshFromPolygons(polys, source) {
		const out = M.clone(source), verts = [], cells = new Map();
		const weld = p => {
			const c = p.map(x => Math.floor(x / EPS));
			for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++)
				for (const i of cells.get([c[0]+x,c[1]+y,c[2]+z].join(",")) || []) if (V.dist(verts[i], p) <= EPS) return i;
			const key = c.join(","), i = verts.length;
			if (!cells.has(key)) cells.set(key, []); cells.get(key).push(i); verts.push(p.slice()); return i;
		};
		out.faces = polys.map(p => ({ ...p.data, v: p.p.map(weld) })).filter(f => new Set(f.v).size >= 3);
		out.verts = verts; delete out.lines;
		if (verts.length * out.faces.length > 8000000) fail();
		for (const f of out.faces) {
			const ring = [];
			for (let j = 0; j < f.v.length; j++) {
				const a = f.v[j], b = f.v[(j + 1) % f.v.length], A = verts[a], B = verts[b], d = V.sub(B, A), len2 = V.dot(d, d), extra = [];
				if (a === b || len2 < EPS * EPS) continue;
				ring.push(a);
				for (let i = 0; i < verts.length; i++) {
					if (i === a || i === b) continue;
					const t = V.dot(V.sub(verts[i], A), d) / len2;
					if (t <= EPS / Math.sqrt(len2) || t >= 1 - EPS / Math.sqrt(len2)) continue;
					if (V.dist(verts[i], V.lerp(A, B, t)) < EPS) extra.push([t, i]);
				}
				extra.sort((a, b) => a[0] - b[0]); ring.push(...extra.map(p => p[1]));
			}
			f.v = ring;
		}
		return out;
	}
	C.volume = obj => {
		// Local origin reduces cancellation for models far from the world origin.
		const origin = obj.verts[0] || [0, 0, 0]; let sum = 0;
		for (const t of M.triangles(obj)) sum += V.dot(V.sub(obj.verts[t.a], origin), V.cross(V.sub(obj.verts[t.b], origin), V.sub(obj.verts[t.c], origin))) / 6;
		return sum;
	};
	C.depth = (obj, surface, depth, through) => {
		if (!surface) throw new Error("Start the cut on an object's surface.");
		if (through) return obj.verts.reduce((max, p) => Math.max(max, -V.dot(V.sub(p, surface.origin), surface.normal)), EPS * 16) + 0.01;
		if (!Number.isFinite(depth) || depth <= 0 || depth > 255) throw new Error("Cut depth must be greater than 0 and at most 255 px, or choose Through all.");
		return depth;
	};
	C.subtract = (target, input, options = {}) => {
		if (!target || !target.faces.length) throw new Error("Choose an existing model to cut.");
		if (target.faces.length > 6000 || target.verts.length > 12000) fail();
		const s = options.surface;
		if (!s || ![s.origin, s.normal].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) || V.len(s.normal) < EPS)
			throw new Error("Start the cut on a visible surface of the model.");
		if (!Array.isArray(input) || !input.every(p => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(Number.isFinite))) throw new Error("The outline contains an invalid point.");
		let p = TS.Shape.simplify(input, Math.max(0, options.simplify || 0));
		if (options.snap > 0) p = TS.Shape.clean(p.map(q => q.map(v => TS.snap(v, options.snap))));
		TS.Shape.validate(p);
		if (options.radius > 0) { p = TS.Shape.roundCorners(p, options.radius); TS.Shape.validate(p); }
		if (TS.Shape.area(p) < 0) p.reverse();
		const surface = { ...s, normal: V.norm(s.normal) }, depth = C.depth(target, surface, options.depth, options.through);
		const source = meshFromPolygons(target.faces.map(f => ({ p: f.v.map(i => target.verts[i]), data: Object.fromEntries(Object.entries(f).filter(([k]) => k !== "v")) })), target);
		if (!M.isClosed(source)) throw new Error("Cut out needs a closed solid. Close this model's open edges first, or use Cut line.");
		const oldVolume = C.volume(source);
		if (oldVolume <= EPS) throw new Error("The model has inward or invalid faces. Correct its face directions before cutting.");
		const front = p.map(q => typeof options.pointAt === "function" ? options.pointAt(q) : TS.Shape.surfacePoint(q, surface)), n = front.length;
		if (!front.every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))) throw new Error("The cut outline could not be mapped onto the target surface.");
		const pad = 0.01, verts = front.map(q => V.add(q, V.scale(surface.normal, pad))).concat(front.map(q => V.add(q, V.scale(surface.normal, -depth))));
		const ring = front.map((_, i) => i), mat = M.faceMat(target, target.faces[s.face] || {});
		const faces = [ring, ring.map(i => i+n).reverse()];
		for (let i = 0; i < n; i++) { const j = (i+1)%n; faces.push([i+n, j+n, j, i]); }
		const cutter = options.cutter || { verts, faces: faces.map(v => ({ v, mat: { ...mat } })) };
		if (!options.cutter && V.dot(M.faceNormal(cutter, cutter.faces[0]), surface.normal) < 0) cutter.faces.forEach(f => f.v.reverse());
		const budget = { count: 0 }, a = new Node(polygons(source), budget), b = new Node(polygons(cutter), budget);
		a.invert(); a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert(); a.build(b.all()); a.invert();
		const result = meshFromPolygons(a.all(), target);
		if (result.faces.length && !M.isClosed(result)) throw new Error("This cut would leave broken edges. Move the outline slightly away from an existing edge and try again.");
		const removed = oldVolume - C.volume(result);
		if (removed < Math.max(EPS, oldVolume * 1e-9)) throw new Error("The outline did not remove any volume. Check its position and depth.");
		// Loose lines are drawing aids, independent of the solid being carved.
		if (result.faces.length && target.lines?.length) {
			const map = new Map();
			const copy = i => {
				if (!map.has(i)) {
					let at = result.verts.findIndex(p => V.dist(p, target.verts[i]) < EPS);
					if (at < 0) { at = result.verts.length; result.verts.push(target.verts[i].slice()); }
					map.set(i, at);
				}
				return map.get(i);
			};
			result.lines = target.lines.map(([a, b]) => [copy(a), copy(b)]);
		}
		return { object: result, removed, depth, corners: p.length };
	};
})();

