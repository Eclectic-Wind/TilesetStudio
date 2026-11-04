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

	// A material's index in maps.materials (the table the bundle already has): the frames add none of their own.
	const materialLookup = (materials) => {
		const memo = new Map();
		return (rough, metal) => {
			const key = Math.round(rough * 255) * 256 + Math.round(metal * 255);
			if (memo.has(key)) return memo.get(key);
			let best = 0, bd = Infinity;
			materials.forEach((m, k) => { const d = (m[0] - rough) ** 2 + (m[1] - metal) ** 2; if (d < bd) { bd = d; best = k; } });
			memo.set(key, best);
			return best;
		};
	};
	// One flipbook frame processed like the base frame: the piece's models at this frame's pose (posed) under this frame's paint.
	const frameSurface = (posed, f, sheet, lay, W, H, settings) => {
		const [ox, oy] = TS.Rig.cellOrigin(lay, f), rgba = new Uint8ClampedArray(W * H * 4), alpha = new Uint8Array(W * H);
		for (let y = 0; y < H; y++) {
			rgba.set(sheet.data.subarray(((oy + y) * sheet.width + ox) * 4, ((oy + y) * sheet.width + ox + W) * 4), y * W * 4);
			for (let x = 0; x < W; x++) alpha[y * W + x] = rgba[(y * W + x) * 4 + 3];
		}
		return TS.Process.run(posed, { w: W, h: H, data: rgba, alpha }, settings);
	};
	// A field made of ONE piece's models (the posed animated piece alone): every model is the same piece, so P.floorPoint's gap rule
	// finds the tallest hole between its spans, as for a lone piece in the static maps.
	const lonePiece = (oi) => (oi >= 0 ? 1 : 0);

	// Animated tiles (bundle version 6, docs/export-schema.md): per clip with a `models` scope, one target per piece those models
	// belong to. The base frame stays in the atlas; the target holds the frames as cell-aligned rects of the piece's art, packed `cols`
	// per row, as a PNG of the Aseprite Albedo frames. A clip that only repaints reuses the base frame's height, normal and material;
	// when bones move the piece, `data` carries them per frame, and (oblique) `floor` the exact floor spans of the posed piece per frame
	// (P.floorPoint's form, the same as the floor rows of maps.data), with floorDy / floorH placing the block (clip.shadow = "frames").
	// p: {anim (project anim: clips[{name, fps, frames, loop, export, models: [object id]}]), objects, settings, result (with pieceMap),
	//     art: {w, h}, albedoOf(clip) -> {width, height, data RGBA} | null (the clip's Albedo sheet, Rig.layout cells),
	//     materials (maps.materials), encodePNG(rgba, w, h) -> base64 PNG (no prefix); dry: true skips building the sheets (warnings only)}
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
				if (Object.values(clip.tracks || {}).some((ks) => ks.length)) warnings.push(`clip "${clip.name}": no models chosen, so it is not exported (a clip reaches the game as painted frames on the models you pick)`);
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
				// Bones move this piece in the clip: each frame gets the height, normal and material of the posed models under its own
				// paint, and (oblique) the exact floor spans of the posed models. The floor block shares the rect's columns (a floor
				// point's x is its art column), so the rect grows to hold the columns the posed models cover in any frame.
				const pieceObjs = pm.pieces[piece].objs.map((oi) => p.objects[oi]), moves = pieceObjs.some((o) => Rig.modelMoves(a, clip, o));
				const posed = moves && !p.dry ? Array.from({ length: frames }, (_, f) => Rig.posedObjects(pieceObjs, a, clip, f)) : null;
				let reach = null; // the floor points the posed models cover in any frame: {x0, y0, x1, y1}
				if (posed && oblique)
					for (const ps of posed) {
						const q = P.floorReach(ps, W, r.floor.rows);
						if (q) reach = reach ? { x0: Math.min(reach.x0, q.x0), y0: Math.min(reach.y0, q.y0), x1: Math.max(reach.x1, q.x1), y1: Math.max(reach.y1, q.y1) } : q;
					}
				if (reach) { x0 = Math.min(x0, reach.x0); x1 = Math.max(x1, reach.x1); }
					// A frame can paint past the base art (a door swinging open), so the rect grows to hold it. Pixels over another piece's
					// art are that piece's in the sheet, and don't count.
					for (let f = 0; f < frames; f++) {
						const [ox, oy] = Rig.cellOrigin(lay, f);
						for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
							const own = r.owner[y * W + x];
							if (sheet.data[((oy + y) * sheet.width + ox + x) * 4 + 3] > cut && !(own >= 0 && pm.pieceOf[own] !== piece)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
						}
					}
				const rx = Math.floor(x0 / T) * T, ry = Math.floor(y0 / T) * T, rw = Math.min(W, Math.ceil((x1 + 1) / T) * T) - rx, rh = Math.min(H, Math.ceil((y1 + 1) / T) * T) - ry;
				// A rect reaching south of the piece's sort row (oblique: its lowest floor row) would sort wrongly.
				if (oblique) {
					let base = 0;
					for (const oi of pm.pieces[piece].objs) for (const i of r.floor.covers[oi]) { const row = (i / W) | 0; if (row > base) base = row; }
					if (ry + rh > Math.ceil((base + 1) / T) * T) warnings.push(`clip "${clip.name}" / ${names}: the frames reach south of the piece's base row (${base}); the game sorts it by that row${reach ? " (the floor spans give each frame its own south edge)" : ""}`);
				}
				const cols = Math.max(1, Math.min(frames, Math.floor(MAX_SHEET / rw))), rows = Math.ceil(frames / cols);
				const out = p.dry ? null : new Uint8ClampedArray(cols * rw * rows * rh * 4);
				if (moves && !oblique && !p.dry) warnings.push(`clip "${clip.name}" / ${names}: isometric, so the shadow stays the base frame's (per-frame floor spans are only written for the oblique projection)`);
				// The floor block: per frame, the floor points over the rect's columns and the rows the posed models cover in any frame, packed like the frames.
				const floorDy = reach ? reach.y0 - ry : 0, floorH = reach ? reach.y1 - reach.y0 + 1 : 0;
				const floorOut = reach ? new Uint8Array(cols * rw * rows * floorH * 4) : null;
				const data = posed ? new Uint8Array(out.length) : null, matOf = materialLookup(p.materials || []), flat = data && r.proj.toMapNormal([0, 0, 1]);
				let outside = 0, outsideFrame = -1;
				for (let f = 0; f < frames; f++) {
					const [ox, oy] = Rig.cellOrigin(lay, f), dx = (f % cols) * rw, dy = Math.floor(f / cols) * rh;
					const fr = data ? frameSurface(posed[f], f, sheet, lay, W, H, p.settings) : null;
					if (floorOut) {
						const fx = (f % cols) * rw, fy = Math.floor(f / cols) * floorH;
						for (let j = 0; j < floorH; j++) for (let i = 0; i < rw; i++) {
							const fp = P.floorPoint(fr.floor, (reach.y0 + j) * W + rx + i, lonePiece);
							if (fp) P.putFloorPoint(floorOut, ((fy + j) * cols * rw + fx + i) * 4, fp);
						}
					}
					let any = 0;
					for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
						const s = ((oy + ry + y) * sheet.width + ox + rx + x) * 4, bi = (ry + y) * W + rx + x;
						const d = ((dy + y) * cols * rw + dx + x) * 4;
						if (sheet.data[s + 3] > cut) {
							any++;
							const has = fr && !isNaN(fr.height[bi]);
							if (moves ? fr && !has : !(r.owner[bi] >= 0 && pm.pieceOf[r.owner[bi]] === piece)) { outside++; if (outsideFrame < 0) outsideFrame = f + 1; }
							if (fr) { // maps.data's art-row bytes
								const n = has ? P.mapNormal(fr, bi, p.settings) : flat;
								data[d] = has ? TS.clamp(Math.round(fr.height[bi]), 0, 255) : 0;
								data[d + 1] = Math.round(TS.clamp(n[0] * 0.5 + 0.5, 0, 1) * 255);
								data[d + 2] = Math.round(TS.clamp(n[1] * 0.5 + 0.5, 0, 1) * 255);
								data[d + 3] = matOf(has ? fr.rough[bi] : 1, has ? fr.metal[bi] : 0) + 1;
							}
						}
						if (out) { out[d] = sheet.data[s]; out[d + 1] = sheet.data[s + 1]; out[d + 2] = sheet.data[s + 2]; out[d + 3] = sheet.data[s + 3]; }
					}
					if (!any) warnings.push(`clip "${clip.name}" / ${names}: frame ${f + 1} is empty`);
				}
				if (outside) warnings.push(`clip "${clip.name}" / ${names}: ${outside} painted pixel(s) (first in frame ${outsideFrame}) lie outside ${moves ? "the posed models" : "the piece's base art"}, where height and normal are flat`);
				targets.push({ piece: piece + 1, rect: [rx, ry, rw, rh], cols, rows, source: "flipbook", ...(moves && p.dry ? { moves: true, ...(oblique ? { floor: true } : {}) } : {}),
					...(out ? { color: p.encodePNG(out, cols * rw, rows * rh) } : {}), ...(data ? { data: base64(data) } : {}),
					...(floorOut ? { floor: base64(floorOut), floorDy, floorH } : {}) });
			}
			if (targets.length) clips.push({ name: clip.name, fps: clip.fps | 0 || 8, frames, loop: ["once", "pingpong"].includes(clip.loop) ? clip.loop : "loop",
				shadow: targets.some((t) => t.floor) ? "frames" : "static", collision: "static", targets });
		}
		return clips.length || warnings.length ? { clips, warnings } : null;
	};

	// -> the bundle object (JSON.stringify it to write the file).
	// p: {name, bundleId, atlas (PNG data URL of the art), art: {w, h}, objects, settings, result (processed, with pieceMap), now (ISO 8601)}
	Bundle.build = (p) => {
		const P = TS.Process, { art, settings, result } = p;
		const maps = P.maps(result, settings), proj = TS.Proj.of(settings, art);
		const anim = p.anim ? Bundle.anim(Object.assign({ art, objects: p.objects, settings, result, materials: maps.materials }, p)) : null;
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
