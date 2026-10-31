// Prisms: the coarse stage of the shadow test. A prism is an invisible box round a model: its floor footprint (convex hull) and its
// height range. It only answers "should I look closer here?": a ray that passes over (or under, or beside) every prism can't be in
// shadow, so only the stretches of a ray inside a prism are checked against the exact floor spans (floor.spanData, "solid from height
// A to B"). Gaps between table legs or under a lintel stay lit because the spans say so, not the box.
//   TS.Prism.build(result)            one prism per model: {id (piece id), oi, hull, z0, z1}
//   TS.Prism.table(prisms, light)     the light's-eye table: for each of BINS directions round the light, the prisms a ray that way
//                                     can enter, as {enter, exit (px from the light along the floor), z0, z1, id}
//   TS.Prism.shadowed(table, f, W, p, toL)   the same answer as marching every step, checking only inside prisms
"use strict";
(function () {
	const BINS = 1024, TAU = Math.PI * 2, BIN_W = TAU / BINS;

	// Convex hull (monotone chain) of [x, y] points.
	function hull(pts) {
		const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
		if (p.length < 3) return p;
		const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
		const lo = [], up = [];
		for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
		for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
		return lo.slice(0, -1).concat(up.slice(0, -1));
	}

	// The hull grown by r in every direction (its vertices plus a square of half-side r round each: a superset of the true offset).
	function grow(h, r) {
		const pts = [];
		for (const q of h) for (const dx of [-r, r]) for (const dy of [-r, r]) pts.push([q[0] + dx, q[1] + dy]);
		return hull(pts);
	}

	// One prism per model that has surfaces on the floor plan. Models of one piece share its id.
	function build(result) {
		const out = [], roles = result.roles || [], pm = result.pieceMap;
		roles.forEach((role, oi) => {
			if (!role || role.hull.length < 3 || !(role.heightMax > role.heightMin || role.heightMax > 0)) return;
			out.push({ oi, id: pm ? pm.pieceOf[oi] : oi, hull: role.hull, z0: role.heightMin, z1: role.heightMax });
		});
		return out;
	}

	// Ray from (lx, ly) at angle a against a convex polygon (counter-clockwise or not): [enter, exit] distances or null.
	function clip(poly, lx, ly, ux, uy) {
		let t0 = 0, t1 = Infinity;
		const n = poly.length;
		// Winding from the signed area.
		let area = 0;
		for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
		const w = area >= 0 ? 1 : -1;
		for (let i = 0; i < n; i++) {
			const a = poly[i], b = poly[(i + 1) % n];
			// Inside is the left of each edge for counter-clockwise (w = 1): cross(edge, point - a) >= 0.
			const ex = (b[0] - a[0]) * w, ey = (b[1] - a[1]) * w;
			const num = ex * (ly - a[1]) - ey * (lx - a[0]);   // cross at the origin: >= 0 inside
			const den = ex * uy - ey * ux;                       // change along the ray
			if (Math.abs(den) < 1e-12) { if (num < 0) return null; continue; }
			const t = -num / den;
			if (den > 0) { if (t > t0) t0 = t; } else if (t < t1) t1 = t;
			if (t0 > t1) return null;
		}
		return t1 === Infinity ? null : [t0, t1];
	}

	// The light's-eye table for a light at floor point (lx, ly): bins[b] = list of {enter, exit, z0, z1, id}. Every box is grown
	// so a sample anywhere in a bin's wedge, in any floor cell the box touches, is still inside its interval (a cull must never
	// drop a real hit).
	function table(prisms, light) {
		const bins = new Array(BINS);
		for (let b = 0; b < BINS; b++) bins[b] = [];
		const lx = light.x, ly = light.y;
		for (const pr of prisms) {
			let far = 0;
			for (const q of pr.hull) far = Math.max(far, Math.hypot(q[0] - lx, q[1] - ly));
			const pad = 1.5 + (far + 2) * BIN_W * 0.5;
			const g = grow(pr.hull, pad);
			// Inside the grown box: every direction. Else the wedge it spans.
			let inside = true, area = 0;
			for (let i = 0; i < g.length; i++) { const a = g[i], b = g[(i + 1) % g.length]; area += a[0] * b[1] - b[0] * a[1]; }
			const w = area >= 0 ? 1 : -1;
			for (let i = 0; i < g.length && inside; i++) {
				const a = g[i], b = g[(i + 1) % g.length];
				if (((b[0] - a[0]) * w) * (ly - a[1]) - ((b[1] - a[1]) * w) * (lx - a[0]) < 0) inside = false;
			}
			let b0 = 0, b1 = BINS - 1;
			if (!inside) {
				const c = Math.atan2(g.reduce((s, q) => s + q[1], 0) / g.length - ly, g.reduce((s, q) => s + q[0], 0) / g.length - lx);
				let lo = Infinity, hi = -Infinity;
				for (const q of g) {
					let d = Math.atan2(q[1] - ly, q[0] - lx) - c;
					while (d > Math.PI) d -= TAU;
					while (d < -Math.PI) d += TAU;
					if (d < lo) lo = d;
					if (d > hi) hi = d;
				}
				b0 = Math.floor((c + lo + Math.PI) / BIN_W) - 1; b1 = Math.ceil((c + hi + Math.PI) / BIN_W) + 1;
			}
			const count = inside ? BINS : Math.min(BINS, b1 - b0 + 1);
			for (let k = 0; k < count; k++) {
				const bi = inside ? k : ((b0 + k) % BINS + BINS) % BINS;
				const a = (bi + 0.5) * BIN_W - Math.PI;
				const hit = clip(g, lx, ly, Math.cos(a), Math.sin(a));
				if (hit) bins[bi].push({ enter: hit[0] - pad - 1, exit: hit[1] + pad + 1, z0: pr.z0 - 0.1, z1: pr.z1 + 0.1, id: pr.id });
			}
		}
		return { bins, light: { x: lx, y: ly }, count: prisms.length };
	}

	const binOf = (dx, dy) => {
		const b = Math.floor((Math.atan2(dy, dx) + Math.PI) / BIN_W);
		return b >= BINS ? BINS - 1 : b < 0 ? 0 : b;
	};

	// Same samples as the plain march (1 px steps from the surface point p toward the light, from the 2nd step on) but only those
	// inside a prism the ray can touch, and below its top / above its bottom, are looked up in the exact spans.
	function shadowed(tab, f, W, p, toL) {
		const steps = Math.ceil(Math.hypot(toL[0], toL[1]));
		if (steps < 1) return false;
		const list = tab.bins[binOf(p[0] - tab.light.x, p[1] - tab.light.y)];
		if (!list.length) return false;
		const D = Math.hypot(p[0] - tab.light.x, p[1] - tab.light.y);
		for (let m = 0; m < list.length; m++) {
			const pr = list[m];
			// Sample s is at distance D * (1 - s / steps) from the light; its height is p[2] + toL[2] * s / steps.
			if (pr.exit < 0 || pr.enter > D) continue;
			let s0 = Math.max(2, Math.floor(steps * (1 - Math.min(D, pr.exit) / D)) - 1);
			let s1 = Math.min(steps, Math.ceil(steps * (1 - Math.max(0, pr.enter) / D)) + 1);
			if (D < 1e-6) { s0 = 2; s1 = steps; }
			for (let s = s0; s <= s1; s++) {
				const t = s / steps, z = p[2] + toL[2] * t;
				if (z > pr.z1 || z < pr.z0) continue;
				const x = Math.floor(p[0] + toL[0] * t), y = Math.floor(p[1] + toL[1] * t);
				if (x < 0 || y < 0 || x >= W || y >= f.rows) continue;
				const k = y * W + x, sp = f.spanData;
				for (let j = f.spanStart[k], end = f.spanStart[k + 1]; j < end; j += 2) if (sp[j] < z - 0.25 && sp[j + 1] > z + 0.75) return true;
			}
		}
		return false;
	}

	TS.Prism = { BINS, build, table, shadowed };
})();
