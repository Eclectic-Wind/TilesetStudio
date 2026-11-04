// FBX import, through three.js's FBXLoader (js/vendor/FBXLoader.js, MIT; the format is too large to read by hand). Each mesh in the
// file becomes a model, with its place in the file's hierarchy applied. Bones, skins and animation are not read: the mesh comes in
// in its bind pose.
//
// Axes: `up` is "y" (FBX from Blender, Unity and Maya default to Y up, read as glTF is) or "z" (read as the Studio axes, like OBJ).
// Studio is X east, Y south, Z up; scale is pixels per unit (the same as the glTF and OBJ readers).
"use strict";
(function () {
	const F = (TS.Fbx = {});

	F.read = function (buffer, opts = {}) {
		if (typeof THREE === "undefined" || !THREE.FBXLoader) throw new Error("The FBX reader did not load. Reload the page.");
		const scale = opts.scale > 0 ? opts.scale : 1, yUp = opts.up !== "z";
		// Models only: the loader would decode every texture the file carries, and the import never uses them.
		THREE.TextureLoader.prototype.load = () => new THREE.Texture();
		const root = new THREE.FBXLoader().parse(buffer, "");
		root.updateMatrixWorld(true);
		const objects = [], v = new THREE.Vector3();
		root.traverse((node) => {
			if (!node.isMesh || !node.geometry || !node.geometry.attributes.position) return;
			const pos = node.geometry.attributes.position, index = node.geometry.index;
			// Base colour per triangle (reference only, f.col): its material's colour times its vertex colours. Textures are not read.
			const mats = Array.isArray(node.material) ? node.material : [node.material], groups = node.geometry.groups || [], vcol = node.geometry.attributes.color;
			const matAt = (t) => { const g = groups.find((gr) => t >= gr.start && t < gr.start + gr.count); return mats[g ? g.materialIndex || 0 : 0]; };
			const colourAt = (t, corners) => {
				const m = matAt(t), c = m && m.color ? [m.color.r, m.color.g, m.color.b] : vcol ? [1, 1, 1] : null;
				if (!c) return null;
				if (vcol) for (let k = 0; k < 3; k++) c[k] *= corners.reduce((a, i) => a + vcol.getComponent(i, k), 0) / 3;
				return TS.Mesh.colourHex(c.map((x) => (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055))); // FBX material colours are linear (as Blender writes them)
			};
			const used = new Map(), verts = [], faces = [];
			const add = (i) => { // weld corners that sit on the same spot (the loader splits vertices along seams)
				v.fromBufferAttribute(pos, i).applyMatrix4(node.matrixWorld);
				const p = yUp ? [v.x, -v.z, v.y] : [v.x, v.y, v.z], k = p.map((c) => Math.round(c * 1e4)).join(",");
				if (!used.has(k)) { used.set(k, verts.length); verts.push(p.map((c) => c * scale)); }
				return used.get(k);
			};
			const count = index ? index.count : pos.count;
			for (let t = 0; t + 2 < count; t += 3) {
				const corner = (k) => (index ? index.getX(t + k) : t + k), corners = [corner(0), corner(1), corner(2)];
				const f = corners.map(add), col = colourAt(t, corners);
				if (new Set(f).size === 3) faces.push(col ? { v: f, col } : { v: f });
			}
			if (!faces.length) return;
			objects.push({ id: objects.length + 1, name: node.name || "Model " + (objects.length + 1), verts, faces, mat: { roughness: 0.7, metallic: 0 }, solid: true, smooth: 30 });
		});
		if (!objects.length) throw new Error("This FBX has no triangle meshes to import.");
		return { objects };
	};
})();
