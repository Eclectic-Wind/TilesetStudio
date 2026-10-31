// Process: renders the models through the tileset's projection (TS.Proj: oblique or isometric) into per-pixel surface data, then
// the maps the lighting engine reads. A canvas pixel shows a line of world points (oblique: (x, y + t, t)); its surface is the
// nearest point of any model on that line (largest proj.depth). Because the projection is parallel, depth, height and normals
// interpolate linearly across a triangle on screen. Height is always Z (px above the floor), whatever the projection.
//
// Outputs (all canvas-sized, transparent where the art is):
//   <name>_height.png  R = height px / 255 (G, B = R, or the engine's packed highlights: G strength, B gloss, from roughness)
//   <name>_normal.png  OpenGL sprite normal map: R = east, G = up (a top), B = toward the viewer (south, an upright front);
//                      isometric: screen space, R = screen right, G = screen up, B = toward the viewer (proj.toMapNormal)
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
		const W = art.w, H = art.h, N = W * H, proj = TS.Proj.of(settings, art);
		const height = new Float32Array(N).fill(NaN);
		const depth = new Float32Array(N);
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
					rasterTri(proj, p, n, (idx, z, d, nx, ny, nz) => {
						if (!(d > depth[idx]) && !isNaN(height[idx])) return;
						height[idx] = z; depth[idx] = d;
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
		const floor = P.floorField(objects, W, H, P.bodyRule(settings), proj);
		const roles = P.roles(objects, floor, settings);
		const collision = P.collision(objects, floor, settings, roles);
		return { w: W, h: H, proj, height, normal, rough, metal, owner, alpha, hole, clipped, floor, roles, collision, art,
			stats: { covered, holes, filled, unfilled: holes - filled, unused, over } };
	};

	// A typed array twice the size, with the same contents.
	const grown = (a) => { const out = new a.constructor(a.length * 2); out.set(a); return out; };

	// Scanline-free triangle raster over the canvas: calls put(index, z, depth, nx, ny, nz) per covered pixel centre (z = height,
	// depth = proj.depth: what decides the nearer surface). Screen point of a world point: proj.toCanvas. Back faces (seen from
	// behind) are skipped: on a closed model the surface seen along a line is always a front face. The signed screen area is
	// dot(face normal, proj.dir) up to a positive factor in both projections, so "area < 0" is exactly "faces away from proj.viewer".
	function rasterTri(proj, p, n, put, W, H) {
		const s0 = proj.toCanvas(p[0]), s1 = proj.toCanvas(p[1]), s2 = proj.toCanvas(p[2]);
		const ax = s0[0], ay = s0[1], bx = s1[0], by = s1[1], cx = s2[0], cy = s2[1];
		const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
		if (Math.abs(area) < 1e-9) return;
		// Faces facing the viewer come out with a positive signed area here (screen y down); skip the rest.
		if (area < 0) return;
		const d0 = proj.depth(p[0]), d1 = proj.depth(p[1]), d2 = proj.depth(p[2]);
		const z0 = p[0][2], z1 = p[1][2], z2 = p[2][2], n0 = n[0], n1 = n[1], n2 = n[2];
		const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
		const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
		const inv = 1 / area, eps = 1e-6;
		// Runs per covered pixel, millions of times a process: plain numbers only, no arrays.
		for (let y = y0; y <= y1; y++)
			for (let x = x0; x <= x1; x++) {
				const px = x + 0.5, py = y + 0.5;
				const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv;
				const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv;
				const w2 = 1 - w0 - w1;
				if (w0 < -eps || w1 < -eps || w2 < -eps) continue;
				const z = w0 * z0 + w1 * z1 + w2 * z2, d = w0 * d0 + w1 * d1 + w2 * d2;
				const nx = w0 * n0[0] + w1 * n1[0] + w2 * n2[0], ny = w0 * n0[1] + w1 * n1[1] + w2 * n2[1], nz = w0 * n0[2] + w1 * n1[2] + w2 * n2[2], l = Math.hypot(nx, ny, nz);
				if (l > 1e-12) put(y * W + x, z, d, nx / l, ny / l, nz / l);
				else put(y * W + x, z, d, 0, 0, 0);
			}
	}

	// Floor-plan heightfield: per floor point, the highest (top) and lowest (bottom) model height above it, and the solid spans
	// in between: each model's surfaces crossing that point pair up into the heights it fills (entering, leaving), so a gap
	// between two stacked parts (a cart's shelves, a top over a lower part) stays open to light. A floor point can be south of
	// the canvas (things drawn near the bottom stand further south), so it has H + 256 rows. The plan is world XY whatever the
	// projection, W wide; in isometric the models can stand anywhere the canvas can show, so its rows come from the models' south edge.
	// rule {step, body}: blocks[model index] lists the floor points where that model's own spans reach into [step, body] (the
	// player's body), the floor it blocks in footprint collision mode.
	//
	// The spans and pairs live in flat arrays, not one array per floor point (millions of those are what made this slow):
	// the spans of point i are spanData[spanStart[i]] .. spanData[spanStart[i + 1] - 1], as bottom, top, bottom, top...; its pairs
	// (the spans before they merge, with the model that made each: the engine's per-piece maps read these) are pairA / pairB /
	// pairObj [pairStart[i]] .. [pairStart[i + 1] - 1].
	P.floorField = (objects, W, H, rule = P.bodyRule(), proj = TS.Proj.OBLIQUE) => {
		let rows = H + 256;
		if (proj.kind !== "oblique") {
			let south = 0;
			for (const obj of objects) if (obj.faces.length) for (const v of obj.verts) if (v[1] > south) south = v[1];
			rows = Math.max(H, Math.min(4096, Math.ceil(south) + 16));
		}
		const N = W * rows, top = new Float32Array(N).fill(-1), bottom = new Float32Array(N).fill(1e9);
		const blocks = [], owner = new Int32Array(N).fill(-1);
		// covers[model index] = the floor points its footprint covers (flat indices).
		const covers = [];
		// heights[model index] = {min, max}: lowest underside and highest top of the model's own solid spans (null: none on the plan).
		const heights = [];
		let used = H;
		// One model's crossings: slot[floor point] = its place in keys (first seen first), each with a linked list through crossZ / crossNext.
		const slot = new Int32Array(N).fill(-1);
		let keys = new Int32Array(1024), heads = new Int32Array(1024), blocking = new Int32Array(1024), crossZ = new Float64Array(4096), crossNext = new Int32Array(4096);
		// Every model's solid spans before they merge, in model order: floor point, bottom, top, model index.
		let recI = new Int32Array(65536), recA = new Float64Array(65536), recB = new Float64Array(65536), recO = new Int32Array(65536), nRec = 0;
		const pairStart = new Int32Array(N + 1), zs = [];
		for (let oi = 0; oi < objects.length; oi++) {
			const obj = objects[oi];
			let hMin = Infinity, hMax = -Infinity, nKeys = 0, nCross = 0, nBlock = 0;
			for (const t of Mesh.triangles(obj)) {
				const a = obj.verts[t.a], b = obj.verts[t.b], c = obj.verts[t.c];
				const ax = a[0], ay = a[1], bx = b[0], by = b[1], cx = c[0], cy = c[1], az = a[2], bz = b[2], cz = c[2];
				const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
				if (Math.abs(area) < 1e-9) continue;
				const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
				const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(rows - 1, Math.ceil(Math.max(ay, by, cy)));
				const inv = 1 / area;
				for (let y = y0; y <= y1; y++)
					for (let x = x0; x <= x1; x++) {
						const px = x + 0.5, py = y + 0.5;
						const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv;
						const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv;
						const w2 = 1 - w0 - w1;
						if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
						const z = w0 * az + w1 * bz + w2 * cz, i = y * W + x;
						if (z > top[i]) { top[i] = z; owner[i] = oi; }
						if (z < bottom[i]) bottom[i] = z;
						if (y >= used) used = y + 1;
						let s = slot[i];
						if (s < 0) {
							if (nKeys === keys.length) { keys = grown(keys); heads = grown(heads); blocking = grown(blocking); }
							s = slot[i] = nKeys++;
							keys[s] = i; heads[s] = -1;
						}
						if (nCross === crossZ.length) { crossZ = grown(crossZ); crossNext = grown(crossNext); }
						crossZ[nCross] = z; crossNext[nCross] = heads[s]; heads[s] = nCross++;
					}
			}
			covers.push(keys.slice(0, nKeys));
			// Pair the crossings into filled spans. Two triangles sharing an edge both report a point on it: drop near-duplicates.
			for (let s = 0; s < nKeys; s++) {
				const i = keys[s];
				slot[i] = -1;
				let nz = 0;
				for (let c = heads[s]; c >= 0; c = crossNext[c]) {
					const z = crossZ[c];
					let at = nz++;
					while (at > 0 && zs[at - 1] > z) { zs[at] = zs[at - 1]; at--; }
					zs[at] = z;
				}
				let nClean = 1;
				for (let k = 1; k < nz; k++) if (zs[k] - zs[nClean - 1] > 0.05) zs[nClean++] = zs[k];
				// Height range from the real crossings, not the spans: a lone last crossing (touching parts of one model) gets an
				// invented 0.5 px span below, which must not raise heightMax.
				if (zs[0] < hMin) hMin = zs[0];
				if (zs[nClean - 1] > hMax) hMax = zs[nClean - 1];
				let hit = false;
				for (let k = 0; k < nClean; k += 2) {
					const a = zs[k], b = k + 1 < nClean ? zs[k + 1] : zs[k] + 0.5;
					if (nRec === recI.length) { recI = grown(recI); recA = grown(recA); recB = grown(recB); recO = grown(recO); }
					recI[nRec] = i; recA[nRec] = a; recB[nRec] = b; recO[nRec++] = oi;
					pairStart[i + 1]++;
					if (a < rule.body && b > rule.step) hit = true;
				}
				if (hit) blocking[nBlock++] = i;
			}
			blocks.push(blocking.slice(0, nBlock));
			heights.push(hMin <= hMax ? { min: Math.max(0, hMin), max: hMax } : null);
		}
		for (let i = 0; i < N; i++) pairStart[i + 1] += pairStart[i];
		const pairA = new Float64Array(nRec), pairB = new Float64Array(nRec), pairObj = new Int32Array(nRec), next = pairStart.slice(0, N);
		for (let q = 0; q < nRec; q++) { const j = next[recI[q]]++; pairA[j] = recA[q]; pairB[j] = recB[q]; pairObj[j] = recO[q]; }
		// Different models' spans that touch or overlap (a pillow on a mattress) are one solid; only real gaps stay open.
		const spanStart = new Int32Array(N + 1), spanData = new Float64Array(nRec * 2);
		let nSpan = 0;
		for (let i = 0; i < N; i++) {
			const p0 = pairStart[i], p1 = pairStart[i + 1];
			spanStart[i] = nSpan;
			if (p1 === p0) continue;
			if (p1 - p0 === 1) { spanData[nSpan++] = pairA[p0]; spanData[nSpan++] = pairB[p0]; continue; }
			const list = [];
			for (let j = p0; j < p1; j++) list.push([pairA[j], pairB[j]]);
			list.sort((a, b) => a[0] - b[0]);
			let lo = list[0][0], hi = list[0][1];
			for (let k = 1; k < list.length; k++) {
				if (list[k][0] <= hi + 0.5) hi = Math.max(hi, list[k][1]);
				else { spanData[nSpan++] = lo; spanData[nSpan++] = hi; lo = list[k][0]; hi = list[k][1]; }
			}
			spanData[nSpan++] = lo; spanData[nSpan++] = hi;
		}
		spanStart[N] = nSpan;
		return { top, bottom, spanStart, spanData: spanData.subarray(0, nSpan), blocks, heights, owner, pairStart, pairA, pairB, pairObj, covers, rows, shown: Math.min(rows, used + 8) };
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
	// Kinds (bundle version 4): floor (walked over: flat ground art), wall_h (horizontal wall, runs east-west: casts shadow, the torch
	// beam lands on it, fades while the player is behind it), wall_v (vertical wall, runs north-south: casts shadow, blocks light east
	// / west, never fades), furn (anything else that stands: furniture, props, pillars; casts shadow, y-sorted at its base line).
	// Inferred when the artist set nothing: flat -> floor; else tall (heightMax >= wallHeight) and thin (the shorter side of its floor
	// box <= wallThickness) -> wall_h if its east-west extent >= its north-south extent, else wall_v; else furn.
	P.KINDS = ["floor", "wall_h", "wall_v", "furn"];
	P.walkOver = (settings = {}) => settings.walkOverHeight ?? 2;
	P.wallHeight = (settings = {}) => settings.wallHeight ?? 48;
	P.wallThickness = (settings = {}) => settings.wallThickness ?? 24;
	P.defaultSettings = () => ({ projection: "oblique", isoTilt: 26, alphaCut: 13, fill: 2, relief: 0.5, cavity: 1, packHighlights: true, body: 40, step: 4, walkOverHeight: 2, wallHeight: 48, wallThickness: 24 });

	// Kinds that are no longer valid map on every load: deco and solid -> furn, wall -> wall_h, side -> wall_v (the old names of the
	// same things, from versions 1-3 and from projects saved before furn existed). Mutates the objects; -> how many changed.
	const OLD_KINDS = new Map([["wall", "wall_h"], ["side", "wall_v"], ["solid", "furn"], ["deco", "furn"]]);
	P.migrateKinds = (objects) => {
		let changed = 0;
		for (const o of objects) if (OLD_KINDS.has(o.kind)) { o.kind = OLD_KINDS.get(o.kind); changed++; }
		return changed;
	};
	// Per model index: {heightMin, heightMax (floor-space px above the floor; 0/0 when it has no surface on the plan), flat,
	// kindInferred, kind, kindOverridden, requested, mode (resolved collision), hull (floor plan convex hull)}.
	// auto -> "footprint" (a model nothing of which reaches the step blocks no floor, so it yields no polygon). An explicit
	// strip / footprint / none is always honoured.
	P.roles = (objects, floor, settings) => {
		const walk = P.walkOver(settings), wallH = P.wallHeight(settings), wallT = P.wallThickness(settings);
		return objects.map((o, oi) => {
			const h = floor.heights[oi], heightMin = h ? round2(h.min) : 0, heightMax = h ? round2(h.max) : 0;
			const flat = !!h && heightMax <= walk;
			const vi = o.faces.length ? Mesh.faceVerts(o) : [];
			// The model's floor box: its east-west and north-south extents.
			const ew = span(vi.map((i) => o.verts[i][0])), ns = span(vi.map((i) => o.verts[i][1]));
			const kindInferred = flat ? "floor" : h && heightMax >= wallH && Math.min(ew, ns) <= wallT ? (ew >= ns ? "wall_h" : "wall_v") : "furn";
			const kindOverridden = P.KINDS.includes(o.kind);
			const requested = P.collisionRequested(o);
			const mode = requested !== "auto" ? requested : "footprint";
			return { heightMin, heightMax, flat, kindInferred, kind: kindOverridden ? o.kind : kindInferred, kindOverridden, requested, mode,
				hull: hull(vi.map((i) => [o.verts[i][0], o.verts[i][1]])) };
		});
	};
	const span = (list) => (list.length ? list.reduce((m, v) => Math.max(m, v), -Infinity) - list.reduce((m, v) => Math.min(m, v), Infinity) : 0);

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

	// The world normal (east, south, up) of art pixel i with the relief bump and the depth rim: relief and cavity work in world space
	// (their tangents come from the projection), and the map vector is made from the result.
	P.worldNormal = (r, i, settings) => {
		let n = [r.normal[i * 3], r.normal[i * 3 + 1], r.normal[i * 3 + 2]];
		const proj = r.proj || TS.Proj.of(settings, r.art);
		if (settings.relief > 0) n = relief(proj, r, i, n, settings.relief);
		if (settings.cavity > 0) n = cavity(proj, r, i, n, settings.cavity);
		return n;
	};
	// The exported normal-map vector: world (east, south, up) -> map [right, up, toward the viewer] by the projection
	// (oblique: (east, up, south); isometric: screen space).
	P.mapNormal = (r, i, settings) => (r.proj || TS.Proj.of(settings, r.art)).toMapNormal(P.worldNormal(r, i, settings));

	// The world normals (east, south, up) with the relief bump, per art pixel: what the Lit view shades with, so it matches the map.
	// prev (optional): {result, normals, relief, cavity} from the last call. Only pixels near a change are worked out again.
	P.litNormals = (r, settings, prev) => {
		const N = r.w * r.h, dirty = prev ? litDirty(r, settings, prev) : null, out = dirty ? prev.normals.slice() : new Float32Array(N * 3);
		for (let i = 0; i < N; i++) {
			if (dirty && !dirty[i]) continue;
			if (isNaN(r.height[i])) { out[i * 3] = 0; out[i * 3 + 1] = 0; out[i * 3 + 2] = 1; continue; }
			const n = P.worldNormal(r, i, settings);
			out[i * 3] = n[0]; out[i * 3 + 1] = n[1]; out[i * 3 + 2] = n[2];
		}
		return out;
	};
	// The art pixels whose lit normal can differ from prev's (relief reads 1 px round a pixel, cavity CAVITY_REACH), or null to do them all.
	function litDirty(r, settings, prev) {
		const q = prev.result, W = r.w, H = r.h, N = W * H;
		if (q.art !== r.art || prev.relief !== settings.relief || prev.cavity !== settings.cavity || !q.proj || !r.proj || q.proj.kind !== r.proj.kind || String(q.proj.matrix) !== String(r.proj.matrix)) return null;
		const R = CAVITY_REACH, dirty = new Uint8Array(N), limit = N >> 4;
		let changed = 0;
		for (let i = 0; i < N; i++) {
			const a = r.height[i], b = q.height[i];
			if ((a === b || (a !== a && b !== b)) && r.owner[i] === q.owner[i] && r.normal[i * 3] === q.normal[i * 3] && r.normal[i * 3 + 1] === q.normal[i * 3 + 1] && r.normal[i * 3 + 2] === q.normal[i * 3 + 2]) continue;
			if (++changed > limit) return null; // too much moved for this to save anything
			const x = i % W, y = (i / W) | 0, x0 = Math.max(0, x - R), x1 = Math.min(W - 1, x + R), y0 = Math.max(0, y - R), y1 = Math.min(H - 1, y + R);
			for (let v = y0; v <= y1; v++) dirty.fill(1, v * W + x0, v * W + x1 + 1);
		}
		return dirty;
	}

	// Unit world vectors in the surface's tangent plane (normal n) that draw as canvas right and canvas up, or null when the surface
	// is edge-on. The oblique relief and rim keep their own tangents (below); this is the same idea taken from the projection.
	function tangents(proj, n) {
		const nd = v3.dot(n, proj.dir);
		if (Math.abs(nd) < 1e-6) return null;
		const lift = (sx, sy) => { const a = proj.toWorld(0, 0, 0), b = proj.toWorld(sx, sy, 0); return [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; };
		const along = (e) => v3.norm(v3.sub(e, v3.scale(proj.dir, v3.dot(n, e) / nd)));
		return { u: along(lift(1, 0)), v: along(lift(0, -1)) };
	}

	// The art's shading as a little bump, within one surface (same model, similar normal), clamped.
	function relief(proj, r, i, n, strength) {
		const W = r.w, x = i % W, y = (i / W) | 0, d = r.art.data;
		const lum = (q) => (d[q * 4] * 0.3 + d[q * 4 + 1] * 0.59 + d[q * 4 + 2] * 0.11) / 255;
		const same = (q) => q >= 0 && q < W * r.h && !isNaN(r.height[q]) && r.owner[q] === r.owner[i] &&
			r.normal[q * 3] * n[0] + r.normal[q * 3 + 1] * n[1] + r.normal[q * 3 + 2] * n[2] > 0.7 && r.alpha[q] > 0;
		const l = lum(i);
		const at = (dx, dy) => { const qx = x + dx, qy = y + dy; if (qx < 0 || qy < 0 || qx >= W || qy >= r.h) return l; const q = qy * W + qx; return same(q) ? lum(q) : l; };
		const gx = TS.clamp((at(1, 0) - at(-1, 0)) * 0.5 * strength, -0.2, 0.2), gy = TS.clamp((at(0, 1) - at(0, -1)) * 0.5 * strength, -0.2, 0.2);
		if (proj.kind !== "oblique") {
			// Brighter = higher: the normal leans away from the brighter side, along the screen's right and up on this surface.
			const t = tangents(proj, n);
			return t ? v3.norm(v3.add(v3.sub(n, v3.scale(t.u, gx)), v3.scale(t.v, gy))) : n;
		}
		const top = Math.abs(n[2]) >= 0.7;
		// Along the surface: u to the right, v up the screen.
		const u = top ? [1, 0, 0] : v3.norm([-n[1], n[0], 0]);
		const v = top ? [0, -1, 0] : [0, 0, 1];
		return v3.norm(v3.add(v3.sub(n, v3.scale(u, gx)), v3.scale(v, gy)));
	}

	// Depth as a rim: a pixel within a few px of a wall that stands well above its own surface (a drawer let into a front, a
	// pit in a top) tilts away from it, by how deep the step is. A recess floor faces the same way as the face round it, so
	// without this the normal map shows no depth there (the height map holds it).
	const CAVITY_REACH = 4, CAVITY_STEP = 2, CAVITY_DEEP = 12;
	function cavity(proj, r, i, n, strength) {
		const W = r.w, x = i % W, y = (i / W) | 0, h = r.height[i], oblique = proj.kind === "oblique", run = oblique ? n[1] + n[2] : v3.dot(n, proj.viewer);
		if (run < (oblique ? 0.2 : 0.14)) return n;
		const tan = oblique ? null : tangents(proj, n);
		if (!oblique && !tan) return n;
		let tx = 0, ty = 0;
		for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
			for (let k = 1; k <= CAVITY_REACH; k++) {
				const qx = x + dx * k, qy = y + dy * k;
				if (qx < 0 || qy < 0 || qx >= W || qy >= r.h) break;
				const hq = r.height[qy * W + qx];
				if (isNaN(hq)) break;
				// What the height would be if the surface just ran on to q, against what is there.
				const excess = oblique ? hq - h + (n[0] * dx + n[1] * dy) * k / run : hq - h - expectedRise(proj, n, dx * k, dy * k);
				if (excess < CAVITY_STEP) continue;
				const w = Math.min(excess / CAVITY_DEEP, 1) * (1 - (k - 1) / CAVITY_REACH);
				tx -= dx * w; ty -= dy * w;
				break;
			}
		if (!tx && !ty) return n;
		const top = Math.abs(n[2]) >= 0.7, s = 0.5 * strength;
		const u = tan ? tan.u : top ? [1, 0, 0] : v3.norm([-n[1], n[0], 0]);
		const v = tan ? tan.v : top ? [0, -1, 0] : [0, 0, 1];
		return v3.norm(v3.add(v3.add(n, v3.scale(u, TS.clamp(tx * s, -0.8, 0.8))), v3.scale(v, TS.clamp(-ty * s, -0.8, 0.8))));
	}

	// How much higher (Z) a surface with normal n gets when it runs on over canvas (dx, dy) px from where it is: the point of the
	// plane that draws there, found along the view line.
	function expectedRise(proj, n, dx, dy) {
		const a = proj.toWorld(0, 0, 0), b = proj.toWorld(dx, dy, 0), e = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
		return (-v3.dot(n, e) / v3.dot(n, proj.dir)) * proj.dir[2];
	}

	// ImageData for each map.
	P.images = (r, settings) => {
		const W = r.w, H = r.h, mk = () => new ImageData(W, H);
		const hgt = mk(), nrm = mk(), pbr = mk(), flat = (r.proj || TS.Proj.of(settings, r.art)).toMapNormal([0, 0, 1]);
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
			const n = has ? P.mapNormal(r, i, settings) : flat;
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
	// Version 4: where a floor point's spans belong to different pieces, the gap is instead the boundary between the topmost piece's
	// lowest run and the run under it, whatever its size (0 px: touching, so B = A + 1). Each half of the point then belongs to one piece.
	// The engine builds its heightfield from the floor part exactly instead of guessing it from the art.
	//
	// maps.pieces (version 4) is the same W x (H + rows) grid, RGBA8 too, of 16-bit piece numbers (lo, hi bytes; 0 = no piece; a
	// piece's number is its place in footprints.pieces + 1):
	//   rows 0..H-1 (art space)   R, G = the piece of the art pixel's owner (hole-filled pixels included); B, A = 0.
	//   rows H..H+rows-1 (floor)  R, G = the piece of the run above the gap (the top piece when there is no gap); B, A = the piece of the
	//                             run below the gap (the same as R, G when there is no gap).
	const MIN_GAP = 3;
	P.maps = (r, settings) => {
		const W = r.w, H = r.h, floor = r.floor, rows = floor.shown, pm = r.pieceMap, cut = settings.alphaCut;
		if (!pm) throw new Error("P.maps needs r.pieceMap (P.pieces)");
		const flat = (r.proj || TS.Proj.of(settings, r.art)).toMapNormal([0, 0, 1]);
		const data = new Uint8Array(W * (H + rows) * 4), pieces = new Uint8Array(W * (H + rows) * 4);
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
		// Piece number of a model (0 = none), 16-bit into two bytes.
		const pieceOf = (oi) => (oi >= 0 && pm.pieceOf[oi] >= 0 ? pm.pieceOf[oi] + 1 : 0);
		const put16 = (o, n) => { pieces[o] = n & 255; pieces[o + 1] = n >> 8; };
		for (let i = 0; i < W * H; i++) {
			if (r.alpha[i] <= cut) continue;
			const has = !isNaN(r.height[i]), o = i * 4;
			const n = has ? P.mapNormal(r, i, settings) : flat;
			data[o] = has ? TS.clamp(Math.round(r.height[i]), 0, 255) : 0;
			data[o + 1] = Math.round(TS.clamp(n[0] * 0.5 + 0.5, 0, 1) * 255);
			data[o + 2] = Math.round(TS.clamp(n[1] * 0.5 + 0.5, 0, 1) * 255);
			data[o + 3] = material(has ? r.rough[i] : 1, has ? r.metal[i] : 0) + 1;
			put16(o, pieceOf(r.owner[i]));
		}
		const byte = (v) => TS.clamp(Math.round(v), 0, 255);
		let gaps = 0;
		for (let k = 0; k < W * rows; k++) {
			if (floor.top[k] < 0) continue;
			const o = (W * H + k) * 4;
			// The solid runs here, bottom to top. Crossings merge into one run while they touch (within 0.5 px) and belong to one piece;
			// a run is {a, b, piece}: its bottom, top and piece.
			const prs = [], runs = [];
			for (let j = floor.pairStart[k]; j < floor.pairStart[k + 1]; j++) prs.push([floor.pairA[j], floor.pairB[j], floor.pairObj[j]]);
			prs.sort((p, q) => p[0] - q[0]);
			for (const [a, b, oi] of prs) {
				const piece = pieceOf(oi), last = runs[runs.length - 1];
				if (last && last.piece === piece && a <= last.b + 0.5) last.b = Math.max(last.b, b);
				else runs.push({ a, b, piece });
			}
			let under = floor.bottom[k], top = floor.top[k], topPiece = pieceOf(floor.owner[k]);
			let lo = -1, hi = 0, upper = topPiece, lower = topPiece;
			if (runs.length) {
				under = runs[0].a; top = runs[runs.length - 1].b; topPiece = runs[runs.length - 1].piece;
				upper = lower = topPiece;
				// The topmost piece's lowest run and the run under it: that boundary is the gap, whatever its size.
				const j = runs.findIndex((run) => run.piece === topPiece);
				if (j > 0) { lo = runs[j - 1].b; hi = Math.max(lo, runs[j].a); lower = runs[j - 1].piece; upper = runs[j].piece; }
				else {
					// Otherwise the tallest gap, as before.
					let best = MIN_GAP;
					for (let q = 0; q + 1 < runs.length; q++) {
						const gap = runs[q + 1].a - runs[q].b;
						if (gap >= best) { best = gap; lo = runs[q].b; hi = runs[q + 1].a; lower = runs[q].piece; upper = runs[q + 1].piece; }
					}
				}
			}
			data[o] = byte(top) + 1 > 255 ? 255 : byte(top) + 1;
			data[o + 1] = byte(under);
			if (lo >= 0) { data[o + 2] = Math.min(255, byte(lo) + 1); data[o + 3] = byte(hi); gaps++; }
			put16(o, upper); put16(o + 2, lower);
		}
		return { w: W, h: H, rows, materials, highlights: !!settings.packHighlights, data, pieces, gaps };
	};

	// Version 2 adds each model's `collision` ({mode, polygons}) and the rule it was made with; the version 1 fields stay, so an
	// older importer still reads it (as strips). Pass the processed result to reuse its collision (else it is computed here).
	//
	// Bundle version 3 adds, per model (all additive): kind, kindInferred, heightMin, heightMax, flat, tags, piece, cells, and
	// collision.requested (collision.mode is now the RESOLVED mode); plus walkOverHeight, cellOwners and clashes at this level. The
	// shape of version 2 (name, solid, z, footprint, roughness, metallic, collision.mode / polygons) is unchanged. The index of a
	// model in `objects` below is what cells / cellOwners / clashes refer to.
	//
	// Bundle version 4 (see addons/studio_import/BUNDLE_V4.md) adds: wallHeight / wallThickness (here and at the top level), per model
	// pieceIndex (its piece's number, 1-based) and outline (its exact floor outline), and footprints.pieces, the piece table: one entry
	// per piece, in order, its number being its position + 1. The kinds are now floor, wall_h, wall_v and furn.
	P.footprints = (objects, art, result, settings) => {
		const rule = P.bodyRule(settings);
		const r = result && result.roles && result.roles.length === objects.length ? result : P.run(objects, art, settings);
		const pm = r.pieceMap || (r.pieceMap = P.pieces(objects, r, settings));
		const col = r.collision, roles = r.roles;
		// Export index of each model (loose lines / points are left out below, so indices shift).
		const exported = objects.map((o, oi) => oi).filter((oi) => objects[oi].faces.length);
		const idx = new Map(exported.map((oi, k) => [oi, k]));
		const own = P.cellOwnership(objects, r, settings);
		const bounds = (oi) => Mesh.bounds(objects[oi], Mesh.faceVerts(objects[oi]));
		return {
			version: 2,
			walkOverHeight: P.walkOver(settings),
			wallHeight: P.wallHeight(settings),
			wallThickness: P.wallThickness(settings),
			canvas: [art.w, art.h],
			tile: 32,
			note: "World px: X east, Y south (floor plan), Z up; drawn at canvas " + (r.proj && r.proj.kind === "iso" ? "(ox + X - Y, oy + sin(" + r.proj.tilt + " deg) * (X + Y) - Z), isometric " + r.proj.tilt + " deg tilt. " : "(X, Y - Z). ") + "footprint = convex hull on the floor plan; outline = the exact " +
				"floor outline (a traced mask, not a hull). collision.mode: strip = the importer's 4 px strip along the footprint's south edge; footprint = collision.polygons (floor px) " +
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
					pieceIndex: pm.pieceOf[oi] + 1,
					outline: outlineOf(r.floor.covers[oi], r.w),
				};
			}),
			// The piece table: the models of each piece, its kind (the strongest of its models'), its height, the floor rows its footprint
			// spans (base = the south edge, its sort line; back = the north edge), its exact outline and the atlas cells it occupies.
			pieces: pm.pieces.map((p) => {
				const KIND_RANK = { floor: 0, furn: 1, wall_v: 2, wall_h: 3 };
				const floorPoints = new Set(), cells = new Map(), zs = [];
				let kind = "floor";
				for (const oi of p.objs) {
					for (const i of r.floor.covers[oi]) floorPoints.add(i);
					for (const c of own.cells[oi]) cells.set(c[0] + "," + c[1], c);
					const b = bounds(oi);
					zs.push(b.min[2], b.max[2]);
					if (KIND_RANK[roles[oi].kind] > KIND_RANK[kind]) kind = roles[oi].kind;
				}
				const rowsOf = [...floorPoints].map((i) => (i / r.w) | 0);
				return {
					names: p.names, models: p.objs.map((oi) => idx.get(oi)), kind,
					z: [round2(Math.min(...zs)), round2(Math.max(...zs))],
					base: rowsOf.length ? Math.max(...rowsOf) : 0, back: rowsOf.length ? Math.min(...rowsOf) : 0,
					outline: outlineOf([...floorPoints], r.w), cells: [...cells.values()],
				};
			}),
			// Every occupied atlas cell and the models in it, then the cells two or more models share (one entry per pair).
			cellOwners: own.owners.map((e) => ({ cell: e.cell, models: e.models.map((oi) => idx.get(oi)) })),
			clashes: own.clashes.map((e) => ({ cell: e.cell, models: e.models.map((oi) => idx.get(oi)), samePiece: e.samePiece })),
		};
	};

	// The exact outline of a set of floor points (flat indices into a grid W wide): the traced (P.trace) mask of them, in floor-plan px.
	function outlineOf(list, W) {
		if (!list || !list.length) return [];
		let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
		for (const i of list) { const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
		const w = x1 - x0 + 1, h = y1 - y0 + 1, mask = new Uint8Array(w * h);
		for (const i of list) mask[(((i / W) | 0) - y0) * w + (i % W - x0)] = 1;
		return P.trace(mask, w, h).map((poly) => poly.map(([x, y]) => [x + x0, y + y0]));
	}

	// Which atlas tile cells (32 px; [column, row]) each model occupies: the cells holding art it paints (its pixels on top at that
	// spot) or floor points it tops. The same sampling P.pieces uses for a piece's content, per model instead of per piece. Floor
	// points south of the canvas aren't atlas cells and are left out. Indices are into `objects`.
	// -> {cells: [[x, y], ...] per object index, owners: [{cell, models}], clashes: [{cell, models: [i, j], samePiece}]}
	// samePiece: the two models are one piece to the importer (footprints within 2 px), so it reads the cell consistently; false
	// is the dangerous kind. P.clashes (pieces on different rows of one column) is a separate check.
	P.cellOwnership = (objects, r, settings) => {
		const T = 32, W = r.w, H = r.h, gw = Math.ceil(W / T), gh = Math.ceil(H / T), cut = settings.alphaCut, proj = r.proj || TS.Proj.of(settings, r.art);
		const grid = new Array(gw * gh), put = (x, y, oi) => { const c = (y >> 5) * gw + (x >> 5); (grid[c] || (grid[c] = new Set())).add(oi); };
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				const i = y * W + x;
				if (r.alpha[i] > cut && r.owner[i] >= 0) put(x, y, r.owner[i]);
				if (proj.kind === "oblique" && r.floor.top[i] >= 0 && r.floor.owner[i] >= 0) put(x, y, r.floor.owner[i]);
			}
		if (proj.kind !== "oblique")
			for (let k = 0; k < r.floor.top.length; k++) {
				if (!(r.floor.top[k] >= 0 && r.floor.owner[k] >= 0)) continue;
				const c = proj.toCanvas([(k % W) + 0.5, ((k / W) | 0) + 0.5, 0]);
				if (c[0] >= 0 && c[1] >= 0 && c[0] < W && c[1] < H) put(Math.floor(c[0]), Math.floor(c[1]), r.floor.owner[k]);
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
		const T = 32, JOIN = 2, W = r.w, H = r.h, rows = r.floor.shown, cut = settings.alphaCut, proj = r.proj || TS.Proj.of(settings, r.art);
		const items = [];
		objects.forEach((o, oi) => {
			if (!o.faces.length) return;
			const vi = Mesh.faceVerts(o), b = Mesh.bounds(o, vi);
			items.push({ oi, o, hull: hull(vi.map((i) => [o.verts[i][0], o.verts[i][1]])), z0: b.min[2], z1: b.max[2] });
		});
		const root = items.map((_, i) => i), find = (k) => { while (root[k] !== k) k = root[k]; return k; };
		// A floor-kind model is always a piece of its own (it never joins, and its name doesn't group it). A model with a `piece` name
		// is placed by you: it joins every model with the same name (however far apart) and never joins by footprint; unnamed models
		// join each other by footprint as before.
		const solo = (it) => !!r.roles && !!r.roles[it.oi] && r.roles[it.oi].kind === "floor";
		const label = (it) => (typeof it.o.piece === "string" ? it.o.piece.trim() : "");
		const firstNamed = new Map();
		items.forEach((it, i) => { it.solo = solo(it); it.label = it.solo ? "" : label(it); if (it.label) { if (firstNamed.has(it.label)) root[find(i)] = find(firstNamed.get(it.label)); else firstNamed.set(it.label, i); } });
		// Every pair of models: the floor boxes rule out nearly all of them before the exact distance.
		for (const it of items) { it.x0 = Infinity; it.x1 = -Infinity; it.y0 = Infinity; it.y1 = -Infinity; for (const q of it.hull) { it.x0 = Math.min(it.x0, q[0]); it.x1 = Math.max(it.x1, q[0]); it.y0 = Math.min(it.y0, q[1]); it.y1 = Math.max(it.y1, q[1]); } }
		for (let a = 0; a < items.length; a++) {
			const A = items[a];
			if (A.label || A.solo) continue;
			for (let b = a + 1; b < items.length; b++) {
				const B = items[b];
				if (B.label || B.solo || A.x0 - B.x1 > JOIN || B.x0 - A.x1 > JOIN || A.y0 - B.y1 > JOIN || B.y0 - A.y1 > JOIN) continue;
				if (polyDist(A.hull, B.hull) <= JOIN) root[find(b)] = find(a);
			}
		}
		const groups = new Map();
		items.forEach((it, i) => { const k = find(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); });
		const pieceOf = new Int32Array(objects.length).fill(-1);
		const pieces = [...groups.values()].map((its, id) => {
			const cols = new Map(), names = its[0].label ? [its[0].label] : [...new Set(its.map((it) => it.o.name))];
			// Flat art: every model is kind floor (walked over), so the piece has no height, shadow or outline to anchor. It has no
			// anchor cells and its art / floor is never judged: it can't be misread, only drawn.
			const flat = !!r.roles && its.every((it) => r.roles[it.oi] && r.roles[it.oi].kind === "floor");
			let top = Infinity; // highest drawn row of the piece's art (its tops), for the column-clash check
			for (const it of its) for (const q of it.hull) top = Math.min(top, proj.toCanvas([q[0], q[1], it.z1])[1]);
			for (const it of its) {
				pieceOf[it.oi] = id;
				if (flat) continue;
				// The footprint's outline at the model's underside, as drawn: its lowest row per tile column anchors the piece.
				const base = it.hull.map((q) => proj.toCanvas([q[0], q[1], it.z0]));
				const xs = base.map((q) => q[0]), x0 = Math.min(...xs), x1 = Math.max(...xs);
				for (let cx = Math.floor(x0 / T); cx * T < x1; cx++) {
					const y = maxYIn(base, Math.max(x0, cx * T), Math.min(x1, cx * T + T));
					if (!isFinite(y)) continue;
					cols.set(cx, Math.max(cols.has(cx) ? cols.get(cx) : -Infinity, Math.floor((y - 0.01) / T)));
				}
			}
			return { id, names, objs: its.map((it) => it.oi), cols, top: Math.floor(top / T), flat };
		});
		const artPiece = new Int16Array(W * H).fill(-1), floorPiece = new Int16Array(W * rows).fill(-1);
		for (let i = 0; i < W * H; i++) if (r.alpha[i] > cut && r.owner[i] >= 0) artPiece[i] = pieceOf[r.owner[i]];
		for (let k = 0; k < W * rows; k++) if (r.floor.top[k] >= 0 && r.floor.owner[k] >= 0) floorPiece[k] = pieceOf[r.floor.owner[k]];
		const gw = Math.ceil(W / T), gh = Math.ceil((proj.kind === "oblique" ? rows : H) / T), grid = new Array(gw * gh);
		let lastC = -1, lastP = -1; // runs of one piece in one cell, the usual case: only the first needs the Set
		const put = (x, y, p) => { const c = (y >> 5) * gw + (x >> 5); if (c === lastC && p === lastP) return; lastC = c; lastP = p; if (!pieces[p].flat) (grid[c] || (grid[c] = new Set())).add(p); };
		for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (artPiece[y * W + x] >= 0) put(x, y, artPiece[y * W + x]);
		// Floor points count only for a model standing on the floor (its underside no higher than the step). A raised one (a
		// tabletop, a rail) is drawn Y - height above its footprint, so its footprint lies a row below its art and anchor and would
		// read as another piece's cell; its collision is judged separately, not here.
		const groundStep = P.bodyRule(settings).step, grounded = (oi) => !r.roles || !r.roles[oi] || r.roles[oi].heightMin <= groundStep;
		// Floor points sit in the cell they are drawn in (oblique: their own coordinates; isometric: through the projection).
		for (let y = 0; y < rows; y++) for (let x = 0; x < W; x++) {
			if (!(floorPiece[y * W + x] >= 0 && grounded(r.floor.owner[y * W + x]))) continue;
			if (proj.kind === "oblique") { put(x, y, floorPiece[y * W + x]); continue; }
			const c = proj.toCanvas([x + 0.5, y + 0.5, 0]);
			if (c[0] >= 0 && c[1] >= 0 && c[0] < W && c[1] < gh * T) put(Math.floor(c[0]), Math.floor(c[1]), floorPiece[y * W + x]);
		}
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
