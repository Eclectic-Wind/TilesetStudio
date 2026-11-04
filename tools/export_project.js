// Exports a saved project (.studio.json) headless: the same Godot bundle (version 6) that Export ▸ Godot bundle writes, built by the
// Studio's own Process and Bundle code run in a vm. Usage: node tools/export_project.js <in.studio.json> <out.export.json>
// The tileset is decoded from the project's own PNG (zlib), so the atlas in the bundle is the project's PNG bytes; the browser
// re-encodes it. Everything else matches, bar exportedAt.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), zlib = require("zlib"), crypto = require("crypto");
const root = path.join(__dirname, "..");
const { encodePNG } = require("./png");
const ctx = { console, Math, JSON, Map, Set, Float32Array, Uint8Array, Int32Array, Int16Array, Uint8ClampedArray, btoa };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["math", "proj", "shape", "mesh", "rig", "process", "bundle"]) vm.runInContext(fs.readFileSync(path.join(root, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
const TS = ctx.TS, P = TS.Process;

// Decodes a non-interlaced 8-bit PNG (any colour type) to RGBA8. Throws on anything else.
function decodePNG(buf) {
	if (buf.toString("latin1", 1, 4) !== "PNG") throw new Error("the tileset is not a PNG");
	let p = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0, palette = null, trns = null;
	const idat = [];
	while (p < buf.length) {
		const len = buf.readUInt32BE(p), type = buf.toString("latin1", p + 4, p + 8), body = buf.subarray(p + 8, p + 8 + len);
		p += 12 + len;
		if (type === "IHDR") { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]; ctype = body[9]; interlace = body[12]; }
		else if (type === "PLTE") palette = body;
		else if (type === "tRNS") trns = body;
		else if (type === "IDAT") idat.push(body);
		else if (type === "IEND") break;
	}
	if (depth !== 8 || interlace) throw new Error(`the tileset PNG must be 8-bit and not interlaced (depth ${depth}, interlace ${interlace})`);
	const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
	if (!channels) throw new Error(`unsupported PNG colour type ${ctype}`);
	const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * channels, bytes = Buffer.alloc(stride * h);
	let prev = Buffer.alloc(stride);
	const paeth = (a, b, c) => { const v = a + b - c, pa = Math.abs(v - a), pb = Math.abs(v - b), pc = Math.abs(v - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
	for (let y = 0; y < h; y++) {
		const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = Buffer.alloc(stride);
		for (let x = 0; x < stride; x++) {
			const a = x >= channels ? cur[x - channels] : 0, b = prev[x], c = x >= channels ? prev[x - channels] : 0;
			const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
			if (pred === undefined) throw new Error(`bad PNG filter ${filter}`);
			cur[x] = (line[x] + pred) & 255;
		}
		cur.copy(bytes, y * stride);
		prev = cur;
	}
	const data = new Uint8ClampedArray(w * h * 4);
	for (let i = 0; i < w * h; i++) {
		const s = i * channels, o = i * 4;
		if (ctype === 6) data.set(bytes.subarray(s, s + 4), o);
		else if (ctype === 2) data.set([bytes[s], bytes[s + 1], bytes[s + 2], 255], o);
		else if (ctype === 0) data.set([bytes[s], bytes[s], bytes[s], 255], o);
		else if (ctype === 4) data.set([bytes[s], bytes[s], bytes[s], bytes[s + 1]], o);
		else { const k = bytes[s]; data.set([palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2], trns && k < trns.length ? trns[k] : 255], o); }
	}
	return { w, h, data };
}

// A target's per-frame floor spans in one line: where the block sits and each frame's south edge (the floor y a game sorts that frame by:
// the last floor row of the frame with something standing on it).
function floorSummary(t, frames) {
	const [, ry, rw] = t.rect, bytes = Buffer.from(t.floor, "base64"), W = t.cols * rw, top = ry + t.floorDy, south = [];
	for (let f = 0; f < frames; f++) {
		const fx = (f % t.cols) * rw, fy = Math.floor(f / t.cols) * t.floorH;
		let last = -1;
		for (let y = 0; y < t.floorH; y++) for (let x = 0; x < rw; x++) if (bytes[((fy + y) * W + fx + x) * 4]) last = y;
		south.push(last < 0 ? "-" : top + last);
	}
	return `      floor spans: rows ${top}..${top + t.floorH - 1} (floorDy ${t.floorDy}, floorH ${t.floorH}), ${Math.round(t.floor.length / 1024)} KB; south edge by frame: ${south.join(" ")}`;
}

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
	console.error("Usage: node tools/export_project.js <in.studio.json> <out.export.json>");
	process.exit(2);
}
const project = JSON.parse(fs.readFileSync(inPath, "utf8"));
if (project.format !== "tileset-studio") throw new Error(`${inPath} is not a Tileset Studio project`);
if (!project.tileset) throw new Error(`${inPath} has no tileset image`);

const img = decodePNG(Buffer.from(project.tileset.replace(/^data:image\/png;base64,/, ""), "base64"));
const alpha = new Uint8Array(img.w * img.h);
for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
const art = { w: img.w, h: img.h, data: img.data, alpha };
const settings = Object.assign(P.defaultSettings(), project.settings || {});
const objects = project.objects || [];

// Projects carrying retired kind names (deco, solid, wall, side) are mapped first, as the Studio does on open.
P.migrateKinds(objects);
const result = P.run(objects, art, settings);
result.pieceMap = P.pieces(objects, result, settings);

// Animated tiles: each clip's Albedo sheet (a data URL in the project, as Aseprite sent it), decoded for TS.Bundle.anim.
const anim = project.anim || null, sheets = new Map();
for (const c of (anim && anim.clips) || []) {
	const url = c.albedo || (c.id === anim.clip ? anim.albedo : null);
	if (url && (c.models || []).length) { const s = decodePNG(Buffer.from(url.replace(/^data:image\/png;base64,/, ""), "base64")); sheets.set(c.id, { width: s.w, height: s.h, data: s.data }); }
}

const name = TS.Bundle.exportName(project.name, project.exportName);
const bundle = TS.Bundle.build({
	name, bundleId: project.bundleId || crypto.randomUUID(), atlas: project.tileset, art, objects, settings, result, now: new Date().toISOString(),
	anim, albedoOf: (clip) => sheets.get(clip.id) || null, encodePNG: (rgba, w, h) => encodePNG(rgba, w, h).toString("base64"),
});
const text = JSON.stringify(bundle);
fs.writeFileSync(outPath, text);
const st = result.stats, fp = bundle.footprints;
console.log(`wrote ${outPath} (${Math.round(text.length / 1024)} KB): ${fp.objects.length} models, ${fp.pieces.length} pieces, ` +
	`${st.unfilled} art px uncovered`);
for (const o of fp.objects) console.log(`  ${o.name.padEnd(12)} ${o.kind.padEnd(7)} ${o.kindInferred ? "inferred" : "set     "} piece ${o.pieceIndex}  h ${o.heightMin}-${o.heightMax}`);
if (fp.walk) {
	console.log(`walk: ${fp.walk.surfaces.length} surface(s)`);
	for (const sf of fp.walk.surfaces) {
		const st = sf.stairs;
		console.log(`  surface ${sf.id} stairs [${sf.models.map((m) => fp.objects[m].name).join(", ")}] piece ${sf.pieces}: ${sf.fit.treads} treads of ${sf.fit.riser} px, rise ${st.rise} (z ${st.zLow}-${st.zHigh}) over ${st.run} going [${st.dir}], ${st.width} wide, plane [${sf.plane}] fit ±${sf.fit.max}`);
		console.log(`    low seam -> ${JSON.stringify(sf.seams[0].to)} ${JSON.stringify(st.low)}; high seam -> ${JSON.stringify(sf.seams[1].to)} ${JSON.stringify(st.high)}; ${sf.blockers.length} blocker + ${sf.around.length} around polygon(s)`);
	}
	for (const w of fp.walk.warnings) console.log("  warning: " + w);
}
if (bundle.anim) {
	console.log(`anim: ${bundle.anim.clips.length} clip(s)`);
	for (const c of bundle.anim.clips) {
		console.log(`  ${c.name}: ${c.frames} frames at ${c.fps} fps, ${c.loop}, shadow ${c.shadow}, collision ${c.collision}`);
		for (const t of c.targets) {
			console.log(`    piece ${t.piece} (${fp.pieces[t.piece - 1].names.join(" + ")}) ${t.source} rect [${t.rect}] ${t.cols}x${t.rows} frames per sheet, color ${Math.round(t.color.length / 1024)} KB${t.data ? ", data " + Math.round(t.data.length / 1024) + " KB" : ", no data (base frame's height and normal)"}`);
			if (t.floor) console.log(floorSummary(t, c.frames));
		}
	}
	for (const w of bundle.anim.warnings) console.log("  warning: " + w);
}
