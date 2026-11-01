// The Godot bundle (`name.export.json`, version 6; docs/export-schema.md). One envelope for Export ▸ Godot bundle (js/app.js) and the
// headless tool (tools/export_project.js), so the two can't drift. Needs TS.Process (process.js) and a processed result whose
// pieceMap is set (Process.pieces).
"use strict";
(function () {
	const Bundle = (TS.Bundle = {});
	Bundle.VERSION = 6;
	// The Studio had no version number yet: this is the one written to bundles (bump it by hand per release).
	Bundle.STUDIO_VERSION = "1.0.0";
	Bundle.cleanName = (s) => String(s || "").trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9_-]/g, "");
	// The bundle's base name: the export name the artist set, else the project's name, else "tileset".
	Bundle.exportName = (name, exportName) => Bundle.cleanName(exportName) || Bundle.cleanName(name) || "tileset";

	// Raw bytes as base64 (chunked: String.fromCharCode can't take megabytes at once).
	const base64 = (bytes) => {
		let bin = "";
		for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
		return btoa(bin);
	};

	// Animated tiles (bundle version 6, docs/export-schema.md): per clip with a `models` scope, one target per piece those models
	// belong to. The base frame stays in the atlas; the target holds the frames as cell-aligned rects of the piece's art, packed `cols`
	// per row, as a PNG of the Aseprite Albedo frames. Flipbook only: height, normal and material are the base frame's (no `data`).
	// p: {anim (project anim: clips[{name, fps, frames, loop, export, models: [object id]}]), objects, settings, result (with pieceMap),
	//     art: {w, h}, albedoOf(clip) -> {width, height, data RGBA} | null (the clip's Albedo sheet, Rig.layout cells),
	//     encodePNG(rgba, w, h) -> base64 PNG (no prefix); dry: true skips building the sheets (warnings only)}
	// -> {clips, warnings} or null when nothing is exported and nothing to say.
	Bundle.anim = (p) => {
		const P = TS.Process, Rig = TS.Rig, T = 32, MAX_SHEET = 2048;
		const a = p.anim, r = p.result, warnings = [], clips = [];
		if (!a || !a.clips || !a.clips.length) return null;
		const pm = r.pieceMap || (r.pieceMap = P.pieces(p.objects, r, p.settings)), W = r.w, H = r.h, cut = p.settings.alphaCut;
		const oblique = !r.proj || r.proj.kind === "oblique";
		for (const clip of a.clips) {
			if (clip.export === false) continue;
			const ids = Array.isArray(clip.models) ? clip.models : [];
			if (!ids.length) {
				if (Object.values(clip.tracks || {}).some((ks) => ks.length)) warnings.push(`clip "${clip.name}": no models chosen, so it is not exported (rigged clips are not exported yet; for a flipbook pick its models)`);
				continue;
			}
			const pieces = new Map(); // piece index -> its models in the clip
			for (const id of ids) {
				const oi = p.objects.findIndex((o) => o.id === id);
				if (oi < 0 || pm.pieceOf[oi] < 0) { warnings.push(`clip "${clip.name}": a chosen model is gone or has no surface, ignored`); continue; }
				if (!pieces.has(pm.pieceOf[oi])) pieces.set(pm.pieceOf[oi], []);
				pieces.get(pm.pieceOf[oi]).push(oi);
			}
			if (!pieces.size) continue;
			const frames = clip.frames | 0, lay = Rig.layout(p.art.w, p.art.h, frames);
			const sheet = p.albedoOf ? p.albedoOf(clip) : null;
			if (!sheet) { warnings.push(`clip "${clip.name}": no Albedo frames yet (paint them in Aseprite), not exported`); continue; }
			if (sheet.width !== lay.w || sheet.height !== lay.h) { warnings.push(`clip "${clip.name}": the Albedo sheet is ${sheet.width}x${sheet.height}, expected ${lay.w}x${lay.h} for ${frames} frame(s) of ${p.art.w}x${p.art.h}, not exported`); continue; }
			const targets = [];
			for (const [piece, members] of pieces) {
				const names = pm.pieces[piece].names.join(" + ");
				const walkers = pm.pieces[piece].objs.filter((oi) => P.walkOf(p.objects[oi]) === "stairs");
				if (walkers.length) { warnings.push(`clip "${clip.name}" / ${names}: the piece holds stairs (Walk: stairs), and a moving walk surface is not supported, so it is not animated`); continue; }
				// The piece's art, to whole cells.
				let x0 = W, y0 = H, x1 = -1, y1 = -1;
				for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
					const i = y * W + x;
					if (r.alpha[i] > cut && r.owner[i] >= 0 && pm.pieceOf[r.owner[i]] === piece) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
				}
				if (x1 < 0) { warnings.push(`clip "${clip.name}" / ${names}: no art on the canvas, not animated`); continue; }
				const rx = Math.floor(x0 / T) * T, ry = Math.floor(y0 / T) * T, rw = Math.min(W, Math.ceil((x1 + 1) / T) * T) - rx, rh = Math.min(H, Math.ceil((y1 + 1) / T) * T) - ry;
				// A rect reaching south of the piece's sort row (oblique: its lowest floor row) would sort wrongly.
				if (oblique) {
					let base = 0;
					for (const oi of pm.pieces[piece].objs) for (const i of r.floor.covers[oi]) { const row = (i / W) | 0; if (row > base) base = row; }
					if (ry + rh > Math.ceil((base + 1) / T) * T) warnings.push(`clip "${clip.name}" / ${names}: the frames reach south of the piece's base row (${base}); the game sorts it by that row`);
				}
				const cols = Math.max(1, Math.min(frames, Math.floor(MAX_SHEET / rw))), rows = Math.ceil(frames / cols);
				const out = p.dry ? null : new Uint8ClampedArray(cols * rw * rows * rh * 4);
				let outside = 0, outsideFrame = -1;
				for (let f = 0; f < frames; f++) {
					const [ox, oy] = Rig.cellOrigin(lay, f), dx = (f % cols) * rw, dy = Math.floor(f / cols) * rh;
					let any = 0;
					for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
						const s = ((oy + ry + y) * sheet.width + ox + rx + x) * 4;
						if (sheet.data[s + 3] > cut) {
							any++;
							const bi = (ry + y) * W + rx + x;
							if (!(r.owner[bi] >= 0 && pm.pieceOf[r.owner[bi]] === piece)) { outside++; if (outsideFrame < 0) outsideFrame = f + 1; }
						}
						if (out) { const d = ((dy + y) * cols * rw + dx + x) * 4; out[d] = sheet.data[s]; out[d + 1] = sheet.data[s + 1]; out[d + 2] = sheet.data[s + 2]; out[d + 3] = sheet.data[s + 3]; }
					}
					if (!any) warnings.push(`clip "${clip.name}" / ${names}: frame ${f + 1} is empty`);
				}
				if (outside) warnings.push(`clip "${clip.name}" / ${names}: ${outside} painted pixel(s) (first in frame ${outsideFrame}) lie outside the piece's base art, where the base height and normal are flat`);
				targets.push({ piece: piece + 1, rect: [rx, ry, rw, rh], cols, rows, source: "flipbook",
					...(out ? { color: p.encodePNG(out, cols * rw, rows * rh) } : {}) });
			}
			if (targets.length) clips.push({ name: clip.name, fps: clip.fps | 0 || 8, frames, loop: ["once", "pingpong"].includes(clip.loop) ? clip.loop : "loop", shadow: "static", collision: "static", targets });
		}
		return clips.length || warnings.length ? { clips, warnings } : null;
	};

	// -> the bundle object (JSON.stringify it to write the file).
	// p: {name, bundleId, atlas (PNG data URL of the art), art: {w, h}, objects, settings, result (processed, with pieceMap), now (ISO 8601)}
	Bundle.build = (p) => {
		const P = TS.Process, { art, settings, result } = p;
		const anim = p.anim ? Bundle.anim(Object.assign({ art, objects: p.objects, settings, result }, p)) : null;
			const maps = P.maps(result, settings), proj = TS.Proj.of(settings, art);
		return {
			format: "tileset-studio-export", version: Bundle.VERSION, name: p.name, tile: 32, canvas: [art.w, art.h],
			projection: proj.kind === "iso" ? { type: "iso", origin: proj.origin.slice(), tilt: proj.tilt } : { type: "oblique" }, exported: p.now,
			bundleId: p.bundleId, exportedAt: p.now, studioVersion: Bundle.STUDIO_VERSION, walkOverHeight: P.walkOver(settings),
			wallHeight: P.wallHeight(settings), wallThickness: P.wallThickness(settings),
			images: { atlas: p.atlas },
			maps: { w: maps.w, h: maps.h, rows: maps.rows, materials: maps.materials, highlights: maps.highlights, data: base64(maps.data), pieces: base64(maps.pieces) },
			footprints: P.footprints(p.objects, art, result, settings),
			...(anim ? { anim } : {}),
		};
	};
})();
