// Pencil geometry. Outlines are in tileset image pixels; finished models use the normal mesh format.
"use strict";
(function () {
	const Shape = TS.Shape = {};
	const EPS = 1e-8;
	const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
	const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
	Shape.area = (p) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
	const segmentDist2 = (p, a, b) => {
		const d = dist2(a, b), t = d ? TS.clamp(((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / d, 0, 1) : 0;
		return dist2(p, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
	};
	// Iterative Douglas-Peucker, split into two arcs for a closed outline.
	function simplifyOpen(p, tolerance) {
		if (p.length < 3 || tolerance <= 0) return p.slice();
		const keep = new Set([0, p.length - 1]), stack = [[0, p.length - 1]];
		while (stack.length) {
			const [a, b] = stack.pop(); let best = tolerance * tolerance, at = -1;
			for (let i = a + 1; i < b; i++) { const d = segmentDist2(p[i], p[a], p[b]); if (d > best) { best = d; at = i; } }
			if (at >= 0) { keep.add(at); stack.push([a, at], [at, b]); }
		}
		return [...keep].sort((a, b) => a - b).map((i) => p[i]);
	}
	Shape.clean = (input) => {
		const p = [];
		for (const v of input) if (!p.length || dist2(p[p.length - 1], v) > EPS) p.push(v.slice(0, 2));
		if (p.length > 1 && dist2(p[0], p[p.length - 1]) <= EPS) p.pop();
		let changed = true;
		while (changed && p.length > 2) {
			changed = false;
			for (let i = 0; i < p.length; i++) {
				const a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length];
				if (Math.abs(cross(a, b, c)) < EPS && segmentDist2(b, a, c) < EPS) { p.splice(i, 1); changed = true; break; }
			}
		}
		return p;
	};
	Shape.simplify = (input, tolerance) => {
		const p = Shape.clean(input);
		if (p.length < 4 || tolerance <= 0) return p;
		let far = 1;
		for (let i = 2; i < p.length; i++) if (dist2(p[0], p[i]) > dist2(p[0], p[far])) far = i;
		const a = simplifyOpen(p.slice(0, far + 1), tolerance), b = simplifyOpen(p.slice(far).concat([p[0]]), tolerance);
		return Shape.clean(a.slice(0, -1).concat(b.slice(0, -1)));
	};
	function intersects(a, b, c, d) {
		const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
		if (abC * abD < -EPS && cdA * cdB < -EPS) return true;
		return (Math.abs(abC) < EPS && segmentDist2(c, a, b) < EPS) || (Math.abs(abD) < EPS && segmentDist2(d, a, b) < EPS) ||
			(Math.abs(cdA) < EPS && segmentDist2(a, c, d) < EPS) || (Math.abs(cdB) < EPS && segmentDist2(b, c, d) < EPS);
	}
	Shape.validate = (p) => {
		if (p.length < 3) throw new Error("Draw at least three distinct corners around an area.");
		if (p.length > 256) throw new Error("This outline has too many corners. Increase Simplify or draw a simpler outline.");
		for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
			if (j === i + 1 || (i === 0 && j === p.length - 1)) continue;
			if (intersects(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length]))
				throw new Error("The outline crosses or touches itself. Draw one simple outline without crossings.");
		}
		if (Math.abs(Shape.area(p)) < 0.5) throw new Error("The outline is too small or flat. Draw around an area.");
	};
	// Returns triangle CORNER indices. Shared by drawing, picking, processing and exported maps.
	Shape.triangulate = (p) => {
		if (p.length < 3) return [];
		const sign = Math.sign(Shape.area(p));
		if (!sign) return [];
		const turn = (a, b, c) => sign * cross(p[a], p[b], p[c]);
		const ring = p.map((_, i) => i), triangles = [];
		// Preserve the existing triangle layout for convex primitives (including non-planar quads).
		if (ring.every((b, i) => turn(ring[(i + ring.length - 1) % ring.length], b, ring[(i + 1) % ring.length]) >= -EPS))
			return ring.slice(1, -1).map((b, i) => [0, b, i + 2]);
		while (ring.length > 3) {
			let found = false;
			for (let i = 0; i < ring.length; i++) {
				const a = ring[(i + ring.length - 1) % ring.length], b = ring[i], c = ring[(i + 1) % ring.length];
				if (turn(a, b, c) <= EPS) continue;
				if (ring.some((k) => k !== a && k !== b && k !== c && turn(a, b, k) >= -EPS && turn(b, c, k) >= -EPS && turn(c, a, k) >= -EPS)) continue;
				triangles.push([a, b, c]); ring.splice(i, 1); found = true; break;
			}
			if (!found) {
				// Collinear corners can remain after mesh editing; omit a zero-area corner, never fill a concave notch.
				const i = ring.findIndex((b, j) => Math.abs(turn(ring[(j + ring.length - 1) % ring.length], b, ring[(j + 1) % ring.length])) < EPS);
				if (i < 0) return [];
				ring.splice(i, 1);
			}
		}
		if (ring.length === 3) triangles.push(ring.slice());
		return triangles;
	};
	// Intersect a tileset projection ray (x, y+t, t) with a captured surface plane.
	Shape.surfacePoint = ([x, y], surface) => {
		const n = surface.normal, denom = n[1] + n[2];
		if (Math.abs(denom) < 1e-6) throw new Error("This face is edge-on. Start on a face visible in the tileset view.");
		const t = (TS.v3.dot(n, surface.origin) - n[0] * x - n[1] * y) / denom;
		return [x, y + t, t];
	};
	Shape.create = (input, options = {}) => {
		if (!Array.isArray(input) || !input.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])))
			throw new Error("The outline contains an invalid point.");
		let p = Shape.simplify(input, Math.max(0, Number(options.simplify) || 0));
		if (options.snap > 0) p = Shape.clean(p.map((q) => q.map((v) => TS.snap(v, options.snap))));
		Shape.validate(p);
		if (Shape.area(p) < 0) p.reverse();
		const thickness = Number(options.thickness ?? 8), base = Number(options.base ?? 0);
		if (!Number.isFinite(thickness) || thickness < 0 || thickness > 255 || !Number.isFinite(base) || base < 0)
			throw new Error("Thickness must be between 0 and 255 px, and the base height must be non-negative.");
		const top = options.plane === "top", z = base + thickness, frontY = Math.max(...p.map((v) => v[1])) + base;
		let verts, back, surfaceNormal = null;
		if (options.surface) {
			const s = options.surface;
			if (![s.origin, s.normal].every((v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) || TS.v3.len(s.normal) < 1e-6)
				throw new Error("The drawing surface is invalid. Clear the outline and choose the face again.");
			surfaceNormal = TS.v3.norm(s.normal);
			if (surfaceNormal[1] + surfaceNormal[2] < 0) surfaceNormal = TS.v3.scale(surfaceNormal, -1);
			back = p.map((q) => Shape.surfacePoint(q, { origin: s.origin, normal: surfaceNormal }));
			// A zero-thickness detail is lifted by 0.01 px to avoid coplanar flicker and win map processing.
			verts = back.map((q) => TS.v3.add(q, TS.v3.scale(surfaceNormal, thickness || 0.01)));
		} else {
			verts = p.map(([x, y]) => top ? [x, y + z, z] : [x, frontY, frontY - y]);
			back = verts.map(([x, y, h]) => top ? [x, y, base] : [x, y - thickness, h]);
		}
		const n = verts.length, front = verts.map((_, i) => i), faces = [front];
		if (thickness > 0) {
			verts.push(...back);
			faces.push(front.map((i) => i + n).reverse());
			for (let i = 0; i < n; i++) { const j = (i + 1) % n; faces.push([i + n, j + n, j, i]); }
		}
		// newObject's centre-based winding only applies to convex shapes. Use the known outline winding here.
		const obj = TS.Mesh.newObject("Custom shape", verts, []);
		obj.faces = faces.map((v) => ({ v })); obj.smooth = 0;
		if (surfaceNormal) { const u = TS.v3.norm(TS.v3.sub(verts[1], verts[0])); obj.basis = [u, TS.v3.norm(TS.v3.cross(surfaceNormal, u)), surfaceNormal]; }
		obj.solid = thickness > 0;
		if (obj.solid) obj.collision = "footprint";
		return obj;
	};
})();
