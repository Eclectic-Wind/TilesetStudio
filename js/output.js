// Output viewport: the processed result, to check before exporting.
//   lit         the art lit by a point light you drag round (height = light height), shaded with the normals, roughness and
//               metallic, shadows marched through the floor heightfield (like the engine's)
//   height      black 0 -> white 128, red above 255 (clipped)
//   normals     the normal map as exported
//   roughness / metallic
//   holes       art no model covers: magenta = left on the floor, orange = filled from a neighbour
//   heightfield the floor plan seen from above: colour = top height, dark stripes = open underneath (a top on legs, an overhang),
//               light stripes = a gap between stacked parts (shelves), which light passes through
//   collision   the floor plan: what blocks the player (see _collision); the 24x12 feet box follows the pointer
// Zoom (wheel, buttons) and pan (middle/right drag) only redraw the cached image; render() recomputes it.
"use strict";
(function () {
	const v3 = TS.v3;
	const ZOOMS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32];

	class Output {
		constructor(canvas) {
			this.canvas = canvas;
			this.ctx = canvas.getContext("2d");
			this.mode = "lit";
			this.renderScale = 1;
			this.rendererMode = "current";
			const host=canvas.parentElement;this.primaryPane=document.createElement('div');this.primaryPane.className='lit-pane';host.insertBefore(this.primaryPane,canvas);this.primaryPane.append(canvas);this.comparePane=document.createElement('div');this.comparePane.className='lit-pane lit-compare';this.comparePane.hidden=true;this.compareCanvas=document.createElement('canvas');this.compareCanvas.className='lit-compare-canvas';this.comparePane.append(this.compareCanvas);host.append(this.comparePane);host.classList.add('lit-host');
			for(const [pane,text]of [[this.primaryPane,'Current · interact here'],[this.comparePane,'GPU · synchronized']]){const label=document.createElement('span');label.className='lit-pane-label';label.textContent=text;pane.append(label);}

			this.light = { x: 0, y: 0, z: 36, radius: 220, on: false };
			this.shadows = true;
			this.usePrisms = true;   // shadow test: prisms decide where to look, the floor spans decide the shadow
			this.showPrisms = false; // V: draw the prism boxes
			this.ambient = 0.18;
			this.result = null;
			this.settings = null;
			this.image = null;
			this.view = { s: 0, cx: 0, cy: 0 };
			this.onzoom = null;
		}

		// The projection the result was processed in (oblique unless the project is isometric).
		proj() { return (this.result && this.result.proj) || TS.Proj.of(this.settings, this.result && this.result.art); }

		set(result, settings) {
			this.result = result;
			if(this.gpu)this.gpu.source=null;
			this.settings = settings;
			this._prisms = null;
			this.litNormal = result ? TS.Process.litNormals(result, settings) : null;
			if (result && !this.light.on) { const q = this.proj().toWorld(result.w * 0.25, result.h * 0.9, 0); this.light.x = q[0]; this.light.y = q[1]; this.light.on = true; }
			this.render();
		}

		floorPlan() { return this.mode === "heightfield" || this.mode === "collision" || this.mode === "pieces" || this.mode === "kind"; }

		// Kind view tints and collision-view outlines, as [r, g, b].
		static KIND_COLOURS = { floor: [90, 200, 110], wall_h: [210, 90, 210], wall_v: [70, 210, 220], furn: [235, 150, 60] };
		static MODE_COLOURS = { none: "#5dff8a", strip: "#ffa030", footprint: "#ff4d4d" };

		// A distinct colour per piece (golden-angle hues), as [r, g, b].
		static pieceColour(id) {
			const h = ((id * 137.508) % 360) / 60, c = 0.75, x = c * (1 - Math.abs((h % 2) - 1)), m = 0.2;
			const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h) % 6];
			return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
		}
		// Pieces and Kind are views of the canvas (the tile cells): in isometric they stop at the art, floor points showing where they draw.
		canvasView() { return this.mode === "pieces" || this.mode === "kind"; }
		rows() { return this.floorPlan() && !(this.canvasView() && this.proj().kind !== "oblique") ? this.result.floor.shown : this.result.h; }
		// The floor-plan index under canvas pixel (x, y): oblique: the same pixel (floor points share the canvas's coordinates);
		// isometric: the floor point that draws there. -1 off the plan.
		floorIndex(x, y) {
			const r = this.result, p = this.proj();
			if (p.kind === "oblique") return x >= 0 && y >= 0 && x < r.w && y < r.floor.rows ? y * r.w + x : -1;
			const q = p.toWorld(x + 0.5, y + 0.5, 0), fx = Math.floor(q[0]), fy = Math.floor(q[1]);
			return fx >= 0 && fy >= 0 && fx < r.w && fy < r.floor.rows ? fy * r.w + fx : -1;
		}

		// The collision under the player's feet box at this.feet (floor px; the box is FEET wide, FEET.h tall above the feet):
		// {mask, owner} of the first colliding pixel, or null when the feet can stand there.
		feetHit() {
			const r = this.result, f = this.feet;
			if (!r || !f) return null;
			const c = r.collision, W = c.w, fw = TS.Process.FEET.w, fh = TS.Process.FEET.h;
			const fx = Math.round(f[0]), fy = Math.round(f[1]);
			for (let y = fy - fh; y < fy; y++)
				for (let x = fx - fw / 2; x < fx + fw / 2; x++) {
					if (x < 0 || y < 0 || x >= W || y >= c.rows) continue;
					const m = c.mask[y * W + x];
					if (m & 6) return { mask: m, owner: c.owner[y * W + x] };
				}
			return null;
		}

		// Whole-pixel scale that fits the image in the box.
		fitScale() {
			const r = this.result, box = this.canvas.parentElement.getBoundingClientRect();
			return Math.max(1, Math.floor(Math.min((box.width - 8) / r.w, (box.height - 8) / this.rows())));
		}

		// view.s = 0: fit and centre; else that scale with art point (cx, cy) at the canvas centre.
		scale() { return this.view.s || this.fitScale(); }

		// Zoom one step of ZOOMS (dir +1 / -1) keeping the art point under canvas px (px, py) in place.
		zoomAt(px, py, dir) {
			if (!this.result) return;
			const s = this.scale(), a = this.toArt(px, py);
			const next = dir > 0 ? ZOOMS.find((z) => z > s + 1e-6) : [...ZOOMS].reverse().find((z) => z < s - 1e-6);
			if (!next) return;
			const w = this.canvas.width, h = this.canvas.height;
			this.view = { s: next, cx: a[0] - (px - w / 2) / next, cy: a[1] - (py - h / 2) / next };
			this.draw();
		}

		// Pan by a drag of (dx, dy) canvas px.
		pan(dx, dy) {
			if (!this.result) return;
			const s = this.scale();
			if (!this.view.s) this.view = { s, cx: (this.canvas.width / 2 - this.ox) / s, cy: (this.canvas.height / 2 - this.oy) / s };
			this.view.cx -= dx / s; this.view.cy -= dy / s;
			this.draw();
		}

		fit() { this.view = { s: 0, cx: 0, cy: 0 }; this.draw(); }

		// Screen px (in the canvas) -> canvas art px.
		toArt(px, py) {
			const s = this.scale();
			return [(px - this.ox) / s, (py - this.oy) / s];
		}

		// Recompute the image for the current mode, then draw it. Animating, the Lit view shows the clip's current frame, processed
		// like the rest pose (AnimUI.litResult); the rest pose comes back afterwards.
		render() {
			const rest = this.result, frame = this.mode === "lit" && rest && TS.AnimUI && TS.AnimUI.litResult ? TS.AnimUI.litResult() : null;
			if (!frame) return this._renderImage();
			const saved = { result: rest, litNormal: this.litNormal, _prisms: this._prisms };
			Object.assign(this, { result: frame.result, litNormal: frame.litNormal, _prisms: frame.prisms });
			try { this._renderImage(); }
			finally { frame.prisms = this._prisms; Object.assign(this, saved); }
		}

		_renderImage() {
			const r = this.result;
			this.off = null; this.gpuOff=null;
			const activeGPU=this.mode==='lit' && this.rendererMode!=='current';
			const status=document.getElementById('lit_renderer_status');
			if(status)status.textContent='';
			if(r && activeGPU){try{if(TS.AnimUI?.on)throw Error('Animation uses Current renderer');this.gpu=this.gpu||new TS.LitGPU();this.gpuOff=this.gpu.render(this);if(status)status.textContent='GPU lighting · reference shadows';}catch(e){if(status)status.textContent='Current fallback: '+e.message;}}
			const comparing=!!this.gpuOff && this.rendererMode==='compare';this.comparePane.hidden=!comparing;this.primaryPane.parentElement.classList.toggle('lit-comparing',comparing);
			if(this.gpuOff && this.rendererMode==='gpu'){this.off=this.gpuOff;this.draw();return;}
			if (r) {
				const rows = this.rows(), scale = this.mode === "lit" ? TS.clamp(Number(this.renderScale) || 1, .25, 1) : 1;
				const img = new ImageData(Math.max(1, Math.ceil(r.w * scale)), Math.max(1, Math.ceil(rows * scale)));
				// Animating: Normals shows the clip's current frame, so playback runs here too (Lit takes its frame in render()).
				const anim = this.mode === "normals" && TS.AnimUI && TS.AnimUI.frameImage && TS.AnimUI.frameImage(img, {width:r.w,height:rows});
				if (anim) { /* drawn */ }
				else if (this.mode === "heightfield") this._heightfield(img);
				else if (this.mode === "collision") this._collision(img);
				else if (this.mode === "pieces") this._pieces(img);
				else if (this.mode === "kind") this._kinds(img);
				else this._pixels(img);
				this.off = document.createElement("canvas");
				this.off.width = img.width; this.off.height = img.height;
				this.off.getContext("2d").putImageData(img, 0, 0);
			}
			this.draw();
		}

		// Draw the last computed image at the current zoom and pan (cheap: zooming and panning only call this).
		draw() {
			this._drawSingle();
			if(this.gpuOff && !this.comparePane.hidden){const saved=[this.canvas,this.ctx,this.off,this.onzoom,this.ox,this.oy];try{this.canvas=this.compareCanvas;this.ctx=this.compareCanvas.getContext('2d');this.off=this.gpuOff;this.onzoom=null;this._drawSingle();}finally{[this.canvas,this.ctx,this.off,this.onzoom,this.ox,this.oy]=saved;}}
		}
		_drawSingle() {
			const r = this.result, ctx = this.ctx;
			const box = this.canvas.parentElement.getBoundingClientRect();
			this.canvas.width = Math.max(1, box.width);
			this.canvas.height = Math.max(1, box.height);
			ctx.fillStyle = "#16161b";
			ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
			if (this.onzoom) this.onzoom(r ? this.scale() : 0);
			if (!r || !this.off) return;
			const rows = this.rows(), s = this.scale();
			if (this.view.s) {
				this.ox = Math.round(this.canvas.width / 2 - this.view.cx * s);
				this.oy = Math.round(this.canvas.height / 2 - this.view.cy * s);
			} else {
				this.ox = Math.floor((this.canvas.width - r.w * s) / 2);
				this.oy = Math.floor((this.canvas.height - rows * s) / 2);
			}
			ctx.imageSmoothingEnabled = false;
			ctx.drawImage(this.off, this.ox, this.oy, r.w * s, rows * s);
			if (this.mode === "lit") {
				// The light: its floor point and where it hangs, as the projection draws them.
				const pj = this.proj(), lf = pj.toCanvas([this.light.x, this.light.y, 0]), lh = pj.toCanvas([this.light.x, this.light.y, this.light.z]);
				const fx = this.ox + lf[0] * s, fy = this.oy + lf[1] * s, hy = this.oy + lh[1] * s;
				ctx.strokeStyle = "rgba(255,220,120,0.8)";
				ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, hy); ctx.stroke();
				ctx.beginPath(); ctx.arc(fx, fy, 3, 0, Math.PI * 2); ctx.stroke();
				ctx.fillStyle = "#ffd878"; ctx.beginPath(); ctx.arc(this.ox + lh[0] * s, hy, 5, 0, Math.PI * 2); ctx.fill();
			}
			if (this.mode === "pieces" && r.pieceMap) this._pieceOverlay(ctx, r.pieceMap, s);
			if (this.showPrisms && (this.mode === "lit" || this.floorPlan())) this._prismOverlay(ctx, s);
			if (this.mode === "collision") {
				// The exported polygons, then the feet box under the pointer (green: the feet can stand here, red: blocked).
				ctx.strokeStyle = "#ffe066"; ctx.lineWidth = 1;
				for (const m of r.collision.models)
					for (const poly of m.polygons) {
						ctx.beginPath();
						poly.forEach((p, k) => ctx[k ? "lineTo" : "moveTo"](this.ox + p[0] * s + 0.5, this.oy + p[1] * s + 0.5));
						ctx.closePath(); ctx.stroke();
					}
				// Each model's footprint outlined by its resolved collision mode: green dashed = none (walkable), orange = strip, red = footprint.
				ctx.lineWidth = 1.5;
				for (const role of r.roles || []) {
					if (role.hull.length < 3) continue;
					ctx.strokeStyle = Output.MODE_COLOURS[role.mode];
					ctx.setLineDash(role.mode === "none" ? [4, 3] : []);
					ctx.beginPath();
					role.hull.forEach((p, k) => ctx[k ? "lineTo" : "moveTo"](this.ox + p[0] * s + 0.5, this.oy + p[1] * s + 0.5));
					ctx.closePath(); ctx.stroke();
				}
				ctx.setLineDash([]); ctx.lineWidth = 1;
				if (this.feet) {
					const F = TS.Process.FEET, fx = Math.round(this.feet[0]), fy = Math.round(this.feet[1]), hit = this.feetHit();
					ctx.strokeStyle = hit ? "#ff4d4d" : "#5dff8a"; ctx.lineWidth = 2;
					ctx.strokeRect(this.ox + (fx - F.w / 2) * s, this.oy + (fy - F.h) * s, F.w * s, F.h * s);
					ctx.fillStyle = ctx.strokeStyle;
					ctx.beginPath(); ctx.arc(this.ox + fx * s, this.oy + fy * s, 3, 0, Math.PI * 2); ctx.fill();
					ctx.lineWidth = 1;
				}
			}
		}

		// Collision: the floor plan, dim by top height; red = floor a footprint-mode model blocks (its spans reach into the body),
		// bright red = its collision (that floor pulled in for the feet box), orange = a strip model's strip; yellow outlines = the
		// exported polygons (drawn in draw()).
		_collision(img) {
			const r = this.result, f = r.floor, c = r.collision, d = img.data;
			for (let y = 0; y < f.shown; y++)
				for (let x = 0; x < r.w; x++) {
					const k = y * r.w + x, o = k * 4, m = c.mask[k];
					let g = f.top[k] < 0 ? (y < r.h ? 26 : 16) : 50 + TS.clamp(f.top[k] / 96, 0, 1) * 60;
					let col = [g, g, g + 4];
					if (m & 2) col = [230, 60, 60];
					else if (m & 4) col = [240, 150, 40];
					else if (m & 1) col = [120, 40, 44];
					d.set([col[0], col[1], col[2], 255], o);
				}
		}

		// Pieces: the art tinted by the piece that paints it (as the importer groups models: footprints within 2 px = one piece);
		// art no model covers stays grey, floor with no art above it is a dim tint of its piece.
		_pieces(img) {
			const r = this.result, pm = r.pieceMap, d = img.data, cut = this.settings.alphaCut, art = r.art.data;
			const cols = pm.pieces.map((p) => Output.pieceColour(p.id));
			for (let y = 0; y < img.height; y++)
				for (let x = 0; x < r.w; x++) {
					const k = y * r.w + x, o = k * 4, inArt = y < r.h && r.alpha[k] > cut, fk = this.floorIndex(x, y);
					const ap = inArt ? pm.artPiece[k] : -1, fp = fk >= 0 ? pm.floorPiece[fk] : -1;
					let col = [y < r.h ? 26 : 16, y < r.h ? 26 : 16, y < r.h ? 30 : 20];
					if (inArt) {
						const g = (art[o] * 0.3 + art[o + 1] * 0.59 + art[o + 2] * 0.11) * 0.55 + 40;
						if (ap >= 0) { const c = cols[ap]; col = [c[0] * g / 255 * 1.1, c[1] * g / 255 * 1.1, c[2] * g / 255 * 1.1]; }
						else col = [g * 0.5 + 60, g * 0.5 + 60, g * 0.5 + 60];
					} else if (fp >= 0) { const c = cols[fp]; col = [c[0] * 0.3, c[1] * 0.3, c[2] * 0.3]; }
					d.set([col[0], col[1], col[2], 255], o);
				}
		}

		// Kind: like Pieces, but tinted by the resolved kind (floor / wall_h / wall_v / furn) of the model that paints each pixel;
		// floor with no art above it is a dim tint of its model's kind.
		_kinds(img) {
			const r = this.result, d = img.data, cut = this.settings.alphaCut, art = r.art.data, roles = r.roles;
			const col = (oi) => Output.KIND_COLOURS[roles[oi].kind];
			for (let y = 0; y < img.height; y++)
				for (let x = 0; x < r.w; x++) {
					const k = y * r.w + x, o = k * 4, inArt = y < r.h && r.alpha[k] > cut, ao = inArt ? r.owner[k] : -1, fk = this.floorIndex(x, y), fo = fk >= 0 ? r.floor.owner[fk] : -1;
					let c = [y < r.h ? 26 : 16, y < r.h ? 26 : 16, y < r.h ? 30 : 20];
					if (inArt) {
						const g = (art[o] * 0.3 + art[o + 1] * 0.59 + art[o + 2] * 0.11) * 0.55 + 40;
						if (ao >= 0) { const t = col(ao); c = [t[0] * g / 255 * 1.1, t[1] * g / 255 * 1.1, t[2] * g / 255 * 1.1]; }
						else c = [g * 0.5 + 60, g * 0.5 + 60, g * 0.5 + 60];
					} else if (fo >= 0 && r.floor.top[fk] >= 0) { const t = col(fo); c = [t[0] * 0.3, t[1] * 0.3, t[2] * 0.3]; }
					d.set([c[0], c[1], c[2], 255], o);
				}
		}

		// Per tile cell: border in the colour of the piece the engine reads that cell as; red fill = conflict (another piece paints
		// there), yellow dashes = floating (art with no anchored cell below); a diamond marks a piece's anchor cell.
		_pieceOverlay(ctx, pm, s) {
			const T = pm.T * s;
			ctx.save();
			ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1;
			for (let cy = 0; cy <= pm.gh; cy++) { ctx.beginPath(); ctx.moveTo(this.ox, this.oy + cy * T + 0.5); ctx.lineTo(this.ox + pm.gw * T, this.oy + cy * T + 0.5); ctx.stroke(); }
			for (let cx = 0; cx <= pm.gw; cx++) { ctx.beginPath(); ctx.moveTo(this.ox + cx * T + 0.5, this.oy); ctx.lineTo(this.ox + cx * T + 0.5, this.oy + pm.gh * T); ctx.stroke(); }
			const rgb = (id, a) => { const c = Output.pieceColour(id); return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; };
			for (const c of pm.cells) {
				const x = this.ox + c.cx * T, y = this.oy + c.cy * T;
				if (c.status === 2) {
					ctx.fillStyle = "rgba(255,40,40,0.30)"; ctx.fillRect(x, y, T, T);
					ctx.fillStyle = "rgba(255,40,40,0.55)";
					ctx.save(); ctx.beginPath(); ctx.rect(x, y, T, T); ctx.clip(); // the stripes run past the cell; keep them inside it
					for (let k = -T; k < T; k += 8) { ctx.beginPath(); ctx.moveTo(x + k, y + T); ctx.lineTo(x + k + 3, y + T); ctx.lineTo(x + k + T + 3, y); ctx.lineTo(x + k + T, y); ctx.fill(); }
					ctx.restore();
				}
				if (c.engine.length) {
					ctx.strokeStyle = c.status === 2 ? "#ff4040" : rgb(c.engine[0], 0.95); ctx.lineWidth = c.status === 2 ? 3 : 2;
					ctx.strokeRect(x + 1.5, y + 1.5, T - 3, T - 3);
				}
				if (c.status === 1) { ctx.strokeStyle = "#ffd24d"; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.strokeRect(x + 1.5, y + 1.5, T - 3, T - 3); ctx.setLineDash([]); }
				c.anchored.forEach((id, k) => {
					const mx = x + T / 2 + (k - (c.anchored.length - 1) / 2) * 12, my = y + T - 8;
					ctx.fillStyle = rgb(id, 1); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
					ctx.beginPath(); ctx.moveTo(mx, my - 6); ctx.lineTo(mx + 6, my); ctx.lineTo(mx, my + 6); ctx.lineTo(mx - 6, my); ctx.closePath(); ctx.fill(); ctx.stroke();
				});
			}
			ctx.restore();
		}

		// The prisms (cached per result); the light's-eye table is rebuilt for the light's floor point on every render.
		prisms() { return this.result ? this._prisms || (this._prisms = TS.Prism.build(this.result)) : []; }

		// V: each prism as a coloured box (piece colour). Lit view: the footprint at its bottom and top (as the projection draws them) joined by
		// its edges. Plan views: the footprint with its height range. The Floor view shows the real shape inside the boxes.
		_prismOverlay(ctx, s) {
			ctx.save();
			ctx.lineWidth = 1.5;
			const lit = this.mode === "lit", pj = this.proj(), pt = (q, z) => { if (!lit) return [this.ox + q[0] * s, this.oy + q[1] * s]; const c = pj.toCanvas([q[0], q[1], z]); return [this.ox + c[0] * s, this.oy + c[1] * s]; };
			const path = (h, z) => { h.forEach((q, k) => { const [x, y] = pt(q, z); ctx[k ? "lineTo" : "moveTo"](x, y); }); ctx.closePath(); };
			for (const pr of this.prisms()) {
				const c = Output.pieceColour(pr.id), rgb = `${c[0] | 0},${c[1] | 0},${c[2] | 0}`;
				ctx.strokeStyle = `rgb(${rgb})`; ctx.fillStyle = `rgba(${rgb},0.16)`;
				if (lit) {
					ctx.beginPath(); path(pr.hull, pr.z0); ctx.stroke();
					for (const q of pr.hull) { const a = pt(q, pr.z0), b = pt(q, pr.z1); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
					ctx.beginPath(); path(pr.hull, pr.z1); ctx.fill(); ctx.stroke();
				} else {
					ctx.beginPath(); path(pr.hull, 0); ctx.fill(); ctx.stroke();
					const [x, y] = pt(pr.hull[0], 0);
					ctx.fillStyle = `rgb(${rgb})`; ctx.font = "10px sans-serif"; ctx.fillText(`${pr.z0.toFixed(0)}-${pr.z1.toFixed(0)}`, x + 3, y - 3);
				}
			}
			ctx.restore();
		}

		_pixels(img) {
			const r = this.result, d = img.data, art = r.art.data, cut = this.settings.alphaCut, flat = this.proj().toMapNormal([0, 0, 1]);
			this._ptab = this.mode === "lit" && this.shadows && this.usePrisms ? TS.Prism.table(this.prisms(), this.light) : null;
			for (let py = 0; py < img.height; py++)
				for (let px = 0; px < img.width; px++) {
					const x = Math.min(r.w-1, Math.floor((px+.5)*r.w/img.width)), y = Math.min(r.h-1, Math.floor((py+.5)*r.h/img.height));
					const i = y * r.w + x, o = (py * img.width + px) * 4, source = i * 4;
					if (r.alpha[i] <= cut) {
						if (this.mode === "lit") { const f = this._floor(x + 0.5, y + 0.5, 0); d.set([f * 34, f * 34, f * 40, 255], o); }
						else d.set([22, 22, 27, 255], o);
						continue;
					}
					const has = !isNaN(r.height[i]);
					const a = [art[source], art[source + 1], art[source + 2]];
					switch (this.mode) {
						case "lit": d.set(this._lit(r, i, x, y, a), o); d[o + 3] = 255; break;
						case "height": {
							if (!has) { d.set([255, 0, 255, 255], o); break; }
							const v = TS.clamp(r.height[i] / 128, 0, 1) * 255;
							d.set(r.clipped[i] ? [255, 40, 40, 255] : [v, v, v, 255], o);
							break;
						}
						case "normals": {
							const n = has ? TS.Process.mapNormal(r, i, this.settings) : flat;
							d.set([(n[0] * 0.5 + 0.5) * 255, (n[1] * 0.5 + 0.5) * 255, (n[2] * 0.5 + 0.5) * 255, 255], o);
							break;
						}
						case "roughness": { const v = (has ? r.rough[i] : 1) * 255; d.set([v, v, v, 255], o); break; }
						case "metallic": { const v = (has ? r.metal[i] : 0) * 255; d.set([v, v * 0.85, v * 0.5, 255], o); break; }
						case "holes": {
							const g = (a[0] * 0.3 + a[1] * 0.59 + a[2] * 0.11) * 0.35;
							d.set(r.hole[i] === 1 ? [255, 0, 255, 255] : r.hole[i] === 2 ? [255, 150, 0, 255] : r.clipped[i] ? [255, 40, 40, 255] : [g, g, g, 255], o);
							break;
						}
					}
				}
		}

		// Floor-light term for empty canvas, so the light's reach shows.
		_floor(x, y, h) {
			const l = this.light, q = this.proj().toWorld(x, y, h), dx = l.x - q[0], dy = l.y - q[1], dz = l.z - h, dist = Math.hypot(dx, dy, dz);
			const att = Math.max(0, 1 - dist / l.radius);
			return 0.4 + 2 * att * att * (dz / dist);
		}

		_lit(r, i, x, y, albedo) {
			const has = !isNaN(r.height[i]);
			const h = has ? r.height[i] : 0;
			const N = this.litNormal, n = has ? [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]] : [0, 0, 1];
			const proj = this.proj(), p = proj.toWorld(x + 0.5, y + 0.5, h);
			const toL = v3.sub([this.light.x, this.light.y, this.light.z], p), dist = v3.len(toL), l = v3.scale(toL, 1 / dist);
			const att = Math.max(0, 1 - dist / this.light.radius) ** 2;
			const ndl = Math.max(0, v3.dot(n, l));
			let shade = ndl * att;
			if (shade > 0 && this.shadows && this._shadowed(r, p, toL)) shade = 0;
			const rough = has ? r.rough[i] : 1, metal = has ? r.metal[i] : 0;
			const a = albedo.map((c) => c / 255);
			const half = v3.norm(v3.add(l, proj.viewer));
			const shin = Math.max(2, 2 / Math.max(0.02, rough ** 4) - 2);
			const spec = Math.pow(Math.max(0, v3.dot(n, half)), shin) * ((shin + 8) / (8 * Math.PI)) * 0.25;
			const out = [0, 1, 2].map((k) => {
				const f0 = 0.04 + (a[k] - 0.04) * metal;
				const diffuse = a[k] * (1 - metal) * (this.ambient + 2.2 * shade);
				const amb = a[k] * metal * this.ambient * 0.6;
				return TS.clamp((diffuse + amb + f0 * spec * 2.2 * shade) * 255, 0, 255);
			});
			return out;
		}

		// March from the surface point toward the light over the floor heightfield: blocked where a model spans that height.
		_shadowed(r, p, toL) {
			const f = r.floor, W = r.w;
			if (this._ptab) return TS.Prism.shadowed(this._ptab, f, W, p, toL);
			const steps = Math.ceil(Math.hypot(toL[0], toL[1]));
			if (steps < 1) return false;
			for (let s = 2; s <= steps; s++) {
				const t = s / steps, x = Math.floor(p[0] + toL[0] * t), y = Math.floor(p[1] + toL[1] * t), z = p[2] + toL[2] * t;
				if (x < 0 || y < 0 || x >= W || y >= f.rows) continue;
				const k = y * W + x;
				const sp = f.spans[k];
				if (!sp) continue;
				for (let j = 0; j < sp.length; j += 2) if (sp[j] < z - 0.25 && sp[j + 1] > z + 0.75) return true;
			}
			return false;
		}

		_heightfield(img) {
			const r = this.result, f = r.floor, d = img.data;
			for (let y = 0; y < f.shown; y++)
				for (let x = 0; x < r.w; x++) {
					const k = y * r.w + x, o = k * 4;
					if (f.top[k] < 0) { const g = y < r.h ? 26 : 16; d.set([g, g, g + 4, 255], o); continue; }
					const t = TS.clamp(f.top[k] / 96, 0, 1);
					let c = [40 + 60 * t, 90 + 150 * t, 200 - 120 * t];
					if (f.bottom[k] > 0.75 && (x + y) % 6 < 3) c = c.map((v) => v * 0.35);
					else if (f.spans[k] && f.spans[k].length > 2 && (x - y) % 6 < 2) c = c.map((v) => v * 0.55 + 90);
					d.set([c[0], c[1], c[2], 255], o);
				}
		}
	}

	TS.Output = Output;
})();
