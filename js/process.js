// Process: renders the models through the tileset's projection into per-pixel surface data, then the maps the lighting engine
// reads. A canvas pixel (x, y) shows the line (x, y + t, t); its surface is the highest point of any model on that line
// (largest t = height). Because the projection is parallel, height and normals interpolate linearly across a triangle on screen.
//
// Outputs (all canvas-sized, transparent where the art is):
//   <name>_height.png  R = height px / 255 (G, B = R, or the engine's packed highlights: G strength, B gloss, from roughness)
//   <name>_normal.png  OpenGL sprite normal map: R = east, G = up (a top), B = toward the viewer (south, an upright front)
//   <name>_pbr.png     R = roughness, G = metallic
//   <name>_footprints.json  each model's floor footprint (convex hull), height range, and its collision (mode, and in
//                           footprint mode the exact polygons the player collides with; see P.collision)
"use strict";
(function () {
	const v3 = TS.v3, Mesh = TS.Mesh;
	const P = (TS.Process = {});

	// result: {w, h, height Float32 (NaN = nothing), normal Float32 x3, rough, metal, obj Int32, art alpha, holes, stats,
	//          floor: {top, bottom, rows} heightfield on the floor plan}
	P.run = (objects, art, settings) => {
		const W = art.w, H = art.h, N = W * H;
		const height = new Float32Array(N).fill(NaN);
		const normal = new Float32Array(N * 3);
		const rough = new Float32Array(N), metal = new Float32Array(N);
		const owner = new Int32Array(N).fill(-1);
		const clipped = new Uint8Array(N);
		for (let oi = 0; oi < objects.length; oi++) {
			const obj = objects[oi];
			const corners = Mesh.shadingNormals(obj);
			obj.faces.forEach((f, fi) => {
				const mat = Mesh.faceMat(obj, f);
				for (const ids of Mesh.faceTriangles(obj, f)) {
					const p = ids.map((k) => obj.verts[f.v[k]]), n = ids.map((k) => corners[fi][k]);
					rasterTri(p, n, (idx, z, nx, ny, nz) => {
						if (!(z > height[idx]) && !isNaN(height[idx])) return;
						height[idx] = z;
						normal[idx * 3] = nx; normal[idx * 3 + 1] = ny; normal[idx * 3 + 2] = nz;
						rough[idx] = mat.roughness; metal[idx] = mat.metallic;
						owner[idx] = oi;
					}, W, H);
				}
			});
		}
		// Art coverage: holes (art no model covers), fills, clamping.
		const alpha = art.alpha;
		let holes = 0, filled = 0, unused = 0, over = 0, covered = 0;
		const hole = new Uint8Array(N);
		for (let i = 0; i < N; i++) {
			const has = alpha[i] > settings.alphaCut;
			if (has && isNaN(height[i])) { hole[i] = 1; holes++; }
			else if (has) covered++;
			else if (!isNaN(height[i])) unused++;
		}
		// Fill holes from the nearest covered pixel (a face pixel one higher per px up), else leave them on the floor.
		if (settings.fill > 0 && holes) {
			const src = height.slice();
			// Summed-area table of fillable pixels: a hole with none within reach skips the ring search (same result, far faster
			// when most holes are far from any model).
			const sw = W + 1, sat = new Int32Array(sw * (H + 1));
			for (let y = 0; y < H; y++) {
				let run = 0;
				for (let x = 0; x < W; x++) {
					const q = y * W + x;
					if (!isNaN(src[q]) && !hole[q]) run++;
					sat[(y + 1) * sw + x + 1] = sat[y * sw + x + 1] + run;
				}
			}
			const reach = settings.fill;
			for (let i = 0; i < N; i++) {
				if (!hole[i]) continue;
				const x = i % W, y = (i / W) | 0;
				const ax = Math.max(0, x - reach), bx = Math.min(W, x + reach + 1), ay = Math.max(0, y - reach), by = Math.min(H, y + reach + 1);
				if (sat[by * sw + bx] - sat[ay * sw + bx] - sat[by * sw + ax] + sat[ay * sw + ax] === 0) continue;
				let best = -1, bd = Infinity, bdy = 0;
				for (let r = 1; r <= settings.fill && best < 0; r++)
					for (let dy = -r; dy <= r; dy++)
						for (let dx = -r; dx <= r; dx++) {
							if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
							const qx = x + dx, qy = y + dy;
							if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
							const q = qy * W + qx;
							if (isNaN(src[q]) || hole[q]) continue;
							const d = dx * dx + dy * dy;
							if (d < bd) { bd = d; best = q; bdy = dy; }
						}
				if (best < 0) continue;
				const face = Math.abs(normal[best * 3 + 2]) < 0.7;
				height[i] = Math.max(0, src[best] + (face ? bdy : 0));
				normal.copyWithin(i * 3, best * 3, best * 3 + 3);
				rough[i] = rough[best]; metal[i] = metal[best]; owner[i] = owner[best];
				hole[i] = 2;
				filled++;
			}
		}
		for (let i = 0; i < N; i++) if (height[i] > 255) { clipped[i] = 1; over++; }
		const floor = P.floorField(objects, W, H, P.bodyRule(settings));
		const roles = P.roles(objects, floor, settings);
		const collision = P.collision(objects, floor, settings, roles);
		return { w: W, h: H, height, normal, rough, metal, owner, alpha, hole, clipped, floor, roles, collision, art,
			stats: { covered, holes, filled, unfilled: holes - filled, unused, over } };
	};

	// Scanline-free triangle raster over the canvas: calls put(index, z, nx, ny, nz) per covered pixel centre.
	// Screen point of a world point: (X, Y - Z). Back faces (seen from behind) are skipped: on a closed model the surface seen
	// along a line is always a front face.
	function rasterTri(p, n, put, W, H) {
		const s = p.map((q) => [q[0], q[1] - q[2]]);
		const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[1][1] - s[0][1]) * (s[2][0] - s[0][0]);
		if (Math.abs(area) < 1e-9) return;
		// Faces facing the viewer (0, 1, 1) come out with a positive signed area here (screen y down); skip the rest.
		if (area < 0) return;
		const x0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
		const y0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
		const inv = 1 / area, eps = 1e-6;
		for (let y = y0; y <= y1; y++)
			for (let x = x0; x <= x1; x++) {
				const px = x + 0.5, py = y + 0.5;
				const w0 = ((s[1][0] - px) * (s[2][1] - py) - (s[1][1] - py) * (s[2][0] - px)) * inv;
				const w1 = ((s[2][0] - px) * (s[0][1] - py) - (s[2][1] - py) * (s[0][0] - px)) * inv;
				const w2 = 1 - w0 - w1;
				if (w0 < -eps || w1 < -eps || w2 < -eps) continue;
				const z = w0 * p[0][2] + w1 * p[1][2] + w2 * p[2][2];
				const nn = v3.norm([w0 * n[0][0] + w1 * n[1][0] + w2 * n[2][0], w0 * n[0][1] + w1 * n[1][1] + w2 * n[2][1], w0 * n[0][2] + w1 * n[1][2] + w2 * n[2][2]]);
				put(y * W + x, z, nn[0], nn[1], nn[2]);
			}
	}

	// Floor-plan heightfield: per floor point, the highest (top) and lowest (bottom) model height above it, and the solid spans
	// in between: each model's surfaces crossing that point pair up into the heights it fills (entering, leaving), so a gap
	// between two stacked parts (a cart's shelves, a top over a lower part) stays open to light. A floor point can be south of
	// the canvas (things drawn near the bottom stand further south), so it has H + 256 rows.
	// rule {step, body}: blocks[model index] lists the floor points where that model's own spans reach into [step, body] (the
	// player's body), the floor it blocks in footprint collision mode.
	P.floorField = (objects, W, H, rule = P.bodyRule()) => {
		const rows = H + 256, top = new Float32Array(W * rows).fill(-1), bottom = new Float32Array(W * rows).fill(1e9);
		const spans = new Array(W * rows), blocks = [], owner = new Int32Array(W * rows).fill(-1);
		// heights[model index] = {min, max}: lowest underside and highest top of the model's own solid spans (null: none on the plan).
		const heights = [];
		let used = H;
		for (let oi = 0; oi < objects.length; oi++) {
			const obj = objects[oi];
			const blocking = [];
			blocks.push(blocking);
			const hits = new Map();
			let hMin = Infinity, hMax = -Infinity;
			for (const t of Mesh.triangles(obj)) {
				const p = [obj.verts[t.a], obj.verts[t.b], obj.verts[t.c]];
				const area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
				if (Math.abs(area) < 1e-9) continue;
				const x0 = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])));
				const y0 = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1]))), y1 = Math.min(rows - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])));
				const inv = 1 / area;
				for (let y = y0; y <= y1; y++)
					for (let x = x0; x <= x1; x++) {
						const px = x + 0.5, py = y + 0.5;
						const w0 = ((p[1][0] - px) * (p[2][1] - py) - (p[1][1] - py) * (p[2][0] - px)) * inv;
						const w1 = ((p[2][0] - px) * (p[0][1] - py) - (p[2][1] - py) * (p[0][0] - px)) * inv;
						const w2 = 1 - w0 - w1;
						if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
						const z = w0 * p[0][2] + w1 * p[1][2] + w2 * p[2][2], i = y * W + x;
						if (z > top[i]) { top[i] = z; owner[i] = oi; }
						if (z < bottom[i]) bottom[i] = z;
						if (y >= used) used = y + 1;
						if (!hits.has(i)) hits.set(i, []);
						hits.get(i).push(z);
					}
			}
			// Pair the crossings into filled spans. Two triangles sharing an edge both report a point on it: drop near-duplicates.
			for (const [i, zs] of hits) {
				zs.sort((a, b) => a - b);
				const clean = [];
				for (const z of zs) if (!clean.length || z - clean[clean.length - 1] > 0.05) clean.push(z);
				const list = spans[i] || (spans[i] = []);
				// Height range from the real crossings, not the spans: a lone last crossing (touching parts of one model) gets an
				// invented 0.5 px span below, which must not raise heightMax.
				if (clean[0] < hMin) hMin = clean[0];
				if (clean[clean.length - 1] > hMax) hMax = clean[clean.length - 1];
				let hit = false;
				for (let k = 0; k < clean.length; k += 2) {
					const a = clean[k], b = k + 1 < clean.length ? clean[k + 1] : clean[k] + 0.5;
					list.push(a, b);
					if (a < rule.body && b > rule.step) hit = true;
				}
				if (hit) blocking.push(i);
			}
			heights.push(hMin <= hMax ? { min: Math.max(0, hMin), max: hMax } : null);
		}
		// Different models' spans that touch or overlap (a pillow on a mattress) are one solid; only real gaps stay open.
		spans.forEach((list, i) => {
			if (list.length <= 2) return;
			const pairs = [];
			for (let k = 0; k < list.length; k += 2) pairs.push([list[k], list[k + 1]]);
			pairs.sort((a, b) => a[0] - b[0]);
			const merged = [pairs[0]];
			for (const p of pairs.slice(1)) {
				const last = merged[merged.length - 1];
				if (p[0] <= last[1] + 0.5) last[1] = Math.max(last[1], p[1]);
				else merged.push(p);
			}
			spans[i] = merged.flat();
		});
		return { top, bottom, spans, blocks, heights, owner, rows, shown: Math.min(rows, used + 8) };
	};

	// --- collision ---
	// Per model, collision mode (o.collision: strip | footprint | none; unset = "auto", resolved in P.roles; solid: false = "none"):
	//   auto       (default) footprint. A flat or low model (nothing reaches the step) simply blocks no floor, so it produces no polygon.
	//   strip      today's rule, built by Godot (addons/studio_import/footprints.gd foot_strips): a 4 px strip along the south edge of the convex
	//              footprint, for solid models whose bottom is below SOLID_BELOW. You walk into the drawn top.
	//   footprint  walk-behind: the floor the model really blocks stops the player, so they walk round it and can stand behind it.
	//              A floor point blocks where one of the model's solid spans reaches into the body, [step, body] px (a shelf hung
	//              above the head and a rug under the step don't). That mask is pulled in for the player's box (24x12 above the
	//              feet) the way footprints.gd does strips: sides COLLIDE_SIDE in, south edges COLLIDE_SOUTH north (the feet stop
	//              4 px in front of the base and can stand right at its back edge), at least COLLIDE_MIN deep (see bodyMask),
	//              then traced.
	//   none       never blocks.
	// Mirrors addons/studio_import/footprints.gd's constants; keep them in sync.
	const COLLIDE_SOUTH = 8, COLLIDE_SIDE = 3, COLLIDE_MIN = 4, SOLID_BELOW = 30, FEET = { w: 24, h: 12 };
	P.FEET = FEET;
	P.bodyRule = (settings = {}) => ({ step: settings.step ?? 4, body: settings.body ?? 40 });
	// What the artist chose: "auto" (default) | "strip" | "footprint" | "none". solid: false is the older spelling of "none".
	P.collisionRequested = (o) => (!o.solid ? "none" : o.collision === "footprint" || o.collision === "strip" ? o.collision : "auto");
	// The mode that applies: the role's resolved one when the model was processed, else the request ("auto" until resolved).
	P.collisionMode = (o, role) => (role ? role.mode : P.collisionRequested(o));

	// --- engine roles ---
	// Kinds: floor (walk over it), deco (art only), solid (blocks), wall (tall back wall the torch beam lands on), side (side wall
	// that blocks light east/west). Only floor / solid are inferred; deco, wall and side are the artist's call (o.kind).
	P.KINDS = ["floor", "deco", "solid", "wall", "side"];
	P.walkOver = (settings = {}) => settings.walkOverHeight ?? 2;

	// Per model index: {heightMin, heightMax (floor-space px above the floor; 0/0 when it has no surface on the plan), flat,
	// kindInferred, kind, kindOverridden, requested, mode (resolved collision), hull (floor plan convex hull)}.
	// auto -> "footprint" (a model nothing of which reaches the step blocks no floor, so it yields no polygon). An explicit
	// strip / footprint / none is always honoured.
	P.roles = (objects, floor, settings) => {
		const walk = P.walkOver(settings);
		return objects.map((o, oi) => {
			const h = floor.heights[oi], heightMin = h ? round2(h.min) : 0, heightMax = h ? round2(h.max) : 0;
			const flat = !!h && heightMax <= walk;
			const kindInferred = flat ? "floor" : "solid";
			const kindOverridden = P.KINDS.includes(o.kind);
			const requested = P.collisionRequested(o);
			const mode = requested !== "auto" ? requested : "footprint";
			const vi = o.faces.length ? Mesh.faceVerts(o) : [];
			return { heightMin, heightMax, flat, kindInferred, kind: kindOverridden ? o.kind : kindInferred, kindOverridden, requested, mode,
				hull: hull(vi.map((i) => [o.verts[i][0], o.verts[i][1]])) };
		});
	};

	// {models: [{mode, polygons (footprint mode, floor px), blocked (floor px count)}] by object index,
	//  mask Uint8 over the floor plan (1 = floor a footprint model blocks, 2 = its collision, 4 = a strip model's strip, as Godot
	//  will build it), owner Int32 (model index of the collision there), w, rows}
	P.collision = (objects, floor, settings, roles = P.roles(objects, floor, settings)) => {
		const W = floor.top.length / floor.rows, rows = floor.rows, N = W * rows;
		const mask = new Uint8Array(N), owner = new Int32Array(N).fill(-1);
		const stripFeet = new Uint8Array(N);
		let anyStrip = false;
		const models = objects.map((o, oi) => {
			const mode = roles[oi].mode;
			if (!o.faces.length || mode === "none") return { mode, polygons: [], blocked: 0 };
			if (mode === "strip") {
				const b = Mesh.bounds(o, Mesh.faceVerts(o));
				if (b.min[2] < SOLID_BELOW) {
					fillConvex(stripFeet, W, rows, hull(Mesh.faceVerts(o).map((i) => [o.verts[i][0], o.verts[i][1]])));
					anyStrip = true;
				}
				return { mode, polygons: [], blocked: 0 };
			}
			const idx = floor.blocks[oi] || [];
			if (!idx.length) return { mode, polygons: [], blocked: 0 };
			// Local mask over the blocked floor, with room south for the minimum depth.
			let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
			for (const i of idx) { const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
			const ox = x0, oy = y0, w = x1 - x0 + 1, h = y1 - oy + 1 + COLLIDE_MIN;
			const m = new Uint8Array(w * h);
			for (const i of idx) { const x = i % W, y = (i / W) | 0; m[(y - oy) * w + (x - ox)] = 1; mask[i] |= 1; }
			const c = bodyMask(m, w, h);
			for (let y = 0; y < h; y++)
				for (let x = 0; x < w; x++) {
					if (!c[y * w + x]) continue;
					const gx = x + ox, gy = y + oy;
					if (gy < 0 || gy >= rows) continue;
					mask[gy * W + gx] |= 2; owner[gy * W + gx] = oi;
				}
			return { mode, polygons: P.trace(c, w, h).map((poly) => poly.map(([x, y]) => [x + ox, y + oy])), blocked: idx.length };
		});
		if (anyStrip) {
			const s = stripMask(stripFeet, W, rows);
			for (let i = 0; i < N; i++) if (s[i]) mask[i] |= 4;
		}
		return { models, mask, owner, w: W, rows };
	};

	// The body pull-in on a 0/1 mask (w x h): each row's runs lose COLLIDE_SIDE px each end (less on thin runs, never below 2 px),
	// then each column's runs [a, b) become [a, max(b - SOUTH, a + MIN)): the feet stop 4 px in front of b and can stand at a.
	// A run thinner than SOUTH + MIN keeps MIN px from its back edge (never reaching north of it, so you can still stand behind
	// a bed leg; the feet stop a little further out in front instead).
	function bodyMask(m, w, h) {
		const s = new Uint8Array(w * h), out = new Uint8Array(w * h);
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w;) {
				if (!m[y * w + x]) { x++; continue; }
				let e = x;
				while (e < w && m[y * w + e]) e++;
				const k = Math.min(COLLIDE_SIDE, Math.max(0, (e - x - 2) >> 1));
				for (let q = x + k; q < e - k; q++) s[y * w + q] = 1;
				x = e;
			}
		for (let x = 0; x < w; x++)
			for (let y = 0; y < h;) {
				if (!s[y * w + x]) { y++; continue; }
				let e = y;
				while (e < h && s[e * w + x]) e++;
				for (let q = y; q < Math.max(e - COLLIDE_SOUTH, y + COLLIDE_MIN); q++) if (q < h) out[q * w + x] = 1;
				y = e;
			}
		return out;
	}

	// What foot_strips makes of the strip models' merged footprints: per column, the south COLLIDE_MIN px of each run (sides in),
	// moved COLLIDE_SOUTH north. For the Collision view only (Godot builds the real one from the exported hulls).
	function stripMask(feet, W, rows) {
		const s = new Uint8Array(W * rows), out = new Uint8Array(W * rows);
		for (let y = 0; y < rows; y++)
			for (let x = 0; x < W;) {
				if (!feet[y * W + x]) { x++; continue; }
				let e = x;
				while (e < W && feet[y * W + e]) e++;
				const k = e - x > 2 * COLLIDE_SIDE ? COLLIDE_SIDE : e - x > 2 ? 1 : 0;
				for (let q = x + k; q < e - k; q++) s[y * W + q] = 1;
				x = e;
			}
		for (let x = 0; x < W; x++)
			for (let y = 0; y < rows;) {
				if (!s[y * W + x]) { y++; continue; }
				let e = y;
				while (e < rows && s[e * W + x]) e++;
				for (let q = Math.max(0, e - COLLIDE_SOUTH - COLLIDE_MIN); q < e - COLLIDE_SOUTH; q++) out[q * W + x] = 1;
				y = e;
			}
		return out;
	}

	function fillConvex(mask, W, rows, poly) {
		if (poly.length < 3) return;
		const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
		const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
		const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(rows - 1, Math.ceil(Math.max(...ys)));
		for (let y = y0; y <= y1; y++)
			for (let x = x0; x <= x1; x++) {
				const px = x + 0.5, py = y + 0.5;
				let inside = true;
				for (let i = 0; i < poly.length && inside; i++) {
					const a = poly[i], b = poly[(i + 1) % poly.length];
					if ((b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]) < -1e-9) inside = false;
				}
				if (inside) mask[y * W + x] = 1;
			}
	}

	// Outlines of a 0/1 pixel mask (w x h) as polygons along the pixel edges (marching squares on the pixel corners), each
	// clockwise on screen, collinear corners dropped and pixel staircases straightened (Douglas-Peucker, SIMPLIFY px). No convex
	// hull: an L stays an L. Godot's tile polygons can't have holes, so a part with a hole (a ring) is cut in two through it first.
	const SIMPLIFY = 1;
	P.trace = (mask, w, h) => {
		const loops = traceLoops(mask, w, h);
		const hole = loops.find((l) => area(l) < 0);
		if (hole) {
			const cut = Math.min(...hole.map((p) => p[0]));
			const left = new Uint8Array(w * h), right = new Uint8Array(w * h);
			for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) (x < cut ? left : right)[y * w + x] = 1;
			return P.trace(left, w, h).concat(P.trace(right, w, h));
		}
		return loops.map(simplify).filter((l) => l.length >= 3);
	};

	// Directed boundary edges with the filled pixel on the right (screen y down), linked into loops; at a corner two diagonal
	// pixels share, turn right first so they stay separate loops.
	function traceLoops(mask, w, h) {
		const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x];
		const out = new Map(), key = (x, y) => y * (w + 1) + x;
		const add = (ax, ay, bx, by) => { const k = key(ax, ay); if (!out.has(k)) out.set(k, []); out.get(k).push([ax, ay, bx, by]); };
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++) {
				if (!mask[y * w + x]) continue;
				if (!at(x, y - 1)) add(x, y, x + 1, y);
				if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
				if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
				if (!at(x - 1, y)) add(x, y + 1, x, y);
			}
		const loops = [];
		for (const list of out.values())
			while (list.length) {
				let e = list.pop();
				const loop = [[e[0], e[1]]], sx = e[0], sy = e[1];
				for (let guard = 0; guard < 4 * (w + 1) * (h + 1); guard++) {
					if (e[2] === sx && e[3] === sy) break;
					loop.push([e[2], e[3]]);
					const next = out.get(key(e[2], e[3]));
					const dx = e[2] - e[0], dy = e[3] - e[1];
					// Right turn of (dx, dy) on screen is (-dy, dx).
					let pick = next.findIndex((n) => n[2] - n[0] === -dy && n[3] - n[1] === dx);
					if (pick < 0) pick = next.findIndex((n) => n[2] - n[0] === dx && n[3] - n[1] === dy);
					if (pick < 0) pick = 0;
					e = next.splice(pick, 1)[0];
				}
				loops.push(loop);
			}
		return loops;
	}

	const area = (l) => { let a = 0; for (let i = 0; i < l.length; i++) { const p = l[i], q = l[(i + 1) % l.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };

	function simplify(loop) {
		// Drop collinear corners.
		let pts = loop.filter((p, i) => {
			const a = loop[(i + loop.length - 1) % loop.length], b = loop[(i + 1) % loop.length];
			return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
		});
		if (pts.length <= 4) return pts;
		// Douglas-Peucker on the closed loop, split at the corner farthest from the first.
		let far = 0, fd = -1;
		pts.forEach((p, i) => { const d = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]); if (d > fd) { fd = d; far = i; } });
		const dp = (seq) => {
			if (seq.length <= 2) return seq;
			const a = seq[0], b = seq[seq.length - 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
			let worst = 0, wi = 0;
			for (let i = 1; i < seq.length - 1; i++) {
				const d = Math.abs((b[0] - a[0]) * (a[1] - seq[i][1]) - (a[0] - seq[i][0]) * (b[1] - a[1])) / len;
				if (d > worst) { worst = d; wi = i; }
			}
			if (worst <= SIMPLIFY) return [a, b];
			return dp(seq.slice(0, wi + 1)).slice(0, -1).concat(dp(seq.slice(wi)));
		};
		const one = dp(pts.slice(0, far + 1)), two = dp(pts.slice(far).concat([pts[0]]));
		pts = one.slice(0, -1).concat(two.slice(0, -1));
		return pts;
	}

	// --- maps ---

	P.mapNormal = (r, i, settings) => {
		let n = [r.normal[i * 3], r.normal[i * 3 + 1], r.normal[i * 3 + 2]];
		if (settings.relief > 0) n = relief(r, i, n, settings.relief);
		// world (east, south, up) -> map (east, up, toward the viewer = south)
		return [n[0], n[2], n[1]];
	};

	// The art's shading as a little bump, within one surface (same model, similar normal), clamped.
	function relief(r, i, n, strength) {
		const W = r.w, x = i % W, y = (i / W) | 0, d = r.art.data;
		const lum = (q) => (d[q * 4] * 0.3 + d[q * 4 + 1] * 0.59 + d[q * 4 + 2] * 0.11) / 255;
		const same = (q) => q >= 0 && q < W * r.h && !isNaN(r.height[q]) && r.owner[q] === r.owner[i] &&
			r.normal[q * 3] * n[0] + r.normal[q * 3 + 1] * n[1] + r.normal[q * 3 + 2] * n[2] > 0.7 && r.alpha[q] > 0;
		const l = lum(i);
		const at = (dx, dy) => { const qx = x + dx, qy = y + dy; if (qx < 0 || qy < 0 || qx >= W || qy >= r.h) return l; const q = qy * W + qx; return same(q) ? lum(q) : l; };
		const gx = TS.clamp((at(1, 0) - at(-1, 0)) * 0.5 * strength, -0.2, 0.2), gy = TS.clamp((at(0, 1) - at(0, -1)) * 0.5 * strength, -0.2, 0.2);
		const top = Math.abs(n[2]) >= 0.7;
		// Along the surface: u to the right, v up the screen.
		const u = top ? [1, 0, 0] : v3.norm([-n[1], n[0], 0]);
		const v = top ? [0, -1, 0] : [0, 0, 1];
		return v3.norm(v3.add(v3.sub(n, v3.scale(u, gx)), v3.scale(v, gy)));
	}

	// ImageData for each map.
	P.images = (r, settings) => {
		const W = r.w, H = r.h, mk = () => new ImageData(W, H);
		const hgt = mk(), nrm = mk(), pbr = mk();
		for (let i = 0; i < W * H; i++) {
			if (r.alpha[i] <= settings.alphaCut) continue;
			const has = !isNaN(r.height[i]);
			const h = has ? TS.clamp(Math.round(r.height[i]), 0, 255) : 0;
			const rough = has ? r.rough[i] : 1, metal = has ? r.metal[i] : 0;
			let g = h, b = h;
			if (settings.packHighlights && has) {
				g = Math.round(TS.clamp((0.15 + 0.85 * (1 - rough)) * (1 + 0.3 * metal), 0, 1) * 255);
				b = Math.round((1 - rough) * 255);
			}
			hgt.data.set([h, g, b, 255], i * 4);
			const n = has ? P.mapNormal(r, i, settings) : [0, 1, 0];
			nrm.data.set([Math.round((n[0] * 0.5 + 0.5) * 255), Math.round((n[1] * 0.5 + 0.5) * 255), Math.round((n[2] * 0.5 + 0.5) * 255), 255], i * 4);
			pbr.data.set([Math.round(rough * 255), Math.round(metal * 255), 0, 255], i * 4);
		}
		return { height: hgt, normal: nrm, pbr };
	};

	// Everything the engine reads per pixel and per floor point, as ONE RGBA8 image of W x (H + rows), exact bytes (it travels as raw
	// base64 in the bundle, never through a canvas, which would premultiply alpha and corrupt the channels):
	//   rows 0..H-1  (art space)   R height px (0-255), G normal x, B normal y (map normal * 0.5 + 0.5; z = sqrt(1 - x^2 - y^2)),
	//                              A material + 1 (0 = no art); materials = [[roughness, metallic], ...] indexed by A - 1.
	//   rows H..H+rows-1 (floor)   per floor point: R top + 1 (0 = nothing stands there), G underside, B gap bottom + 1 (0 = no gap),
	//                              A gap top. A gap is the tallest hole (>= MIN_GAP px) between the solid spans there (a cart's shelves).
	// The engine builds its heightfield from the floor part exactly instead of guessing it from the art.
	const MIN_GAP = 3;
	P.maps = (r, settings) => {
		const W = r.w, H = r.h, floor = r.floor, rows = floor.shown;
		const data = new Uint8Array(W * (H + rows) * 4);
		const materials = [], index = new Map();
		const material = (rough, metal) => {
			const key = Math.round(rough * 255) * 256 + Math.round(metal * 255);
			if (!index.has(key)) {
				if (materials.length >= 255) return nearest(rough, metal);
				index.set(key, materials.length);
				materials.push([Math.round(rough * 255) / 255, Math.round(metal * 255) / 255]);
			}
			return index.get(key);
		};
		const nearest = (rough, metal) => {
			let best = 0, bd = Infinity;
			materials.forEach((m, k) => { const d = (m[0] - rough) ** 2 + (m[1] - metal) ** 2; if (d < bd) { bd = d; best = k; } });
			return best;
		};
		for (let i = 0; i < W * H; i++) {
			if (r.alpha[i] <= settings.alphaCut) continue;
			const has = !isNaN(r.height[i]), o = i * 4;
			const n = has ? P.mapNormal(r, i, settings) : [0, 1, 0];
			data[o] = has ? TS.clamp(Math.round(r.height[i]), 0, 255) : 0;
			data[o + 1] = Math.round(TS.clamp(n[0] * 0.5 + 0.5, 0, 1) * 255);
			data[o + 2] = Math.round(TS.clamp(n[1] * 0.5 + 0.5, 0, 1) * 255);
			data[o + 3] = material(has ? r.rough[i] : 1, has ? r.metal[i] : 0) + 1;
		}
		const byte = (v) => TS.clamp(Math.round(v), 0, 255);
		let gaps = 0;
		for (let k = 0; k < W * rows; k++) {
			if (floor.top[k] < 0) continue;
			const sp = floor.spans[k], o = (W * H + k) * 4;
			let under = floor.bottom[k], top = floor.top[k], lo = -1, hi = 0, best = MIN_GAP;
			if (sp && sp.length >= 2) {
				under = sp[0]; top = sp[sp.length - 1];
				for (let j = 1; j + 1 < sp.length; j += 2) {
					const gap = sp[j + 1] - sp[j];
					if (gap >= best) { best = gap; lo = sp[j]; hi = sp[j + 1]; }
				}
			}
			data[o] = byte(top) + 1 > 255 ? 255 : byte(top) + 1;
			data[o + 1] = byte(under);
			if (lo >= 0) { data[o + 2] = Math.min(255, byte(lo) + 1); data[o + 3] = byte(hi); gaps++; }
		}
		return { w: W, h: H, rows, materials, highlights: !!settings.packHighlights, data, gaps };
	};

	// Version 2 adds each model's `collision` ({mode, polygons}) and the rule it was made with; the version 1 fields stay, so an
	// older importer still reads it (as strips). Pass the processed result to reuse its collision (else it is computed here).
	//
	// Bundle version 3 adds, per model (all additive): kind, kindInferred, heightMin, heightMax, flat, tags, piece, cells, and
	// collision.requested (collision.mode is now the RESOLVED mode); plus walkOverHeight, cellOwners and clashes at this level. The
	// shape of version 2 (name, solid, z, footprint, roughness, metallic, collision.mode / polygons) is unchanged. The index of a
	// model in `objects` below is what cells / cellOwners / clashes refer to.
	P.footprints = (objects, art, result, settings) => {
		const rule = P.bodyRule(settings);
		const r = result && result.roles && result.roles.length === objects.length ? result : P.run(objects, art, settings);
		const col = r.collision, roles = r.roles;
		// Export index of each model (loose lines / points are left out below, so indices shift).
		const exported = objects.map((o, oi) => oi).filter((oi) => objects[oi].faces.length);
		const idx = new Map(exported.map((oi, k) => [oi, k]));
		const own = P.cellOwnership(objects, r, settings);
		return {
			version: 2,
			walkOverHeight: P.walkOver(settings),
			canvas: [art.w, art.h],
			tile: 32,
			note: "World px: X east, Y south (floor plan), Z up; drawn at canvas (X, Y - Z). footprint = convex hull on the floor plan. " +
				"collision.mode: strip = the importer's 4 px strip along the footprint's south edge; footprint = collision.polygons (floor px) " +
				"is what the player's 24x12 feet box collides with: the floor where the model's solid spans reach into [step, body] px, sides " +
				`pulled in ${COLLIDE_SIDE} px and south edges ${COLLIDE_SOUTH} px north (feet stop 4 px in front, can stand at its back edge); none = never blocks.`,
			collision: { step: rule.step, body: rule.body, feet: [FEET.w, FEET.h], south: COLLIDE_SOUTH, side: COLLIDE_SIDE, min: COLLIDE_MIN },
			// Only surfaces count: loose lines and points (drawing aids) are left out, and models made of nothing else.
			objects: exported.map((oi) => {
				const o = objects[oi], c = col.models[oi], role = roles[oi], vi = Mesh.faceVerts(o), b = Mesh.bounds(o, vi);
				return {
					name: o.name, solid: o.solid, z: [round2(b.min[2]), round2(b.max[2])],
					footprint: hull(vi.map((i) => [round2(o.verts[i][0]), round2(o.verts[i][1])])),
					roughness: o.mat.roughness, metallic: o.mat.metallic,
					collision: Object.assign({ mode: c.mode, requested: role.requested }, c.mode === "footprint" ? { polygons: c.polygons } : {}),
					kind: role.kind, kindInferred: !role.kindOverridden,
					heightMin: role.heightMin, heightMax: role.heightMax, flat: role.flat,
					tags: typeof o.tags === "string" ? o.tags : "",
					piece: typeof o.piece === "string" ? o.piece.trim() : "",
					cells: own.cells[oi],
				};
			}),
			// Every occupied atlas cell and the models in it, then the cells two or more models share (one entry per pair).
			cellOwners: own.owners.map((e) => ({ cell: e.cell, models: e.models.map((oi) => idx.get(oi)) })),
			clashes: own.clashes.map((e) => ({ cell: e.cell, models: e.models.map((oi) => idx.get(oi)), samePiece: e.samePiece })),
		};
	};

	// Which atlas tile cells (32 px; [column, row]) each model occupies: the cells holding art it paints (its pixels on top at that
	// spot) or floor points it tops. The same sampling P.pieces uses for a piece's content, per model instead of per piece. Floor
	// points south of the canvas aren't atlas cells and are left out. Indices are into `objects`.
	// -> {cells: [[x, y], ...] per object index, owners: [{cell, models}], clashes: [{cell, models: [i, j], samePiece}]}
	// samePiece: the two models are one piece to the importer (footprints within 2 px), so it reads the cell consistently; false
	// is the dangerous kind. P.clashes (pieces on different rows of one column) is a separate check.
	P.cellOwnership = (objects, r, settings) => {
		const T = 32, W = r.w, H = r.h, gw = Math.ceil(W / T), gh = Math.ceil(H / T), cut = settings.alphaCut;
		const grid = new Array(gw * gh), put = (x, y, oi) => { const c = (y >> 5) * gw + (x >> 5); (grid[c] || (grid[c] = new Set())).add(oi); };
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				const i = y * W + x;
				if (r.alpha[i] > cut && r.owner[i] >= 0) put(x, y, r.owner[i]);
				if (r.floor.top[i] >= 0 && r.floor.owner[i] >= 0) put(x, y, r.floor.owner[i]);
			}
		const pm = r.pieceMap || P.pieces(objects, r, settings);
		const cells = objects.map(() => []), owners = [], clashes = [];
		grid.forEach((set, c) => {
			if (!set) return;
			const cell = [c % gw, (c / gw) | 0], models = [...set].sort((a, b) => a - b);
			owners.push({ cell, models });
			for (const oi of models) cells[oi].push(cell);
			for (let a = 0; a < models.length; a++)
				for (let b = a + 1; b < models.length; b++)
					clashes.push({ cell, models: [models[a], models[b]], samePiece: pm.pieceOf[models[a]] === pm.pieceOf[models[b]] });
		});
		return { cells, owners, clashes };
	};

	const round2 = (v) => Math.round(v * 100) / 100;

	// The importer's (tools/import_studio.gd) clash check, done here so artists see it before exporting. Models whose footprints
	// come within 2 px are one piece; each piece anchors every tile column it covers on the row of its lowest bottom there, and
	// reaches up to the top of its drawn art (both come from P.pieces: pass its result). Two pieces anchored on different rows of
	// one column, whose spans come within a row of each other, clash: one layer measures them as one piece there.
	// -> [{a: names, b: names, col}]
	P.clashes = (pm) => {
		const ps = pm.pieces, out = [];
		for (let a = 0; a < ps.length; a++)
			for (let b = a + 1; b < ps.length; b++)
				for (const [cx, ra] of ps[a].cols) {
					if (!ps[b].cols.has(cx)) continue;
					const rb = ps[b].cols.get(cx), ta = Math.min(ps[a].top, ra), tb = Math.min(ps[b].top, rb);
					if (ra !== rb && ta <= rb + 1 && tb <= ra + 1) { out.push({ a: ps[a].names, b: ps[b].names, col: cx }); break; }
				}
		return out;
	};

	// How the engine will read the atlas, per 32 px tile cell (the Pieces view). The importer groups models whose footprints come within
	// 2 px into one piece, puts each piece's light outline and collision on ONE cell per tile column (the cell holding its lowest
	// bottom row there: its "anchor"), and the lighting then measures every painted cell as part of the first anchored cell at or
	// below it in its column. So a cell is read correctly only when every piece with art or floor in it is the piece that owns
	// that anchor. Returns {pieces: [{names, objs, cols: Map column -> anchor row, top: highest art row}], pieceOf (per object index, -1 = no surfaces),
	// artPiece (per art pixel), floorPiece (per floor point), gw, gh, cells: [{cx, cy, content, engine, status, msg}], conflicts,
	// floating}; status 0 fine, 1 floating (art with no anchored cell below it: flat art to the engine), 2 conflict (a piece's art or
	// floor sits in a cell the engine reads as another piece's).
	P.pieces = (objects, r, settings) => {
		const T = 32, JOIN = 2, W = r.w, H = r.h, rows = r.floor.shown, cut = settings.alphaCut;
		const items = [];
		objects.forEach((o, oi) => {
			if (!o.faces.length) return;
			const vi = Mesh.faceVerts(o), b = Mesh.bounds(o, vi);
			items.push({ oi, o, hull: hull(vi.map((i) => [o.verts[i][0], o.verts[i][1]])), z0: b.min[2], z1: b.max[2] });
		});
		const root = items.map((_, i) => i), find = (k) => { while (root[k] !== k) k = root[k]; return k; };
		// A model with a `piece` name is placed by you: it joins every model with the same name (however far apart) and never
		// joins by footprint; unnamed models join each other by footprint as before.
		const label = (it) => (typeof it.o.piece === "string" ? it.o.piece.trim() : "");
		const firstNamed = new Map();
		items.forEach((it, i) => { it.label = label(it); if (it.label) { if (firstNamed.has(it.label)) root[find(i)] = find(firstNamed.get(it.label)); else firstNamed.set(it.label, i); } });
		for (let a = 0; a < items.length; a++)
			for (let b = a + 1; b < items.length; b++) if (!items[a].label && !items[b].label && polyDist(items[a].hull, items[b].hull) <= JOIN) root[find(b)] = find(a);
		const groups = new Map();
		items.forEach((it, i) => { const k = find(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); });
		const pieceOf = new Int32Array(objects.length).fill(-1);
		const pieces = [...groups.values()].map((its, id) => {
			const cols = new Map(), names = its[0].label ? [its[0].label] : [...new Set(its.map((it) => it.o.name))];
			// Flat art: every model is kind floor (walked over) or deco (art only), so the piece has no height, shadow or outline to
			// anchor. It has no anchor cells and its art / floor is never judged: it can't be misread, only drawn.
			const flat = !!r.roles && its.every((it) => r.roles[it.oi] && (r.roles[it.oi].kind === "floor" || r.roles[it.oi].kind === "deco"));
			let top = Infinity; // highest drawn row of the piece's art (its tops), for the column-clash check
			for (const it of its) for (const q of it.hull) top = Math.min(top, q[1] - it.z1);
			for (const it of its) {
				pieceOf[it.oi] = id;
				if (flat) continue;
				const xs = it.hull.map((q) => q[0]), x0 = Math.min(...xs), x1 = Math.max(...xs);
				for (let cx = Math.floor(x0 / T); cx * T < x1; cx++) {
					const y = maxYIn(it.hull, Math.max(x0, cx * T), Math.min(x1, cx * T + T)) - it.z0;
					if (!isFinite(y)) continue;
					cols.set(cx, Math.max(cols.has(cx) ? cols.get(cx) : -Infinity, Math.floor((y - 0.01) / T)));
				}
			}
			return { id, names, objs: its.map((it) => it.oi), cols, top: Math.floor(top / T), flat };
		});
		const artPiece = new Int16Array(W * H).fill(-1), floorPiece = new Int16Array(W * rows).fill(-1);
		for (let i = 0; i < W * H; i++) if (r.alpha[i] > cut && r.owner[i] >= 0) artPiece[i] = pieceOf[r.owner[i]];
		for (let k = 0; k < W * rows; k++) if (r.floor.top[k] >= 0 && r.floor.owner[k] >= 0) floorPiece[k] = pieceOf[r.floor.owner[k]];
		const gw = Math.ceil(W / T), gh = Math.ceil(rows / T), grid = new Array(gw * gh);
		const put = (x, y, p) => { if (pieces[p].flat) return; const c = (y >> 5) * gw + (x >> 5); (grid[c] || (grid[c] = new Set())).add(p); };
		for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (artPiece[y * W + x] >= 0) put(x, y, artPiece[y * W + x]);
		// Floor points count only for a model standing on the floor (its underside no higher than the step). A raised one (a
		// tabletop, a rail) is drawn Y - height above its footprint, so its footprint lies a row below its art and anchor and would
		// read as another piece's cell; its collision is judged separately, not here.
		const grounded = (oi) => !r.roles || !r.roles[oi] || r.roles[oi].heightMin <= P.bodyRule(settings).step;
		for (let y = 0; y < rows; y++) for (let x = 0; x < W; x++) if (floorPiece[y * W + x] >= 0 && grounded(r.floor.owner[y * W + x])) put(x, y, floorPiece[y * W + x]);
		// Per column: the anchors, sorted by row.
		const anchors = [];
		for (let cx = 0; cx < gw; cx++) {
			const list = [];
			for (const p of pieces) if (p.cols.has(cx)) list.push([p.cols.get(cx), p.id]);
			anchors.push(list.sort((a, b) => a[0] - b[0]));
		}
		const cells = [];
		let conflicts = 0, floating = 0;
		for (let cy = 0; cy < gh; cy++)
			for (let cx = 0; cx < gw; cx++) {
				const content = [...(grid[cy * gw + cx] || [])];
				// The engine's reading: the pieces anchored in this cell, else those anchored on the nearest row below.
				const list = anchors[cx], own = list.filter((a) => a[0] === cy);
				const below = own.length ? own : (() => { const next = list.find((a) => a[0] > cy); return next ? list.filter((a) => a[0] === next[0]) : []; })();
				const engine = [...new Set(below.map((a) => a[1]))];
				if (!content.length && !own.length) continue;
				let status = 0, msg = "";
				const stray = content.filter((p) => !engine.includes(p));
				if (content.length && !engine.length) { status = 1; floating++; msg = `${content.map((p) => pieces[p].names[0]).join(", ")}: art with no anchored cell below it in this column, so the engine treats it as flat art (no height, no shadow)`; }
				else if (stray.length) {
					status = 2; conflicts++;
					msg = `${stray.map((p) => pieces[p].names[0]).join(", ")} sits in a cell the engine reads as ${engine.map((p) => pieces[p].names[0]).join(", ")}`;
				}
				cells.push({ cx, cy, content, engine, anchored: own.map((a) => a[1]), status, msg });
			}
		return { pieces, pieceOf, artPiece, floorPiece, gw, gh, T, cells, conflicts, floating };
	};

	// Largest y of a convex polygon over x in [x0, x1] (vertices inside, plus edge crossings of the bounds).
	function maxYIn(poly, x0, x1) {
		let best = -Infinity;
		for (let i = 0; i < poly.length; i++) {
			const p = poly[i], q = poly[(i + 1) % poly.length];
			if (p[0] >= x0 && p[0] <= x1) best = Math.max(best, p[1]);
			for (const x of [x0, x1])
				if ((p[0] - x) * (q[0] - x) < 0) best = Math.max(best, p[1] + ((x - p[0]) / (q[0] - p[0])) * (q[1] - p[1]));
		}
		return best;
	}

	// Distance between two convex polygons (0 if they overlap).
	function polyDist(a, b) {
		const inside = (p, poly) => {
			if (poly.length < 3) return false;
			let sign = 0;
			for (let i = 0; i < poly.length; i++) {
				const o = poly[i], n = poly[(i + 1) % poly.length], c = (n[0] - o[0]) * (p[1] - o[1]) - (n[1] - o[1]) * (p[0] - o[0]);
				if (Math.abs(c) < 1e-9) continue;
				if (sign && Math.sign(c) !== sign) return false;
				sign = Math.sign(c);
			}
			return true;
		};
		if (a.some((p) => inside(p, b)) || b.some((p) => inside(p, a))) return 0;
		const seg = (p, s, t) => {
			const dx = t[0] - s[0], dy = t[1] - s[1], l = dx * dx + dy * dy;
			const u = l ? Math.max(0, Math.min(1, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / l)) : 0;
			return Math.hypot(p[0] - s[0] - u * dx, p[1] - s[1] - u * dy);
		};
		let d = Infinity;
		for (const [P, Q] of [[a, b], [b, a]]) for (const p of P) for (let i = 0; i < Q.length; i++) d = Math.min(d, seg(p, Q[i], Q[(i + 1) % Q.length]));
		return d;
	}

	function hull(points) {
		const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
		if (pts.length < 3) return pts;
		const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
		const lower = [], upper = [];
		for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
		for (const p of pts.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
		return lower.slice(0, -1).concat(upper.slice(0, -1));
	}
})();
