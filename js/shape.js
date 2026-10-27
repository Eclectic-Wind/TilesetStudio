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
	// Round each outline corner with a short quadratic arc; radius is clamped to adjacent edge lengths.
	Shape.roundCorners = (input, radius) => {
		const r = Number(radius);
		if (!Number.isFinite(r) || r < 0 || r > 128) throw new Error("Corner radius must be between 0 and 128 px.");
		const p = Shape.clean(input);
		if (r === 0 || p.length < 3) return p;
		const out = [];
		for (let i = 0; i < p.length; i++) {
			const a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length];
			const la = Math.hypot(a[0] - b[0], a[1] - b[1]), lc = Math.hypot(c[0] - b[0], c[1] - b[1]);
			const d = Math.min(r, la * 0.45, lc * 0.45);
			if (d < 0.01) { out.push(b.slice()); continue; }
			const start = [b[0] + (a[0] - b[0]) * d / la, b[1] + (a[1] - b[1]) * d / la];
			const end = [b[0] + (c[0] - b[0]) * d / lc, b[1] + (c[1] - b[1]) * d / lc];
			out.push(start);
			for (const t of [1 / 3, 2 / 3]) {
				const u = 1 - t;
				out.push([u * u * start[0] + 2 * u * t * b[0] + t * t * end[0], u * u * start[1] + 2 * u * t * b[1] + t * t * end[1]]);
			}
			out.push(end);
		}
		return Shape.clean(out);
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
		if (options.radius > 0) { p = Shape.roundCorners(p, options.radius); Shape.validate(p); }
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
	Shape.create3D = (input, options = {}) => {
		if (!Array.isArray(input) || !input.every((s) => s && Array.isArray(s.screen) && Array.isArray(s.point) && Array.isArray(s.normal) &&
			s.screen.length === 2 && s.point.length === 3 && s.normal.length === 3 && [...s.screen, ...s.point, ...s.normal].every(Number.isFinite)))
			throw new Error("The 3D outline contains an invalid point.");
		const key = (p) => `${p[0]},${p[1]}`;
		const byScreen = new Map(input.map((s) => [key(s.screen), s]));
		let outline = Shape.simplify(input.map((s) => s.screen), Math.max(0, Number(options.simplify) || 0));
		if (options.snap > 0) outline = Shape.clean(outline.map((q) => q.map((v) => TS.snap(v, options.snap))));
		Shape.validate(outline);
		if (options.radius > 0) { outline = Shape.roundCorners(outline, options.radius); Shape.validate(outline); }
		let samples = outline.map((p) => byScreen.get(key(p)) || input.reduce((best, s) =>
			Math.hypot(s.screen[0] - p[0], s.screen[1] - p[1]) < Math.hypot(best.screen[0] - p[0], best.screen[1] - p[1]) ? s : best, input[0]));
		if (Shape.area(outline) < 0) { outline.reverse(); samples.reverse(); }
		const thickness = Number(options.thickness ?? 8);
		if (!Number.isFinite(thickness) || thickness < 0 || thickness > 255) throw new Error("Thickness must be between 0 and 255 px.");
		const normals = samples.map((s) => TS.v3.norm(s.normal)), offset = thickness || 0.03;
		const front = samples.map((s, i) => TS.v3.add(s.point, TS.v3.scale(normals[i], offset))), frontSamples = samples.slice();
		const n = front.length, faces = [], indexByScreen = new Map(outline.map((p, i) => [key(p), i]));
		const getIndex = (screen, fallback) => {
			const k = key(screen), old = indexByScreen.get(k); if (old !== undefined) return old;
			const sample = typeof options.surfaceAt === "function" ? options.surfaceAt(screen) : null;
			const s = sample && sample.point && sample.normal ? sample : fallback;
			const i = front.length; indexByScreen.set(k, i); frontSamples.push(s);
			const normal = TS.v3.norm(s.normal); normals.push(normal); front.push(TS.v3.add(s.point, TS.v3.scale(normal, offset)));
			return i;
		};
		for (const baseTri of Shape.triangulate(outline)) {
			const [a, b, c] = baseTri.map((i) => outline[i]);
			const steps = typeof options.surfaceAt === "function" ? TS.clamp(Math.ceil(Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1]), Math.hypot(a[0] - c[0], a[1] - c[1])) / 48), 1, 6) : 1;
			const grid = [];
			for (let j = 0; j <= steps; j++) {
				grid[j] = [];
				for (let i = 0; i <= steps - j; i++) {
					const u = i / steps, v = j / steps, screen = [a[0] * (1 - u - v) + b[0] * u + c[0] * v, a[1] * (1 - u - v) + b[1] * u + c[1] * v];
					const fallback = { point: samples[baseTri[0]].point.map((x, k) => x * (1 - u - v) + samples[baseTri[1]].point[k] * u + samples[baseTri[2]].point[k] * v),
						normal: TS.v3.norm(samples[baseTri[0]].normal.map((x, k) => x * (1 - u - v) + samples[baseTri[1]].normal[k] * u + samples[baseTri[2]].normal[k] * v)) };
					grid[j][i] = getIndex(screen, fallback);
				}
			}
			const addTriangle = (ids) => {
				let face = ids.slice();
				const avg = TS.v3.norm(face.reduce((sum, i) => TS.v3.add(sum, normals[i]), [0, 0, 0]));
				const fn = TS.v3.norm(TS.v3.cross(TS.v3.sub(front[face[1]], front[face[0]]), TS.v3.sub(front[face[2]], front[face[0]])));
				if (TS.v3.dot(fn, avg) < 0) face.reverse();
				faces.push({ v: face });
			};
			for (let j = 0; j < steps; j++) for (let i = 0; i < steps - j; i++) {
				addTriangle([grid[j][i], grid[j][i + 1], grid[j + 1][i]]);
				if (i < steps - j - 1) addTriangle([grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]);
			}
		}
		const back = frontSamples.map((s) => s.point.slice()), frontCount = front.length;
		if (thickness > 0) {
			for (const f of faces.slice()) faces.push({ v: f.v.map((i) => i + frontCount).reverse() });
			for (let i = 0; i < n; i++) { const j = (i + 1) % n; faces.push({ v: [i + frontCount, j + frontCount, j, i] }); }
		}
		const obj = TS.Mesh.newObject("Custom shape", thickness > 0 ? [...front, ...back] : front, []);
		obj.faces = faces; obj.smooth = 0; obj.solid = thickness > 0; if (obj.solid) obj.collision = "footprint";
		const normal = TS.v3.len(normals.reduce((a, b) => TS.v3.add(a, b), [0, 0, 0])) > 1e-6 ? TS.v3.norm(normals.reduce((a, b) => TS.v3.add(a, b), [0, 0, 0])) : normals[0];
		let u = TS.v3.sub(front[1], front[0]);
		if (TS.v3.len(u) < 1e-6) u = TS.v3.cross(Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], normal);
		u = TS.v3.norm(u);
		obj.basis = [u, TS.v3.norm(TS.v3.cross(normal, u)), normal];
		return obj;
	};

	// A closed primitive loft; bevel belongs only to this generated mesh.
	Shape.primitive = (input, kind, height, bevel = 0) => {
		const xs=input.map(p=>p[0]), ys=input.map(p=>p[1]);
		const x0=Math.min(...xs), x1=Math.max(...xs), y0=Math.min(...ys), y1=Math.max(...ys);
		const rx=(x1-x0)/2, ry=(y1-y0)/2, cx=(x0+x1)/2, cy=(y0+y1)/2;
		if (!(rx>0.01 && ry>0.01 && height>0) || !Number.isFinite(height)) throw new Error("Drag a wider shape and set a positive height/depth.");
		if (!Number.isFinite(bevel) || bevel<0) throw new Error("Bevel must be non-negative.");
		if(kind==="sphere") return TS.Mesh.sphere([cx,cy,0],rx,ry,height/2,16,8);
		const b=Math.min(bevel,rx*.45,ry*.45,height*.45), verts=[],faces=[];
		const ring=(z,inset)=>{
			const X=rx-inset,Y=ry-inset;
			const pts=kind==="cylinder" ? Array.from({length:24},(_,i)=>[Math.cos(i*Math.PI/12)*X,Math.sin(i*Math.PI/12)*Y]) :
				(b>0 ? [[-X+b,-Y],[X-b,-Y],[X,-Y+b],[X,Y-b],[X-b,Y],[-X+b,Y],[-X,Y-b],[-X,-Y+b]] : [[-X,-Y],[X,-Y],[X,Y],[-X,Y]]);
			verts.push(...pts.map(([x,y])=>[cx+x,cy+y,z]));return pts.length;
		};
		const n=ring(0,b); if(b>0){ring(b,0);ring(height-b,0);} ring(height,b);
		const rings=verts.length/n;
		faces.push(Array.from({length:n},(_,i)=>n-1-i));
		for(let r=0;r<rings-1;r++)for(let i=0;i<n;i++){const j=(i+1)%n;faces.push([r*n+i,r*n+j,(r+1)*n+j,(r+1)*n+i]);}
		faces.push(Array.from({length:n},(_,i)=>(rings-1)*n+i));
		const obj=TS.Mesh.newObject(kind==="box"?"Box":"Cylinder",verts,[]);obj.faces=faces.map(v=>({v}));obj.solid=true;obj.collision="footprint";return obj;
	};
})();
