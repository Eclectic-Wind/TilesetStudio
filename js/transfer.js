// Geometry exchange and reusable model placement. No changes to the destination artwork.
"use strict";
(function () {
	const T = TS.Transfer = {}, clone = (v) => JSON.parse(JSON.stringify(v));
	T.validate = function (objects) {
		if (!Array.isArray(objects) || !objects.length) throw new Error("This file has no mesh objects.");
		let total = 0;
		return objects.map((src, n) => {
			if (!src || !Array.isArray(src.verts) || !src.verts.length || !Array.isArray(src.faces)) throw new Error(`Object ${n + 1} has no valid mesh.`);
			total += src.verts.length;
			if (total > 200000) throw new Error("Use a simpler mesh: the import limit is 200,000 vertices.");
			if (src.verts.some(p => !Array.isArray(p) || p.length !== 3 || p.some(v => !Number.isFinite(v) || Math.abs(v) > 1e7))) throw new Error(`Object ${n + 1} has invalid vertex coordinates.`);
			const index = i => Number.isInteger(i) && i >= 0 && i < src.verts.length;
			if (src.faces.some(f => !f || !Array.isArray(f.v) || f.v.length < 3 || f.v.length > 4096 || !f.v.every(index))) throw new Error(`Object ${n + 1} has an invalid face.`);
			if (src.lines && (!Array.isArray(src.lines) || src.lines.some(l => !Array.isArray(l) || l.length !== 2 || !l.every(index)))) throw new Error(`Object ${n + 1} has an invalid edge.`);
			const o = clone(src);
			o.name = String(o.name || `Model ${n + 1}`); o.mat = o.mat || { roughness: 0.7, metallic: 0 };
			o.solid = o.solid !== false; o.smooth = Number.isFinite(o.smooth) ? o.smooth : 30;
			return o;
		});
	};
	T.bounds = function (objects) {
		const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
		for (const o of objects) for (const [x, y, z] of o.verts) {
			b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x);
			b.y0 = Math.min(b.y0, y - z); b.y1 = Math.max(b.y1, y - z);
			b.z0 = Math.min(b.z0, z); b.z1 = Math.max(b.z1, z);
		}
		return b;
	};
	// The anchor is the upper-left of the projected group. Raising its base changes Y and Z together,
	// keeping the aligned image footprint fixed while preserving all relative heights and depth.
	T.place = function (objects, x, y, scale, base) {
		if (![x, y, scale, base].every(Number.isFinite) || scale <= 0 || scale > 100) throw new Error("Use a scale above 0 and at most 10,000%, with valid position and height values.");
		const b = T.bounds(objects);
		return objects.map(src => {
			const o = clone(src); o.hidden = false;
			o.verts = src.verts.map(p => { const z = base + (p[2] - b.z0) * scale; return [x + (p[0] - b.x0) * scale, y + (p[1] - p[2] - b.y0) * scale + z, z]; });
			return o;
		});
	};
	// The move place() gives every point, as p' = s * p + c, so bones and key offsets can follow their models.
	T.placeMap = function (objects, x, y, scale, base) {
		const b = T.bounds(objects);
		return { s: scale, c: [x - b.x0 * scale, y - (b.y0 + b.z0) * scale + base, base - b.z0 * scale] };
	};
	// A rig (bones, bind, clips from TS.Gltf.read) carried along with models: only what the given models need (their bones and the
	// bones above them), optionally moved by a placeMap. Returns null when none of the models follows a bone.
	T.rigFor = function (rig, ids, map) {
		if (!rig) return null;
		const byId = new Map(rig.bones.map((b) => [b.id, b])), need = new Set();
		for (const id of ids) for (let b = byId.get(rig.bind[id]), n = 0; b && n < 1000; n++, b = b.parent && byId.get(b.parent)) need.add(b.id);
		if (!need.size) return null;
		const at = (p) => (map ? p.map((v, i) => v * map.s + map.c[i]) : p.slice());
		const bones = rig.bones.filter((b) => need.has(b.id)).map((b) => Object.assign(clone(b), { head: at(b.head), tail: at(b.tail) }));
		const bind = {};
		for (const id of ids) if (need.has(rig.bind[id])) bind[id] = rig.bind[id];
		const clips = [];
		for (const c of rig.clips) {
			const tracks = {};
			for (const id of Object.keys(c.tracks)) if (need.has(id)) tracks[id] = c.tracks[id].map((k) => ({ f: k.f, rot: k.rot.slice(), pos: map ? k.pos.map((v) => v * map.s) : k.pos.slice() }));
			if (Object.keys(tracks).length) clips.push({ name: c.name, fps: c.fps, frames: c.frames, tracks });
		}
		return { bones, bind, clips };
	};
	T.readOBJ = function (text, options = {}) {
		const scale = options.scale === undefined ? 1 : options.scale, up = options.up || "z";
		if (!Number.isFinite(scale) || scale <= 0 || scale > 100000) throw new Error("Pixels per OBJ unit must be above 0 and at most 100,000.");
		const vertices = [], groups = []; let current = null, smooth = false, hasObjects = false, name = "Imported mesh";
		const group = () => current || (current = { name, faces: [], lines: [], points: [], smooth: false });
		const flush = () => { if (current && (current.faces.length || current.lines.length || current.points.length)) groups.push(current); current = null; };
		let lineNo = 0;
		for (const raw of text.replace(/\\\r?\n/g, " ").split(/\r?\n/)) {
			lineNo++; const line = raw.replace(/#.*/, "").trim(); if (!line) continue;
			const [key, ...parts] = line.split(/\s+/);
			const error = msg => { throw new Error(`OBJ line ${lineNo}: ${msg}`); };
			const idx = token => {
				const head = token.split("/")[0]; if (!/^-?\d+$/.test(head)) error("invalid vertex index.");
				const n = Number(head), i = n < 0 ? vertices.length + n : n - 1;
				if (!Number.isSafeInteger(n) || n === 0 || i < 0 || i >= vertices.length) error("vertex index is outside the file.");
				return i;
			};
			if (key === "v") {
				if (parts.length < 3) error("a vertex needs three coordinates.");
				let p = parts.slice(0, 3).map(Number); if (p.some(v => !Number.isFinite(v))) error("invalid coordinate.");
				if (up === "y") p = [p[0], -p[2], p[1]];
				vertices.push(p.map(v => v * scale)); if (vertices.length > 200000) error("import limit is 200,000 vertices.");
			} else if (key === "o" || (key === "g" && !hasObjects)) {
				flush(); name = parts.join(" ") || "Imported mesh"; if (key === "o") hasObjects = true;
			} else if (key === "s") { smooth = parts[0] !== "off" && parts[0] !== "0";
			} else if (key === "f") {
				if (parts.length < 3 || parts.length > 4096) error("a polygon needs 3–4,096 corners.");
				let v = parts.map(idx); if (v.at(-1) === v[0]) v.pop();
				if (new Set(v).size < 3) error("degenerate polygon.");
				group().faces.push({ v }); group().smooth ||= smooth;
			} else if (key === "l") { const v = parts.map(idx); for (let i = 1; i < v.length; i++) group().lines.push([v[i - 1], v[i]]);
			} else if (key === "p") group().points.push(...parts.map(idx));
		}
		flush();
		if (!groups.length && vertices.length) groups.push({ name, faces: [], lines: [], points: vertices.map((_, i) => i), smooth: false });
		const objects = groups.map((g, n) => {
			const used = new Map(), verts = [], local = i => { if (!used.has(i)) { used.set(i, verts.length); verts.push(vertices[i].slice()); } return used.get(i); };
			const faces = g.faces.map(f => ({ v: f.v.map(local) })), lines = g.lines.map(l => l.map(local)); g.points.forEach(local);
			return { id: n + 1, name: g.name, verts, faces, lines, mat: { roughness: 0.7, metallic: 0 }, solid: true, smooth: g.smooth ? 30 : 0 };
		});
		return T.validate(objects);
	};
	T.writeOBJ = function (objects, options = {}) {
		if (!objects.length) throw new Error("There are no models to export.");
		const units = options.scale === undefined ? 1 : options.scale, up = options.up || "z";
		if (!Number.isFinite(units) || units <= 0 || units > 100000) throw new Error("Pixels per OBJ unit must be above 0 and at most 100,000.");
		const lines = ["# Tileset Studio — mesh geometry", `# ${up.toUpperCase()} up; ${units} pixels per unit. Studio image projection: (X, Y-Z).`]; let offset = 1;
		const num = n => String(Number(n.toFixed(8)));
		for (const o of objects) {
			lines.push("o " + String(o.name || "Model").replace(/[\r\n#]/g, "_").replace(/\s+/g, "_"));
			for (const v of o.verts) { const p = up === "y" ? [v[0], v[2], -v[1]] : v; lines.push("v " + p.map(n => num(n / units)).join(" ")); }
			lines.push(o.smooth > 0 ? "s 1" : "s off");
			for (const f of o.faces) lines.push("f " + f.v.map(i => i + offset).join(" "));
			for (const l of o.lines || []) lines.push("l " + l.map(i => i + offset).join(" "));
			const used = new Set([...o.faces.flatMap(f => f.v), ...(o.lines || []).flat()]);
			for (let i = 0; i < o.verts.length; i++) if (!used.has(i)) lines.push("p " + (i + offset));
			offset += o.verts.length;
		}
		return lines.join("\n") + "\n";
	};
})();
