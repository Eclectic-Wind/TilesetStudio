// The Godot bundle (`name.export.json`, version 4; docs/export-schema.md). One envelope for Export ▸ Godot bundle (js/app.js) and the
// headless tool (tools/export_project.js), so the two can't drift. Needs TS.Process (process.js) and a processed result whose
// pieceMap is set (Process.pieces).
"use strict";
(function () {
	const Bundle = (TS.Bundle = {});
	Bundle.VERSION = 4;
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

	// -> the bundle object (JSON.stringify it to write the file).
	// p: {name, bundleId, atlas (PNG data URL of the art), art: {w, h}, objects, settings, result (processed, with pieceMap), now (ISO 8601)}
	Bundle.build = (p) => {
		const P = TS.Process, { art, settings, result } = p;
		const maps = P.maps(result, settings), proj = TS.Proj.of(settings, art);
		return {
			format: "tileset-studio-export", version: Bundle.VERSION, name: p.name, tile: 32, canvas: [art.w, art.h],
			projection: proj.kind === "iso" ? { type: "iso", origin: proj.origin.slice(), tilt: proj.tilt } : { type: "oblique" }, exported: p.now,
			bundleId: p.bundleId, exportedAt: p.now, studioVersion: Bundle.STUDIO_VERSION, walkOverHeight: P.walkOver(settings),
			wallHeight: P.wallHeight(settings), wallThickness: P.wallThickness(settings),
			images: { atlas: p.atlas },
			maps: { w: maps.w, h: maps.h, rows: maps.rows, materials: maps.materials, highlights: maps.highlights, data: base64(maps.data), pieces: base64(maps.pieces) },
			footprints: P.footprints(p.objects, art, result, settings),
		};
	};
})();
