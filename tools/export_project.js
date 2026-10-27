// Exports a saved project (.studio.json) headless: the same Godot bundle (version 4) that Export ▸ Godot bundle writes, built by the
// Studio's own Process and Bundle code run in a vm. Usage: node tools/export_project.js <in.studio.json> <out.export.json>
// The tileset is decoded from the project's own PNG (zlib), so the atlas in the bundle is the project's PNG bytes; the browser
// re-encodes it. Everything else matches, bar exportedAt.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), zlib = require("zlib"), crypto = require("crypto");
const root = path.join(__dirname, "..");
const ctx = { console, Math, JSON, Map, Set, Float32Array, Uint8Array, Int32Array, Int16Array, Uint8ClampedArray, btoa };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["math", "shape", "mesh", "process", "bundle"]) vm.runInContext(fs.readFileSync(path.join(root, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
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

// Projects saved before bundle version 4 carry the old kinds: map them first (the Studio does this on open).
if ((project.version || 1) < 2) P.migrateKinds(objects, art, settings);
const result = P.run(objects, art, settings);
result.pieceMap = P.pieces(objects, result, settings);

const name = TS.Bundle.exportName(project.name, project.exportName);
const bundle = TS.Bundle.build({
	name, bundleId: project.bundleId || crypto.randomUUID(), atlas: project.tileset, art, objects, settings, result, now: new Date().toISOString(),
});
const text = JSON.stringify(bundle);
fs.writeFileSync(outPath, text);
const st = result.stats, fp = bundle.footprints;
console.log(`wrote ${outPath} (${Math.round(text.length / 1024)} KB): ${fp.objects.length} models, ${fp.pieces.length} pieces, ` +
	`${st.unfilled} art px uncovered`);
for (const o of fp.objects) console.log(`  ${o.name.padEnd(12)} ${o.kind.padEnd(7)} ${o.kindInferred ? "inferred" : "set     "} piece ${o.pieceIndex}  h ${o.heightMin}-${o.heightMax}`);
