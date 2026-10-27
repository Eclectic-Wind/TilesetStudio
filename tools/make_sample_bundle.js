// Builds samples/sample.export.json: a version 4 Godot bundle for a small scene (flat rug, table, back wall, side wall) by running the
// Studio's own Process and Bundle code headless. Usage: node tools/make_sample_bundle.js [out.json]
// The envelope is TS.Bundle.build (js/bundle.js), the same one Export ▸ Godot bundle and tools/export_project.js write; the atlas is a
// flat-coloured stand-in drawn here.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), zlib = require("zlib");
const root = path.join(__dirname, "..");
const ctx = { console, Math, JSON, Map, Set, Float32Array, Uint8Array, Int32Array, Int16Array, Uint8ClampedArray, btoa };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["math", "shape", "mesh", "process", "bundle"]) vm.runInContext(fs.readFileSync(path.join(root, "js", f + ".js"), "utf8"), ctx, { filename: f + ".js" });
const TS = ctx.TS, M = TS.Mesh, P = TS.Process;

// A box as raw verts / faces (counter-clockwise from outside), to merge several into one model.
const box = (x0, y0, z0, x1, y1, z1) => ({
	verts: [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
	faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]],
});
const merge = (name, parts) => {
	const verts = [], faces = [];
	for (const p of parts) { const o = verts.length; verts.push(...p.verts); faces.push(...p.faces.map((f) => f.map((i) => i + o))); }
	return M.newObject(name, verts, faces);
};

const W = 256, H = 256;
// Floor-plan px: X east, Y south, Z up. Each model keeps to its own atlas cells (32 px).
const rug = M.box([48, 60, 0], 56, 40, 2); rug.name = "Rug";
const tableTop = box(136, 84, 24, 184, 116, 28), leg = (x, y) => box(x, y, 0, x + 4, y + 4, 24);
const table = merge("Table", [tableTop, leg(136, 84), leg(180, 84), leg(136, 112), leg(180, 112)]);
table.tags = "furniture";
const wall = M.box([64, 190, 0], 96, 8, 56); wall.name = "Back wall"; wall.kind = "wall_h";
const side = M.box([228, 200, 0], 8, 96, 48); side.name = "Side wall"; side.kind = "wall_v"; side.collision = "footprint";
const objects = [rug, table, wall, side];
const settings = { alphaCut: 13, fill: 2, relief: 0.5, packHighlights: true, body: 40, step: 4, walkOverHeight: 2, wallHeight: 48, wallThickness: 24 };

// Art: opaque wherever a model shows (found with a first pass over an all-opaque canvas), a flat colour per model.
const alpha = new Uint8Array(W * H).fill(255), data = new Uint8ClampedArray(W * H * 4);
let r = P.run(objects, { w: W, h: H, alpha, data }, settings);
const tint = [[150, 60, 60], [150, 110, 60], [90, 90, 110], [70, 100, 90]];
for (let i = 0; i < W * H; i++) {
	const has = !isNaN(r.height[i]);
	alpha[i] = has ? 255 : 0;
	if (has) data.set([...tint[r.owner[i]].map((c) => Math.min(255, c + (r.normal[i * 3 + 2] > 0.7 ? 40 : 0))), 255], i * 4);
}
const art = { w: W, h: H, alpha, data };
r = P.run(objects, art, settings);
r.pieceMap = P.pieces(objects, r, settings);

// PNG of the atlas (RGBA8, no filter), so the file is self-contained.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, body) => { const t = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(body.length); sum.writeUInt32BE(crc(Buffer.concat([t, body]))); return Buffer.concat([len, t, body, sum]); };
const png = () => {
	const raw = Buffer.alloc((W * 4 + 1) * H);
	for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; Buffer.from(data.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1); }
	const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
};

const bundle = TS.Bundle.build({
	name: "sample", bundleId: "6f1c2a9e-3b7d-4c58-9e1a-0d4b8f2c7a11", atlas: "data:image/png;base64," + png().toString("base64"), art, objects, settings,
	result: r, now: "2026-10-20T12:00:00.000Z",
});
const out = process.argv[2] || path.join(root, "samples", "sample.export.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(bundle));
// A readable summary (everything but the two big blobs) for eyeballing and for the docs.
const brief = Object.assign({}, bundle, { images: "...", maps: "..." });
fs.writeFileSync(out.replace(/\.json$/, ".summary.json"), JSON.stringify(brief, null, 1));
console.log("wrote", out, Math.round(fs.statSync(out).size / 1024), "KB");
for (const o of bundle.footprints.objects) console.log(o.name.padEnd(10), o.kind.padEnd(7), "inferred=" + o.kindInferred, `h ${o.heightMin}-${o.heightMax}`, "flat=" + o.flat, "piece", o.pieceIndex, "collision", o.collision.requested, "->", o.collision.mode, "cells", JSON.stringify(o.cells));
console.log("pieces", bundle.footprints.pieces.map((p) => p.names.join("+") + ":" + p.kind).join(" "), "clashes", JSON.stringify(bundle.footprints.clashes));
