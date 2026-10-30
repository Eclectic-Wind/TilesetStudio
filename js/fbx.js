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
			const used = new Map(), verts = [], faces = [];
			const add = (i) => { // weld corners that sit on the same spot (the loader splits vertices along seams)
				v.fromBufferAttribute(pos, i).applyMatrix4(node.matrixWorld);
				const p = yUp ? [v.x, -v.z, v.y] : [v.x, v.y, v.z], k = p.map((c) => Math.round(c * 1e4)).join(",");
				if (!used.has(k)) { used.set(k, verts.length); verts.push(p.map((c) => c * scale)); }
				return used.get(k);
			};
			const count = index ? index.count : pos.count;
			for (let t = 0; t + 2 < count; t += 3) {
				const corner = (k) => (index ? index.getX(t + k) : t + k);
				const f = [add(corner(0)), add(corner(1)), add(corner(2))];
				if (new Set(f).size === 3) faces.push({ v: f });
			}
			if (!faces.length) return;
			objects.push({ id: objects.length + 1, name: node.name || "Model " + (objects.length + 1), verts, faces, mat: { roughness: 0.7, metallic: 0 }, solid: true, smooth: 30 });
		});
		if (!objects.length) throw new Error("This FBX has no triangle meshes to import.");
		return { objects };
	};
})();
