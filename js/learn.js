// Learn: short animated lessons in a centred window over a dimmed Studio. Every lesson is a self-playing loop that draws the real
// BasicSample scene (js/sample_basic.js) in isometric 3D: its own boxes, textured with its own art. Nothing to adjust: watch, read the
// caption, press Next. A tiny canvas renderer does it (no WebGL): each triangle of each model is texture-mapped with the atlas,
// using the Studio's own art projection (u, v) = (x, y - z).
// Open with the Learn button (or L); arrows go back / next, Space pauses, Esc closes.
"use strict";
(function () {
	const $ = (id) => document.getElementById(id);
	const W = 720, H = 380; // the stage, in CSS px
	const C = { x: "#ec5f59", y: "#74c655", z: "#5b97f5", amber: "#ffb35c", dim: "#8b8e9a", ok: "#5ac86e", bad: "#ff5b8a", ink: "#e6e8ee", floor: "#5ac86e", deco: "#5a96eb", solid: "#eb963c", wall: "#d25ad2", side: "#46d2dc" };
	const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
	const lerp = (a, b, k) => a + (b - a) * k;
	const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
	const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
	const sege = (t, a, b) => ease(seg(t, a, b));
	const rad = (d) => (d * Math.PI) / 180;
	const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

	const SPEED = 0.75; // playback speed: slower than the timelines are written, so there is time to read
	const dpr = () => Math.min(2, window.devicePixelRatio || 1);
	const B = () => TS.samples && TS.samples.basic;
	const atlas = new Image();
	let ready = false;
	atlas.onload = () => { ready = true; };
	if (B()) atlas.src = B().tileset;

	// --- models -------------------------------------------------------------------------------------------------------
	// {key, verts, faces: [[i..]], uv: per vertex [u, v] in atlas px (the art stays where it was drawn), color (untextured)}
	function sampleModels() {
		return B().objects.map((o) => ({
			key: o.name === "Plane.01" ? "char" : o.name === "Box.02" ? "floor" : "wall", name: o.name,
			verts: o.verts.map((v) => v.slice()), uv: o.verts.map((v) => [v[0], v[1] - v[2]]), faces: o.faces.map((f) => f.v.slice()), side: "#59606e",
		}));
	}
	function boxModel(key, x0, y0, z0, x1, y1, z1, color, order) {
		return { key, order, color, verts: [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
			faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]] };
	}
	const bounds = (m, off = [0, 0, 0]) => {
		const b = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
		for (const v of m.verts) for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], v[k] + off[k]); b.max[k] = Math.max(b.max[k], v[k] + off[k]); }
		return b;
	};

	// --- camera -------------------------------------------------------------------------------------------------------
	// Screen = (x', (y' sin(el) - z cos(el)) * sigma) after turning the world by yaw. yaw 0, el 45 deg, sigma sqrt2 is exactly the
	// Studio's own view (canvas = (X, Y - Z)); yaw ~40, el ~35, sigma 1 is the isometric one.
	const WC = [90, 150, 30];
	const STUDIO = { yaw: 0, el: rad(45), sigma: Math.SQRT2 };
	const ISO = { yaw: rad(40), el: rad(33), sigma: 1 };
	const mix = (a, b, k) => ({ yaw: lerp(a.yaw, b.yaw, k), el: lerp(a.el, b.el, k), sigma: lerp(a.sigma, b.sigma, k) });
	const camAt = (v, s, cx = W / 2, cy = H / 2 + 6) => Object.assign({ s, cx, cy }, v);
	function project(p, cam) {
		const dx = p[0] - WC[0], dy = p[1] - WC[1], dz = p[2] - WC[2], cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), ce = Math.cos(cam.el), se = Math.sin(cam.el);
		const x2 = dx * cy - dy * sy, y2 = dx * sy + dy * cy;
		return [cam.cx + x2 * cam.s, cam.cy + (y2 * se - dz * ce) * cam.sigma * cam.s, y2 * ce + dz * se];
	}

	// --- drawing ------------------------------------------------------------------------------------------------------
	const SHADE = (() => { const l = [-0.3, 0.45, 0.85], n = Math.hypot(...l); return l.map((v) => v / n); })();
	const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
	const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
	const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
	const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

	function tri(g, pts, fill) {
		g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); g.lineTo(pts[1][0], pts[1][1]); g.lineTo(pts[2][0], pts[2][1]); g.closePath();
		g.fillStyle = fill; g.fill();
	}
	// Texture-map one triangle: the affine map from atlas (u, v) to the screen points, clipped to the (slightly grown) triangle.
	function texTri(g, pts, uv) {
		const [u0, v0] = uv[0], [u1, v1] = uv[1], [u2, v2] = uv[2], den = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
		if (Math.abs(den) < 0.5) return false;
		const [x0, y0] = pts[0], [x1, y1] = pts[1], [x2, y2] = pts[2];
		const a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / den, c = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / den, e = x0 - a * u0 - c * v0;
		const b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / den, d = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / den, f = y0 - b * u0 - d * v0;
		const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3, grow = (p) => { const l = Math.hypot(p[0] - cx, p[1] - cy) || 1; return [p[0] + ((p[0] - cx) / l) * 0.6, p[1] + ((p[1] - cy) / l) * 0.6]; };
		const q = pts.map(grow);
		g.save();
		g.beginPath(); g.moveTo(q[0][0], q[0][1]); g.lineTo(q[1][0], q[1][1]); g.lineTo(q[2][0], q[2][1]); g.closePath(); g.clip();
		g.transform(a, b, c, d, e, f);
		const su = Math.max(0, Math.floor(Math.min(u0, u1, u2)) - 1), sv = Math.max(0, Math.floor(Math.min(v0, v1, v2)) - 1);
		const eu = Math.min(atlas.width, Math.ceil(Math.max(u0, u1, u2)) + 1), ev = Math.min(atlas.height, Math.ceil(Math.max(v0, v1, v2)) + 1);
		if (eu > su && ev > sv) g.drawImage(atlas, su, sv, eu - su, ev - sv, su, sv, eu - su, ev - sv);
		g.restore();
		return true;
	}

	// A scratch layer the size of the stage: lit / tinted models are drawn here first, so the lighting only lands on their own
	// opaque pixels (a character card has transparent corners that must stay clear).
	let layer = null;
	function layerCtx(d) {
		if (!layer) layer = document.createElement("canvas");
		if (layer.width !== W * d || layer.height !== H * d) { layer.width = W * d; layer.height = H * d; }
		const lg = layer.getContext("2d");
		lg.setTransform(1, 0, 0, 1, 0, 0); lg.clearRect(0, 0, layer.width, layer.height); lg.setTransform(d, 0, 0, d, 0, 0);
		lg.imageSmoothingEnabled = false; lg.globalAlpha = 1; lg.globalCompositeOperation = "source-over";
		return lg;
	}

	// One model. o: off [dx, dy, dz], alpha, tint {rgb, a}, lamp [x, y, z] (lights it), flatLook (no texture).
	function drawModel(g, m, cam, o = {}) {
		const off = o.off || [0, 0, 0], world = m.verts.map((v) => [v[0] + off[0], v[1] + off[1], v[2] + off[2]]), P = world.map((p) => project(p, cam));
		const order = m.faces.map((f, i) => ({ f, d: f.reduce((s, k) => s + P[k][2], 0) / f.length })).sort((a, b) => a.d - b.d);
		const layered = !!(o.lamp || o.tint), d = dpr(), q = layered ? layerCtx(d) : g;
		if (!layered) { g.save(); g.globalAlpha = o.alpha === undefined ? 1 : o.alpha; }
		for (const { f } of order)
			for (let i = 1; i + 1 < f.length; i++) {
				const ids = [f[0], f[i], f[i + 1]], pts = ids.map((k) => P[k]), w = ids.map((k) => world[k]);
				const n = norm(cross(sub(w[1], w[0]), sub(w[2], w[0])));
				const textured = m.uv && ready && !o.flatLook && texTri(q, pts, ids.map((k) => m.uv[k]));
				if (!textured) {
					const k = 0.55 + 0.45 * Math.abs(dot(n, SHADE)), c = hex(m.color || m.side || "#59606e");
					tri(q, pts, `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})`);
				}
				if (layered) q.globalCompositeOperation = "source-atop";
				if (o.lamp) {
					const mid = [(w[0][0] + w[1][0] + w[2][0]) / 3, (w[0][1] + w[1][1] + w[2][1]) / 3, (w[0][2] + w[1][2] + w[2][2]) / 3], to = sub(o.lamp, mid), dist = Math.hypot(...to);
					const lit = Math.abs(dot(n, norm(to))) * Math.pow(clamp(1 - dist / 300, 0, 1), 1.4) * 2.2, al = clamp(0.8 - 0.8 * (0.18 + lit), 0, 0.8);
					tri(q, pts, `rgba(4,6,14,${al})`);
				}
				if (o.tint) tri(q, pts, `rgba(${o.tint.rgb[0]},${o.tint.rgb[1]},${o.tint.rgb[2]},${o.tint.a})`);
				if (layered) q.globalCompositeOperation = "source-over";
			}
		if (layered) { g.save(); g.globalAlpha = o.alpha === undefined ? 1 : o.alpha; g.drawImage(layer, 0, 0, W, H); g.restore(); }
		else g.restore();
	}
	// Models in a sensible painter's order: flat ground first, then north to south (by their southern edge).
	function drawWorld(g, cam, models, optsFor = () => ({})) {
		const key = (m) => { const o = optsFor(m).off || [0, 0, 0], b = bounds(m, o); return [b.max[2] <= 2 ? 0 : 1, m.order !== undefined ? m.order : b.max[1]]; };
		for (const m of models.slice().sort((a, b) => { const ka = key(a), kb = key(b); return ka[0] - kb[0] || ka[1] - kb[1]; })) drawModel(g, m, cam, optsFor(m));
	}
	function ground(g, cam, a = 1, x0 = -6, x1 = 186, y0 = 96, y1 = 224) {
		g.save(); g.globalAlpha = a;
		const quad = [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]].map((p) => project(p, cam));
		g.beginPath(); quad.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fillStyle = "#171a22"; g.fill();
		g.strokeStyle = "rgba(120,170,255,0.2)"; g.lineWidth = 1;
		for (let x = Math.ceil(x0 / 32) * 32; x <= x1; x += 32) { const a1 = project([x, y0, 0], cam), b1 = project([x, y1, 0], cam); g.beginPath(); g.moveTo(a1[0], a1[1]); g.lineTo(b1[0], b1[1]); g.stroke(); }
		for (let y = Math.ceil(y0 / 32) * 32; y <= y1; y += 32) { const a1 = project([x0, y, 0], cam), b1 = project([x1, y, 0], cam); g.beginPath(); g.moveTo(a1[0], a1[1]); g.lineTo(b1[0], b1[1]); g.stroke(); }
		g.restore();
	}
	function hull(pts) {
		const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
		if (p.length < 3) return p;
		const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
		for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
		for (const q of p.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
		return lo.slice(0, -1).concat(up.slice(0, -1));
	}
	// The shadow of a model on the ground from a point lamp.
	function shadow(g, cam, m, L, off = [0, 0, 0], a = 0.5) {
		const pts = [];
		for (const v of m.verts) {
			const p = [v[0] + off[0], v[1] + off[1], v[2] + off[2]];
			if (p[2] >= L[2] - 1) continue;
			const k = L[2] / (L[2] - Math.max(0, p[2]));
			pts.push(project([L[0] + (p[0] - L[0]) * k, L[1] + (p[1] - L[1]) * k, 0], cam));
		}
		const h = hull(pts);
		if (h.length < 3) return;
		g.beginPath(); h.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fillStyle = `rgba(0,0,0,${a})`; g.fill();
	}
	// A filled footprint (rectangle on the ground).
	function footprint(g, cam, x0, y0, x1, y1, fill, stroke, dash = []) {
		const q = [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]].map((p) => project(p, cam));
		g.save(); g.beginPath(); q.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath();
		if (fill) { g.fillStyle = fill; g.fill(); }
		if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.setLineDash(dash); g.stroke(); }
		g.restore();
	}
	function pill(g, x, y, text, col, a = 1, size = 14) {
		if (a <= 0.01) return;
		g.save(); g.globalAlpha = a; g.font = `bold ${size}px system-ui, sans-serif`;
		const w = g.measureText(text).width + 18, h = size + 10;
		g.fillStyle = "rgba(12,13,18,0.88)"; g.strokeStyle = col; g.lineWidth = 2;
		g.beginPath(); g.roundRect(x - w / 2, y - h / 2, w, h, h / 2); g.fill(); g.stroke();
		g.fillStyle = col; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, x, y + 1);
		g.restore();
	}
	function arrow(g, a, b, col, a2 = 1, w = 3) {
		g.save(); g.globalAlpha = a2; g.strokeStyle = col; g.fillStyle = col; g.lineWidth = w; g.lineCap = "round";
		g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
		const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
		g.beginPath(); g.moveTo(b[0], b[1]); g.lineTo(b[0] - 11 * Math.cos(ang - 0.45), b[1] - 11 * Math.sin(ang - 0.45)); g.lineTo(b[0] - 11 * Math.cos(ang + 0.45), b[1] - 11 * Math.sin(ang + 0.45)); g.closePath(); g.fill();
		g.restore();
	}
	function text(g, s, x, y, col = C.ink, size = 14, align = "center", a = 1) {
		g.save(); g.globalAlpha = a; g.fillStyle = col; g.font = `bold ${size}px system-ui, sans-serif`; g.textAlign = align; g.textBaseline = "middle"; g.fillText(s, x, y); g.restore();
	}
	function bg(g) {
		const k = g.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.62); k.addColorStop(0, "#1d2029"); k.addColorStop(1, "#0d0e13");
		g.fillStyle = k; g.fillRect(0, 0, W, H);
	}
	function drawAtlas(g, ox, oy, s, a = 1) {
		if (!ready) return;
		g.save(); g.globalAlpha = a; g.imageSmoothingEnabled = false;
		g.drawImage(atlas, 0, 0, 256, 256, ox, oy, 256 * s, 256 * s);
		g.restore();
	}
	// The flat atlas picture, drawn where the Studio's view would put it for a camera of scale s centred on WC.
	function flatPicture(g, s, a = 1, cx = W / 2, cy = H / 2 + 6) {
		if (!ready) return;
		g.save(); g.globalAlpha = a; g.imageSmoothingEnabled = false;
		g.drawImage(atlas, 0, 0, 256, 256, cx - WC[0] * s, cy - (WC[1] - WC[2]) * s, 256 * s, 256 * s);
		g.restore();
	}

	// --- the lessons --------------------------------------------------------------------------------------------------
	// scene(g, t, fx): draws one frame at time t (loops every `dur` seconds). caps: [{t, say, sub}] captions over time.
	const L = [];
	const wallTop = () => ({ near: [90, 129, 96] });

	// 1 ---------------------------------------------------------------------------------------------------------------
	L.push({
		title: "The big idea", dur: 14,
		caps: [
			{ t: 0, say: "Your art is a flat picture.", sub: "Pretty, but the game can't tell how tall anything is." },
			{ t: 3.4, say: "The Studio puts simple boxes under it.", sub: "Same picture, same place. The boxes just add depth." },
			{ t: 6.2, say: "Turn it around: now it has height and depth.", sub: "That's what lets the game light it, shadow it and block the player." },
			{ t: 10.4, say: "Your job: make the boxes match the art.", sub: "Not pretty. Just the right size, in the right spot." },
		],
		show: [["lit", "Lit view"], ["kind", "Kind view"]],
		make() {
			const models = sampleModels();
			return (g, t) => {
				bg(g);
				const s = 1.75, k = sege(t, 5, 8.2), back = sege(t, 12.4, 14), kk = k * (1 - back);
				const swing = t > 8.2 && t < 12.4 ? Math.sin((t - 8.2) * 1.0) * rad(14) : 0, view = mix(STUDIO, { yaw: ISO.yaw + swing, el: ISO.el, sigma: ISO.sigma }, kk);
				const cam = camAt(view, s);
				ground(g, cam, kk);
				const flat = 1 - seg(t, 3, 4.4) * (1 - back); // the picture fades out as the boxes take over
				flatPicture(g, s, t < 3 ? 1 : flat);
				if (t >= 3 || back > 0) {
					g.save(); g.globalAlpha = clamp(Math.max(seg(t, 3, 4.4), back), 0, 1) * (t < 12.4 || back > 0 ? 1 : 1); drawWorld(g, cam, models); g.restore();
				}
				// the three directions, on the wall's corner, while turning
				const aa = seg(t, 6.6, 7.6) * (1 - seg(t, 11.4, 12.2));
				if (aa > 0.01) {
					const o = project([64, 129, 0], cam), px = project([64 + 38, 129, 0], cam), py = project([64, 129 + 34, 0], cam), pz = project([64, 129, 52], cam);
					arrow(g, o, px, C.x, aa); arrow(g, o, py, C.y, aa); arrow(g, o, pz, C.z, aa);
					pill(g, px[0] + 22, px[1] + 2, "wide", C.x, aa, 13); pill(g, py[0] + 12, py[1] + 14, "deep", C.y, aa, 13); pill(g, pz[0], pz[1] - 16, "tall", C.z, aa, 13);
				}
				pill(g, 112, 28, t < 3.4 ? "① the art" : "② the art + boxes", C.amber, 1, 14);
			};
		},
	});

	// 2 ---------------------------------------------------------------------------------------------------------------
	// Y (depth, south) and Z (height, up) look alike in the picture: +Y moves a thing down the screen, +Z moves it up, so equal
	// amounts of both cancel. Left: the Studio's view, the box outline over the fixed picture. Right: the game's view.
	L.push({
		title: "Y and Z look alike", dur: 29,
		caps: [
			{ t: 0, say: "The wall box sits exactly on the art.", sub: "Left: the Studio, the box outline over the picture. Right: where the game puts it." },
			{ t: 3, say: "Move it deeper (Y): it slides down the picture.", sub: "Y runs away from you along the floor, so on screen it goes down." },
			{ t: 11, say: "Raise it (Z): it slides up the picture.", sub: "Z is height, so on screen it goes up." },
			{ t: 19, say: "Do both: they cancel out in the picture.", sub: "Down by Y, up by Z. On screen: no change at all." },
			{ t: 24, say: "…but the game has the wall in the wrong place.", sub: "Its shadow and its collision follow the box, not the picture." },
			{ t: 27, say: "Y and Z look alike. Only you can tell them apart.", sub: "So: bottoms on the floor, tops at their real height." },
		],
		show: [["heightfield", "Floor view"]],
		make() {
			const models = sampleModels(), wall = models.find((m) => m.key === "wall"), wb = bounds(wall), N = 34;
			const up = (t, a1, a2, b1, b2) => sege(t, a1, a2) - sege(t, b1, b2);
			return (g, t) => {
				bg(g);
				const dy = N * (up(t, 3, 6.5, 8, 10.5) + up(t, 19, 23, 26, 28.5)), dz = N * (up(t, 11, 14.5, 16, 18.5) + up(t, 19, 23, 26, 28.5)), off = (m) => (m.key === "wall" ? { off: [0, dy, dz] } : {});
				g.fillStyle = "rgba(255,255,255,0.08)"; g.fillRect(W / 2 - 1, 36, 2, H - 70);
				const sL = 1.45, camL = camAt(STUDIO, sL, W * 0.25, H / 2 + 20), camR = camAt(ISO, 1.5, W * 0.75, H / 2 + 14);
				// left: the fixed picture, and the box outline over it
				flatPicture(g, sL, 0.7, W * 0.25, H / 2 + 20);
				const P = wall.verts.map((v) => project([v[0], v[1] + dy, v[2] + dz], camL)), match = Math.abs(dy - dz) < 0.6;
				g.save(); g.lineWidth = 1.5; g.strokeStyle = match ? "rgba(120,230,150,0.95)" : "rgba(255,120,150,0.95)"; g.fillStyle = match ? "rgba(90,200,110,0.16)" : "rgba(255,91,138,0.18)";
				for (const f of wall.faces) { g.beginPath(); f.forEach((k, i) => (i ? g.lineTo(P[k][0], P[k][1]) : g.moveTo(P[k][0], P[k][1]))); g.closePath(); g.fill(); g.stroke(); }
				g.restore();
				// the numbers: Y and Z, and what the picture sees
				const row = Math.round(dy - dz);
				pill(g, W * 0.25 - 62, H - 52, "Y +" + Math.round(dy), C.y, 1, 14); pill(g, W * 0.25 + 28, H - 52, "Z +" + Math.round(dz), C.z, 1, 14);
				pill(g, W * 0.25, H - 24, row === 0 ? (dy > 0.5 ? "on screen: no change ✓" : "box matches the art ✓") : "on screen: " + (row > 0 ? "down " : "up ") + Math.abs(row), row === 0 ? C.ok : C.amber, 1, 14);
				// right: the game
				ground(g, camR, 1);
				footprint(g, camR, wb.min[0], wb.min[1], wb.max[0], wb.max[1], null, "rgba(255,255,255,0.5)", [5, 4]);
				const wrongY = dy > 0.5, wrongZ = dz > 0.5, bad = wrongY || wrongZ;
				footprint(g, camR, wb.min[0], wb.min[1] + dy, wb.max[0], wb.max[1] + dy, bad ? "rgba(255,91,138,0.28)" : "rgba(90,200,110,0.3)", bad ? C.bad : C.ok);
				drawWorld(g, camR, models, off);
				if (wrongZ) { const a = project([wb.max[0], wb.max[1] + dy, 0], camR), b2 = project([wb.max[0], wb.max[1] + dy, dz], camR); arrow(g, a, b2, C.z, 0.9, 2); }
				if (wrongY) { const a = project([wb.max[0] + 8, wb.max[1], 0], camR), b2 = project([wb.max[0] + 8, wb.max[1] + dy, 0], camR); arrow(g, a, b2, C.y, 0.9, 2); }
				text(g, "① what you see (Studio)", W * 0.25, 22, C.amber, 14); text(g, "② where the game puts it", W * 0.75, 22, C.amber, 14);
				pill(g, W * 0.75, H - 24, !bad ? "✓ right place" : wrongY && wrongZ ? "✗ floating, and too far south" : wrongY ? "✗ too far south on the floor" : "✗ floating above the floor", bad ? C.bad : C.ok, 1, 14);
			};
		},
	});

	// 3 ---------------------------------------------------------------------------------------------------------------
	L.push({
		title: "Light and shadows", dur: 16,
		caps: [
			{ t: 0, say: "A lamp lights your scene.", sub: "It lights the boxes you made, using the art's colours." },
			{ t: 3.6, say: "And the boxes throw shadows.", sub: "Taller box, longer shadow. That's why heights matter." },
			{ t: 8.6, say: "Lower the lamp and shadows stretch out.", sub: "A high lamp makes short shadows." },
			{ t: 12.6, say: "A wrong box height gives a wrong shadow.", sub: "Not the picture: the box." },
		],
		show: [["lit", "Lit view (drag the light)"]],
		make() {
			const models = sampleModels();
			return (g, t) => {
				bg(g);
				const cam = camAt(ISO, 2.0);
				const lampK = t < 8.6 ? 0 : sege(t, 8.6, 11);
				const lz = lerp(95, 38, lampK) - 0 * t, back = sege(t, 13.6, 16);
				const ang = t < 8.6 ? lerp(-0.2, 1.0, (Math.sin((t / 8.6) * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5)) : 0.9;
				const LP = [lerp(10, 170, ang), 160 - 30 * Math.sin(t * 0.7) * 0, lz * (1 - back) + 95 * back];
				ground(g, cam, 1);
				const shadowK = seg(t, 3.4, 4.6);
				// the wall in the last part is too low: shadow of a shorter box
				const squash = sege(t, 12.6, 14.4) * (1 - sege(t, 14.6, 16));
				const lowWall = (m) => (m.key === "wall" ? { off: [0, 0, 0] } : {});
				const wallShort = models.find((m) => m.key === "wall");
				if (shadowK > 0) for (const m of models) { if (m.key === "floor") continue; if (m.key === "wall" && squash > 0.01) { const sq = { verts: m.verts.map((v) => [v[0], v[1], v[2] * (1 - 0.55 * squash)]) }; shadow(g, cam, sq, LP, [0, 0, 0], 0.55 * shadowK); } else shadow(g, cam, m, LP, [0, 0, 0], 0.55 * shadowK); }
				// lamp glow on the ground
				const lg = project([LP[0], LP[1], 0], cam), lp = project(LP, cam);
				const glow = g.createRadialGradient(lg[0], lg[1], 4, lg[0], lg[1], 120); glow.addColorStop(0, "rgba(255,220,120,0.28)"); glow.addColorStop(1, "rgba(255,220,120,0)");
				g.fillStyle = glow; g.fillRect(lg[0] - 130, lg[1] - 130, 260, 260);
				drawWorld(g, cam, models, () => ({ lamp: LP }));
				g.save(); g.strokeStyle = "rgba(255,220,120,0.55)"; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(lg[0], lg[1]); g.lineTo(lp[0], lp[1]); g.stroke(); g.restore();
				const rg = g.createRadialGradient(lp[0], lp[1], 1, lp[0], lp[1], 16); rg.addColorStop(0, "#fff6c8"); rg.addColorStop(1, "rgba(255,200,80,0)");
				g.fillStyle = rg; g.beginPath(); g.arc(lp[0], lp[1], 16, 0, 7); g.fill();
				g.fillStyle = "#fff2b0"; g.beginPath(); g.arc(lp[0], lp[1], 6, 0, 7); g.fill();
				pill(g, 70, 28, "lamp", "#ffd878", 1, 13);
				if (squash > 0.05) pill(g, W - 130, 40, "box too low → shadow too short", C.bad, clamp(squash * 2, 0, 1), 13);
			};
		},
	});

	// 4 ---------------------------------------------------------------------------------------------------------------
	L.push({
		title: "Walk over it, or blocked?", dur: 16,
		caps: [
			{ t: 0, say: "Our character wants to walk east.", sub: "The stone floor is only 2 px thick." },
			{ t: 3, say: "Low things are walked over.", sub: "Under about 2 px tall the game calls it floor: no collision." },
			{ t: 7.4, say: "Now north, toward the wall.", sub: "The wall is 96 px tall." },
			{ t: 10, say: "Tall things block you.", sub: "A thin collision strip along the wall's front stops the player." },
			{ t: 13.4, say: "You rarely set this by hand.", sub: "The Studio works it out from the heights. You can override it per model." },
		],
		show: [["kind", "Kind view"], ["collision", "Collision view"]],
		make() {
			const models = sampleModels(), floor = models.find((m) => m.key === "floor"), wall = models.find((m) => m.key === "wall");
			return (g, t) => {
				bg(g);
				const cam = camAt(ISO, 2.0);
				// path (offset of the character's card): east over the floor, then north into the wall, bump, retreat
				const east = sege(t, 1.6, 6.4), north = sege(t, 8, 10.4), bump = t > 10.4 && t < 13.2 ? Math.abs(Math.sin((t - 10.4) * 5)) * 0.5 * (1 - seg(t, 12, 13.2)) : 0, back = sege(t, 13.4, 15.6);
				const dx = 76 * east, dy = (-50 * north + bump * 4) * (1 - back) - 0, ex = dx * (1 - back * 0.0);
				const off = (m) => (m.key === "char" ? { off: [ex * (1 - back) , dy, 0] } : {});
				ground(g, cam, 1);
				const fb = bounds(floor), wb = bounds(wall);
				const onFloor = east > 0.45 && north < 0.05 || (east > 0.45 && t < 13.4);
				footprint(g, cam, fb.min[0], fb.min[1], fb.max[0], fb.max[1], onFloor && t < 7.4 ? "rgba(90,200,110,0.30)" : null, onFloor && t < 7.4 ? C.ok : null);
				const blocked = north > 0.9 && t < 13.4;
				footprint(g, cam, wb.min[0], wb.max[1] - 3, wb.max[0], wb.max[1] + 1, blocked ? "rgba(255,91,138,0.55)" : seg(t, 7.2, 8) > 0 && t < 13.4 ? "rgba(255,91,138,0.18)" : null, blocked ? C.bad : null);
				drawWorld(g, cam, models, off);
				const c = project([22 + ex * (1 - back), 187 + dy, 70], cam);
				if (east > 0.45 && t < 7.4) pill(g, project([112, 165, 0], cam)[0], project([112, 165, 0], cam)[1] + 4, "floor: walk over it ✓", C.ok, seg(t, 4.2, 5), 14);
				if (blocked) { pill(g, c[0] + 56, c[1] - 6, "✋ blocked", C.bad, 1, 15); }
				if (seg(t, 7.4, 8.4) > 0 && t < 13.4) pill(g, project([112, 118, 98], cam)[0], project([112, 118, 98], cam)[1] - 18, "wall: 96 px tall", C.wall, seg(t, 7.4, 8.4), 13);
			};
		},
	});

	// 5 ---------------------------------------------------------------------------------------------------------------
	const KINDS = [
		{ k: "floor", say: "Floor: you walk on it.", sub: "Rugs, paths, the stone floor here.", key: "floor" },
		{ k: "deco", say: "Deco: it only looks nice.", sub: "Posters, grass tufts. No collision, no shadow.", key: "poster" },
		{ k: "solid", say: "Solid: it blocks you.", sub: "Tables, crates, beds.", key: "crate" },
		{ k: "wall", say: "Wall: the tall wall at the back.", sub: "The torch's light lands on it.", key: "wall" },
		{ k: "side", say: "Side: a wall on the left or right.", sub: "It blocks light going east and west.", key: "side" },
	];
	L.push({
		title: "Give each thing a job", dur: 17,
		caps: [{ t: 0, say: "Every model has a job: its kind.", sub: "Watch the five kinds light up one by one." }].concat(KINDS.map((k, i) => ({ t: 2 + i * 3, say: k.say, sub: k.sub }))).concat([{ t: 17 - 0.01, say: "", sub: "" }]).slice(0, 6),
		show: [["kind", "Kind view"]],
		make() {
			const models = sampleModels();
			models.push(boxModel("crate", 100, 148, 0, 126, 174, 22, "#9a7248"));
			models.push(Object.assign(boxModel("poster", 94, 128.4, 40, 122, 128.7, 68, "#d9a24a"), { order: 131 }));
			models.push(boxModel("side", 164, 113, 0, 172, 192, 84, "#6a7488"));
			const nameOf = { floor: "floor", crate: "solid", poster: "deco", wall: "wall", side: "side" };
			return (g, t) => {
				bg(g);
				const cam = camAt(ISO, 2.0, W / 2 - 8);
				ground(g, cam, 1);
				const idx = t < 2 ? -1 : Math.min(4, Math.floor((t - 2) / 3)), local = (t - 2) - idx * 3, pulse = 0.55 + 0.25 * Math.sin(t * 5);
				drawWorld(g, cam, models, (m) => {
					const kd = KINDS[idx], on = kd && m.key === kd.key;
					if (idx < 0) return {};
					return on ? { tint: { rgb: hex(C[kd.k]), a: pulse * 0.6 } } : { alpha: 0.38 };
				});
				if (idx >= 0) {
					const kd = KINDS[idx], m = models.find((q) => q.key === kd.key), b = bounds(m), mid = project([(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2], cam);
					const a = sege(local, 0, 0.4) * (1 - sege(local, 2.6, 3)), lx = W - 100, ly = 56 + 0;
					arrow(g, [lx - 52, ly + 14], [mid[0] + (mid[0] < lx ? 14 : -14), mid[1] - 8], C[kd.k], a * 0.8, 2);
					pill(g, lx, ly, kd.k.toUpperCase(), C[kd.k], a, 18);
				}
				KINDS.forEach((kd, i) => { const y = 36 + i * 27; g.save(); g.globalAlpha = i === idx ? 1 : 0.35; g.fillStyle = C[kd.k]; g.beginPath(); g.roundRect(18, y - 8, 16, 16, 4); g.fill(); g.restore(); text(g, kd.k, 42, y, i === idx ? C.ink : C.dim, 14, "left"); });
			};
		},
	});

	// 6 ---------------------------------------------------------------------------------------------------------------
	let cellData = null;
	function cellOwners() {
		if (cellData || !ready) return cellData;
		const cv = document.createElement("canvas"); cv.width = atlas.width; cv.height = atlas.height;
		const cx = cv.getContext("2d"); cx.drawImage(atlas, 0, 0);
		const px = cx.getImageData(0, 0, cv.width, cv.height), alpha = new Uint8Array(cv.width * cv.height);
		for (let i = 0; i < alpha.length; i++) alpha[i] = px.data[i * 4 + 3];
		const settings = { alphaCut: 13, fill: 2, relief: 0.5, body: 40, step: 4, walkOverHeight: 2 }, objects = JSON.parse(JSON.stringify(B().objects));
		const r = TS.Process.run(objects, { w: cv.width, h: cv.height, alpha, data: px.data }, settings), own = TS.Process.cellOwnership(objects, r, settings);
		const key = (o) => (o.name === "Plane.01" ? "char" : o.name === "Box.02" ? "floor" : "wall");
		cellData = { cells: {}, clashes: own.clashes };
		objects.forEach((o, i) => { cellData.cells[key(o)] = own.cells[i]; });
		return cellData;
	}
	L.push({
		title: "One tile, one thing", dur: 17,
		caps: [
			{ t: 0, say: "The game reads your art in square tiles.", sub: "Each is 32 × 32 pixels." },
			{ t: 1.8, say: "Every box owns the tiles it covers.", sub: "Character, then stone floor, then back wall." },
			{ t: 8.6, say: "A few tiles are shared by the floor and the wall.", sub: "That's fine: they touch, so they count as one piece." },
			{ t: 11.4, say: "But two separate things in one tile is a problem.", sub: "The game can't tell whose tile it is. The Studio warns you." },
			{ t: 15, say: "Fix it by moving one so each tile has one thing.", sub: "" },
		],
		show: [["pieces", "Pieces view"]],
		make() {
			const models = sampleModels(), ch = models.find((m) => m.key === "char"), cb = bounds(ch), colors = { char: C.solid, floor: C.floor, wall: C.deco };
			return (g, t) => {
				bg(g);
				const data = cellOwners();
				if (!data) { text(g, "loading…", W / 2, H / 2, C.dim, 16); return; }
				const s = 1.95, cx = W / 2, cy = H / 2 + 6, sx = (u) => cx + (u - 88) * s, sy = (v) => cy + (v - 108) * s;
				drawAtlas(g, sx(0), sy(0), s, 0.6);
				// the 32 px grid
				g.save(); g.strokeStyle = "rgba(255,255,255,0.18)"; g.lineWidth = 1;
				const gridA = seg(t, 0.2, 1.4);
				g.globalAlpha = gridA;
				for (let u = 0; u <= 192; u += 32) { g.beginPath(); g.moveTo(sx(u), sy(0)); g.lineTo(sx(u), sy(224)); g.stroke(); }
				for (let v = 0; v <= 224; v += 32) { g.beginPath(); g.moveTo(sx(0), sy(v)); g.lineTo(sx(192), sy(v)); g.stroke(); }
				g.restore();
				const cell = (c, col, a) => { g.fillStyle = col; g.globalAlpha = a; g.fillRect(sx(c[0] * 32) + 1, sy(c[1] * 32) + 1, 32 * s - 2, 32 * s - 2); g.globalAlpha = 1; };
				const phase = [["char", 1.8, 4.6], ["floor", 4.6, 6.8], ["wall", 6.8, 8.8]];
				for (const [key, a, b] of phase) {
					const k = seg(t, a, a + 0.8), keep = t > b ? 0.35 : 1;
					for (const c of data.cells[key]) cell(c, colors[key], 0.45 * k * keep * (t > b ? 1 : 0.8 + 0.2 * Math.sin(t * 6)));
					if (t >= a && t < b + 0.2) pill(g, W - 90, 40, key === "char" ? "character" : key === "floor" ? "stone floor" : "back wall", colors[key], k, 15);
				}
				// shared tiles of floor + wall (same piece)
				const shared = data.clashes.filter((c) => c.samePiece);
				const sa = seg(t, 8.8, 9.6) * (1 - seg(t, 11.2, 11.8));
				if (sa > 0) { for (const c of shared) cell(c.cell, "#ffd24d", 0.55 * sa); pill(g, W - 130, 40, "shared · one piece · OK ✓", "#ffd24d", sa, 14); }
				// the problem: the character walks over the wall's tiles
				const slide = sege(t, 11.6, 13.4) * (1 - sege(t, 15.2, 16.4)), shiftU = 72 * slide;
				if (t >= 11.4) {
					const rect = { x0: cb.min[0] + shiftU, x1: cb.max[0] + shiftU, y0: cb.min[1] - cb.max[2], y1: cb.max[1] };
					g.save(); g.imageSmoothingEnabled = false;
					g.drawImage(atlas, 2, 123, 41, 64, sx(2 + shiftU), sy(123), 41 * s, 64 * s);
					g.restore();
					const mine = [];
					for (let cxx = Math.floor(rect.x0 / 32); cxx <= Math.floor((rect.x1 - 1) / 32); cxx++) for (let cyy = Math.floor(rect.y0 / 32); cyy <= Math.floor((rect.y1 - 1) / 32); cyy++) mine.push([cxx, cyy]);
					const hit = mine.filter((c) => data.cells.wall.some((w) => w[0] === c[0] && w[1] === c[1]) || data.cells.floor.some((w) => w[0] === c[0] && w[1] === c[1]));
					const ha = seg(t, 12.6, 13.4) * (1 - sege(t, 15.2, 16.4));
					for (const c of hit) { cell(c, "#ff5b8a", 0.4 * ha); g.save(); g.strokeStyle = C.bad; g.lineWidth = 3; g.setLineDash([6, 4]); g.globalAlpha = ha; g.strokeRect(sx(c[0] * 32) + 2, sy(c[1] * 32) + 2, 32 * s - 4, 32 * s - 4); g.restore(); }
					if (ha > 0.05) pill(g, W - 130, 40, "✗ two things in one tile", C.bad, ha, 14);
				}
			};
		},
	});

	// 7 ---------------------------------------------------------------------------------------------------------------
	L.push({
		title: "Your first five minutes", dur: 20, steps: true,
		caps: [{ t: 0, say: "Five steps. You've got this.", sub: "Tap a step to tick it off." }],
		show: [["lit", "Lit"], ["holes", "Holes"], ["kind", "Kind"], ["collision", "Collision"]],
		extra: `<ol class="todo">
			<li style="--d:0s"><span>1</span><div><b>Cover the art with boxes.</b><br><small>Shift+A adds one. G moves, S resizes. Stuck? Add BasicSample as a ghost (left panel, References).</small></div></li>
			<li style="--d:.12s"><span>2</span><div><b>Fix the heights.</b><br><small>Select a box, then Properties → Placement. Bottoms on the floor.</small></div></li>
			<li style="--d:.24s"><span>3</span><div><b>Press Process, then look at Lit.</b><br><small>Drag the light low across the scene. Do the shadows look right?</small></div></li>
			<li style="--d:.36s"><span>4</span><div><b>Check the jobs.</b><br><small>Wall and side set? Rugs walkable? See the Kind and Collision views.</small></div></li>
			<li style="--d:.48s"><span>5</span><div><b>Export → Godot bundle.</b><br><small>Also Save project, so the export keeps its identity.</small></div></li>
		</ol>
		<div class="row"><button id="l_sample" class="primary">Open the BasicSample scene</button><button id="l_ghost">👻 Add it as a ghost</button></div>`,
		make() {
			const models = sampleModels();
			return (g, t) => {
				bg(g);
				const cam = camAt({ yaw: rad(40) + Math.sin(t * 0.5) * rad(22), el: ISO.el, sigma: 1 }, 1.9);
				ground(g, cam, 1);
				drawWorld(g, cam, models);
			};
		},
	});

	// The BasicSample scene (js/sample_basic.js), opened as the project.
	async function loadSample() {
		const S = TS.state;
		if ((S.objects.length || S.art) && !confirm("Replace the open project with the BasicSample scene? Unsaved work will be lost.")) return;
		const p = JSON.parse(JSON.stringify(B()));
		p.bundleId = undefined; // a fresh identity: it is a copy to play with
		await TS.api.openProject(JSON.stringify(p));
		close();
		const b = document.querySelector('#outmodes button[data-mode="kind"]'); if (b) b.click();
	}

	// --- the window ---------------------------------------------------------------------------------------------------
	let cur = 0, built = false, raf = 0, scene = null, clock = 0, last = 0, paused = false, capIdx = -1, lesson = null;

	function frame(now) {
		raf = requestAnimationFrame(frame);
		const open = $("learn_back") && $("learn_back").classList.contains("open");
		if (!open || !scene) { last = now; return; }
		if (!paused) clock += Math.min(0.25, (now - last) / 1000) * SPEED;
		last = now;
		const t = clock % lesson.dur, cv = $("learn_cv"), g = cv.getContext("2d"), d = dpr();
		if (cv.width !== W * d) { cv.width = W * d; cv.height = H * d; }
		g.setTransform(d, 0, 0, d, 0, 0);
		g.imageSmoothingEnabled = false;
		g.clearRect(0, 0, W, H);
		try { scene(g, t); } catch (err) { g.fillStyle = "#111"; g.fillRect(0, 0, W, H); text(g, "(animation error: " + err.message + ")", W / 2, H / 2, C.bad, 13); }
		// progress along the loop
		g.fillStyle = "rgba(255,255,255,0.1)"; g.fillRect(0, H - 4, W, 4); g.fillStyle = C.amber; g.fillRect(0, H - 4, W * (t / lesson.dur), 4);
		// captions follow the clock
		let ci = 0;
		lesson.caps.forEach((c, i) => { if (t >= c.t) ci = i; });
		if (ci !== capIdx) {
			capIdx = ci;
			const c = lesson.caps[ci], el = $("learn_cap");
			el.classList.remove("in"); void el.offsetWidth;
			$("learn_say").textContent = c.say; $("learn_sub").textContent = c.sub || "";
			el.classList.add("in");
		}
	}

	function render() {
		lesson = L[cur];
		scene = lesson.make();
		clock = 0; capIdx = -1; last = performance.now();
		$("learn").classList.toggle("compact", !!lesson.steps);
		$("learn_title").textContent = lesson.title;
		$("learn_dots").innerHTML = L.map((l, i) => `<button class="dot${i === cur ? " on" : i < cur ? " seen" : ""}" data-i="${i}" title="${l.title}">${i + 1}</button>`).join("");
		$("learn_dots").querySelectorAll(".dot").forEach((d) => { d.onclick = () => { cur = parseInt(d.dataset.i); render(); }; });
		$("learn_prev").style.visibility = cur === 0 ? "hidden" : "visible";
		$("learn_next").textContent = cur === L.length - 1 ? "Done ✓" : "Next →";
		const ex = $("learn_extra");
		ex.innerHTML = (lesson.extra || "") + (lesson.show && lesson.show.length ? `<div class="row seeit"><span class="dim">See it in the Studio:</span>${lesson.show.map(([m, t]) => `<button class="try" data-show="${m}">👁 ${t}</button>`).join("")}</div>` : "");
		ex.querySelectorAll("[data-show]").forEach((b) => { b.onclick = () => { const v = document.querySelector(`#outmodes button[data-mode="${b.dataset.show}"]`); close(); if (v) v.click(); const s = $("status"); if (s) s.textContent = "Showing the " + b.textContent.replace("👁 ", "") + ". Press L to go back to the lessons."; }; });
		ex.querySelectorAll(".todo li").forEach((li) => { li.onclick = () => li.classList.toggle("done"); });
		if ($("l_sample")) $("l_sample").onclick = () => loadSample();
		if ($("l_ghost")) $("l_ghost").onclick = () => { close(); TS.api.addReference(JSON.stringify(B())).catch((e) => alert(e.message)); };
		$("learn_pause").textContent = paused ? "▶ Play" : "⏸ Pause";
		try { localStorage.setItem("ts.learn", String(cur)); } catch (err) { /* storage blocked */ }
	}

	function build() {
		const back = document.createElement("div");
		back.id = "learn_back"; back.className = "lback";
		back.innerHTML = `<div id="learn" class="learn" role="dialog" aria-label="Lessons">
			<div class="lh"><b id="learn_title"></b><span class="grow"></span><div id="learn_dots" class="dots"></div><button id="learn_x" title="Close (Esc)">✕</button></div>
			<canvas id="learn_cv" class="stage" width="${W}" height="${H}"></canvas>
			<div id="learn_cap" class="cap"><div id="learn_say" class="say"></div><div id="learn_sub" class="subc"></div></div>
			<div id="learn_extra" class="extra"></div>
			<div class="lf"><button id="learn_prev">← Back</button><button id="learn_pause" title="Pause / play (Space)"></button><span class="grow"></span><button id="learn_next" class="primary">Next →</button></div>
		</div>`;
		document.body.appendChild(back);
		back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
		$("learn_x").onclick = close;
		$("learn_prev").onclick = () => { cur = Math.max(0, cur - 1); render(); };
		$("learn_next").onclick = () => { if (cur === L.length - 1) close(); else { cur++; render(); } };
		$("learn_pause").onclick = () => { paused = !paused; $("learn_pause").textContent = paused ? "▶ Play" : "⏸ Pause"; };
		built = true;
		raf = requestAnimationFrame(frame);
	}
	function open(n) {
		if (!built) { build(); try { cur = clamp(parseInt(localStorage.getItem("ts.learn") || "0") || 0, 0, L.length - 1); } catch (err) { cur = 0; } }
		if (typeof n === "number") cur = clamp(n, 0, L.length - 1);
		paused = false;
		$("learn_back").classList.add("open");
		render();
	}
	function close() { const el = $("learn_back"); if (el) el.classList.remove("open"); }
	const isOpen = () => !!$("learn_back") && $("learn_back").classList.contains("open");
	function toggle() { if (isOpen()) close(); else open(); }

	TS.Learn = { open, close, toggle, lessons: L, seek: (t) => { clock = t; paused = true; } }; // seek: for scripted checks
	document.addEventListener("DOMContentLoaded", () => { const b = $("b_learn"); if (b) b.onclick = toggle; });
	document.addEventListener("keydown", (e) => {
		if (isOpen()) {
			if (e.key === "Escape") { close(); e.preventDefault(); e.stopPropagation(); }
			else if (e.key === "ArrowRight") { $("learn_next").click(); e.preventDefault(); e.stopPropagation(); }
			else if (e.key === "ArrowLeft") { $("learn_prev").click(); e.preventDefault(); e.stopPropagation(); }
			else if (e.key === " ") { $("learn_pause").click(); e.preventDefault(); e.stopPropagation(); }
			else if (e.key === "l" || e.key === "L") close();
			return;
		}
		if (e.key !== "l" && e.key !== "L") return;
		if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "")) return;
		open();
	}, true);
})();
