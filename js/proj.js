// Projection: the one place that knows how a world point (X east, Y south, Z up, art px) is drawn on the tileset canvas.
//   oblique  top-down 3/4: canvas (X, Y - Z); the viewer looks along (0, -1, -1). The default; nothing is foreshortened.
//   iso      isometric at camera elevation t = settings.isoTilt (degrees, default 26), k = sin t: canvas (ox + X - Y, oy + k (X + Y) - Z);
//            the viewer looks along (-1, -1, -2k). A 32 px world tile is a 64 x 64k diamond (t = 30: the 2:1 pixel-art look), and 1 px of
//            height is 1 art px up. (ox, oy) is settings.isoOrigin (default: top centre of the art).
// Both are parallel projections, so a canvas pixel (x, y) shows the line toWorld(x, y, 0) + t * dir, and the surface seen there is
// the one with the largest t. Everything that converts between canvas and world (raster, viewport, picking, lighting, grid,
// stamps, export) goes through TS.Proj.of(settings), never its own (X, Y - Z).
//   p.kind           "oblique" | "iso"
//   p.origin         [ox, oy] canvas offset
//   p.matrix         [a, b, c, ox, d, e, f, oy]: canvas x = a X + b Y + c Z + ox, canvas y = d X + e Y + f Z + oy
//   p.dir            the view line's direction (toward the viewer, not unit): oblique (0, 1, 1), iso (1, 1, 2k)
//   p.viewer         unit vector from the surface toward the viewer
//   p.toCanvas(p)    -> [cx, cy]
//   p.toWorld(cx, cy, z)   the world point at height z that draws at that canvas point
//   p.depth(p)       z-buffer value for the raster, larger = nearer (oblique: Z, which orders a pixel's line the way Y + Z does; iso: X + Y + 2k Z)
//   p.viewDepth(p)   dot(p, dir): the true distance along the view (oblique Y + Z, iso X + Y + 2k Z), for GL depth and picking order
//   p.toMapNormal(n) world normal -> exported normal-map vector [R right, G up, B toward the viewer]
//   p.yaw, p.pitch   the free view's angles that look the same way as this projection
"use strict";
(function () {
	const v3 = TS.v3;
	const Proj = (TS.Proj = {});
	const make = (kind, m, o, dir, yaw, pitch, depth, toMapNormal) => {
		const p = { kind, origin: o, matrix: [m[0], m[1], m[2], o[0], m[3], m[4], m[5], o[1]], dir, viewer: v3.norm(dir), yaw, pitch, depth, toMapNormal };
		const [a, b, c, d, e, f] = m;
		p.toCanvas = (q) => [a * q[0] + b * q[1] + c * q[2] + o[0], d * q[0] + e * q[1] + f * q[2] + o[1]];
		p.viewDepth = (q) => dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2];
		return p;
	};
	// Top-down 3/4: canvas (X, Y - Z). World normal (east, south, up) -> map (east, up, toward the viewer = south).
	const oblique = make("oblique", [1, 0, 0, 0, 1, -1], [0, 0], [0, 1, 1], 0, Math.PI / 4, (q) => q[2], (n) => [n[0], n[2], n[1]]);
	oblique.toWorld = (cx, cy, z) => [cx, cy + z, z];
	// Isometric at tilt t (degrees), k = sin t. The screen's right, up and toward-viewer axes in world are the rows r1 = (1, -1, 0),
	// r2 = (-k, -k, 1), r3 = (1, 1, 2k): mutually orthogonal, so a normal (which transforms by the inverse transpose) divides each by |r|^2.
	const isoNormal = (k) => (n) => TS.v3.norm([(n[0] - n[1]) / 2, (-k * n[0] - k * n[1] + n[2]) / (1 + 2 * k * k), (n[0] + n[1] + 2 * k * n[2]) / (2 + 4 * k * k)]);
	const iso = (o, tilt = 30) => {
		const k = Math.round(Math.sin((tilt * Math.PI) / 180) * 1e12) / 1e12; // rounded so 30 is exactly 0.5
		const p = make("iso", [1, -1, 0, k, k, -1], o, [1, 1, 2 * k], Math.PI / 4, Math.atan(Math.SQRT2 * k), (q) => q[0] + q[1] + 2 * k * q[2], isoNormal(k));
		// X - Y = cx - ox and k (X + Y) = cy - oy + z.
		p.tilt = tilt;
		p.toWorld = (cx, cy, z) => { const u = cx - o[0], s = (cy - o[1] + z) / k; return [(s + u) / 2, (s - u) / 2, z]; };
		return p;
	};
	Proj.OBLIQUE = oblique;
	Proj.iso = iso;
	Proj.KINDS = ["oblique", "iso"];
	Proj.LABELS = { oblique: "Top-down (oblique)", iso: "Isometric" };
	// The iso tilt (camera elevation, degrees) can be any value from TILT_MIN to TILT_MAX, rounded to 0.01: outside that the diamond
	// is too flat or too steep to draw, so it is clamped. 30 is the 2:1 pixel-art look; a missing or non-number value is 30 (projects saved before the tilt setting).
	Proj.TILT_MIN = 10;
	Proj.TILT_MAX = 80;
	Proj.DEFAULT_TILT = 26; // what a new isometric project starts at
	Proj.TILTS = [26.57, 30, 35.26, 45]; // the named looks the self-check covers
	Proj.tilt = (t) => {
		const n = typeof t === "string" ? parseFloat(t) : t;
		if (!Number.isFinite(n)) return 30;
		return Math.min(Proj.TILT_MAX, Math.max(Proj.TILT_MIN, Math.round(n * 100) / 100));
	};
	// The chip over the view: "Isometric 30° (2:1)", "Isometric 45°", "Top-down".
	Proj.chip = (p) => (p.kind === "iso" ? `Isometric ${p.tilt}°${p.tilt === 30 ? " (2:1)" : ""}` : "Top-down");
	// Default iso origin for an art of this width: the world corner (0, 0) at the top centre, so the floor opens downward.
	Proj.defaultOrigin = (width) => [Math.round((width || 256) / 2), 0];
	// The projection for a project's settings (art: only used for the default iso origin when settings.isoOrigin is not set).
	Proj.of = (settings, art) => {
		if (!settings || settings.projection !== "iso") return oblique;
		const o = settings.isoOrigin;
		return iso(Array.isArray(o) && o.length === 2 && o.every(Number.isFinite) ? [o[0], o[1]] : Proj.defaultOrigin(art && art.w), Proj.tilt(settings.isoTilt));
	};
	// Set settings.isoOrigin and isoTilt when the project is iso and has none yet (the app does this on load and when switching).
	Proj.ensure = (settings, art) => {
		if (settings && settings.projection === "iso") {
			if (!(Array.isArray(settings.isoOrigin) && settings.isoOrigin.length === 2)) settings.isoOrigin = Proj.defaultOrigin(art && art.w);
			settings.isoTilt = Proj.tilt(settings.isoTilt);
		}
		return settings;
	};
	// Quick self-check (console: TS.Proj.test()): oblique and iso round trips, the view line and the iso normal-map directions at every tilt.
	Proj.test = () => {
		const out = [], ok = (name, cond) => out.push((cond ? "ok   " : "FAIL ") + name);
		const old = (n) => v3.norm([(n[0] - n[1]) / 2, (-n[0] / 2 - n[1] / 2 + n[2]) / 1.5, (n[0] + n[1] + n[2]) / 3]);
		for (const [tag, p] of [["", oblique], ...Proj.TILTS.map((t) => [t + "° ", iso([128, 0], t)])]) {
			const w = [37, 91, 23], c = p.toCanvas(w), back = p.toWorld(c[0], c[1], w[2]);
			ok(tag + p.kind + " toWorld(toCanvas(p)) = p", v3.dist(back, w) < 1e-9);
			const t = [w[0] + 5 * p.dir[0], w[1] + 5 * p.dir[1], w[2] + 5 * p.dir[2]], c2 = p.toCanvas(t);
			ok(tag + p.kind + " view line stays on one pixel", Math.hypot(c2[0] - c[0], c2[1] - c[1]) < 1e-9);
			if (p.kind !== "iso") continue;
			const top = p.toMapNormal([0, 0, 1]), east = p.toMapNormal([1, 0, 0]), south = p.toMapNormal([0, 1, 0]);
			ok(tag + "iso top: G > 0, B > 0, R = 0", top[1] > 0.5 && top[2] > 0 && Math.abs(top[0]) < 1e-9);
			ok(tag + "iso east wall R > 0, south wall R < 0", east[0] > 0 && south[0] < 0);
			ok(tag + "iso walls share B", Math.abs(east[2] - south[2]) < 1e-9);
			ok(tag + "iso depth grows toward the viewer", p.depth(t) > p.depth(w) && p.viewDepth(t) > p.viewDepth(w));
		}
		const I = iso([128, 0], 30);
		let worst = 0;
		for (const n of [[0, 0, 1], [1, 0, 0], [0, 1, 0], v3.norm([1, 2, 3]), v3.norm([-1, 0.5, 0.2])]) worst = Math.max(worst, v3.dist(I.toMapNormal(n), old(n)));
		ok("iso 30° matches the old 2:1 normal, pitch and dir (" + worst.toExponential(1) + ")", worst < 1e-9 && Math.abs(I.pitch - Math.asin(1 / Math.sqrt(3))) < 1e-12 && I.dir.join() === "1,1,1");
		ok("a tilt that is not a number is 30; any other is clamped to 10-80", Proj.tilt(NaN) === 30 && Proj.tilt(undefined) === 30 && Proj.tilt("45") === 45 && Proj.tilt(31) === 31 && Proj.tilt(5) === 10 && Proj.tilt(90) === 80);
		return out;
	};
})();
