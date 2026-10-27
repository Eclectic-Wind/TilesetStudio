// WebGL2 viewport: the tileset's own projection (oblique: canvas (X, Y - Z), nothing foreshortened) with the art behind the
// meshes, and a perspective free view for a quick look round that eases back to it. Meshes can show the art projected onto them
// (what each surface will carry), a solid shade, or just wires. Also screen <-> world helpers and ray picking.
"use strict";
(function () {
	const v3 = TS.v3, m4 = TS.m4;
	const FREE_FOV = (40 * Math.PI) / 180;

	const VS = `#version 300 es
	in vec3 a_pos; in vec3 a_nrm; in vec4 a_col;
	uniform mat4 u_vp; uniform vec2 u_art; uniform float u_point; uniform vec2 u_uvoff;
	out vec3 v_nrm; out vec4 v_col; out vec2 v_uv; out vec3 v_pos;
	void main() {
		gl_Position = u_vp * vec4(a_pos, 1.0);
		gl_PointSize = u_point;
		v_nrm = a_nrm; v_col = a_col; v_pos = a_pos;
		v_uv = (vec2(a_pos.x, a_pos.y - a_pos.z) - u_uvoff) / u_art;
	}`;
	const FS = `#version 300 es
	precision highp float;
	in vec3 v_nrm; in vec4 v_col; in vec2 v_uv; in vec3 v_pos;
	uniform sampler2D u_tex; uniform int u_mode; uniform float u_opacity; uniform int u_hasArt; uniform vec3 u_light; uniform int u_cut; uniform int u_below;
	out vec4 o;
	void main() {
		bool under = u_below == 1 && v_pos.z < -0.001;                  // "below the floor" highlight (view option)
		if (u_mode == 0) { o = under ? vec4(mix(v_col.rgb, vec3(1.0, 0.15, 0.15), 0.7), max(v_col.a, 0.9)) : v_col; return; }
		vec3 n = normalize(v_nrm);
		float lit = 0.45 + 0.55 * max(dot(n, normalize(u_light)), 0.0);
		vec4 art = u_hasArt == 1 ? texture(u_tex, v_uv) : vec4(0.0);
		bool inside = v_uv.x >= 0.0 && v_uv.y >= 0.0 && v_uv.x <= 1.0 && v_uv.y <= 1.0;
			if (u_cut == 1 && !(art.a > 0.05 && inside)) discard;                  // reference faces: only where its art is
		vec3 base = (u_mode == 2 && art.a > 0.05 && inside) ? art.rgb : vec3(0.62, 0.66, 0.72);
		vec3 c = base * lit;
		c = mix(c, v_col.rgb, v_col.a);                                  // selection tint
		if (under) c = mix(c, vec3(1.0, 0.15, 0.15), 0.65);
		o = vec4(c, u_opacity);
	}`;
	// Art backdrop: a quad over the canvas in screen space, under everything.
	const BVS = `#version 300 es
	in vec2 a_pos; uniform mat4 u_vp; out vec2 v_uv; uniform vec2 u_art;
	void main() { gl_Position = u_vp * vec4(a_pos, 0.0, 1.0); gl_Position.z = 0.999 * gl_Position.w; v_uv = a_pos / u_art; }`;
	const BFS = `#version 300 es
	precision highp float; in vec2 v_uv; uniform sampler2D u_tex; uniform float u_dim; out vec4 o;
	void main() {
		vec4 c = texture(u_tex, v_uv);
		vec2 cell = floor(v_uv * 64.0); float chk = mod(cell.x + cell.y, 2.0) * 0.03 + 0.12;
		o = vec4(mix(vec3(chk), c.rgb * u_dim, c.a), 1.0);
	}`;

	// Reference art: a translucent copy of another tileset laid over the canvas at an offset (a ghost to trace or compare with).
	const RVS = `#version 300 es
	in vec2 a_pos; uniform mat4 u_vp; uniform vec2 u_off; uniform vec2 u_size; out vec2 v_uv;
	void main() { gl_Position = u_vp * vec4(a_pos, 0.0, 1.0); gl_Position.z = 0.998 * gl_Position.w; v_uv = (a_pos - u_off) / u_size; }`;
	const RFS = `#version 300 es
	precision highp float; in vec2 v_uv; uniform sampler2D u_tex; uniform float u_alpha; out vec4 o;
	void main() { vec4 c = texture(u_tex, v_uv); o = vec4(c.rgb, c.a * u_alpha); }`;

	class Renderer {
		constructor(canvas) {
			this.canvas = canvas;
			const gl = (this.gl = canvas.getContext("webgl2", { antialias: true, preserveDrawingBuffer: true }));
			if (!gl) throw new Error("WebGL2 is not available in this browser.");
			this.prog = this._program(VS, FS);
			this.back = this._program(BVS, BFS);
			this.ref = this._program(RVS, RFS);
			this.refTex = new Map();
			this.buf = gl.createBuffer();
			this.backBuf = gl.createBuffer();
			this.tex = gl.createTexture();
			this.art = { w: 256, h: 256, has: false };
			// Oblique camera: canvas point at the view centre, screen px per art px.
			this.cam = { x: 128, y: 128, zoom: 3 };
			// Free view: yaw (0 = looking north from the south), pitch, distance factor; blend 0 = oblique, 1 = free.
			this.free = { yaw: 0, pitch: Math.PI / 4, blend: 0, ortho: false, up: null, target: [128, 128, 0] };
		}

		_program(vs, fs) {
			const gl = this.gl, p = gl.createProgram();
			for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
				const s = gl.createShader(type);
				gl.shaderSource(s, src);
				gl.compileShader(s);
				if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
				gl.attachShader(p, s);
			}
			gl.linkProgram(p);
			if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
			return p;
		}

		setArt(image, w, h) {
			const gl = this.gl;
			this.art = { w, h, has: !!image };
			gl.bindTexture(gl.TEXTURE_2D, this.tex);
			if (image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
			else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		}

		// A reference's art texture (id -> texture); image null / dropRefArt removes it.
		setRefArt(id, image) {
			const gl = this.gl;
			this.dropRefArt(id);
			if (!image) return;
			const tex = gl.createTexture();
			gl.bindTexture(gl.TEXTURE_2D, tex);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			this.refTex.set(id, tex);
		}
		dropRefArt(id) { if (this.refTex.has(id)) { this.gl.deleteTexture(this.refTex.get(id)); this.refTex.delete(id); } }

		fit() {
			const r = this.canvas.getBoundingClientRect();
			this.cam.x = this.art.w / 2;
			this.cam.y = this.art.h / 2;
			this.cam.zoom = Math.max(0.25, Math.floor(Math.min(r.width / this.art.w, r.height / this.art.h) * 0.9 * 4) / 4);
		}

		size() {
			const dpr = window.devicePixelRatio || 1, r = this.canvas.getBoundingClientRect();
			const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
			if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
			return { w: r.width, h: r.height };
		}

		obliqueMatrix() {
			const { w, h } = this.size(), z = this.cam.zoom, k = 1 / 16384;
			return new Float32Array([
				(2 * z) / w, 0, 0, 0,
				0, (-2 * z) / h, -k, 0,
				0, (2 * z) / h, -k, 0,
				(-this.cam.x * 2 * z) / w, (this.cam.y * 2 * z) / h, 0, 1,
			]);
		}

		freeEye() {
			const { h } = this.size(), f = this.free;
			const dist = f.ortho ? 3000 : h / (2 * this.cam.zoom * Math.tan(FREE_FOV / 2));
			const d = [Math.sin(f.yaw) * Math.cos(f.pitch), Math.cos(f.yaw) * Math.cos(f.pitch), Math.sin(f.pitch)];
			return v3.add(f.target, v3.scale(d, dist));
		}

		freeMatrix() {
			const { w, h } = this.size();
			// Orthographic (preset views): no perspective, one screen px per art px at the zoom, like Blender's numpad views.
			const ortho = this.free.ortho, z = this.cam.zoom;
			const proj = ortho ? new Float32Array([(2 * z) / w, 0, 0, 0, 0, (2 * z) / h, 0, 0, 0, 0, -2 / 19999, 0, 0, 0, -20001 / 19999, 1]) : m4.perspective(FREE_FOV, w / h, 4, 20000);
			// Y runs south, so these axes are mirror-handed for an ordinary camera: flip screen x so east stays on the right,
			// as in the tileset view.
			const flip = new Float32Array([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
			return m4.mul(proj, m4.mul(flip, m4.lookAt(this.freeEye(), this.free.target, this.free.up || [0, 0, 1])));
		}

		viewProj() {
			const b = this.free.blend;
			if (b <= 0) return this.obliqueMatrix();
			if (b >= 1) return this.freeMatrix();
			return m4.lerp(this.obliqueMatrix(), this.freeMatrix(), b * b * (3 - 2 * b));
		}

		// Free view target: the world point under the view centre, on the floor... raised to `z` so orbiting circles the model.
		startFree(z) {
			this.free.target = [this.cam.x, this.cam.y + (z || 0), z || 0];
			this.free.yaw = 0;
			this.free.pitch = Math.PI / 4;
		}

		// --- screen <-> world (CSS px in the canvas) ---

		toScreen(p) {
			const { w, h } = this.size(), c = m4.apply(this.viewProj(), p);
			if (c[3] <= 0) return null;
			return [((c[0] / c[3]) * 0.5 + 0.5) * w, (0.5 - (c[1] / c[3]) * 0.5) * h];
		}

		// Ray through a screen point: {o, d} (d points away from the viewer).
		ray(px, py) {
			const { w, h } = this.size();
			if (this.free.blend <= 0) {
				const sx = this.cam.x + (px - w / 2) / this.cam.zoom, sy = this.cam.y + (py - h / 2) / this.cam.zoom;
				return { o: [sx, sy + 4096, 4096], d: v3.norm([0, -1, -1]) };
			}
			const inv = m4.invert(this.viewProj());
			const nx = (px / w) * 2 - 1, ny = 1 - (py / h) * 2;
			const a = m4.apply(inv, [nx, ny, -1]), b = m4.apply(inv, [nx, ny, 1]);
			const p0 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], p1 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
			return { o: p0, d: v3.norm(v3.sub(p1, p0)) };
		}

		// Canvas point (art px) under a screen point, in the oblique view.
		canvasPoint(px, py) {
			const { w, h } = this.size();
			return [this.cam.x + (px - w / 2) / this.cam.zoom, this.cam.y + (py - h / 2) / this.cam.zoom];
		}

		// Nearest face hit: {obj, face, point, t} or null.
		pick(objects, px, py, skip) {
			const r = this.ray(px, py);
			let best = null;
			for (const obj of objects) {
				if (skip && skip(obj)) continue;
				if (!Renderer.rayBox(r.o, r.d, TS.Mesh.boundsCached(obj), Infinity)) continue;
				for (const t of TS.Mesh.triangles(obj)) {
					const hit = Renderer.rayTri(r.o, r.d, obj.verts[t.a], obj.verts[t.b], obj.verts[t.c]);
					if (hit !== null && (!best || hit < best.t)) best = { obj, face: t.face, t: hit, point: v3.add(r.o, v3.scale(r.d, hit)) };
				}
			}
			return best;
		}

		// Every object hit under a screen point, nearest first: [{obj, face, point, t}] (one per object, its nearest face).
		pickAll(objects, px, py) {
			const r = this.ray(px, py), out = [];
			for (const obj of objects) {
				let best = null;
				if (!Renderer.rayBox(r.o, r.d, TS.Mesh.boundsCached(obj), Infinity)) continue;
				for (const t of TS.Mesh.triangles(obj)) {
					const hit = Renderer.rayTri(r.o, r.d, obj.verts[t.a], obj.verts[t.b], obj.verts[t.c]);
					if (hit !== null && (!best || hit < best.t)) best = { obj, face: t.face, t: hit, point: v3.add(r.o, v3.scale(r.d, hit)) };
				}
				if (best) out.push(best);
			}
			return out.sort((a, b) => a.t - b.t);
		}

		// Every face of one object under a screen point, nearest first: [{face, t}] (each face once).
		pickFaces(obj, px, py) {
			const r = this.ray(px, py), best = new Map();
			if (!Renderer.rayBox(r.o, r.d, TS.Mesh.boundsCached(obj), Infinity)) return [];
			for (const t of TS.Mesh.triangles(obj)) {
				const hit = Renderer.rayTri(r.o, r.d, obj.verts[t.a], obj.verts[t.b], obj.verts[t.c]);
				if (hit !== null && (!best.has(t.face) || hit < best.get(t.face))) best.set(t.face, hit);
			}
			return [...best].map(([face, t]) => ({ face, t })).sort((a, b) => a.t - b.t);
		}

		// Is world point p in sight (no face of `objects` in front of it along the view ray)? eps: world px of slack, so points
		// on a face or its silhouette count as seen.
		visible(objects, p, eps) {
			const s = this.toScreen(p);
			if (!s) return false;
			const r = this.ray(s[0], s[1]), tp = v3.dot(v3.sub(p, r.o), r.d), limit = tp - (eps === undefined ? 0.75 : eps);
			for (const obj of objects) {
				if (!Renderer.rayBox(r.o, r.d, TS.Mesh.boundsCached(obj), limit)) continue;
				for (const t of TS.Mesh.triangles(obj)) {
					// Triangles slightly widened: a point exactly behind a corner (common in this projection) counts as hidden.
					const hit = Renderer.rayTri(r.o, r.d, obj.verts[t.a], obj.verts[t.b], obj.verts[t.c], 1e-4);
					if (hit !== null && hit < limit) return false;
				}
			}
			return true;
		}

		// Floor point (Z = z) under a screen point.
		floorPoint(px, py, z) {
			const r = this.ray(px, py);
			if (Math.abs(r.d[2]) < 1e-9) return null;
			const t = ((z || 0) - r.o[2]) / r.d[2];
			return t > 0 ? v3.add(r.o, v3.scale(r.d, t)) : null;
		}

		// Does the ray enter the box before distance tmax? (slab test)
		static rayBox(o, d, box, tmax) {
			let t0 = 0, t1 = tmax;
			for (let k = 0; k < 3; k++) {
				if (Math.abs(d[k]) < 1e-12) { if (o[k] < box.min[k] - 0.05 || o[k] > box.max[k] + 0.05) return false; continue; }
				const inv = 1 / d[k];
				let a = (box.min[k] - 0.05 - o[k]) * inv, b = (box.max[k] + 0.05 - o[k]) * inv;
				if (a > b) { const x = a; a = b; b = x; }
				if (a > t0) t0 = a;
				if (b < t1) t1 = b;
				if (t0 > t1) return false;
			}
			return true;
		}

		static rayTri(o, d, a, b, c, grow) {
			const e1 = v3.sub(b, a), e2 = v3.sub(c, a), p = v3.cross(d, e2), det = v3.dot(e1, p), g = grow || 1e-9;
			if (Math.abs(det) < 1e-12) return null;
			const inv = 1 / det, s = v3.sub(o, a), u = v3.dot(s, p) * inv;
			if (u < -g || u > 1 + g) return null;
			const q = v3.cross(s, e1), v = v3.dot(d, q) * inv;
			if (v < -g || u + v > 1 + g) return null;
			const t = v3.dot(e2, q) * inv;
			return t > 1e-6 ? t : null;
		}

		// --- drawing ---

		// geometry: {tris: Float32Array (pos3 nrm3 col4 per vertex), lines: Float32Array, points: Float32Array} (same layout)
		draw(geometry, opts) {
			const gl = this.gl;
			this.size();
			gl.viewport(0, 0, this.canvas.width, this.canvas.height);
			gl.clearColor(0.09, 0.09, 0.11, 1);
			gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
			const vp = this.viewProj();
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, this.tex);
			if (opts.backdrop && this.free.blend < 1) {
				gl.useProgram(this.back);
				gl.disable(gl.DEPTH_TEST);
				const W = this.art.w, H = this.art.h;
				gl.bindBuffer(gl.ARRAY_BUFFER, this.backBuf);
				gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, W, 0, W, H, 0, 0, W, H, 0, H]), gl.DYNAMIC_DRAW);
				const loc = gl.getAttribLocation(this.back, "a_pos");
				gl.enableVertexAttribArray(loc);
				gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 8, 0);
				gl.uniformMatrix4fv(gl.getUniformLocation(this.back, "u_vp"), false, vp);
				gl.uniform2f(gl.getUniformLocation(this.back, "u_art"), W, H);
				gl.uniform1i(gl.getUniformLocation(this.back, "u_tex"), 0);
				gl.uniform1f(gl.getUniformLocation(this.back, "u_dim"), 1 - this.free.blend);
				gl.drawArrays(gl.TRIANGLES, 0, 6);
				gl.disableVertexAttribArray(loc);
				// Reference art over it: only in the tileset view (in 3D the art is carried by the models), fading out as 3D comes in.
				const refs = (opts.refs || []).filter((r) => r.showArt && this.refTex.has(r.id) && r.opacity > 0);
				if (refs.length) {
					gl.useProgram(this.ref);
					gl.enable(gl.BLEND);
					gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
					const rl = gl.getAttribLocation(this.ref, "a_pos");
					gl.enableVertexAttribArray(rl);
					gl.uniformMatrix4fv(gl.getUniformLocation(this.ref, "u_vp"), false, vp);
					gl.uniform1i(gl.getUniformLocation(this.ref, "u_tex"), 0);
					for (const r of refs) {
						const x0 = r.dx, y0 = r.dy, x1 = r.dx + r.w, y1 = r.dy + r.h;
						gl.bindTexture(gl.TEXTURE_2D, this.refTex.get(r.id));
						gl.bindBuffer(gl.ARRAY_BUFFER, this.backBuf);
						gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([x0, y0, x1, y0, x1, y1, x0, y0, x1, y1, x0, y1]), gl.DYNAMIC_DRAW);
						gl.vertexAttribPointer(rl, 2, gl.FLOAT, false, 8, 0);
						gl.uniform2f(gl.getUniformLocation(this.ref, "u_off"), x0, y0);
						gl.uniform2f(gl.getUniformLocation(this.ref, "u_size"), r.w, r.h);
						gl.uniform1f(gl.getUniformLocation(this.ref, "u_alpha"), r.opacity * (1 - this.free.blend));
						gl.drawArrays(gl.TRIANGLES, 0, 6);
					}
					gl.disableVertexAttribArray(rl);
					gl.bindTexture(gl.TEXTURE_2D, this.tex);
				}
			}
			gl.useProgram(this.prog);
			gl.uniformMatrix4fv(gl.getUniformLocation(this.prog, "u_vp"), false, vp);
			gl.uniform2f(gl.getUniformLocation(this.prog, "u_art"), this.art.w, this.art.h);
			gl.uniform1i(gl.getUniformLocation(this.prog, "u_tex"), 0);
			gl.uniform1i(gl.getUniformLocation(this.prog, "u_hasArt"), this.art.has ? 1 : 0);
			gl.uniform3f(gl.getUniformLocation(this.prog, "u_light"), -0.4, 0.8, 0.9);
			gl.uniform1i(gl.getUniformLocation(this.prog, "u_below"), opts.belowZ ? 1 : 0);
			gl.enable(gl.DEPTH_TEST);
			gl.depthFunc(gl.LEQUAL);
			gl.enable(gl.BLEND);
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
			const free = this.free.blend > 0;
			// X-ray: faces stay see-through (also in 3D) and don't hide anything, so wires, vertices and face dots behind them show.
			const opacity = opts.xray ? Math.min(free ? 0.4 : opts.opacity, 0.4) : free ? 1 : opts.opacity;
			// Faces sit a little behind their own wires and dots, so those win the depth test on the surface they belong to.
			gl.enable(gl.POLYGON_OFFSET_FILL);
			gl.polygonOffset(1, 2);
			if (geometry.tris.length && opacity > 0.001) {
				gl.uniform1i(gl.getUniformLocation(this.prog, "u_mode"), opts.shade === "art" || free ? 2 : 1);
				gl.uniform1f(gl.getUniformLocation(this.prog, "u_opacity"), opacity);
				gl.depthMask(!opts.xray);
				this._stream(geometry.tris, gl.TRIANGLES);
			} else if (geometry.tris.length && !opts.xray) {
				// Invisible faces still hide what's behind them (opacity 0 without X-ray).
				gl.colorMask(false, false, false, false);
				this._stream(geometry.tris, gl.TRIANGLES);
				gl.colorMask(true, true, true, true);
			}
			// Reference models in 3D: their faces carry the reference's own art (the flat backdrop is hidden there), fading in with 3D.
			if (free && geometry.ghosts) {
				const loc = (n) => gl.getUniformLocation(this.prog, n);
				gl.depthMask(false);
				gl.uniform1i(loc("u_cut"), 1); gl.uniform1i(loc("u_hasArt"), 1);
				for (const g of geometry.ghosts) {
					if (!this.refTex.has(g.id) || !g.tris.length || g.opacity <= 0.001) continue;
					gl.bindTexture(gl.TEXTURE_2D, this.refTex.get(g.id));
					gl.uniform2f(loc("u_art"), g.w, g.h); gl.uniform2f(loc("u_uvoff"), g.dx, g.dy);
					gl.uniform1i(loc("u_mode"), g.art ? 2 : 1);
					gl.uniform1f(loc("u_opacity"), g.opacity * this.free.blend);
					this._stream(g.tris, gl.TRIANGLES);
				}
				gl.bindTexture(gl.TEXTURE_2D, this.tex);
				gl.uniform1i(loc("u_cut"), 0); gl.uniform1i(loc("u_hasArt"), this.art.has ? 1 : 0);
				gl.uniform2f(loc("u_art"), this.art.w, this.art.h); gl.uniform2f(loc("u_uvoff"), 0, 0);
			}
			gl.disable(gl.POLYGON_OFFSET_FILL);
			gl.uniform1i(gl.getUniformLocation(this.prog, "u_mode"), 0);
			gl.depthMask(false);
			// Reference models: faint faces, then their wires (flat colour with alpha).
			if (geometry.ghostLines && geometry.ghostLines.length) this._stream(geometry.ghostLines, gl.LINES);
			if (geometry.grid && geometry.grid.length) { gl.disable(gl.DEPTH_TEST); this._stream(geometry.grid, gl.LINES); gl.enable(gl.DEPTH_TEST); }
			gl.depthFunc(opts.xray ? gl.ALWAYS : gl.LEQUAL);
			if (geometry.lines.length) this._stream(geometry.lines, gl.LINES);
			gl.uniform1f(gl.getUniformLocation(this.prog, "u_point"), 5);
			if (geometry.dots && geometry.dots.length) this._stream(geometry.dots, gl.POINTS);
			gl.uniform1f(gl.getUniformLocation(this.prog, "u_point"), 7);
			if (geometry.points.length) this._stream(geometry.points, gl.POINTS);
			// The element under the pointer (what a click would pick) draws over everything.
			gl.depthFunc(gl.ALWAYS);
			if (geometry.hover && geometry.hover.lines.length) this._stream(geometry.hover.lines, gl.LINES);
			gl.uniform1f(gl.getUniformLocation(this.prog, "u_point"), 9);
			if (geometry.hover && geometry.hover.points.length) this._stream(geometry.hover.points, gl.POINTS);
			if (geometry.overlay && geometry.overlay.length) this._stream(geometry.overlay, gl.LINES);
			gl.depthFunc(gl.LEQUAL);
			gl.depthMask(true);
			gl.disable(gl.BLEND);
		}

		_stream(data, mode) {
			const gl = this.gl, stride = 40;
			gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
			gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
			const attrs = [["a_pos", 3, 0], ["a_nrm", 3, 12], ["a_col", 4, 24]];
			const locs = attrs.map(([n, size, off]) => {
				const loc = gl.getAttribLocation(this.prog, n);
				if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off); }
				return loc;
			});
			gl.drawArrays(mode, 0, data.length / 10);
			locs.forEach((loc) => loc >= 0 && gl.disableVertexAttribArray(loc));
		}
	}

	TS.Renderer = Renderer;
})();
