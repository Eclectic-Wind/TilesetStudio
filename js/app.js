// Tileset Studio: load a tileset (power-of-two canvas) -> lay models over its art with primitives and Blender-style edits,
// snapped to the 32 px tile grid -> Process -> check the result in the output viewport -> Export the lighting engine's maps.
"use strict";
(function () {
	const v3 = TS.v3, Mesh = TS.Mesh, $ = (id) => document.getElementById(id);

	const S = (TS.state = {
		name: "tileset", art: null, artURL: null,
		objects: [], active: null, selected: new Set(),
		edit: false, elemMode: "face", elemSel: new Set(),
		cursor: [0, 0, 0], snap: 1, shade: "art", opacity: 0.55, xray: false, grid: true,
		settings: { alphaCut: 13, fill: 2, relief: 0.5, packHighlights: true, body: 40, step: 4, walkOverHeight: 2 },
		autoProcess: true, result: null,
		bundleId: newUUID(),
		refs: [], refActive: null, // reference tilesets shown as ghosts (see "references" below)
	});
	// The Studio had no version number yet: this is the one written to bundles (bump it by hand per release).
	const STUDIO_VERSION = "1.0.0";
	// Generated once per project, saved in the project file; lets the importer tell a moved / renamed export from a new one.
	function newUUID() {
		if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
		const b = crypto.getRandomValues(new Uint8Array(16));
		b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
		const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
		return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
	}
	const undoStack = [], redoStack = [];
	let renderer, output, modal = null, loopHover = null, mouse = [0, 0], spaceDown = false, dirty = true;
	let pencil = null, exchange = null;

	// --- state helpers ---

	const objById = (id) => S.objects.find((o) => o.id === id) || null;
	const activeObj = () => objById(S.active);
	const selectedObjs = () => S.objects.filter((o) => S.selected.has(o.id));

	function snapshot() {
		return JSON.stringify({ objects: S.objects, active: S.active, selected: [...S.selected], edit: S.edit, elemMode: S.elemMode, elemSel: [...S.elemSel] });
	}
	function restore(json) {
		const s = JSON.parse(json);
		S.objects = s.objects; S.active = s.active; S.selected = new Set(s.selected); S.edit = s.edit; S.elemMode = s.elemMode; S.elemSel = new Set(s.elemSel);
		Mesh.bumpIds(S.objects);
		hover = null; loopHover = null; cycle = null;
		changed();
	}
	function pushUndo(before) {
		undoStack.push(before || snapshot());
		if (undoStack.length > 200) undoStack.shift();
		redoStack.length = 0;
		markUnsaved();
	}
	function undo() { if (undoStack.length) { redoStack.push(snapshot()); restore(undoStack.pop()); markUnsaved(); status(`Undo (${undoStack.length} more)`); } else status("Nothing to undo."); }
	function redo() { if (redoStack.length) { undoStack.push(snapshot()); restore(redoStack.pop()); markUnsaved(); status(`Redo (${redoStack.length} more)`); } else status("Nothing to redo."); }

	let processTimer = 0;
	function changed(geometryOnly) {
		dirty = true;
		if (!geometryOnly) panels();
		if (S.autoProcess && S.art) { clearTimeout(processTimer); processTimer = setTimeout(processNow, 250); }
	}

	function status(text) { $("status").textContent = text; }
	function hint() {
		if (modal) return;
		if (S.tool === "pencil") return pencilHint();
		if (S.tool === "stamp" && exchange) return exchange.hint();
		const base = "Shift+A add · G move (or drag a selected piece) · S scale · R turn · Tab edit · right-click/C: 3D cursor (stacks on tops) · F frame · wheel/+/-: zoom · Space-drag: pan · Alt/middle-drag: look round · 5: stay in 3D · snap " + snapText();
		const edit = "1/2/3 vertex/edge/face · white = what a click picks; click again: the one behind · Alt+Z X-ray: pick through faces · E extrude (Alt+E manifold) · F fill · Ctrl+E bridge · Ctrl+right-click: new point · K knife · I inset · Ctrl+B bevel · Ctrl+R loop cut · A all · G/S/R, then X/Y/Z (twice: local) · Shift fine";
		const in3d = "3D view (5 goes back): drag orbits · Shift-drag pans · Ctrl-drag box-selects · drag a selected piece to move it · wheel zooms · F frames · all tools and keys work · ";
		status((S.stay3d ? in3d : "") + (S.edit ? "EDIT " + S.elemMode + " — " + edit : S.stay3d ? "Tab edit · Shift+A add · G/S/R" : base));
	}

	// --- tileset / project files ---

	function loadImage(src) {
		return new Promise((ok, fail) => { const img = new Image(); img.onload = () => ok(img); img.onerror = fail; img.src = src; });
	}

	async function setTileset(dataURL, name) {
		const img = await loadImage(dataURL);
		const c = document.createElement("canvas");
		if (pencil || S.tool === "stamp") setTool("select");
		c.width = img.width; c.height = img.height;
		const g = c.getContext("2d");
		g.drawImage(img, 0, 0);
		const data = g.getImageData(0, 0, img.width, img.height).data;
		const alpha = new Uint8Array(img.width * img.height);
		for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
		S.art = { w: img.width, h: img.height, data, alpha };
		S.artURL = dataURL;
		S.name = name.replace(/\.[^.]+$/, "").replace(/_(height|normal|pbr)$/, "");
		renderer.setArt(img, img.width, img.height);
		renderer.fit();
		S.cursor = [Math.round(img.width / 2 / 32) * 32, Math.round(img.height / 2 / 32) * 32, 0];
		$("exportname").placeholder = S.name;
		$("tileinfo").textContent = `${S.name} ·${img.width}x${img.height} · ${(img.width / 32) * (img.height / 32)} tiles`;
		changed();
		return true;
	}

	const readFile = (file, asText) => new Promise((ok, fail) => { const r = new FileReader(); r.onerror = () => fail(new Error("Could not read this file.")); r.onload = () => ok(r.result); asText ? r.readAsText(file) : r.readAsDataURL(file); });

	async function openTilesetFile(file) {
		if (await setTileset(await readFile(file), file.name)) { status(`Loaded ${file.name}`); }
	}

	async function openTilesetURL(url) {
		const blob = await (await fetch(url)).blob();
		const dataURL = await readFile(blob);
		await setTileset(dataURL, url.split("/").pop());
	}

	// --- references ---
	// A reference is another tileset (a .studio.json project, or a Godot .export.json bundle) shown as a translucent ghost to trace
	// over or compare with: its art as a faint picture, its models as faint outlines. It only moves across the floor (X, Y): its
	// height is locked, so the heights it was built with stay true. Saved in the project. A bundle has no meshes, only each model's
	// footprint and height range, so its models show as prisms (open the .studio.json for the exact shapes).

	const newRefId = () => "r" + Math.random().toString(36).slice(2, 9);
	const refById = (id) => S.refs.find((r) => r.id === id) || null;
	const activeRef = () => refById(S.refActive);

	// A model's footprint hull extruded between its lowest and highest point.
	function prism(name, hull, z0, z1) {
		const n = hull.length;
		if (n < 2) return null;
		if (!(z1 > z0)) z1 = z0 + 0.5;
		const verts = hull.map((p) => [p[0], p[1], z0]).concat(hull.map((p) => [p[0], p[1], z1])), faces = [];
		for (let i = 0; i < (n === 2 ? 1 : n); i++) faces.push({ v: [i, (i + 1) % n, n + ((i + 1) % n), n + i] });
		if (n >= 3) { faces.push({ v: [...Array(n).keys()].map((i) => n + i) }); faces.push({ v: [...Array(n).keys()] }); }
		return { name, verts, faces };
	}

	async function parseReference(text) {
		const p = JSON.parse(text);
		let atlas, meshes, approx = false;
		if (p.format === "tileset-studio") {
			atlas = p.tileset;
			meshes = (p.objects || []).filter((o) => o.faces && o.faces.length).map((o) => ({ name: o.name, verts: o.verts, faces: o.faces.map((f) => ({ v: f.v })) }));
		} else if (p.format === "tileset-studio-export") {
			atlas = p.images && p.images.atlas;
			meshes = ((p.footprints && p.footprints.objects) || []).map((o) => prism(o.name, o.footprint || [], o.z ? o.z[0] : 0, o.z ? o.z[1] : 0)).filter(Boolean);
			approx = true;
		} else throw new Error("That file is not a Tileset Studio project (.studio.json) or Godot bundle (.export.json).");
		if (!atlas) throw new Error("That file has no tileset image to show.");
		const img = await loadImage(atlas);
		return { id: newRefId(), name: p.name || "reference", w: img.width, h: img.height, atlas, meshes, approx, dx: 0, dy: 0, opacity: 0.5, showArt: true, showModels: true, visible: true };
	}

	async function loadRefArt(ref) { renderer.setRefArt(ref.id, await loadImage(ref.atlas)); dirty = true; }

	async function addReference(text) {
		const ref = await parseReference(text);
		S.refs.push(ref); S.refActive = ref.id;
		await loadRefArt(ref);
		refPanel(); markUnsaved(); dirty = true;
		status(`Added reference "${ref.name}"${ref.approx ? " (from a bundle: models show as outlines)" : ""}. Press ✥ Move under References and drag in the view: it slides across the floor, its height stays locked.`);
		return ref;
	}

	function removeReference(id) {
		renderer.dropRefArt(id);
		S.refs = S.refs.filter((r) => r.id !== id);
		if (S.refActive === id) S.refActive = S.refs.length ? S.refs[S.refs.length - 1].id : null;
		if (S.tool === "ref" && !S.refs.length) setTool("select");
		refPanel(); markUnsaved(); dirty = true;
	}

	// Keeps the X / Y fields in step while it is dragged.
	function refSyncXY(r) {
		const row = document.querySelector(`#refs .ref[data-id="${r.id}"]`);
		if (!row) return;
		row.querySelector('[data-a="x"]').value = r.dx; row.querySelector('[data-a="y"]').value = r.dy;
	}

	function refPanel() {
		const el = $("refs");
		if (!el) return;
		const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
		if (!S.refs.length) { el.innerHTML = `<p class="dim">Add another tileset (.studio.json, or a Godot .export.json) as a faint ghost to trace over or compare with. It only slides across the floor; its height stays locked.</p>`; return; }
		el.innerHTML = S.refs.map((r) => `<div class="ref${r.id === S.refActive ? " active" : ""}" data-id="${r.id}">
			<div class="rh"><button class="eye" data-a="vis" title="Show / hide">${r.visible ? "●" : "◌"}</button><span class="rn" title="${esc(r.name)}">${esc(r.name)}${r.approx ? " <i title='From a bundle: models show as footprint outlines'>(outlines)</i>" : ""}</span>
				<button data-a="move" title="Move it: drag in the view. It slides across the floor (X, Y); its height is locked.">✥ Move</button><button data-a="del" title="Remove this reference">✕</button></div>
			<label class="lr2">Opacity <input type="range" data-a="op" min="0" max="1" step="0.05" value="${r.opacity}"></label>
			<div class="rc"><label><input type="checkbox" data-a="art" ${r.showArt ? "checked" : ""}> Picture</label><label><input type="checkbox" data-a="mod" ${r.showModels ? "checked" : ""}> Models</label></div>
			<div class="xy"><label class="ax-x">X <input type="number" data-a="x" value="${r.dx}"></label><label class="ax-y">Y <input type="number" data-a="y" value="${r.dy}"></label><span class="lock" title="Height (Z) can't be changed: it stays where it was built">🔒 Z fixed</span></div>
		</div>`).join("");
		for (const row of el.querySelectorAll(".ref")) {
			const r = refById(row.dataset.id), q = (a) => row.querySelector(`[data-a="${a}"]`);
			const pick = () => { S.refActive = r.id; el.querySelectorAll(".ref").forEach((x) => x.classList.toggle("active", x === row)); };
			row.onclick = () => { if (S.refActive !== r.id) pick(); };
			q("vis").onclick = () => { r.visible = !r.visible; refPanel(); markUnsaved(); dirty = true; };
			q("del").onclick = (e) => { e.stopPropagation(); removeReference(r.id); };
			q("move").onclick = (e) => { e.stopPropagation(); pick(); setTool("ref"); status("Drag in the view to move the reference across the floor. Its height is locked. Q goes back to select."); };
			q("op").oninput = () => { r.opacity = parseFloat(q("op").value); dirty = true; };
			q("op").onchange = () => markUnsaved();
			q("art").onchange = () => { r.showArt = q("art").checked; markUnsaved(); dirty = true; };
			q("mod").onchange = () => { r.showModels = q("mod").checked; markUnsaved(); dirty = true; };
			q("x").onchange = () => { const v = parseFloat(q("x").value); if (!isNaN(v)) { r.dx = v; markUnsaved(); dirty = true; } else q("x").value = r.dx; };
			q("y").onchange = () => { const v = parseFloat(q("y").value); if (!isNaN(v)) { r.dy = v; markUnsaved(); dirty = true; } else q("y").value = r.dy; };
		}
	}

	function projectJSON() {
		return JSON.stringify({ format: "tileset-studio", version: 1, bundleId: S.bundleId, name: S.name, exportName: S.exportName || "", tileset: S.artURL, cursor: S.cursor, snap: S.snap,
			settings: S.settings, objects: S.objects, references: S.refs }, null, 1);
	}

	async function openProject(text) {
		const p = JSON.parse(text);
		// A Godot bundle is not a project to edit: it is added as a reference ghost (drop one in, or Add reference).
		if (p.format === "tileset-studio-export") { addReference(text).catch((err) => alert(err.message)); return; }
		if (p.format !== "tileset-studio") { alert("Not a Tileset Studio project."); return; }
		if (pencil || S.tool === "stamp") setTool("select");
		if (p.tileset) await setTileset(p.tileset, p.name + ".png");
		S.objects = p.objects || [];
		Mesh.bumpIds(S.objects);
		S.cursor = p.cursor || S.cursor; S.snap = typeof p.snap === "number" ? p.snap : 1;
		S.exportName = p.exportName || ""; $("exportname").value = S.exportName; $("exportname").placeholder = S.name;
		Object.assign(S.settings, { alphaCut: 13, fill: 2, relief: 0.5, packHighlights: true, body: 40, step: 4, walkOverHeight: 2 }, p.settings || {});
		S.bundleId = typeof p.bundleId === "string" && p.bundleId ? p.bundleId : newUUID();
		S.active = null; S.selected.clear(); S.edit = false; S.elemSel.clear();
		for (const r of S.refs) renderer.dropRefArt(r.id);
		S.refs = Array.isArray(p.references) ? p.references : []; S.refActive = S.refs.length ? S.refs[S.refs.length - 1].id : null;
		S.refs.forEach((r) => loadRefArt(r).catch(() => {}));
		refPanel();
		undoStack.length = 0; redoStack.length = 0;
		unsaved = !p.bundleId; // an older project gets its id now: autosave keeps it until the project is saved
		if (unsaved) markUnsaved();
		$("snap").value = S.snap;
		settingsToControls();
		changed();
		status(`Opened project ${p.name}`);
	}

	// The Processing panel shows the open project's settings.
	const SETTING_IDS = [["s_fill", "fill", parseInt], ["s_relief", "relief", parseFloat], ["s_alpha", "alphaCut", parseInt], ["s_body", "body", parseFloat], ["s_step", "step", parseFloat], ["s_walk", "walkOverHeight", parseInt, 0, 16]];
	function settingsToControls() {
		for (const [id, key] of SETTING_IDS) if ($(id)) $(id).value = S.settings[key];
		if ($("s_pack")) $("s_pack").checked = !!S.settings.packHighlights;
	}

	// --- saving, autosave, unsaved-work guard ---
	// Every undoable change marks the work unsaved and (after a pause) autosaves the project to the browser's IndexedDB. Saving the
	// project file clears both; on the next start an autosave left behind is offered back (banner over the view).

	let unsaved = false, autosaveTimer = 0;
	function markUnsaved() {
		unsaved = true;
		clearTimeout(autosaveTimer);
		autosaveTimer = setTimeout(autosave, 1500);
	}
	function saveProject() {
		if (pencil && pencil.pts.length) return status("Finish or clear the current pencil outline before saving.");
		download(`${S.name}.studio.json`, projectJSON());
		unsaved = false;
		clearTimeout(autosaveTimer);
		idb("delete", "last").catch(() => {});
		status(`Saved ${S.name}.studio.json (to your downloads)`);
	}
	function autosave() {
		if (!S.art || !unsaved) return;
		idb("put", "last", { time: Date.now(), name: S.name, count: S.objects.length, json: projectJSON() }).catch(() => {});
	}
	// Tiny IndexedDB key-value store ("tileset-studio" / "kv"). op: get, put, delete.
	function idb(op, key, value) {
		return new Promise((ok, fail) => {
			let req;
			try { req = indexedDB.open("tileset-studio", 1); } catch (err) { fail(err); return; }
			req.onupgradeneeded = () => req.result.createObjectStore("kv");
			req.onerror = () => fail(req.error);
			req.onsuccess = () => {
				const db = req.result, tx = db.transaction("kv", op === "get" ? "readonly" : "readwrite"), st = tx.objectStore("kv");
				const r = op === "get" ? st.get(key) : op === "put" ? st.put(value, key) : st.delete(key);
				r.onsuccess = () => { ok(r.result); db.close(); };
				r.onerror = () => { fail(r.error); db.close(); };
			};
		});
	}
	async function offerRestore() {
		let saved = null;
		try { saved = await idb("get", "last"); } catch (err) { return; }
		if (!saved || !saved.count) return;
		const bar = $("restore"), when = new Date(saved.time);
		$("restore_text").textContent = `Unsaved work from ${when.toLocaleString()}: ${saved.name}, ${saved.count} model(s).`;
		bar.classList.add("open");
		$("restore_yes").onclick = async () => { bar.classList.remove("open"); await openProject(saved.json); unsaved = true; status(`Restored ${saved.name} from ${when.toLocaleTimeString()}. Save project to keep it as a file.`); };
		$("restore_no").onclick = () => { bar.classList.remove("open"); idb("delete", "last").catch(() => {}); };
	}

	// View preferences remembered per browser (snap, display, output view and light).
	const PREF_IDS = ["snap", "shade", "opacity", "xray", "grid", "auto", "lightz", "lightr", "shadows"];
	function savePrefs() {
		const p = { outMode: output ? output.mode : "lit", snapV: 2 };
		for (const id of PREF_IDS) { const el = $(id); p[id] = el.type === "checkbox" ? el.checked : el.value; }
		try { localStorage.setItem("ts.prefs", JSON.stringify(p)); } catch (err) { /* storage blocked: not remembered */ }
	}
	function loadPrefs() {
		let p = null;
		try { p = JSON.parse(localStorage.getItem("ts.prefs") || "null"); } catch (err) { /* storage blocked or bad data */ }
		if (!p) return;
		if (p.snapV !== 2) delete p.snap; // the default snap is now 1 px: an old remembered choice (often 32) doesn't override it once
		for (const id of PREF_IDS) {
			if (!(id in p)) continue;
			const el = $(id);
			if (el.type === "checkbox") el.checked = !!p[id]; else el.value = p[id];
			el.dispatchEvent(new Event(el.type === "range" ? "input" : "change"));
		}
		const b = document.querySelector(`#outmodes button[data-mode="${p.outMode}"]`);
		if (b) b.click();
	}

	function download(name, blobOrText, type) {
		const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: type || "application/json" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = name;
		document.body.appendChild(a);
		a.click();
		setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
	}

	const imageBlob = (img) => new Promise((ok) => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; c.getContext("2d").putImageData(img, 0, 0); c.toBlob(ok, "image/png"); });

	// The name exported files go by: the Export menu's Name (saved with the project), else the tileset's name. Kept to letters,
	// digits, - and _ so it is a safe file name everywhere (Godot paths included).
	const cleanName = (s) => String(s || "").trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9_-]/g, "");
	const exportName = () => cleanName(S.exportName) || cleanName(S.name) || "tileset";

	const imageDataURL = (img) => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; c.getContext("2d").putImageData(img, 0, 0); return c.toDataURL("image/png"); };
	// The art as PNG data (the tileset may have been opened from any image type the browser reads).
	const artDataURL = () => { const a = S.art, img = new ImageData(new Uint8ClampedArray(a.data), a.w, a.h); return imageDataURL(img); };

	// One file for Godot (addons/studio_import): the art, every map and the footprints / collision, as `name.export.json`. The
	// plugin unpacks it next to itself into name.png, name_height.png, name_normal.png, name_pbr.png, name_footprints.json and
	// builds name_tileset.tres.
	function bundleJSON() {
		processNow();
		const maps = TS.Process.maps(S.result, S.settings), name = exportName();
		// Raw bytes as base64 (chunked: String.fromCharCode can't take megabytes at once).
		let bin = "";
		for (let i = 0; i < maps.data.length; i += 0x8000) bin += String.fromCharCode.apply(null, maps.data.subarray(i, i + 0x8000));
		const now = new Date().toISOString();
		return JSON.stringify({
			format: "tileset-studio-export", version: 3, name, tile: 32, canvas: [S.art.w, S.art.h], exported: now,
			bundleId: S.bundleId, exportedAt: now, studioVersion: STUDIO_VERSION, walkOverHeight: TS.Process.walkOver(S.settings),
			images: { atlas: artDataURL() },
			maps: { w: maps.w, h: maps.h, rows: maps.rows, materials: maps.materials, highlights: maps.highlights, data: btoa(bin) },
			footprints: TS.Process.footprints(S.objects, S.art, S.result, S.settings),
		});
	}

	async function exportMaps(which) {
		if (!S.art) return alert("Open a tileset first.");
		const name = exportName(), st = () => S.result.stats;
		if (which === "bundle") {
			const text = bundleJSON();
			download(`${name}.export.json`, text);
			return status(`Exported ${name}.export.json (${Math.round(text.length / 1024)} KB): put it anywhere under the Godot project; the Studio Import plugin builds ${name}_tileset.tres${st().unfilled ? ` — ${st().unfilled} art px still uncovered (holes view)` : ""}`);
		}
		processNow();
		const imgs = TS.Process.images(S.result, S.settings);
		const files = [];
		if (which === "all" || which === "height") files.push([`${name}_height.png`, await imageBlob(imgs.height)]);
		if (which === "all" || which === "normal") files.push([`${name}_normal.png`, await imageBlob(imgs.normal)]);
		if (which === "all" || which === "pbr") files.push([`${name}_pbr.png`, await imageBlob(imgs.pbr)]);
		if (which === "all" || which === "footprints") files.push([`${name}_footprints.json`, JSON.stringify(TS.Process.footprints(S.objects, S.art, S.result, S.settings), null, 1)]);
		for (const [n, b] of files) { download(n, b); await new Promise((r) => setTimeout(r, 250)); }
		status(`Exported ${files.map((f) => f[0]).join(", ")}${name !== S.name ? ` (the atlas must be called ${name}.png beside them)` : ""}${st().unfilled ? ` — ${st().unfilled} art px still uncovered (holes view)` : ""}`);
	}

	// --- processing ---

	function processNow() {
		if (!S.art) return;
		const t0 = performance.now();
		const roleSig = (r) => (r && r.roles ? r.roles.map((x) => `${x.kind}/${x.mode}/${x.heightMin}/${x.heightMax}`).join() : "");
		const before = roleSig(S.result);
		S.result = TS.Process.run(S.objects, S.art, S.settings);
		if (roleSig(S.result) !== before) panels(); // the properties / outliner show resolved kind, collision and heights
		S.result.pieceMap = TS.Process.pieces(S.objects, S.result, S.settings);
		output.set(S.result, S.settings);
		pieceInfo();
		const st = S.result.stats, clashes = TS.Process.clashes(S.objects);
		holeCells = null;
		const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
		const clashText = clashes.map((c) => `${c.a.join(", ")} / ${c.b.join(", ")} (tile column ${c.col})`);
		$("stats").innerHTML = `covered ${st.covered} px · <b class="${st.unfilled ? "bad" : ""}">holes ${st.unfilled}</b> (+${st.filled} filled)` +
			(st.unfilled ? `<button id="b_nexthole" title="Show the next uncovered spot in both views">next hole ›</button>` : "") +
			` · geometry off the art ${st.unused} px${st.over ? ` · <b class="bad">${st.over} px above 255</b>` : ""} · ${Math.round(performance.now() - t0)} ms` +
			(clashes.length ? `<span class="clash" title="${esc(clashText.join("\n"))}&#10;Pieces standing on different rows of one tile column: in one tile layer the upper one is measured as part of the lower one there (the importer prints the same). Move one of them to its own columns, or onto the same row.">⚠ ${clashes.length} column clash${clashes.length > 1 ? "es" : ""}: ${esc(clashText[0])}${clashes.length > 1 ? " …" : ""}</span>` : "");
		if (st.unfilled) $("b_nexthole").onclick = nextHole;
		// Atlas cells shared by two models (the bundle's `clashes`): a warning here, never silent.
		const own = TS.Process.cellOwnership(S.objects, S.result, S.settings), real = own.clashes.filter((c) => !c.samePiece);
		if (own.clashes.length) {
			const line = (c) => `${S.objects[c.models[0]].name} / ${S.objects[c.models[1]].name} (cell ${c.cell[0]}, ${c.cell[1]}${c.samePiece ? ", same piece" : ""})`;
			const el = document.createElement("span");
			el.className = "clash";
			el.title = own.clashes.map(line).join("\n") + "\nTwo models paint or stand in one 32 px atlas cell. Same piece (footprints within 2 px) is usually fine; otherwise the importer cannot tell whose cell it is: move one, or give them their own cells.";
			el.textContent = `⚠ ${own.clashes.length} shared cell${own.clashes.length > 1 ? "s" : ""}${real.length ? ` (${real.length} between separate pieces)` : " (same piece only)"}: ${line(real[0] || own.clashes[0])}${own.clashes.length > 1 ? " …" : ""}`;
			$("stats").appendChild(el);
		}
	}

	// The output tabs are grouped (Maps, Plan): the group's tab shows the active member and opens a small list.
	function syncModeTabs() {
		for (const g of document.querySelectorAll("#outmodes .grp")) {
			const on = g.querySelector(".sub button.on"), head = g.querySelector(".grphead");
			head.textContent = (on ? on.textContent : head.dataset.label) + " ▾";
			head.classList.toggle("on", !!on);
			g.classList.remove("open");
		}
	}
	function initModeTabs() {
		for (const head of document.querySelectorAll("#outmodes .grphead"))
			head.onclick = (e) => { e.stopPropagation(); const g = head.parentElement, was = g.classList.contains("open"); document.querySelectorAll("#outmodes .grp").forEach((x) => x.classList.remove("open")); g.classList.toggle("open", !was); };
		document.addEventListener("click", () => document.querySelectorAll("#outmodes .grp").forEach((x) => x.classList.remove("open")));
		syncModeTabs();
	}
	// Pieces view legend: each piece's colour and name, and the conflict / floating counts.
	function pieceInfo() {
		const el = $("pieceinfo"), r = S.result;
		el.classList.toggle("on", !!r && (output.mode === "pieces" || output.mode === "kind" || output.mode === "collision"));
		if (!r || !r.pieceMap) return;
		const pm = r.pieceMap, esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
		if (output.mode === "kind" || output.mode === "collision") {
			const rows = [], rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`, roles = r.roles || [];
			if (output.mode === "kind") {
				for (const k of TS.Process.KINDS) {
					const names = S.objects.filter((o, i) => roles[i] && o.faces.length && roles[i].kind === k).map((o, i) => o.name);
					rows.push(`<span class="sw" style="background:${rgb(TS.Output.KIND_COLOURS[k])}"></span>${k} (${names.length})${names.length && names.length <= 4 ? ": " + esc(names.join(", ")) : ""}`);
				}
			} else {
				const C = TS.Output.MODE_COLOURS;
				rows.push(`outlines: <span class="sw" style="background:${C.none}"></span>none (walkable, dashed) <span class="sw" style="background:${C.strip}"></span>strip <span class="sw" style="background:${C.footprint}"></span>footprint`);
				const autos = S.objects.map((o, i) => (roles[i] && o.faces.length && roles[i].requested === "auto" ? `${esc(o.name)} auto→${roles[i].mode}` : null)).filter(Boolean);
				if (autos.length) rows.push(`<br>${autos.join(" · ")}`);
			}
			el.innerHTML = rows.join(" ");
			return;
		}
		const col = (id) => { const c = TS.Output.pieceColour(id); return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; };
		el.innerHTML = (pm.conflicts ? `<b class="bad">${pm.conflicts} conflict cell${pm.conflicts > 1 ? "s" : ""}</b>` : `<b>No conflicts</b>`) +
			(pm.floating ? ` · <b class="warn">${pm.floating} floating</b>` : "") + ` · ${pm.pieces.length} piece${pm.pieces.length === 1 ? "" : "s"}` +
			pm.pieces.map((p) => `<span class="sw" style="background:${col(p.id)}"></span>${esc(p.names.join(" + "))}`).join("");
	}

	// "next hole": cycle through clusters (8 px cells) of uncovered art, centring both views on each.
	let holeCells = null, holeIdx = -1;
	function nextHole() {
		const r = S.result;
		if (!r) return;
		if (!holeCells) {
			const seen = new Set();
			holeCells = [];
			for (let i = 0; i < r.w * r.h; i++) {
				if (r.hole[i] !== 1) continue;
				const x = i % r.w, y = (i / r.w) | 0, key = ((y >> 3) << 16) | (x >> 3);
				if (!seen.has(key)) { seen.add(key); holeCells.push([(x >> 3) * 8 + 4, (y >> 3) * 8 + 4]); }
			}
			holeIdx = -1;
		}
		if (!holeCells.length) return status("No holes.");
		holeIdx = (holeIdx + 1) % holeCells.length;
		const [x, y] = holeCells[holeIdx];
		if (S.stay3d) toggleStay3d(false);
		renderer.cam.x = x; renderer.cam.y = y;
		zoomAt(...viewCentre(), Math.max(renderer.cam.zoom, 6));
		renderer.cam.x = x; renderer.cam.y = y;
		document.querySelector('#outmodes button[data-mode="holes"]').click();
		output.view = { s: Math.max(output.scale(), 4), cx: x, cy: y };
		output.draw();
		status(`Hole spot ${holeIdx + 1} of ${holeCells.length} at canvas ${x}, ${y} (magenta in the Holes view). Model it, or raise "Fill holes up to".`);
	}

	// --- adding / deleting ---

	function addPrimitive(kind) {
		if (!S.art) return alert("Open a tileset first.");
		if (pencil || S.tool === "stamp") setTool("select");
		pushUndo();
		if (S.edit) S.edit = false;
		// The cursor sits on grid intersections; a new piece fills the tile(s) south-east of it.
		const T = 32;
		const base = [S.cursor[0] + T / 2, S.cursor[1] + T / 2, S.cursor[2]];
		const obj = kind === "box" ? Mesh.box(base, T, T, T)
			: kind === "cylinder" ? Mesh.cylinder(base, T / 2, T / 2, T, 16)
			: kind === "wedge" ? Mesh.wedge(base, T, T, T)
			: kind === "plane" ? Mesh.plane(base, T, T)
			: kind === "point" ? Mesh.newObject("Point", [S.cursor.slice()], [])
			: Mesh.sphere(base, T / 2, T / 2, T / 2, 12, 8);
		obj.name = `${obj.name}.${String(S.objects.length + 1).padStart(2, "0")}`;
		S.objects.push(obj);
		S.active = obj.id; S.selected = new Set([obj.id]);
		if (kind === "point") {
			// A lone point to draw from: straight into edit mode with it selected.
			S.edit = true; S.elemMode = "vert"; S.elemSel = new Set([0]);
			changed(); hint();
			return status("Point at the 3D cursor: Ctrl+right-click draws lines on from it, E pulls new points out, F joins selected points into a face.");
		}
		changed();
		status(`Added ${obj.name} at the 3D cursor (${base.map((v) => Math.round(v)).join(", ")})`);
	}

	function deleteSelection() {
		if (S.edit) {
			const obj = activeObj();
			if (!obj || !S.elemSel.size) return status("Select vertices, edges or faces to delete.");
			pushUndo();
			if (S.elemMode === "face") Mesh.deleteFaces(obj, [...S.elemSel]);
			else if (S.elemMode === "edge") Mesh.deleteEdges(obj, [...S.elemSel]);
			else Mesh.deleteVerts(obj, [...S.elemSel]);
			S.elemSel.clear();
			if (!obj.verts.length) { S.objects = S.objects.filter((o) => o !== obj); S.edit = false; S.active = null; }
		} else {
			if (!S.selected.size) return;
			pushUndo();
			S.objects = S.objects.filter((o) => !S.selected.has(o.id));
			S.selected.clear(); S.active = null;
		}
		changed();
	}

	function duplicate() {
		if (S.edit || !S.selected.size) return;
		pushUndo();
		const copies = selectedObjs().map((o) => { const c = Mesh.cloneNew(o); c.name = o.name + " copy"; return c; });
		S.objects.push(...copies);
		S.selected = new Set(copies.map((c) => c.id)); S.active = copies[copies.length - 1].id;
		changed();
		beginModal("grab", true);
	}

	// --- building: points, lines, faces, bridges ---

	// The direction from the scene toward the eye at the view centre (faces made from nothing turn to it).
	const toViewer = () => { const [cx, cy] = viewCentre(); return v3.scale(renderer.ray(cx, cy).d, -1); };

	// E on vertices / edges: new points joined by lines, or quads grown from the edges; then they follow the pointer (G-style).
	// Esc takes the whole extrusion back.
	function extrudeElems() {
		const o = activeObj();
		if (!o || !S.elemSel.size) return status(`Select ${S.elemMode === "edge" ? "edges" : "vertices"} to extrude.`);
		const before = snapshot();
		if (S.elemMode === "vert") S.elemSel = new Set(Mesh.extrudeVerts(o, [...S.elemSel]));
		else { const r = Mesh.extrudeEdges(o, [...S.elemSel]); S.elemSel = new Set(r.edges); }
		beginModal("grab");
		if (!modal) { restore(before); return; }
		modal.before = before;
		modal.data.extruded = true;
		status(`Extruded: move the new ${S.elemMode === "edge" ? "edges" : "points"} (X / Y / Z lock, a number for exact), click to apply, Esc takes it back.`);
	}

	// F: join the selected vertices (or the edges' ends) with a line (two) or a face (three or more).
	function fillSelection() {
		const o = activeObj();
		if (!S.edit || !o) return frameSelection();
		const idx = Mesh.selectionVerts(o, S.elemMode, S.elemSel);
		const before = snapshot(), r = Mesh.fill(o, idx, toViewer());
		if (r.error) return status(r.error);
		pushUndo(before);
		if (r.face !== undefined) { S.elemMode = "face"; S.elemSel = new Set([r.face]); }
		changed();
		status(r.line ? "Joined the two vertices with a line (F on 3+ makes a face)." : `New face with ${o.faces[r.face].v.length} corners (E pulls it up into a solid).`);
	}

	// Ctrl+E: bridge two faces (they're removed, their rims joined by a band: a tunnel, or a neck between two pieces after Ctrl+J)
	// or two edge loops / strips (hole rims, drawn outlines).
	function bridgeSelection() {
		const o = activeObj();
		if (!S.edit || !o) return status("Bridge works in edit mode: select two faces (3) or two edge loops (2).");
		const before = snapshot();
		let r;
		if (S.elemMode === "face") {
			if (S.elemSel.size !== 2) return status("Select exactly two faces to bridge.");
			const [a, b] = [...S.elemSel];
			r = Mesh.bridgeFaces(o, a, b);
		} else {
			const keys = S.elemMode === "edge" ? [...S.elemSel] : [...Mesh.edges(o).keys()].filter((k) => k.split("_").every((i) => S.elemSel.has(+i)));
			const ch = Mesh.chains(o, keys);
			if (ch.error) return status(ch.error);
			if (ch.length !== 2) return status(`Select two separate edge loops or strips to bridge (found ${ch.length}).`);
			r = Mesh.bridge(o, ch[0], ch[1]);
			if (!r.error) Mesh.cleanup(o);
		}
		if (r.error) { restore(before); return status(r.error); }
		pushUndo(before);
		S.elemMode = "face";
		S.elemSel = new Set(o.faces.map((f, i) => i).slice(-r.faces.length));
		changed();
		status(`Bridged with ${r.faces.length} face(s)${Mesh.isClosed(o) ? " · the model is closed" : ""}.`);
	}

	// Ctrl+J: join the selected models into the active one (to bridge between them, or edit them as one).
	function joinSelection() {
		if (S.edit) return status("Join works on models: Tab out of edit mode first.");
		const into = activeObj(), others = selectedObjs().filter((o) => o !== into);
		if (!into || !others.length) return status("Select two or more models to join (the last clicked one keeps its name).");
		pushUndo();
		Mesh.join(into, others);
		S.objects = S.objects.filter((o) => !others.includes(o));
		S.selected = new Set([into.id]);
		changed();
		status(`Joined ${others.length + 1} models into ${into.name}.`);
	}

	// Ctrl+right-click in edit mode: a new point where the pointer is (on a surface, else at the height of the selected point, else
	// the floor), snapped; joined by a line to the one selected point, so clicks draw an outline (F closes it into a face).
	function addVertexAt(px, py) {
		const o = activeObj();
		if (!S.edit || !o) return false;
		const sel = S.elemMode === "vert" && S.elemSel.size === 1 ? [...S.elemSel][0] : -1;
		const hit = renderer.pick(visibleObjs(), px, py);
		let p = hit ? hit.point : renderer.floorPoint(px, py, sel >= 0 ? o.verts[sel][2] : 0);
		if (!p) return true;
		const step = S.snap;
		p = [TS.snap(p[0], step), TS.snap(p[1], step), hit ? Math.round(p[2] * 100) / 100 : p[2]];
		pushUndo();
		o.verts.push(p);
		const n = o.verts.length - 1;
		if (sel >= 0) Mesh.addLine(o, sel, n);
		S.elemMode = "vert"; S.elemSel = new Set([n]);
		changed();
		status(`Point at ${p.map((v) => +v.toFixed(1)).join(", ")}${sel >= 0 ? ", joined to the last one" : ""}. Ctrl+right-click again draws on; F joins the selection into a face.`);
		return true;
	}

	// --- knife (K): click points along a cut, Enter / Space / right-click to cut, Backspace drops the last point, Esc stops ---
	// Points snap to vertices, then onto edges (on grid lines along the edge; Shift / "fine": anywhere), else land on the face
	// under the pointer (or off the model: a cut can start outside it). Clicking the first point again closes the loop. The cut
	// runs through what's in sight; with X-ray it cuts right through the model (back faces too).
	let knife = null;
	function startKnife() {
		if (!S.edit || !activeObj()) return status("Knife works in edit mode: Tab into a model first.");
		if (modal) return;
		S.loopCut = false; loopHover = null;
		knife = { pts: [], hover: null };
		dirty = true;
		status("Knife: click points along the cut (they snap to vertices and edges) · Enter / Space / right-click cuts · Backspace drops a point · click the first point to close · Esc stops" + (S.xray ? " · X-ray: cuts through" : " · X-ray (Alt+Z) cuts through"));
	}
	function knifePoint(px, py, ev) {
		const o = activeObj();
		if (!o) return null;
		const vis = (p) => S.xray || renderer.visible(visibleObjs(), p);
		let best = null, bd = 10;
		o.verts.forEach((p) => { const s = renderer.toScreen(p); if (!s) return; const d = Math.hypot(s[0] - px, s[1] - py); if (d < bd && vis(p)) { bd = d; best = { p: p.slice(), snap: "vertex" }; } });
		if (best) return best;
		bd = 8;
		for (const e of Mesh.edges(o).values()) {
			const a = o.verts[e.a], b = o.verts[e.b], sa = renderer.toScreen(a), sb = renderer.toScreen(b);
			if (!sa || !sb) continue;
			const dx = sb[0] - sa[0], dy = sb[1] - sa[1], l = dx * dx + dy * dy;
			if (l < 1) continue;
			let t = TS.clamp(((px - sa[0]) * dx + (py - sa[1]) * dy) / l, 0, 1);
			const d = Math.hypot(sa[0] + dx * t - px, sa[1] + dy * t - py);
			if (d >= bd) continue;
			// On grid lines along the edge's main axis (strict snapping), unless fine; a step at most half the edge (a one-tile
			// edge snaps to its middle, not just its ends).
			const dd = v3.sub(b, a), k = [0, 1, 2].reduce((m, i) => (Math.abs(dd[i]) > Math.abs(dd[m]) ? i : m), 0);
			const kstep = Math.max(1, Math.min(stepFor(ev), 2 ** Math.floor(Math.log2(Math.max(2, Math.abs(dd[k])) / 2))));
			if (!((ev && ev.shiftKey) || S.fine) && Math.abs(dd[k]) > 1e-6) t = TS.clamp((TS.snap(a[k] + dd[k] * t, kstep) - a[k]) / dd[k], 0, 1);
			const p = v3.lerp(a, b, t);
			if (vis(p)) { bd = d; best = { p, snap: "edge" }; }
		}
		if (best) return best;
		const h = renderer.pick(S.xray ? [o] : visibleObjs(), px, py);
		if (h && h.obj === o) return { p: h.point, snap: "face" };
		const c = Mesh.centre(o), f = renderer.floorPoint(px, py, c[2]);
		return f ? { p: f, snap: "off the model" } : null;
	}
	function knifeClick(px, py, ev) {
		const k = knifePoint(px, py, ev);
		if (!k) return;
		const first = knife.pts[0], s0 = first && renderer.toScreen(first);
		if (knife.pts.length > 2 && s0 && Math.hypot(s0[0] - px, s0[1] - py) < 10) { knife.closed = true; return knifeApply(); }
		knife.pts.push(k.p);
		dirty = true;
		status(`Knife: ${knife.pts.length} point(s), last on ${k.snap} · Enter cuts · Backspace drops · Esc stops`);
	}
	function knifeApply() {
		const o = activeObj(), pts = knife ? knife.pts.slice() : [];
		const closed = knife && knife.closed;
		knife = null;
		dirty = true;
		if (!o || pts.length < 2) return status("Knife: nothing cut (it needs two points or more).");
		const before = snapshot(), cuts = [];
		if (closed) pts.push(pts[0]);
		for (let i = 0; i + 1 < pts.length; i++) {
			const A = pts[i], B = pts[i + 1], sA = renderer.toScreen(A), sB = renderer.toScreen(B);
			if (!sA || !sB) continue;
			const ex = sB[0] - sA[0], ey = sB[1] - sA[1], l = ex * ex + ey * ey;
			if (l < 1) continue;
			const d = renderer.ray(sA[0], sA[1]).d;
			// Within this stroke on screen (a hair over, so a cut ending on an edge or vertex reaches it).
			const inside = (X) => { const s = renderer.toScreen(X); if (!s) return false; const t = ((s[0] - sA[0]) * ex + (s[1] - sA[1]) * ey) / l; return t > -1e-3 && t < 1 + 1e-3; };
			const use = (fi, X1, X2) => {
				if (S.xray) return true;
				const f = o.faces[fi], mid = v3.lerp(X1, X2, 0.5), s = renderer.toScreen(mid);
				return s && v3.dot(Mesh.faceNormal(o, f), renderer.ray(s[0], s[1]).d) < 0 && renderer.visible(visibleObjs(), mid);
			};
			cuts.push(...Mesh.knife(o, A, B, d, inside, use));
		}
		if (!cuts.length) { restore(before); return status("Knife: the cut crossed no face from edge to edge (start and end it on edges, or outside the model)."); }
		pushUndo(before);
		S.elemMode = "edge";
		const live = Mesh.edges(o);
		S.elemSel = new Set(cuts.filter((k) => live.has(k)));
		changed();
		status(`Knife: cut ${cuts.length} face(s); the new edges are selected.`);
	}

	// --- quality-of-life actions (keys in onKey, buttons in the palette / outliner) ---

	const allElems = (o) => (S.elemMode === "face" ? o.faces.map((f, i) => i) : S.elemMode === "edge" ? [...Mesh.edges(o).keys()] : o.verts.map((p, i) => i));

	// H hides the selection, Shift+H everything else, Alt+H shows all (and selects what came back).
	function hideModels(mode) {
		if (S.edit) return status("Hiding works on whole models: Tab out of edit mode first.");
		const targets = mode === "unselected" ? S.objects.filter((o) => !S.selected.has(o.id) && !o.hidden) : selectedObjs();
		if (!targets.length) return status(mode === "unselected" ? "Nothing else to hide." : "Select models to hide (H), or Alt+H to show all.");
		pushUndo();
		for (const o of targets) { o.hidden = true; S.selected.delete(o.id); }
		if (activeObj() && activeObj().hidden) S.active = null;
		changed(true); panels();
		status(`Hid ${targets.length} model(s): they still process and export. Alt+H shows them again.`);
	}
	function unhideAll() {
		const hidden = S.objects.filter((o) => o.hidden);
		if (!hidden.length) return status("Nothing is hidden.");
		pushUndo();
		for (const o of hidden) { o.hidden = false; S.selected.add(o.id); }
		S.active = hidden[hidden.length - 1].id;
		changed(true); panels();
		status(`Showing ${hidden.length} model(s) again (selected).`);
	}
	function toggleHidden(o) {
		pushUndo();
		o.hidden = !o.hidden;
		if (o.hidden) { S.selected.delete(o.id); if (S.active === o.id) { S.active = null; if (S.edit) S.edit = false; } }
		changed(true); panels();
	}

	// Ctrl+I: invert the selection (models, or elements in edit mode).
	function invertSelection() {
		if (S.edit) { const o = activeObj(); if (!o) return; S.elemSel = new Set(allElems(o).filter((k) => !S.elemSel.has(k))); }
		else {
			S.selected = new Set(visibleObjs().filter((o) => !S.selected.has(o.id)).map((o) => o.id));
			if (!S.selected.has(S.active)) S.active = S.selected.size ? [...S.selected].pop() : null;
		}
		changed(true); panels();
	}

	// Ctrl+C / Ctrl+V: copy models, paste them in place (also into another project or tab: kept in the browser's storage).
	let clipboard = null;
	function copySelection() {
		if (S.edit || !S.selected.size) return status("Select models to copy.");
		clipboard = JSON.stringify(selectedObjs());
		try { localStorage.setItem("ts.clipboard", clipboard); } catch (err) { /* storage blocked: this tab only */ }
		status(`Copied ${S.selected.size} model(s). Ctrl+V pastes them in place.`);
	}
	function paste() {
		let text = null;
		try { text = localStorage.getItem("ts.clipboard"); } catch (err) { /* storage blocked */ }
		text = text || clipboard;
		if (!text) return status("Nothing copied yet (Ctrl+C copies selected models).");
		if (!S.art) return status("Open a tileset first.");
		pushUndo();
		if (S.edit) S.edit = false;
		const copies = JSON.parse(text).map((o) => { const c = Mesh.cloneNew(o); c.hidden = false; return c; });
		S.objects.push(...copies);
		S.selected = new Set(copies.map((c) => c.id)); S.active = copies[copies.length - 1].id;
		changed();
		status(`Pasted ${copies.length} model(s) in place: G moves them.`);
	}

	// Ctrl+M then X / Y / Z (or the palette's mirror button): mirror the selected models across their middle on that axis.
	let mirrorPending = false;
	function mirrorSelection(axis) {
		mirrorPending = false;
		if (S.edit) return status("Mirror works on whole models: Tab out of edit mode first.");
		const objs = selectedObjs();
		if (!objs.length) return status("Select models to mirror.");
		const k = "xyz".indexOf(axis), b = { min: Infinity, max: -Infinity };
		for (const o of objs) { const bb = Mesh.bounds(o); b.min = Math.min(b.min, bb.min[k]); b.max = Math.max(b.max, bb.max[k]); }
		pushUndo();
		for (const o of objs) Mesh.mirror(o, k, (b.min + b.max) / 2);
		changed();
		status(`Mirrored ${objs.length} model(s) along ${AXIS[axis]}.`);
	}

	// Ctrl+arrows: nudge the selection a snap step across / in depth; PageUp / PageDown: up / down. Shift: half a step.
	function nudge(d, e) {
		const step = stepFor(e), objs = editTargets();
		if (!objs.length) return false;
		if (S.edit && !S.elemSel.size) return false;
		pushUndo();
		for (const o of objs) Mesh.translate(o, Mesh.selectionVerts(o, S.edit ? S.elemMode : "object", S.elemSel), d.map((v) => v * step));
		changed();
		status(`Nudged ${d.map((v, k) => (v ? "XYZ"[k] + " " + (v > 0 ? "+" : "") + v * step : "")).join("")} px`);
		return true;
	}

	// [ / ]: snap step down / up.
	const SNAPS = [0, 1, 2, 4, 8, 16, 32]; // 0 = off (free)
	const snapText = () => (S.snap > 0 ? S.snap + " px" : "off (free)");
	function snapStep(dir) {
		const i = TS.clamp(SNAPS.indexOf(S.snap) + dir, 0, SNAPS.length - 1);
		S.snap = SNAPS[i]; $("snap").value = S.snap; savePrefs();
		status(`Snapping: ${snapText()}`);
	}

	// --- picking ---

	// Hidden models (H) aren't drawn or picked, but still process and export.
	const visibleObjs = () => S.objects.filter((o) => !o.hidden);
	function pickObject(px, py) { return renderer.pick(visibleObjs(), px, py); }

	function nearestEdge(obj, px, py, maxPx) {
		let best = null, bd = maxPx || 10;
		for (const [k, e] of Mesh.edges(obj)) {
			const a = renderer.toScreen(obj.verts[e.a]), b = renderer.toScreen(obj.verts[e.b]);
			if (!a || !b) continue;
			const d = segDist([px, py], a, b);
			if (d < bd) { bd = d; best = { key: k, a: e.a, b: e.b }; }
		}
		return best;
	}
	function segDist(p, a, b) {
		const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
		const t = l ? TS.clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l, 0, 1) : 0;
		return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
	}

	// In this projection things often stack on one screen spot (a box's back-bottom edge lies exactly on its front-top edge), so
	// picking gathers every candidate under the pointer, best first, and a click again on the same spot takes the next one.
	// Without X-ray only what's in sight counts (nothing in front of it); in X-ray everything does, and face dots come first.

	// Is a point of the active object in sight? (X-ray: always.)
	const inSight = (p) => S.xray || renderer.visible(visibleObjs(), p);
	const edgeInSight = (o, e) => S.xray || [0.5, 0.2, 0.8].some((t) => renderer.visible(visibleObjs(), v3.lerp(o.verts[e.a], o.verts[e.b], t)));
	// A face is in sight when it faces the viewer (not its back, not edge-on: a side wall in the tileset view) and nothing hides
	// its middle.
	function faceInSight(o, fi) {
		if (S.xray) return true;
		const c = Mesh.faceCentre(o, o.faces[fi]), s = renderer.toScreen(c);
		if (!s || v3.dot(Mesh.faceNormal(o, o.faces[fi]), renderer.ray(s[0], s[1]).d) > -0.02) return false;
		return renderer.visible(visibleObjs(), c);
	}

	// Edit mode: element keys under the pointer (face index, edge key or vertex index), best first.
	function elemCandidates(obj, px, py) {
		const out = [], add = (k) => { if (!out.includes(k)) out.push(k); };
		const near = (list) => list.sort((a, b) => a.d - b.d || a.t - b.t).forEach((c) => add(c.k));
		if (S.elemMode === "face") {
			// Face dots near the pointer (X-ray: any; else in sight), and the faces the ray passes through (else only the front one).
			const dots = [];
			obj.faces.forEach((f, fi) => {
				const s = renderer.toScreen(Mesh.faceCentre(obj, f));
				if (s) { const d = Math.hypot(s[0] - px, s[1] - py); if (d < 9) dots.push({ k: fi, d, t: 0 }); }
			});
			const hits = renderer.pickFaces(obj, px, py);
			if (S.xray) { near(dots); hits.forEach((h) => add(h.face)); }
			else {
				const front = renderer.pick(visibleObjs(), px, py);
				if (front && front.obj === obj) add(front.face);
				near(dots.filter((c) => faceInSight(obj, c.k)));
			}
		} else if (S.elemMode === "edge") {
			const list = [];
			for (const [k, e] of Mesh.edges(obj)) {
				const a = renderer.toScreen(obj.verts[e.a]), b = renderer.toScreen(obj.verts[e.b]);
				if (!a || !b) continue;
				const d = segDist([px, py], a, b);
				if (d < 10 && edgeInSight(obj, e)) list.push({ k, d: Math.round(d / 2), t: -(obj.verts[e.a][1] + obj.verts[e.b][1] + obj.verts[e.a][2] + obj.verts[e.b][2]) });
			}
			near(list);
		} else {
			const list = [];
			obj.verts.forEach((p, i) => {
				const s = renderer.toScreen(p);
				if (!s) return;
				const d = Math.hypot(s[0] - px, s[1] - py);
				if (d < 12 && inSight(p)) list.push({ k: i, d: Math.round(d / 2), t: -(p[1] + p[2]) });
			});
			near(list);
		}
		return out;
	}
	// Object mode: models under the pointer, nearest first.
	const objCandidates = (px, py) => renderer.pickAll(visibleObjs(), px, py).map((h) => h.obj.id);

	// Plain click on the same spot again: the next candidate. Shift-click: adds the first one not yet selected (so repeated
	// Shift-clicks gather a whole stack), or removes the top one when all are.
	let cycle = null;
	function choose(cands, px, py, add, selected) {
		if (!cands.length) { cycle = null; return { pick: null }; }
		if (add) {
			const fresh = cands.find((k) => !selected.has(k));
			return fresh !== undefined ? { pick: fresh, adding: true } : { pick: cands[0], removing: true };
		}
		const sig = cands.join(",");
		if (cycle && cycle.sig === sig && Math.hypot(px - cycle.px, py - cycle.py) < 5) cycle.i = (cycle.i + 1) % cands.length;
		else cycle = { sig, px, py, i: 0 };
		return { pick: cands[cycle.i], index: cycle.i };
	}

	function clickSelect(px, py, add) {
		let note = "";
		if (S.edit) {
			const obj = activeObj();
			if (!obj) return;
			const cands = elemCandidates(obj, px, py), c = choose(cands, px, py, add, S.elemSel);
			if (!add) S.elemSel.clear();
			if (c.pick !== null) { if (c.removing) S.elemSel.delete(c.pick); else S.elemSel.add(c.pick); }
			const what = { face: "face", edge: "edge", vert: "vertex" }[S.elemMode];
			if (cands.length > 1) note = `${what} ${c.index !== undefined ? c.index + 1 : cands.indexOf(c.pick) + 1} of ${cands.length} here — ${add ? "Shift-click again adds the next" : "click again for the next"}${S.xray ? "" : " (X-ray, Alt+Z: also the hidden ones)"}`;
			else if (!cands.length && !add) note = S.xray ? "" : `Nothing in sight there. X-ray (Alt+Z) picks through faces.`;
		} else {
			const cands = objCandidates(px, py), c = choose(cands, px, py, add, S.selected);
			if (!add) S.selected.clear();
			if (c.pick !== null) {
				if (c.removing) S.selected.delete(c.pick);
				else { S.selected.add(c.pick); S.active = c.pick; }
				if (cands.length > 1) note = `${objById(c.pick).name}: ${(c.index !== undefined ? c.index : cands.indexOf(c.pick)) + 1} of ${cands.length} models here — ${add ? "Shift-click again adds the next" : "click again for the one behind"}`;
			} else if (!add) S.active = null;
		}
		hover = null;
		changed(true);
		panels();
		if (note) status(note); else hint();
	}

	// Pre-selection: what a click would pick, highlighted under the pointer (edit mode).
	let hover = null;
	function updateHover(px, py) {
		let next = null;
		const obj = activeObj();
		if (S.edit && obj && !modal && !S.armed && !S.loopCut) {
			const c = elemCandidates(obj, px, py);
			if (c.length) {
				const again = cycle && cycle.sig === c.join(",") && Math.hypot(px - cycle.px, py - cycle.py) < 5;
				next = { obj, mode: S.elemMode, key: c[again ? (cycle.i + 1) % c.length : 0], count: c.length };
			}
		}
		const was = hover ? hover.mode + hover.key : "", now = next ? next.mode + next.key : "";
		hover = next;
		if (was !== now) dirty = true;
	}

	// Right-click: the 3D cursor goes on the surface under the mouse (so new pieces stack on tops), else on the floor; x/y snap.
	function placeCursor(px, py) {
		const h = pickObject(px, py);
		const p = h ? h.point : renderer.floorPoint(px, py, 0);
		if (!p) return;
		const step = S.snap;
		S.cursor = [TS.snap(p[0], step), TS.snap(p[1], step), h ? Math.round(p[2] * 100) / 100 : 0];
		dirty = true;
		status(`3D cursor ${S.cursor.map((v) => Math.round(v * 10) / 10).join(", ")}${h ? " (on " + h.obj.name + ")" : ""}`);
	}

	// --- modal tools (Blender style: move the mouse, click/Enter to confirm, right-click/Esc to cancel) ---

	function editTargets() {
		if (S.edit) { const o = activeObj(); return o ? [o] : []; }
		return selectedObjs();
	}

	function beginModal(type, fromDuplicate, opts) {
		// Tools work in the tileset view and the held 3D view, not while the view is still turning.
		if (renderer.free.blend > 0 && !(S.stay3d && renderer.free.blend >= 1 && !anim)) return status(S.stay3d ? "Wait for the 3D view to settle." : "Let go of the look-round first (or press 5 to stay in 3D and model there).");
		const objs = editTargets();
		if (!objs.length) return status("Select something first.");
		// Extruding vertices or edges grows new ones (lines, quads) and moves them.
		if (type === "extrude" && S.edit && S.elemMode !== "face") return extrudeElems();
		if (S.edit) {
			if ((type === "extrude" || type === "inset") && (S.elemMode !== "face" || !S.elemSel.size)) return status(type === "extrude" ? "Select faces (3), edges (2) or vertices (1) to extrude." : "Select faces (3) first.");
			if (type === "bevel" && (S.elemMode !== "edge" || !S.elemSel.size)) return status("Select edges (2) first.");
			if ((type === "grab" || type === "scale" || type === "rotate") && !S.elemSel.size) return status("Select vertices, edges or faces first.");
		} else if (type !== "grab" && type !== "scale" && type !== "rotate") return status("Tab into edit mode for that.");
		modal = { type, start: mouse.slice(), before: fromDuplicate ? undoStack.pop() : snapshot(), base: objs.map((o) => [o, Mesh.clone(o)]),
			axis: null, local: false, numeric: "", data: Object.assign({}, opts), fromDuplicate: !!fromDuplicate };
		// Pivot / reference point.
		const pts = [];
		for (const [o] of modal.base) for (const i of Mesh.selectionVerts(o, S.edit ? S.elemMode : "object", S.elemSel)) pts.push(o.verts[i]);
		const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
		for (const p of pts) for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], p[k]); b.max[k] = Math.max(b.max[k], p[k]); }
		modal.data.ref = S.edit ? (pts[0] || [0, 0, 0]) : b.min;
		modal.data.box = b;
		modal.data.pivot = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, S.edit ? (b.min[2] + b.max[2]) / 2 : b.min[2]];
		if (S.edit) modal.data.frame = elemFrame(modal.base[0][0]);
		updateModal();
	}

	// --- local axes (press an axis key twice: X = world X, X X = local X, X X X = free) ---
	// In object mode "local" is each model's own axes (they turn with it) and each model turns / scales about its own middle.
	// In edit mode it's the selection's: Z along its normal, X along its first edge.
	function elemFrame(o) {
		const sel = [...S.elemSel];
		let z = [0, 0, 0], x = null;
		if (S.elemMode === "face") for (const fi of sel) { const f = o.faces[fi]; if (!f) continue; z = v3.add(z, Mesh.faceNormal(o, f)); x = x || v3.sub(o.verts[f.v[1]], o.verts[f.v[0]]); }
		else {
			const edges = Mesh.edges(o), around = (vi) => o.faces.forEach((f) => { if (f.v.includes(vi)) z = v3.add(z, Mesh.faceNormal(o, f)); });
			if (S.elemMode === "edge") for (const k of sel) { const e = edges.get(k); if (!e) continue; for (const fi of e.faces) z = v3.add(z, Mesh.faceNormal(o, o.faces[fi])); x = x || v3.sub(o.verts[e.b], o.verts[e.a]); }
			else sel.forEach(around);
		}
		z = v3.len(z) > 1e-6 ? v3.norm(z) : [0, 0, 1];
		if (!x || v3.len(v3.cross(x, z)) < 1e-6) x = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
		x = v3.norm(v3.sub(x, v3.scale(z, v3.dot(x, z))));
		return [x, v3.cross(z, x), z];
	}
	// The locked axis direction for one model (its base copy) in the running tool.
	function axisVec(m, base) {
		const k = "xyz".indexOf(m.axis);
		if (!m.local) return [0, 0, 0].map((v, i) => (i === k ? 1 : 0));
		return S.edit ? m.data.frame[k] : Mesh.basis(base)[k];
	}
	function cycleAxis(k) {
		if (!modal) return;
		if (modal.axis !== k) { modal.axis = k; modal.local = false; }
		else if (!modal.local) modal.local = true;
		else { modal.axis = null; modal.local = false; }
		updateModal();
	}
	const axisName = (m) => (m.local ? `local ${m.axis.toUpperCase()}${S.edit ? ({ z: " (normal)", x: " (along the edge)", y: "" })[m.axis] : " (the model's own)"}` : AXIS[m.axis]);

	// Snapping is strict: results land on the Snap grid (positions, edges, extrusions, insets). Shift (or the bar's "fine" toggle)
	// halves the step, down to 1 px, for detail; a typed number is exact.
	// Axis names used everywhere: X across (east), Y depth (south on the ground, toward the viewer), Z height (up).
	const AXIS = { x: "X (across)", y: "Y (depth)", z: "Z (height)" };

	function stepFor(ev) {
		const fine = (ev && ev.shiftKey) || S.fine;
		return S.snap > 0 ? (fine ? Math.max(1, S.snap / 2) : S.snap) : 0; // 0: off, nothing snaps
	}

	// World move from where the tool started to the pointer, in either view: over the level plane through the pivot, or along the
	// locked axis (the point on it nearest the pointer's view ray). In the tileset view this is exactly the screen move / zoom.
	function grabDelta(m) {
		const p = m.data.pivot;
		if (!m.axis) {
			const a = renderer.floorPoint(m.start[0], m.start[1], p[2]), b = renderer.floorPoint(mouse[0], mouse[1], p[2]);
			if (!a || !b) return [0, 0, 0];
			// Near the horizon the plane runs away from the eye: cap the move.
			const d = [b[0] - a[0], b[1] - a[1], 0], l = Math.hypot(d[0], d[1]), cap = 4096;
			return l > cap ? v3.scale(d, cap / l) : d;
		}
		const u = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[m.axis];
		const s0 = axisParam(p, u, m.start), s1 = axisParam(p, u, mouse);
		if (s0 === null || s1 === null) {
			// Looking straight along the axis: fall back to the screen drag.
			const z = renderer.cam.zoom;
			return v3.scale(u, m.axis === "x" ? (mouse[0] - m.start[0]) / z : (m.start[1] - mouse[1]) / z);
		}
		return v3.scale(u, TS.clamp(s1 - s0, -4096, 4096));
	}
	function axisParam(P, u, at) {
		const r = renderer.ray(at[0], at[1]), b = v3.dot(u, r.d), den = 1 - b * b;
		if (den < 0.02) return null;
		const w = v3.sub(P, r.o);
		return (b * v3.dot(r.d, w) - v3.dot(u, w)) / den;
	}

	function restoreBase() {
		for (const [o, base] of modal.base) {
			const c = Mesh.clone(base);
			o.verts = c.verts; o.faces = c.faces;
			if (c.lines) o.lines = c.lines; else delete o.lines;
			if (c.basis) o.basis = c.basis; else delete o.basis;
		}
	}

	let lastEvent = null;
	function updateModal(ev) {
		if (!modal) return;
		ev = ev || lastEvent;
		restoreBase();
		const z = renderer.cam.zoom, dx = (mouse[0] - modal.start[0]) / z, dy = (mouse[1] - modal.start[1]) / z;
		const num = modal.numeric !== "" && !isNaN(parseFloat(modal.numeric)) ? parseFloat(modal.numeric) : null;
		const m = modal, step = stepFor(ev);
		let info = "";
		if (m.type === "grab" && m.axis && m.local) {
			// Along a local axis: the distance snaps (each model along its own axis in object mode).
			let shown = 0;
			for (const [o, base] of m.base) {
				const u = axisVec(m, base), s0 = axisParam(m.data.pivot, u, m.start), s1 = axisParam(m.data.pivot, u, mouse);
				let s = num !== null ? num : s0 === null || s1 === null ? (m.start[1] - mouse[1]) / z : TS.clamp(s1 - s0, -4096, 4096);
				if (num === null) s = TS.snap(s, step);
				Mesh.translate(o, Mesh.selectionVerts(o, S.edit ? S.elemMode : "object", S.elemSel), v3.scale(u, s));
				shown = s;
			}
			info = `Move ${+shown.toFixed(2)} px along ${axisName(m)}`;
		} else if (m.type === "grab") {
			let d = grabDelta(m);
			if (num !== null) d = m.axis === "y" ? [0, num, 0] : m.axis === "z" ? [0, 0, num] : [num, 0, 0];
			else {
				// Only the axes being moved snap (a stacked piece moved over the ground keeps its height).
				const moving = m.axis ? ["xyz".indexOf(m.axis)] : [0, 1];
				d = d.map((v, k) => (moving.includes(k) ? TS.snap(m.data.ref[k] + v, step) - m.data.ref[k] : 0));
			}
			for (const [o] of m.base) Mesh.translate(o, Mesh.selectionVerts(o, S.edit ? S.elemMode : "object", S.elemSel), d);
			info = `Move ${d.map((v, k) => "XYZ"[k] + " " + +v.toFixed(2)).join(" · ")}${m.axis ? " along " + AXIS[m.axis] : " (across and in depth on the ground; Z for height)"}`;
		} else if (m.type === "scale" && m.axis && m.local) {
			// Along a local axis, about each model's middle (edit mode: the selection's): the size along it snaps.
			const p = renderer.toScreen(m.data.pivot) || modal.start;
			const d0 = Math.max(4, Math.hypot(m.start[0] - p[0], m.start[1] - p[1])), d1 = Math.hypot(mouse[0] - p[0], mouse[1] - p[1]);
			const f = num !== null ? num : d1 / d0, sizes = [];
			for (const [o, base] of m.base) {
				const u = axisVec(m, base), idx = Mesh.selectionVerts(o, S.edit ? S.elemMode : "object", S.elemSel);
				const proj = idx.map((i) => v3.dot(o.verts[i], u)), lo = Math.min(...proj), hi = Math.max(...proj), size = hi - lo;
				if (!(size > 1e-6)) continue;
				const kstep = Math.max(1, Math.min(step, 2 ** Math.floor(Math.log2(Math.max(1, size)))));
				const size2 = num === null ? Math.max(kstep, TS.snap(size * f, kstep)) : size * f, mid = (lo + hi) / 2, g = size2 / size;
				for (const i of idx) { const t = v3.dot(o.verts[i], u) - mid; o.verts[i] = v3.add(o.verts[i], v3.scale(u, t * (g - 1))); }
				sizes.push(+size2.toFixed(2));
			}
			info = `Scale to ${sizes.join(", ")} px along ${axisName(m)}`;
		} else if (m.type === "scale") {
			const p = renderer.toScreen(m.data.pivot) || modal.start;
			const d0 = Math.max(4, Math.hypot(m.start[0] - p[0], m.start[1] - p[1])), d1 = Math.hypot(mouse[0] - p[0], mouse[1] - p[1]);
			const f = num !== null ? num : d1 / d0;
			// Each scaled extent is remapped so its edges land on grid lines (grown about its centre; a model's base stays put).
			const bb = m.data.box, sizes = [];
			for (const k of m.axis ? ["xyz".indexOf(m.axis)] : [0, 1, 2]) {
				const lo = bb.min[k], size = bb.max[k] - lo;
				if (size < 1e-6) continue;
				const fromBase = k === 2 && !S.edit, c = (lo + bb.max[k]) / 2, want = size * f;
				// Size snaps to whole steps first, then the near edge onto the grid (so 1 tile -> 2 tiles works). A part smaller than
				// the step uses the largest power-of-two step that fits it (a 3 px leg scales in 2 px steps, not straight to a tile).
				const kstep = Math.max(1, Math.min(step, 2 ** Math.floor(Math.log2(Math.max(1, size)))));
				const size2 = num === null ? Math.max(kstep, TS.snap(want, kstep)) : want;
				let a = fromBase ? lo : c - size2 / 2;
				if (num === null && !fromBase) a = TS.snap(a, kstep);
				const b = a + size2;
				for (const [o] of m.base)
					for (const i of Mesh.selectionVerts(o, S.edit ? S.elemMode : "object", S.elemSel)) { const p = o.verts[i].slice(); p[k] = a + ((p[k] - lo) * (b - a)) / size; o.verts[i] = p; }
				sizes.push("XYZ"[k] + " " + +(b - a).toFixed(2));
			}
			info = `Scale to ${sizes.join(" · ")} px${m.axis ? " (" + AXIS[m.axis] + " only)" : ""}`;
		} else if (m.type === "rotate") {
			const p = renderer.toScreen(m.data.pivot) || modal.start;
			let a = Math.atan2(mouse[1] - p[1], mouse[0] - p[0]) - Math.atan2(m.start[1] - p[1], m.start[0] - p[0]);
			let deg = num !== null ? num : (a * 180) / Math.PI;
			if (num === null && S.snap > 0) deg = TS.snap(deg, (ev && ev.shiftKey) || S.fine ? 5 : 15);
			const rad = (deg * Math.PI) / 180;
			for (const [o, base] of m.base) {
				const u = m.axis ? axisVec(m, base) : [0, 0, 1];
				// Local turns in object mode: each model about its own middle (individual origins); else one shared pivot.
				const c = m.local && !S.edit ? Mesh.centre(base) : m.data.pivot;
				Mesh.rotateAround(o, Mesh.selectionVerts(o, S.edit ? S.elemMode : "object", S.elemSel), c, u, rad);
				if (!S.edit) o.basis = Mesh.basis(base).map((a) => Mesh.turnVec(a, u, rad));
			}
			info = `Turn ${+deg.toFixed(1)}° about ${m.axis ? axisName(m) : "the vertical (Z)"}${m.local && !S.edit && m.base.length > 1 ? ", each about its own middle" : ""}`;
		} else if (m.type === "extrude") {
			const [o] = m.base[0];
			const faces = [...S.elemSel];
			const res = Mesh.extrude(o, faces);
			const c = faces.reduce((acc, fi) => v3.add(acc, Mesh.faceCentre(o, o.faces[fi])), [0, 0, 0]).map((v) => v / faces.length);
			const s0 = renderer.toScreen(c), s1 = renderer.toScreen(v3.add(c, v3.scale(res.normal, 16)));
			let amount;
			const dir = s0 && s1 ? [s1[0] - s0[0], s1[1] - s0[1]] : [0, 0], dl = Math.hypot(dir[0], dir[1]);
			if (dl > 2) amount = (((mouse[0] - m.start[0]) * dir[0] + (mouse[1] - m.start[1]) * dir[1]) / (dl * dl)) * 16;
			else amount = -dy;
			if (num !== null) amount = num;
			else {
				// Along an axis the moved face itself lands on the grid; at an angle the distance snaps.
				const k = res.normal.findIndex((v) => Math.abs(v) > 0.999);
				amount = k >= 0 ? (TS.snap(c[k] + res.normal[k] * amount, step) - c[k]) / res.normal[k] : TS.snap(amount, step);
			}
			Mesh.translate(o, res.verts, v3.scale(res.normal, amount));
			info = `Extrude ${+amount.toFixed(2)} px`;
			if (m.data.manifold && Math.abs(amount) > 1e-6) {
				// Manifold: walls flush with the faces beside them fold into them (pushed in: the model is cut, not doubled inside).
				// If that would leave a closed model open, it's a plain extrude instead.
				const wasClosed = Mesh.isClosed(m.base[0][1]), keep = Mesh.clone(o), r = Mesh.manifold(o, res.walls);
				if (wasClosed && !Mesh.isClosed(o)) { o.verts = keep.verts; o.faces = keep.faces; info += " (manifold: nothing flush to fold in here)"; }
				else info = `Extrude manifold ${+amount.toFixed(2)} px${r.cut ? ` · cut into ${r.cut} face(s)` : ""}${r.merged ? ` · merged into ${r.merged} face(s)` : ""}`;
			}
		} else if (m.type === "loopslide") {
			const [o] = m.base[0];
			const A = o.verts[m.data.a], B = o.verts[m.data.b], len = v3.dist(A, B);
			const sA = renderer.toScreen(A), sB = renderer.toScreen(B);
			let t = 0.5;
			if (sA && sB) {
				const ex = sB[0] - sA[0], ey = sB[1] - sA[1], l = ex * ex + ey * ey;
				if (l > 1) t = ((mouse[0] - sA[0]) * ex + (mouse[1] - sA[1]) * ey) / l;
			}
			t = TS.clamp(t, 0, 1);
			if (num !== null) t = num / Math.max(len, 1e-6);
			else {
				// Strict: the cut lands on a grid line along the edge's main axis.
				const d = v3.sub(B, A), k = [0, 1, 2].reduce((best, i) => (Math.abs(d[i]) > Math.abs(d[best]) ? i : best), 0);
				if (Math.abs(d[k]) > 1e-6) t = (TS.snap(A[k] + d[k] * t, step) - A[k]) / d[k];
			}
			const edge = Math.min(0.5, 1 / Math.max(len, 1));
			t = TS.clamp(t, edge, 1 - edge);
			m.data.loop = Mesh.loopCut(o, m.data.a, m.data.b, t);
			info = `Loop cut ${+(t * len).toFixed(2)} px along the edge (of ${+len.toFixed(2)})`;
		} else if (m.type === "inset" || m.type === "bevel") {			const [o] = m.base[0];
			let amount = Math.max(0, num !== null ? num : dx);
			if (num === null) amount = TS.snap(amount, step);
			if (m.type === "inset") Mesh.inset(o, [...S.elemSel], amount);
			else {
				const edges = [...S.elemSel].map((k) => k.split("_").map((i) => o.verts[+i].slice()));
				if (amount > 0) Mesh.bevel(o, edges, amount);
			}
			info = `${m.type === "inset" ? "Inset" : "Bevel"} ${+amount.toFixed(2)} px (drag right)`;
		}
		status(`${info}${m.numeric ? "  [" + m.numeric + "]" : ""} — snap ${step} px · click/Enter/release to apply, right-click/Esc to cancel · Shift or "fine": half step · type a number for exact`);
		modalBar();
		dirty = true;
	}

	function confirmModal() {
		const m = modal;
		modal = null;
		modalBar();
		pushUndo(m.before);
		if (m.data.extruded) Mesh.orientLoose(m.base[0][0], toViewer());
		if (m.type === "bevel" || m.type === "extrude" || m.type === "inset") {
			// Bevel renumbers edges and faces; keep the selection sensible.
			if (m.type === "bevel") S.elemSel.clear();
		}
		if (m.type === "loopslide") {
			const o = m.base[0][0], set = new Set(m.data.loop);
			S.elemMode = "edge";
			S.elemSel = new Set([...Mesh.edges(o).keys()].filter((k) => k.split("_").every((i) => set.has(+i))));
		}
		changed();
		hint();
	}

	function cancelModal() {
		if (S.armed) { S.armed = null; S.armedOpts = null; modalBar(); hint(); }
		if (!modal) return;
		if (modal.fromDuplicate) {
			// As in Blender: cancelling the move after Shift+D keeps the copies, where the originals are.
			const m = modal;
			restoreBase();
			modal = null;
			pushUndo(m.before);
			changed();
		} else {
			restore(modal.before);
			modal = null;
		}
		modalBar();
		hint();
	}

	// --- loop cut (Ctrl+R): hover an edge to preview the ring, click to cut through the middle ---

	function loopCutHover(px, py) {
		const obj = activeObj();
		loopHover = null;
		if (!obj) return;
		const e = nearestEdge(obj, px, py, 14);
		if (!e) return;
		const ring = Mesh.edgeRing(obj, e.a, e.b);
		if (ring.faces.length) loopHover = { obj, e, ring };
		dirty = true;
	}
	// Clicking the hovered edge starts the slide: the new loop follows the cursor along the ring (snapping to the grid) until a
	// click applies it (with a pen or finger: press on the edge, drag, let go).
	function loopCutApply(dragRelease) {
		if (!loopHover) return;
		const { obj, e } = loopHover;
		loopHover = null;
		S.loopCut = false;
		modal = { type: "loopslide", start: mouse.slice(), before: snapshot(), base: [[obj, Mesh.clone(obj)]], axis: null, numeric: "",
			data: { a: e.a, b: e.b, loop: [] }, dragRelease: !!dragRelease };
		updateModal();
	}
	// --- view geometry ---

	const vtx = (out, p, n, c) => out.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], c[3]);

	function buildGeometry() {
		const tris = [], lines = [], points = [], dots = [], grid = [], overlay = [], hov = { lines: [], points: [] };
		const sel = [1.0, 0.55, 0.15];
		const hv = hover && hover.obj.id === S.active && S.edit && hover.mode === S.elemMode ? hover : null;
		for (const obj of visibleObjs()) {
			const isActive = obj.id === S.active, isSel = S.selected.has(obj.id), editing = S.edit && isActive;
			const corners = Mesh.shadingNormals(obj);
			obj.faces.forEach((f, fi) => {
				const faceMode = editing && S.elemMode === "face", picked = faceMode && S.elemSel.has(fi);
				const tint = picked ? [...sel, 0.55] : faceMode && hv && hv.key === fi ? [1, 1, 1, 0.3] : isSel && !S.edit ? [...sel, 0.18] : [0, 0, 0, 0];
				// Face dots (centres) to aim at in face mode; X-ray shows the ones behind too.
				if (faceMode) vtx(dots, Mesh.faceCentre(obj, f), [0, 0, 1], picked ? [1, 0.6, 0.1, 1] : [0.08, 0.08, 0.1, 1]);
				for (const triangle of Mesh.faceTriangles(obj, f))
					for (const k of triangle) vtx(tris, obj.verts[f.v[k]], corners[fi][k], tint);
			});
			const edgeCol = editing ? [0.95, 0.95, 1, 0.9] : isSel ? [1, 0.65, 0.3, 0.95] : [0.85, 0.9, 1, 0.35];
			for (const [k, e] of Mesh.edges(obj)) {
				const c = editing && S.elemMode === "edge" && S.elemSel.has(k) ? [1, 0.6, 0.1, 1] : edgeCol;
				vtx(lines, obj.verts[e.a], [0, 0, 1], c); vtx(lines, obj.verts[e.b], [0, 0, 1], c);
			}
			if (editing && S.elemMode === "vert")
				obj.verts.forEach((p, i) => vtx(points, p, [0, 0, 1], S.elemSel.has(i) ? [1, 0.6, 0.1, 1] : [0.1, 0.1, 0.12, 1]));
		}
		if (hv) {
			// What a click would pick: outlined in white over everything.
			const o = hv.obj, w = [1, 1, 1, 1];
			if (hv.mode === "vert" && o.verts[hv.key]) vtx(hov.points, o.verts[hv.key], [0, 0, 1], w);
			else if (hv.mode === "edge") { const ab = String(hv.key).split("_").map((i) => o.verts[+i]); if (ab.every(Boolean)) { vtx(hov.lines, ab[0], [0, 0, 1], w); vtx(hov.lines, ab[1], [0, 0, 1], w); } }
			else if (hv.mode === "face" && o.faces[hv.key]) {
				const v = o.faces[hv.key].v;
				for (let i = 0; i < v.length; i++) { vtx(hov.lines, o.verts[v[i]], [0, 0, 1], w); vtx(hov.lines, o.verts[v[(i + 1) % v.length]], [0, 0, 1], w); }
				vtx(hov.points, Mesh.faceCentre(o, o.faces[hv.key]), [0, 0, 1], w);
			}
		}
		if (S.art && S.grid) {
			const W = S.art.w, H = S.art.h, c = [0.5, 0.75, 1, 0.16], cb = [0.5, 0.75, 1, 0.45];
			// Nudged off exact pixel edges, where the GPU may drop a 1 px line.
			const e = 0.02;
			for (let x = 0; x <= W; x += 32) { vtx(grid, [x + e, e, 0], [0, 0, 1], x % W ? c : cb); vtx(grid, [x + e, H + e, 0], [0, 0, 1], x % W ? c : cb); }
			for (let y = 0; y <= H; y += 32) { vtx(grid, [e, y + e, 0], [0, 0, 1], y % H ? c : cb); vtx(grid, [W + e, y + e, 0], [0, 0, 1], y % H ? c : cb); }
		}
		// 3D cursor: a cross on its surface and a drop line to the floor.
		const cu = S.cursor, cc = [1, 0.3, 0.3, 1];
		for (const [a, b] of [[[-5, 0, 0], [5, 0, 0]], [[0, -5, 0], [0, 5, 0]], [[0, 0, 0], [0, 0, 8]]]) { vtx(overlay, v3.add(cu, a), [0, 0, 1], cc); vtx(overlay, v3.add(cu, b), [0, 0, 1], cc); }
		if (cu[2] > 0) { vtx(overlay, cu, [0, 0, 1], [1, 0.3, 0.3, 0.4]); vtx(overlay, [cu[0], cu[1], 0], [0, 0, 1], [1, 0.3, 0.3, 0.4]); }
		// Where the next primitive goes: the tile south-east of the cursor.
		const gc = [1, 0.3, 0.3, 0.35], sq = [[0, 0], [32, 0], [32, 32], [0, 32]];
		for (let i = 0; i < 4; i++) { const a = sq[i], b = sq[(i + 1) % 4]; vtx(overlay, [cu[0] + a[0], cu[1] + a[1], cu[2]], [0, 0, 1], gc); vtx(overlay, [cu[0] + b[0], cu[1] + b[1], cu[2]], [0, 0, 1], gc); }
		if (knife) {
			// The cut so far, and on to the snapped point under the pointer.
			const path = knife.pts.concat(knife.hover ? [knife.hover.p] : []), kc = [1, 0.85, 0.2, 1];
			for (let i = 0; i + 1 < path.length; i++) { vtx(overlay, path[i], [0, 0, 1], kc); vtx(overlay, path[i + 1], [0, 0, 1], kc); }
			for (const p of knife.pts) vtx(hov.points, p, [0, 0, 1], kc);
			if (knife.hover) vtx(hov.points, knife.hover.p, [0, 0, 1], knife.hover.snap === "vertex" ? [1, 1, 1, 1] : knife.hover.snap === "edge" ? [0.4, 1, 0.6, 1] : [1, 0.85, 0.2, 0.6]);
		}
		if (loopHover) {
			const { obj, ring } = loopHover, f = (k) => k.split("_").map((i) => obj.verts[+i]);
			const mids = ring.faces.map(({ fi, i }) => {
				const face = obj.faces[fi], a = obj.verts[face.v[i]], b = obj.verts[face.v[(i + 1) % 4]], c = obj.verts[face.v[(i + 2) % 4]], d = obj.verts[face.v[(i + 3) % 4]];
				return [v3.lerp(a, b, 0.5), v3.lerp(c, d, 0.5)];
			});
			for (const [a, b] of mids) { vtx(overlay, a, [0, 0, 1], [1, 0.9, 0.2, 1]); vtx(overlay, b, [0, 0, 1], [1, 0.9, 0.2, 1]); }
			void f;
		}
		if (modal && modal.axis) {
			// The locked axis through the pivot (local: each model's own, through its middle when it turns about it).
			const c = modal.axis === "x" ? [1, 0.3, 0.3, 0.8] : modal.axis === "y" ? [0.3, 1, 0.3, 0.8] : [0.3, 0.5, 1, 0.8];
			for (const [, base] of modal.local && !S.edit ? modal.base : modal.base.slice(0, 1)) {
				const d = axisVec(modal, base), p = modal.local && !S.edit ? Mesh.centre(base) : modal.data.pivot;
				vtx(overlay, v3.sub(p, v3.scale(d, 2000)), [0, 0, 1], c); vtx(overlay, v3.add(p, v3.scale(d, 2000)), [0, 0, 1], c);
			}
		}
		// Reference models: faint neutral wires, plus faces that carry the reference's art in 3D; offset across the floor only (Z unchanged).
		const ghostLines = [], ghosts = [];
		for (const r of S.refs) {
			if (!r.visible || !r.showModels || r.opacity <= 0) continue;
			const at = (p) => [p[0] + r.dx, p[1] + r.dy, p[2]], gt = [];
			ghosts.push({ id: r.id, w: r.w, h: r.h, dx: r.dx, dy: r.dy, opacity: r.opacity, art: r.showArt, tris: gt });
			for (const m of r.meshes) {
				for (const f of m.faces) {
					const n = Mesh.faceNormal(m, f);
					for (let i = 1; i + 1 < f.v.length; i++) for (const k of [0, i, i + 1]) vtx(gt, at(m.verts[f.v[k]]), n, [0, 0, 0, 0]);
					for (let i = 0; i < f.v.length; i++) { const a = m.verts[f.v[i]], b = m.verts[f.v[(i + 1) % f.v.length]]; vtx(ghostLines, at(a), [0, 0, 1], [0.92, 0.92, 0.95, 0.8 * r.opacity]); vtx(ghostLines, at(b), [0, 0, 1], [0.92, 0.92, 0.95, 0.8 * r.opacity]); }
				}
			}
		}
		return { tris: new Float32Array(tris), lines: new Float32Array(lines), points: new Float32Array(points), dots: new Float32Array(dots), grid: new Float32Array(grid),
			ghosts: ghosts.map((g) => Object.assign(g, { tris: new Float32Array(g.tris) })), ghostLines: new Float32Array(ghostLines), overlay: new Float32Array(overlay), hover: { lines: new Float32Array(hov.lines), points: new Float32Array(hov.points) } };
	}

	// --- free view: look round while the button is held, then ease back to the tileset view ---

	let anim = null;
	function animate(to, ms, done) {
		const from = { yaw: renderer.free.yaw, pitch: renderer.free.pitch, blend: renderer.free.blend }, t0 = performance.now();
		anim = () => {
			const t = Math.min(1, (performance.now() - t0) / ms), e = t * t * (3 - 2 * t);
			for (const k in to) renderer.free[k] = from[k] + (to[k] - from[k]) * e;
			dirty = true;
			if (t >= 1) { anim = null; if (done) done(); }
		};
	}
	function startLook() {
		if (renderer.free.blend === 0) {
			const sel = S.edit ? [activeObj()].filter(Boolean) : selectedObjs();
			const z = sel.length ? Mesh.centre(sel[0])[2] : 0;
			renderer.startFree(z);
		}
		animate({ blend: 1 }, 140);
	}
	function endLook() {
		if (S.stay3d) return;
		// The tileset view comes back centred on where the orbit was panned to.
		const t = renderer.free.target;
		if (renderer.free.blend >= 1) { renderer.cam.x = t[0]; renderer.cam.y = t[1] - t[2]; }
		animate({ yaw: 0, pitch: Math.PI / 4 }, 260, () => animate({ blend: 0 }, 160));
	}
	// Stay in 3D (nav "3D" button, key 5): the look-round holds until toggled off; drag orbits, Shift/Space-drag pans, wheel zooms.
	function toggleStay3d(on) {
		if (pencil || S.tool === "stamp") setTool("select");
		const want = on === undefined ? !S.stay3d : on;
		if (want === !!S.stay3d) return;
		if (modal) cancelModal();
		S.stay3d = want;
		document.querySelectorAll('[data-act="stay3d"]').forEach((b) => b.classList.toggle("on", S.stay3d));
		hover = null;
		if (S.stay3d) {
			const fresh = renderer.free.blend === 0;
			startLook();
			if (fresh) animate({ blend: 1, yaw: -0.5, pitch: 0.6 }, 300);
		} else endLook();
		hint();
	}
	// Pan the 3D view: move the orbit centre across the floor, the way the drag goes.
	function panFree(dx, dy) {
		const f = renderer.free, z = renderer.cam.zoom;
		const right = [Math.cos(f.yaw), -Math.sin(f.yaw)], fwd = [-Math.sin(f.yaw), -Math.cos(f.yaw)], k = 1 / Math.max(0.3, Math.sin(f.pitch));
		f.target = [f.target[0] - (right[0] * dx - fwd[0] * dy * k) / z, f.target[1] - (right[1] * dx - fwd[1] * dy * k) / z, f.target[2]];
		dirty = true;
	}

	// --- pencil: trace a simple outline, then create an ordinary editable mesh ---
	function pencilHint() {
		const corners = $("pencil_mode").value === "corners";
		const help = corners ? "Click corners, then click the first point or press Enter to finish. Backspace removes a corner." :
			"Drag around an outline and release to create an object. Small wobbles are simplified.";
		const placement = $("pencil_surface").checked ? " Start on an object to use its face; thickness builds outward." : " Surface placement is off; empty-space settings apply.";
		$("pencil_help").textContent = help + placement + " Thickness 0 creates a single face. Q returns to selection.";
		status("Pencil: " + help + " Space-drag pans; wheel zooms; Esc clears the outline.");
	}
	function clearPencil() {
		if (!pencil) return;
		pencil.pts = []; pencil.hover = null; pencil.pointer = null; pencil.error = false; pencil.surface = null; pencil.hoverSurface = null;
		dirty = true; pencilHint();
	}
	function pencilBack() {
		if (!pencil) return;
		pencil.pts.pop(); pencil.error = false;
		if (!pencil.pts.length) { pencil.surface = null; pencil.hoverSurface = null; }
		dirty = true;
	}
	function pencilPickSurface(px, py) {
		if (!$("pencil_surface").checked) return null;
		const hit = pickObject(px, py);
		if (!hit) return null;
		const face = hit.obj.faces[hit.face], ray = renderer.ray(px, py);
		let outline = face.v.map((i) => hit.obj.verts[i].slice()), normal = Mesh.faceNormal(hit.obj, face);
		// For a warped n-gon use the actual hit triangle, rather than an averaged plane floating above the mesh.
		if (outline.some((p) => Math.abs(v3.dot(normal, v3.sub(p, outline[0]))) > 1e-5)) {
			let nearest = Infinity;
			for (const tri of Mesh.faceTriangles(hit.obj, face)) {
				const points = tri.map((i) => hit.obj.verts[face.v[i]]);
				const t = TS.Renderer.rayTri(ray.o, ray.d, ...points);
				if (t !== null && t < nearest) { nearest = t; outline = points.map((p) => p.slice()); }
			}
			normal = v3.norm(v3.cross(v3.sub(outline[1], outline[0]), v3.sub(outline[2], outline[0])));
		}
		if (v3.dot(normal, ray.d) > 0) normal = v3.scale(normal, -1);
		if (Math.abs(normal[1] + normal[2]) < 1e-6) return null;
		return { origin: hit.point.slice(), normal, outline, objectId: hit.obj.id, name: hit.obj.name, face: hit.face };
	}
	function pencilPoint(px, py) {
		const p = renderer.canvasPoint(px, py).map((v) => Math.round(v * 100) / 100);
		if ($("pencil_snap").checked) return p.map((v) => TS.snap(v, S.snap));
		return p;
	}
	function pencilAdd(p) {
		const prev = pencil.pts[pencil.pts.length - 1];
		if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 0.01) pencil.pts.push(p);
		pencil.error = false; dirty = true;
	}
	function pencilFinish() {
		if (!pencil || !pencil.pts.length) return;
		try {
			const corners = $("pencil_mode").value === "corners";
			const simplify = Number($("pencil_simplify").value);
			if (!Number.isFinite(simplify) || simplify < 0 || simplify > 32) throw new Error("Simplify must be between 0 and 32 px.");
			const obj = TS.Shape.create(pencil.pts, {
				plane: $("pencil_plane").value, thickness: Number($("pencil_thickness").value), base: Math.max(0, S.cursor[2]),
				simplify: corners ? 0 : simplify, snap: $("pencil_snap").checked ? S.snap : 0,
				surface: pencil.surface,
			});
			const surfaceName = pencil.surface && pencil.surface.name;
			pushUndo();
			obj.name = `Custom shape.${String(S.objects.length + 1).padStart(2, "0")}`;
			S.objects.push(obj); S.active = obj.id; S.selected = new Set([obj.id]); S.edit = false; S.elemSel.clear();
			clearPencil(); changed();
			status(`Added ${obj.name}${surfaceName ? ` on ${surfaceName}` : ""} (${obj.faces[0].v.length} outline corners). Draw another, or press Q to select and Tab to edit.`);
			return obj;
		} catch (err) { pencil.pointer = null; pencil.error = true; dirty = true; status("Pencil: " + err.message + " Use Clear to redraw."); }
	}
	function pencilDown(e) {
		if (!pencil || renderer.free.blend > 0) return;
		const p = pencilPoint(...mouse);
		if ($("pencil_mode").value === "corners") {
			const first = pencil.pts[0], s = first && renderer.toScreen([first[0], first[1], 0]);
			if (pencil.pts.length >= 3 && Math.hypot(s[0] - mouse[0], s[1] - mouse[1]) <= 10) { pencilFinish(); return; }
			if (pencil.pts.length >= 256) return status("Pencil: 256 corners reached. Finish this shape or remove a corner.");
			if (!pencil.pts.length) pencil.surface = pencilPickSurface(...mouse);
			pencilAdd(p); pencil.hover = p;
		} else {
			clearPencil(); pencil.surface = pencilPickSurface(...mouse); pencil.pointer = e.pointerId; pencilAdd(p);
		}
	}
	function pencilMove(e) {
		if (!pencil) return;
		pencil.hover = pencilPoint(...mouse);
		if (!pencil.pts.length) pencil.hoverSurface = pencilPickSurface(...mouse);
		if (pencil.pointer === e.pointerId) {
			const last = pencil.pts[pencil.pts.length - 1], d = Math.hypot(pencil.hover[0] - last[0], pencil.hover[1] - last[1]);
			if (pencil.pts.length < 4096 && d >= Math.max(0.25, 2 / renderer.cam.zoom)) pencilAdd(pencil.hover);
			else if (pencil.pts.length >= 4096) status("Pencil: stroke limit reached. Release to finish this outline.");
		}
		dirty = true;
	}
	function drawPencil() {
		const svg = $("pencil_overlay");
		svg.replaceChildren();
		if (!pencil) return;
		$("pencil_finish").disabled = pencil.pts.length < 3;
		$("pencil_back").disabled = !pencil.pts.length || $("pencil_mode").value !== "corners";
		$("pencil_clear").disabled = !pencil.pts.length;
		const add = (tag, attrs) => { const el = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value); svg.appendChild(el); };
		const target = pencil.pts.length ? pencil.surface : pencil.hoverSurface;
		const targetText = target ? `${pencil.pts.length ? "Drawing on" : "Surface"}: ${target.name} (face ${target.face + 1})` :
			pencil.pts.length || !$("pencil_surface").checked ? "Empty space: " + $("pencil_plane").selectedOptions[0].textContent : "Start on a face to draw on it.";
		if ($("pencil_target").textContent !== targetText) $("pencil_target").textContent = targetText;
		$("pencil_plane").disabled = !!pencil.surface;
		// The outlined face and label show what the first point will attach to, even with X-ray enabled.
		if (target) add("polygon", { points: target.outline.map((p) => renderer.toScreen(p).join(",")).join(" "), fill: "#64d9c411", stroke: "#64d9c4", "stroke-width": 1, "stroke-dasharray": "3 4" });
		const toWorld = (p) => pencil.surface ? TS.Shape.surfacePoint(p, pencil.surface) : [p[0], p[1], 0];
		const toScreen = (p) => renderer.toScreen(toWorld(p));
		const corners = $("pencil_mode").value === "corners", path = pencil.pts.slice();
		if (corners && pencil.hover && path.length) path.push(pencil.hover);
		if (!path.length) return;
		let points = path.map(toScreen);
		if (pencil.surface) {
			const depth = Number($("pencil_thickness").value), lift = Number.isFinite(depth) ? TS.clamp(depth, 0, 255) || 0.01 : 0;
			const upper = path.map((p) => renderer.toScreen(v3.add(toWorld(p), v3.scale(pencil.surface.normal, lift))));
			add("polygon", { points: points.map((p) => p.join(",")).join(" "), fill: "none", stroke: "#64d9c4", "stroke-width": 1.5, "stroke-dasharray": "5 3" });
			// Show thickness without drawing a connector for every freehand sample.
			for (let i = 0; i < points.length; i += Math.max(1, Math.ceil(points.length / 16))) add("line", { x1: points[i][0], y1: points[i][1], x2: upper[i][0], y2: upper[i][1], stroke: "#ffb45d66", "stroke-width": 1 });
			points = upper;
		}
		add("polygon", { points: points.map((p) => p.join(",")).join(" "), fill: pencil.error ? "#ff5b8a22" : "#f08c2e22", stroke: pencil.error ? "#ff5b8a" : "#ffb45d", "stroke-width": 2, "stroke-dasharray": pencil.pointer === null ? "5 3" : "none" });
		if (corners) pencil.pts.forEach((p, i) => { const s = toScreen(p); add("circle", { cx: s[0], cy: s[1], r: i ? 3 : 6, fill: i ? "#ffb45d" : "#56deaa", stroke: "#141418", "stroke-width": 1.5 }); });
	}

	// --- input: pointer events (mouse, pen, touch) ---
	// Tools (palette or keys): select (tap/click picks; drag a selected piece to move it; drag empty space to box-select),
	// cursor (tap places the 3D cursor), pan, zoom, look (drag; look eases back on release). Middle-drag looks, Space/Shift+middle
	// pans, a pen's barrel button or right-click places the cursor, two fingers pan and pinch-zoom. Modal tools started from the
	// palette are "armed": press on the view, drag, release to apply.

	const ZOOMS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32];
	const pointers = new Map();
	let press = null, pinch = null;

	function setTool(tool) {
		if (tool === "stamp" && exchange && !exchange.hasSelection()) { exchange.showSource(); return; }
		if (tool === "pencil" || tool === "stamp") {
			if (!S.art && tool === "pencil") return status("Open a tileset or project first, then choose Pencil (P).");
			if (modal) cancelModal();
			S.armed = null; S.armedOpts = null; knife = null; S.loopCut = false; loopHover = null; hover = null;
			if (renderer.free.blend > 0 || S.stay3d) { if (S.stay3d) toggleStay3d(false); anim = null; renderer.free.blend = 0; }
			S.edit = false; S.elemSel.clear();
			pencil = tool === "pencil" ? { pts: [], hover: null, pointer: null, error: false, surface: null, hoverSurface: null } : null;
			modalBar(); panels();
		} else if (pencil) pencil = null;
		press = null; marquee(null);
		S.tool = tool;
		$("pencilpanel").classList.toggle("open", tool === "pencil");
		$("stamppanel").classList.toggle("open", tool === "stamp");
		if (exchange) { if (tool === "stamp") exchange.begin(); else exchange.end(); }
		dirty = true;
		document.querySelectorAll("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === tool));
		$("view").style.cursor = tool === "pan" ? "grab" : tool === "box" ? "crosshair" : tool === "ref" ? "move" : tool === "zoom" ? "ns-resize" : tool === "look" ? "move" : "crosshair";
		if (!modal) hint();
	}

	function zoomAt(px, py, zoom) {
		const before = renderer.canvasPoint(px, py);
		renderer.cam.zoom = TS.clamp(zoom, ZOOMS[0], ZOOMS[ZOOMS.length - 1]);
		const after = renderer.canvasPoint(px, py);
		renderer.cam.x += before[0] - after[0]; renderer.cam.y += before[1] - after[1];
		dirty = true;
		$("zoomlabel").textContent = `${Math.round(renderer.cam.zoom * 100)}%`;
	}
	// Steps through pixel-friendly zoom levels (whole pixels per art pixel above 1).
	function zoomStep(px, py, dir) {
		const z = renderer.cam.zoom;
		const next = dir > 0 ? ZOOMS.find((v) => v > z + 1e-6) : [...ZOOMS].reverse().find((v) => v < z - 1e-6);
		if (next) zoomAt(px, py, next);
	}
	const viewCentre = () => { const r = $("view").getBoundingClientRect(); return [r.width / 2, r.height / 2]; };

	// Frame the selection (or everything) in the tileset view.
	function frameSelection() {
		const objs = S.edit ? [activeObj()].filter(Boolean) : S.selected.size ? selectedObjs() : S.objects;
		const pts = [];
		for (const o of objs) for (const i of Mesh.selectionVerts(o, S.edit && S.elemSel.size ? S.elemMode : "object", S.elemSel)) pts.push(o.verts[i]);
		if (renderer.free.blend > 0) {
			// 3D view: orbit round the selection's middle, far enough back to see all of it.
			if (!pts.length) { renderer.free.target = [renderer.art.w / 2, renderer.art.h / 2, 0]; dirty = true; return; }
			const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
			for (const p of pts) for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], p[k]); b.max[k] = Math.max(b.max[k], p[k]); }
			renderer.free.target = [0, 1, 2].map((k) => (b.min[k] + b.max[k]) / 2);
			const r = $("view").getBoundingClientRect(), size = Math.max(16, v3.dist(b.min, b.max));
			renderer.cam.zoom = TS.clamp((Math.min(r.width, r.height) / size) * 0.6, ZOOMS[0], ZOOMS[ZOOMS.length - 1]);
			$("zoomlabel").textContent = `${Math.round(renderer.cam.zoom * 100)}%`;
			dirty = true;
			return;
		}
		if (!pts.length) { renderer.fit(); dirty = true; return; }
		let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
		for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1] - p[2]); y1 = Math.max(y1, p[1] - p[2]); }
		const r = $("view").getBoundingClientRect();
		const want = Math.min(r.width / Math.max(x1 - x0, 16), r.height / Math.max(y1 - y0, 16)) * 0.6;
		renderer.cam.x = (x0 + x1) / 2; renderer.cam.y = (y0 + y1) / 2;
		renderer.cam.zoom = [...ZOOMS].reverse().find((v) => v <= want) || ZOOMS[0];
		$("zoomlabel").textContent = `${Math.round(renderer.cam.zoom * 100)}%`;
		dirty = true;
	}

	function localPoint(e) { const r = $("view").getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

	// Is there a selected piece (or selected element) under this point? (drag-to-move starts there)
	function overSelection(px, py) {
		if (S.edit) {
			const o = activeObj();
			if (!o || !S.elemSel.size) return false;
			return elemCandidates(o, px, py).some((k) => S.elemSel.has(k));
		}
		if (S.xray) return objCandidates(px, py).some((id) => S.selected.has(id));
		const h = pickObject(px, py);
		return !!h && S.selected.has(h.obj.id);
	}

	// Box select: in edit mode only elements in sight, unless X-ray (then everything inside the box, as in Blender).
	function boxSelect(a, b, add) {
		const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
		const inside = (p) => { const s = renderer.toScreen(p); return s && s[0] >= x0 && s[0] <= x1 && s[1] >= y0 && s[1] <= y1; };
		if (S.edit) {
			const o = activeObj();
			if (!o) return;
			if (!add) S.elemSel.clear();
			const before = S.elemSel.size;
			let skipped = 0;
			const take = (k, seen) => { if (seen) S.elemSel.add(k); else skipped++; };
			if (S.elemMode === "vert") o.verts.forEach((p, i) => inside(p) && take(i, inSight(p)));
			else if (S.elemMode === "edge") for (const [k, e] of Mesh.edges(o)) { if (inside(o.verts[e.a]) && inside(o.verts[e.b])) take(k, edgeInSight(o, e)); }
			else o.faces.forEach((f, i) => inside(Mesh.faceCentre(o, f)) && take(i, faceInSight(o, i)));
			status(`Box: ${S.elemSel.size - before} selected${skipped ? `, ${skipped} hidden behind faces left out (X-ray, Alt+Z, takes them too)` : ""}`);
		} else {
			if (!add) S.selected.clear();
			// Every model the box touches: its centre or any vertex inside (not just the centre, so big models and walls count).
			const hits = visibleObjs().filter((o) => inside(Mesh.centre(o)) || o.verts.some(inside));
			for (const o of hits) { S.selected.add(o.id); S.active = o.id; }
			status(`Box: ${hits.length} model${hits.length === 1 ? "" : "s"} selected${S.selected.size > 1 ? " · the properties panel edits all of them (collision, kind, tags, material)" : ""}`);
		}
		changed(true); panels();
	}

	function marquee(a, b) {
		const m = $("marquee");
		if (!a) { m.style.display = "none"; return; }
		m.style.display = "block";
		m.style.left = Math.min(a[0], b[0]) + "px"; m.style.top = Math.min(a[1], b[1]) + "px";
		m.style.width = Math.abs(b[0] - a[0]) + "px"; m.style.height = Math.abs(b[1] - a[1]) + "px";
	}

	function bindViewport(canvas) {
		canvas.addEventListener("contextmenu", (e) => e.preventDefault());
		canvas.addEventListener("pointerdown", (e) => {
			canvas.focus();
			try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already-released pointer */ }
			mouse = localPoint(e);
			lastEvent = e;
			pointers.set(e.pointerId, mouse.slice());
			if (pointers.size === 2 && e.pointerType === "touch") {
				// Second finger: pinch / two-finger pan, cancelling whatever the first finger started.
				const [p, q] = [...pointers.values()];
				pinch = { d: Math.hypot(p[0] - q[0], p[1] - q[1]), mid: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], zoom: renderer.cam.zoom };
				press = null; marquee(null);
				if (pencil && pencil.pointer !== null) clearPencil();
				if (exchange?.draft) exchange.draft.pointer = null;
				return;
			}
			const button = e.pointerType === "pen" && e.button === 5 ? "eraser" : e.button;
			if (modal) { if (button === 0) { if (!modal.dragRelease) confirmModal(); } else cancelModal(); return; }
			if (S.armed) {
				// A tool started from the palette: this press is its start point; dragging adjusts, release applies.
				if (button !== 0) { S.armed = null; modalBar(); hint(); return; }
				const type = S.armed, opts = S.armedOpts;
				S.armed = null; S.armedOpts = null;
				beginModal(type, false, opts);
				if (modal) modal.dragRelease = true;
				return;
			}
			if (knife) { if (button === 0) knifeClick(mouse[0], mouse[1], e); else if (button === 2) knifeApply(); return; }
			if (S.loopCut) { if (button === 0) { loopCutHover(mouse[0], mouse[1]); loopCutApply(e.pointerType !== "mouse"); } else { S.loopCut = false; loopHover = null; hint(); dirty = true; } return; }
			if ((button === 1 && e.shiftKey) || (button === 0 && spaceDown) || (button === 0 && S.tool === "pan")) { press = { kind: "pan", last: mouse.slice() }; return; }
			// Move-reference tool: a drag slides the active reference across the floor (X, Y); its height is never touched.
			if (S.tool === "ref" && button === 0 && !spaceDown) {
				const r = activeRef();
				if (!r) { status("Add a reference first (References, in the left panel)."); setTool("select"); return; }
				press = { kind: "ref", id: r.id, start: mouse.slice(), dx0: r.dx, dy0: r.dy, floor: renderer.free.blend > 0 ? renderer.floorPoint(mouse[0], mouse[1], 0) : null };
				return;
			}
			if (S.tool === "stamp" && exchange.draft) {
				if (button === 0) { exchange.draft.pointer = e.pointerId; exchange.move(renderer.canvasPoint(...mouse), true); }
				else if (button === 2) setTool("select");
				else if (button === 1) press = { kind: "pan", last: mouse.slice() };
				return;
			}
			if (pencil) {
				if (button === 0) pencilDown(e);
				else if (button === 2) clearPencil();
				else if (button === 1) press = { kind: "pan", last: mouse.slice() };
				return;
			}
			// Held 3D view: a click selects (Shift-click adds); a drag on the selection moves it, Ctrl-drag box-selects, Shift-drag
			// pans, any other drag orbits.
			if (S.stay3d && button === 0 && S.tool !== "zoom" && S.tool !== "cursor") {
				press = { kind: "select", start: mouse.slice(), add: e.shiftKey, orbit: e.ctrlKey || e.metaKey ? "box" : S.tool === "box" ? (e.altKey ? "look" : "box") : e.shiftKey ? "pan" : "look",
					onSel: !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && overSelection(mouse[0], mouse[1]) };
				return;
			}
			if (button === 0 && S.tool === "zoom") { press = { kind: "zoom", start: mouse.slice(), zoom: renderer.cam.zoom }; return; }
			if (button === 1 || (button === 0 && (e.altKey || S.tool === "look"))) { press = { kind: "look", last: mouse.slice() }; startLook(); return; }
			if (button === 2) { if (!((e.ctrlKey || e.metaKey) && addVertexAt(mouse[0], mouse[1]))) placeCursor(mouse[0], mouse[1]); return; }
			if (button === "eraser") { deleteSelection(); return; }
			if (button !== 0) return;
			if (S.tool === "cursor") { placeCursor(mouse[0], mouse[1]); return; }
			press = { kind: "select", start: mouse.slice(), add: e.shiftKey, onSel: overSelection(mouse[0], mouse[1]) };
		});
		canvas.addEventListener("pointermove", (e) => {
			mouse = localPoint(e);
			lastEvent = e;
			if (pointers.has(e.pointerId)) pointers.set(e.pointerId, mouse.slice());
			if (pinch && pointers.size >= 2) {
				const [p, q] = [...pointers.values()];
				const d = Math.hypot(p[0] - q[0], p[1] - q[1]), mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
				renderer.cam.x -= (mid[0] - pinch.mid[0]) / renderer.cam.zoom; renderer.cam.y -= (mid[1] - pinch.mid[1]) / renderer.cam.zoom;
				pinch.mid = mid;
				zoomAt(mid[0], mid[1], (pinch.zoom * d) / Math.max(pinch.d, 1));
				return;
			}
			if (press && press.kind === "look") {
				renderer.free.yaw -= (mouse[0] - press.last[0]) * 0.008;
				renderer.free.pitch = TS.clamp(renderer.free.pitch + (mouse[1] - press.last[1]) * 0.008, 0.05, 1.5);
				press.last = mouse.slice(); dirty = true;
			} else if (press && press.kind === "pan") {
				if (renderer.free.blend > 0) panFree(mouse[0] - press.last[0], mouse[1] - press.last[1]);
				else { renderer.cam.x -= (mouse[0] - press.last[0]) / renderer.cam.zoom; renderer.cam.y -= (mouse[1] - press.last[1]) / renderer.cam.zoom; }
				press.last = mouse.slice(); dirty = true;
			} else if (press && press.kind === "ref") {
				const r = refById(press.id);
				let ddx = NaN, ddy = NaN;
				if (renderer.free.blend > 0) { const a = renderer.floorPoint(mouse[0], mouse[1], 0); if (a && press.floor) { ddx = a[0] - press.floor[0]; ddy = a[1] - press.floor[1]; } }
				else { ddx = (mouse[0] - press.start[0]) / renderer.cam.zoom; ddy = (mouse[1] - press.start[1]) / renderer.cam.zoom; }
				if (r && !isNaN(ddx)) { const sn = S.snap; r.dx = sn > 0 ? Math.round((press.dx0 + ddx) / sn) * sn : Math.round((press.dx0 + ddx) * 100) / 100; r.dy = sn > 0 ? Math.round((press.dy0 + ddy) / sn) * sn : Math.round((press.dy0 + ddy) * 100) / 100; refSyncXY(r); dirty = true; }
			} else if (press && press.kind === "zoom") {
				zoomAt(press.start[0], press.start[1], press.zoom * Math.pow(1.01, press.start[1] - mouse[1]));
			} else if (press && press.kind === "select") {
				if (Math.hypot(mouse[0] - press.start[0], mouse[1] - press.start[1]) > 5) {
					if (press.onSel) {
						// Dragging a selected piece moves it; releasing applies.
						const start = press.start;
						press = null;
						const now = mouse;
						mouse = start;
						beginModal("grab");
						mouse = now;
						if (modal) { modal.dragRelease = true; updateModal(e); }
					} else if (press.orbit === "look" || press.orbit === "pan") press = { kind: press.orbit, last: mouse.slice() };
					else press.kind = "box";
				}
			}
			if (press && press.kind === "box") marquee(press.start, mouse);
			else if (modal) updateModal(e);
			else if (knife) { knife.hover = knifePoint(mouse[0], mouse[1], e); dirty = true; }
			else if (pencil && !press) pencilMove(e);
			else if (S.tool === "stamp" && !press) exchange.move(renderer.canvasPoint(...mouse));
			else if (S.loopCut) loopCutHover(mouse[0], mouse[1]);
			else if (!press && !pinch) updateHover(mouse[0], mouse[1]);
			if (S.art && renderer.free.blend === 0) {
				const cp = renderer.canvasPoint(mouse[0], mouse[1]);
				$("coords").textContent = `canvas ${Math.floor(cp[0])}, ${Math.floor(cp[1])} · tile ${Math.floor(cp[0] / 32)}, ${Math.floor(cp[1] / 32)} · ${Math.round(renderer.cam.zoom * 100)}%`;
			}
		});
		const release = (e) => {
			pointers.delete(e.pointerId);
			if (pinch) { if (pointers.size < 2) pinch = null; return; }
			if (exchange?.draft?.pointer === e.pointerId) { exchange.draft.pointer = null; return; }
			if (pencil && pencil.pointer === e.pointerId) {
				mouse = localPoint(e); const end = pencilPoint(...mouse), first = pencil.pts[0];
				if (Math.hypot(end[0] - first[0], end[1] - first[1]) * renderer.cam.zoom <= 10) {
					// Close at the first corner, discarding only the last sample if it also sits near the start.
					const last = pencil.pts[pencil.pts.length - 1];
					if (pencil.pts.length > 3 && Math.hypot(last[0] - first[0], last[1] - first[1]) * renderer.cam.zoom <= 10) pencil.pts.pop();
				} else pencilAdd(end);
				pencil.pointer = null; pencilFinish(); return;
			}
			if (modal && modal.dragRelease) { confirmModal(); return; }
			if (!press) return;
			if (press.kind === "look") endLook();
			else if (press.kind === "ref") markUnsaved();
			else if (press.kind === "select") clickSelect(press.start[0], press.start[1], press.add);
			else if (press.kind === "box") { boxSelect(press.start, mouse, press.add); marquee(null); }
			press = null;
		};
		canvas.addEventListener("pointerup", release);
		canvas.addEventListener("pointercancel", () => { if (exchange?.draft) exchange.draft.pointer = null; });
		canvas.addEventListener("pointercancel", (e) => { if (pencil && pencil.pointer === e.pointerId) clearPencil(); });
		canvas.addEventListener("pointerleave", () => { if (hover) { hover = null; dirty = true; } });
		canvas.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); pinch = null; if (press && press.kind === "look") endLook(); press = null; marquee(null); });
		canvas.addEventListener("wheel", (e) => {
			e.preventDefault();
			if (renderer.free.blend > 0) {
				// 3D view: the wheel moves the eye in and out (the zoom sets its distance).
				if (S.stay3d) { renderer.cam.zoom = TS.clamp(renderer.cam.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), ZOOMS[0], ZOOMS[ZOOMS.length - 1]); $("zoomlabel").textContent = `${Math.round(renderer.cam.zoom * 100)}%`; dirty = true; }
				return;
			}
			const [px, py] = localPoint(e);
			if (e.ctrlKey) zoomAt(px, py, renderer.cam.zoom * Math.pow(1.01, -e.deltaY));    // trackpad pinch
			else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {                  // trackpad / shift: pan
				renderer.cam.x += (e.shiftKey ? e.deltaY : e.deltaX) / renderer.cam.zoom;
				if (!e.shiftKey) renderer.cam.y += e.deltaY / renderer.cam.zoom;
				dirty = true;
			} else zoomStep(px, py, e.deltaY < 0 ? 1 : -1);
		}, { passive: false });
	}

	// The bar shown while a tool runs: axis locks, exact value, fine snapping, apply / cancel (for pens and touch).
	function modalBar() {
		const bar = $("modalbar");
		const active = !!modal || !!S.armed || !!knife;
		bar.classList.toggle("open", active);
		if (!active) return;
		if (knife && !modal) { $("mb_title").textContent = `Knife (${knife.pts.length} point${knife.pts.length === 1 ? "" : "s"}): ✓ cuts`; return; }
		const type = modal ? modal.type : S.armed;
		$("mb_title").textContent = (S.armed ? "Press and drag: " : "") + { grab: "Move", scale: "Scale", rotate: "Turn", extrude: "Extrude", inset: "Inset", bevel: "Bevel", loopslide: "Loop cut (slide)" }[type] +
			((modal ? modal.data.manifold : S.armedOpts && S.armedOpts.manifold) ? " manifold" : "");
		for (const ax of ["x", "y", "z"]) {
			const on = !!modal && modal.axis === ax, local = on && modal.local;
			$("mb_" + ax).classList.toggle("on", on);
			$("mb_" + ax).textContent = local ? `${ax.toUpperCase()} local` : { x: "X across", y: "Y depth", z: "Z height" }[ax];
		}
		$("mb_fine").classList.toggle("on", !!S.fine);
		const field = $("mb_value");
		if (document.activeElement !== field) field.value = modal ? modal.numeric : "";
	}

	function startTool(type, armed) {
		if (pencil || S.tool === "stamp") setTool("select");
		if (armed) { S.armed = type; modalBar(); status("Press on the view where to start, drag, and let go to apply. Esc or the ✕ cancels."); return; }
		beginModal(type);
	}

	function toggleEdit() {
		if (pencil || S.tool === "stamp") setTool("select");
		if (!S.edit && !activeObj()) return status("Select an object, then Tab to edit it.");
		S.edit = !S.edit; S.elemSel.clear();
		knife = null;
		if (S.edit) S.selected = new Set([S.active]);
		changed(true); panels(); hint();
	}
	function setElemMode(mode) {
		if (!S.edit) return;
		S.elemMode = mode; S.elemSel.clear(); dirty = true; panels(); hint();
	}
	function startLoopCut() {
		if (!S.edit) return status("Tab into edit mode on an object to loop cut.");
		S.loopCut = true;
		status("Loop cut: hover (or press) an edge to see the ring, tap/click to cut, right-click/Esc to stop");
	}

	function onKey(e) {
		const tag = (e.target.tagName || "").toLowerCase();
		if (tag === "input" || tag === "select" || tag === "textarea") return;
		let k = e.key.toLowerCase();
		const ctrl = e.ctrlKey || e.metaKey;
		if (k === "return" || e.code === "Enter" || e.code === "NumpadEnter") k = "enter";
		if (S.tool === "stamp" && exchange.draft) {
			if (k === "escape" || k === "q") { setTool("select"); e.preventDefault(); return; }
			if (k === "enter") { if (!e.repeat) exchange.place(); e.preventDefault(); return; }
			if (k.startsWith("arrow") || k === "pageup" || k === "pagedown") {
				const d = exchange.draft, step = e.shiftKey ? .5 : 1;
				if (k === "arrowleft") d.x -= step; if (k === "arrowright") d.x += step;
				if (k === "arrowup") d.y -= step; if (k === "arrowdown") d.y += step;
				if (k === "pageup") d.base += step; if (k === "pagedown") d.base -= step;
				d.pinned = true; exchange.syncControls(); exchange.hint(); dirty = true; e.preventDefault(); return;
			}
			if (["p", "tab", "5"].includes(k) && !ctrl) setTool("select");
			else if (!(k === " " || ["+", "=", "-", "_", "home", "[", "]"].includes(k) || (ctrl && ["z", "y", "s"].includes(k)))) { e.preventDefault(); return; }
		}
		if (pencil) {
			if (k === "escape") { pencil.pts.length ? clearPencil() : setTool("select"); e.preventDefault(); return; }
			if (k === "enter") { pencilFinish(); e.preventDefault(); return; }
			if (k === "backspace" || (ctrl && k === "z" && pencil.pts.length)) { pencilBack(); e.preventDefault(); return; }
			if (k === "q" || k === "p" || k === "tab" || k === "5") { setTool("select"); if (k === "p") { e.preventDefault(); return; } }
			else if (!(k === " " || ["+", "=", "-", "_", "home", "[", "]", "arrowleft", "arrowright", "arrowup", "arrowdown"].includes(k) || (ctrl && ["z", "y", "s"].includes(k)))) { e.preventDefault(); return; }
			if (ctrl && k === "s" && pencil && pencil.pts.length) { status("Finish or clear the current pencil outline before saving."); e.preventDefault(); return; }
		}
		if (knife) {
			if (k === "escape") { knife = null; dirty = true; hint(); }
			else if (k === "enter" || k === " ") knifeApply();
			else if (k === "backspace") { knife.pts.pop(); dirty = true; }
			else if (k === "z" && e.altKey) { S.xray = !S.xray; $("xray").checked = S.xray; savePrefs(); dirty = true; }
			else if (!["5", "+", "=", "-", "_", "home", ".", "arrowleft", "arrowright", "arrowup", "arrowdown", "[", "]"].includes(k)) { e.preventDefault(); return; }
			// Navigation keys (and the snap step) still work while cutting.
			if (k === "escape" || k === "enter" || k === " " || k === "backspace" || k === "z") { e.preventDefault(); return; }
		}
		if (k === " ") { spaceDown = true; e.preventDefault(); return; }
		if (S.armed && k === "escape") { cancelModal(); return; }
		if (modal) {
			if (k === "escape") cancelModal();
			else if (k === "enter") confirmModal();
			else if (k === "x" || k === "y" || k === "z") cycleAxis(k);
			else if (/^[0-9.\-]$/.test(e.key)) { modal.numeric += e.key; updateModal(e); }
			else if (k === "backspace") { modal.numeric = modal.numeric.slice(0, -1); updateModal(e); }
			else if (k === "shift" || k === "control") updateModal(e);
			e.preventDefault();
			return;
		}
		if (ctrl && k === "z") { e.shiftKey ? redo() : undo(); e.preventDefault(); return; }
		if (ctrl && k === "y") { redo(); e.preventDefault(); return; }
		if (ctrl && k === "s") { saveProject(); e.preventDefault(); return; }
		if (ctrl && k === "c") { copySelection(); e.preventDefault(); return; }
		if (ctrl && k === "v") { paste(); e.preventDefault(); return; }
		if (ctrl && k === "i") { invertSelection(); e.preventDefault(); return; }
		if (ctrl && k === "m") { if (S.edit || !S.selected.size) mirrorSelection("x"); else { mirrorPending = true; status("Mirror: press X (across), Y (depth) or Z (height); any other key cancels."); } e.preventDefault(); return; }
		if (ctrl && k.startsWith("arrow")) {
			const d = { arrowleft: [-1, 0, 0], arrowright: [1, 0, 0], arrowup: [0, -1, 0], arrowdown: [0, 1, 0] }[k];
			if (nudge(d, e)) e.preventDefault();
			return;
		}
		if (mirrorPending) { if (k === "x" || k === "y" || k === "z") mirrorSelection(k); else { mirrorPending = false; hint(); } e.preventDefault(); return; }
		if (ctrl && k === "r") { startLoopCut(); e.preventDefault(); return; }
		if (ctrl && k === "e") { bridgeSelection(); e.preventDefault(); return; }
		if (ctrl && k === "j") { joinSelection(); e.preventDefault(); return; }
		if (ctrl && k === "b") { beginModal("bevel"); e.preventDefault(); return; }
		if (ctrl) return;
		if (k === "escape") {
			if (S.loopCut) { S.loopCut = false; loopHover = null; hint(); dirty = true; }
			$("help").classList.remove("open"); toggleAddMenu(false);
			return;
		}
		if (e.shiftKey && k === "a") { toggleAddMenu(true); e.preventDefault(); return; }
		if (e.shiftKey && k === "d") { duplicate(); e.preventDefault(); return; }
		if (k === "h") { if (e.altKey) unhideAll(); else hideModels(e.shiftKey ? "unselected" : "selected"); e.preventDefault(); return; }
		if (e.altKey && k === "z") { S.xray = !S.xray; $("xray").checked = S.xray; savePrefs(); dirty = true; e.preventDefault(); return; }
		if (k === "pageup" || k === "pagedown") { nudge([0, 0, k === "pageup" ? 1 : -1], e); e.preventDefault(); return; }
		if (k === "[" || k === "]" || k === "{" || k === "}") { snapStep(k === "[" || k === "{" ? -1 : 1); return; }
		switch (k) {
			case "tab": e.preventDefault(); toggleEdit(); break;
			case "1": setElemMode("vert"); break;
			case "2": setElemMode("edge"); break;
			case "3": setElemMode("face"); break;
			case "a":
				if (e.altKey) { S.edit ? S.elemSel.clear() : S.selected.clear(); }
				else if (S.edit) { const o = activeObj(); if (o) S.elemSel = new Set(allElems(o)); }
				else S.selected = new Set(visibleObjs().map((o) => o.id));
				changed(true); panels();
				break;
			case "g": beginModal("grab"); break;
			case "s": beginModal("scale"); break;
			case "r": beginModal("rotate"); break;
			case "k": startKnife(); break;
			case "e": e.preventDefault(); beginModal("extrude", false, e.altKey ? { manifold: true } : null); break;
			case "i": beginModal("inset"); break;
			case "x": case "delete": deleteSelection(); break;
			case "home": renderer.fit(); $("zoomlabel").textContent = `${Math.round(renderer.cam.zoom * 100)}%`; dirty = true; break;
			case "f": if (S.edit) fillSelection(); else frameSelection(); break;
			case ".": frameSelection(); break;
			case "+": case "=": zoomStep(...viewCentre(), 1); break;
			case "-": case "_": zoomStep(...viewCentre(), -1); break;
			case "arrowleft": renderer.cam.x -= 32; dirty = true; e.preventDefault(); break;
			case "arrowright": renderer.cam.x += 32; dirty = true; e.preventDefault(); break;
			case "arrowup": renderer.cam.y -= 32; dirty = true; e.preventDefault(); break;
			case "arrowdown": renderer.cam.y += 32; dirty = true; e.preventDefault(); break;
			case "5": toggleStay3d(); break;
			case "q": setTool("select"); break;
			case "b": setTool(S.tool === "box" ? "select" : "box"); break;
			case "p": setTool("pencil"); break;
			case "c": setTool("cursor"); break;
			case "f1": case "?": toggleHelp(); e.preventDefault(); break;
		}
	}

	// --- panels ---

	function panels() {
		document.body.classList.toggle("editing", S.edit);
		document.body.classList.toggle("noart", !S.art);
		document.querySelectorAll(".editonly [data-act]").forEach((b) => b.classList.toggle("on", b.dataset.act === S.elemMode));
		// Outliner: click selects (Shift/Ctrl+click toggles), double-click renames, the eye hides / shows; the filter box narrows it.
		const list = $("outliner"), filter = $("outfilter").value.trim().toLowerCase(), keepScroll = list.scrollTop;
		list.innerHTML = "";
		let activeLi = null;
		const nHidden = S.objects.filter((o) => o.hidden).length;
		$("models_h").textContent = `Models (${S.objects.length}${S.selected.size ? `, ${S.selected.size} selected` : ""}${nHidden ? `, ${nHidden} hidden` : ""})`;
		const roles = S.result && S.result.roles && S.result.roles.length === S.objects.length ? S.result.roles : null;
		for (const o of S.objects) {
			if (filter && !o.name.toLowerCase().includes(filter)) continue;
			const li = document.createElement("li");
			li.className = (S.selected.has(o.id) ? "sel " : "") + (o.id === S.active ? "active " : "") + (o.hidden ? "hidden" : "");
			const eye = document.createElement("button");
			eye.className = "eye"; eye.textContent = o.hidden ? "◌" : "●"; eye.title = o.hidden ? "Hidden (still exported): show" : "Hide (H); it still exports";
			eye.onclick = (e) => { e.stopPropagation(); toggleHidden(o); };
			const name = document.createElement("span");
			const role = roles ? roles[S.objects.indexOf(o)] : null;
			name.textContent = o.name + ({ none: "  (no collision)", footprint: "  (walk-behind)" }[TS.Process.collisionMode(o, role)] || "");
			if (TS.Process.KINDS.includes(o.kind)) { const badge = document.createElement("span"); badge.className = "badge"; badge.textContent = o.kind; badge.title = "Kind set by you (inferred: " + (role ? role.kindInferred : "?") + ")"; name.append(badge); }
			li.title = "Click: select · Shift+click: range · Ctrl+click: add/remove · double-click: rename";
			li.append(eye, name);
			li.onclick = (e) => {
				if (S.edit) return;
				if (e.shiftKey && S.active !== null && S.active !== o.id) {
						// Shift-click: everything between the active model and this one (as listed, so a filter narrows the range).
						const ids = S.objects.filter((x) => !filter || x.name.toLowerCase().includes(filter)).map((x) => x.id);
						const p = ids.indexOf(S.active), q = ids.indexOf(o.id);
						if (p >= 0 && q >= 0) for (const id of ids.slice(Math.min(p, q), Math.max(p, q) + 1)) S.selected.add(id);
						S.active = o.id;
					} else if (e.shiftKey || e.ctrlKey || e.metaKey) { if (S.selected.has(o.id)) S.selected.delete(o.id); else { S.selected.add(o.id); S.active = o.id; } }
				else { S.selected = new Set([o.id]); S.active = o.id; }
				changed(true); panels();
			};
			li.ondblclick = (e) => {
				e.stopPropagation();
				const input = document.createElement("input");
				input.value = o.name; input.className = "rename";
				name.replaceWith(input); input.focus(); input.select();
				const done = (keep) => { if (keep && input.value.trim() && input.value !== o.name) { pushUndo(); o.name = input.value.trim(); } panels(); };
				input.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === "Enter") done(true); else if (ev.key === "Escape") done(false); };
				input.onblur = () => done(true);
			};
			list.appendChild(li);
			if (o.id === S.active) activeLi = li;
		}
		// Keep the list where it was, but bring the active model into sight (inside the list only).
		list.scrollTop = keepScroll;
		if (activeLi && (activeLi.offsetTop < list.scrollTop || activeLi.offsetTop + activeLi.offsetHeight > list.scrollTop + list.clientHeight))
			list.scrollTop = activeLi.offsetTop - list.clientHeight / 2;
		const props = $("props"), o = activeObj();
		if (!o) { props.innerHTML = `<p class="empty-note">Select a model to edit it here.<br><span class="dim">Add one with <b>Add ▾</b> or Shift+A; it lands at the red 3D cursor (right-click moves the cursor, on a top to stack).</span></p>`; return; }
		const b = Mesh.bounds(o);
		// More than one model selected (object mode): collision, kind, tags, smoothing and material edit all of them; name and
		// placement belong to one model, so they are left out. A field whose models differ shows "mixed".
		const multi = !S.edit && S.selected.size > 1 ? selectedObjs() : null, targets = multi || [o];
		const common = (get) => (targets.every((t) => get(t) === get(targets[0])) ? get(targets[0]) : undefined);
		const mixedOpt = `<option value="__mixed" selected disabled>— mixed —</option>`;
		const reqValue = common(TS.Process.collisionRequested), kindValue = common((t) => (TS.Process.KINDS.includes(t.kind) ? t.kind : ""));
		const role = roles ? roles[S.objects.indexOf(o)] : null, esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
		const faceSel = S.edit && S.elemMode === "face" && S.elemSel.size;
		const fm = faceSel ? Mesh.faceMat(o, o.faces[[...S.elemSel][0]]) : null;
		props.innerHTML = `
			${multi ? `<p class="multi"><b>${multi.length} models selected.</b> Changes here apply to all of them. Name and placement are single-model: select one, or use G / S / R to move the group.</p>` : `<label>Name <input id="p_name" value="${o.name.replace(/"/g, "&quot;")}"></label>`}
			<label title="How it blocks the player in the game. Strip: only a 4 px strip along the south edge of its footprint, you walk into its drawn top. Footprint (walk-behind): the floor it really covers blocks wherever it reaches between the step and body heights (Processing), so you walk round it and can stand behind it. None: never blocks. The Collision view shows it.">Collision
				<select id="p_collision">${reqValue === undefined ? mixedOpt : ""}${[["auto", `auto${role && !multi ? " (now: " + role.mode + ")" : ""}`], ["strip", "strip (walk into the top)"], ["footprint", "footprint (walk behind)"], ["none", "none"]].map(([v, t]) =>
					`<option value="${v}" ${reqValue === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
			<label title="What the importer treats it as. Default (inferred): flat models (highest point at or below the walk-over height) are floor, everything else solid. Floor: walked over. Deco: art only. Solid: blocks. Wall: a tall back wall the torch beam lands on. Side: a side wall that blocks light east / west. Wall and side are never inferred. The Kind view tints by this.">Kind${kindValue ? `<span class="badge" title="Set by you; the inferred kind is ${role ? role.kindInferred : "?"}">set</span>` : ""}
				<select id="p_kind">${kindValue === undefined ? mixedOpt : ""}<option value="" ${kindValue === "" ? "selected" : ""}>default: ${role && !multi ? role.kindInferred + " (inferred)" : "inferred per model"}</option>${TS.Process.KINDS.map((k) =>
					`<option value="${k}" ${kindValue === k ? "selected" : ""}>${k}</option>`).join("")}</select></label>
			${role && !multi ? `<p class="dim">height ${role.heightMin}-${role.heightMax} px above the floor${role.flat ? " · flat (walkable)" : ""}</p>` : ""}
			<label title="Free-form text for the importer (an escape hatch; nothing in the Studio reads it)">Tags <input id="p_tags" value="${esc(common((t) => t.tags || "") ?? "")}" ${common((t) => t.tags || "") === undefined ? 'placeholder="(mixed: typing replaces all)"' : ""}></label>
			<label>Smooth shading up to <input id="p_smooth" type="number" min="0" max="180" step="5" value="${common((t) => t.smooth) ?? o.smooth}">°</label>
			${multi ? "" : `<fieldset><legend>Placement (bottom centre / size, px)</legend>
				<div class="xyz heads"><span class="ax-x" title="East-west">X across</span><span class="ax-y" title="North-south on the ground: bigger = further south, nearer you">Y depth</span><span class="ax-z" title="Up from the floor">Z height</span></div>
				<div class="xyz"><input id="p_x" class="ax-x" type="text" inputmode="decimal" value="${round((b.min[0] + b.max[0]) / 2)}" title="Position: X across"><input id="p_y" class="ax-y" type="text" inputmode="decimal" value="${round((b.min[1] + b.max[1]) / 2)}" title="Position: Y depth (where its bottom stands on the ground)"><input id="p_z" class="ax-z" type="text" inputmode="decimal" value="${round(b.min[2])}" title="Position: Z height of its bottom"></div>
				<div class="xyz"><input id="p_w" class="ax-x" type="text" inputmode="decimal" value="${round(b.max[0] - b.min[0])}" title="Size: width (X)"><input id="p_d" class="ax-y" type="text" inputmode="decimal" value="${round(b.max[1] - b.min[1])}" title="Size: depth (Y)"><input id="p_h" class="ax-z" type="text" inputmode="decimal" value="${round(b.max[2] - b.min[2])}" title="Size: height (Z)"></div>
				<p class="dim" title="Depth (Y) runs into the picture on the ground; height (Z) goes up. In the drawing both run up and down the screen: something 10 px deeper and 10 px taller lands on the same spot.">Top: bottom-centre position. Bottom: width, depth, height.</p>
			</fieldset>`}
			<fieldset><legend>${faceSel ? `Material of ${S.elemSel.size} selected face(s)` : multi ? `Material of all ${multi.length} (shows ${o.name})` : "Material"}</legend>
				${slider("p_rough", "Roughness", faceSel ? fm.roughness : o.mat.roughness)}
				${slider("p_metal", "Metallic", faceSel ? fm.metallic : o.mat.metallic)}
				<label title="Turn the shading normals about the vertical (+ = from south toward east) when the art draws a surface facing another way than its fitted shape (a wheel drawn as an upright ellipse, a turned chair). Height, outline and collision stay.">Facing turn
					<span class="pair"><button id="p_turn_l" title="−15°">⟲</button><input id="p_turn" type="number" min="-180" max="180" step="15" value="${(faceSel ? fm.turn : o.mat.turn) || 0}">°<button id="p_turn_r" title="+15°">⟳</button></span></label>
				${faceSel ? `<button id="p_clearmat">Use the object's material</button>` : ""}
			</fieldset>
			<p class="dim">${o.verts.length} vertices · ${o.faces.length} faces</p>`;
		const num = (id) => evalNum($(id).value);
		if ($("p_name")) $("p_name").onchange = () => { pushUndo(); o.name = $("p_name").value; changed(); };
		$("p_collision").onchange = () => {
			pushUndo();
			const m = $("p_collision").value;
			if (m === "__mixed") return;
			for (const t of targets) {
				t.solid = m !== "none";
				if (m === "footprint" || m === "strip") t.collision = m; else delete t.collision; // auto: no explicit mode
			}
			changed();
		};
		$("p_kind").onchange = () => { const k = $("p_kind").value; if (k === "__mixed") return; pushUndo(); for (const t of targets) { if (k) t.kind = k; else delete t.kind; } changed(); };
		$("p_tags").onchange = () => { pushUndo(); const v = $("p_tags").value.trim(); for (const t of targets) { if (v) t.tags = v; else delete t.tags; } changed(); };
		$("p_smooth").onchange = () => { const v = num("p_smooth"); if (isNaN(v)) return panels(); pushUndo(); for (const t of targets) t.smooth = v; changed(); };
		for (const id of multi ? [] : ["p_x", "p_y", "p_z", "p_w", "p_d", "p_h"])
			$(id).onchange = () => {
				const bad = ["p_x", "p_y", "p_z", "p_w", "p_d", "p_h"].find((f) => isNaN(num(f)));
				if (bad) { status(`"${$(bad).value}" isn't a number (plain numbers or + − * / ( ) work).`); panels(); return; }
				pushUndo();
				const bb = Mesh.bounds(o), all = o.verts.map((p, i) => i);
				const size = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
				const want = [num("p_w"), num("p_d"), num("p_h")];
				const pivot = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, bb.min[2]];
				Mesh.scaleAbout(o, all, pivot, want.map((w, k) => (size[k] > 1e-6 && w > 0 ? w / size[k] : 1)));
				Mesh.translate(o, all, [num("p_x") - pivot[0], num("p_y") - pivot[1], num("p_z") - pivot[2]]);
				changed();
			};
		const setMat = (key, v) => {
			pushUndo();
			if (faceSel) for (const fi of S.elemSel) { const f = o.faces[fi]; f.mat = Object.assign({}, Mesh.faceMat(o, f), { [key]: v }); }
			else for (const t of targets) t.mat[key] = v;
			changed();
		};
		bindSlider("p_rough", (v) => setMat("roughness", v));
		bindSlider("p_metal", (v) => setMat("metallic", v));
		// Facing turn, wrapped to (-180, 180].
		const setTurn = (v) => { if (isNaN(v)) return; v = ((((v + 180) % 360) + 360) % 360) - 180; setMat("turn", v === -180 ? 180 : v); };
		$("p_turn").onchange = () => setTurn(num("p_turn"));
		$("p_turn_l").onclick = () => setTurn(num("p_turn") - 15);
		$("p_turn_r").onclick = () => setTurn(num("p_turn") + 15);
		if (faceSel) $("p_clearmat").onclick = () => { pushUndo(); for (const fi of S.elemSel) delete o.faces[fi].mat; changed(); };
	}
	const round = (v) => Math.round(v * 100) / 100;
	// A number field's value, which may be simple arithmetic ("32*2", "48+8", "(64-4)/2"); NaN if it isn't.
	function evalNum(text) {
		const s = String(text).trim();
		if (!/^[\d+\-*/(). ]+$/.test(s)) return parseFloat(s);
		try { const v = Function(`"use strict"; return (${s});`)(); return typeof v === "number" && isFinite(v) ? v : NaN; } catch (err) { return NaN; }
	}
	const slider = (id, label, v) => `<label>${label} <span class="pair"><input id="${id}" type="range" min="0" max="1" step="0.01" value="${v}"><input id="${id}_n" type="number" min="0" max="1" step="0.05" value="${v}"></span></label>`;
	function bindSlider(id, set) {
		$(id).oninput = () => { $(id + "_n").value = $(id).value; };
		$(id).onchange = () => set(parseFloat($(id).value));
		$(id + "_n").onchange = () => { $(id).value = $(id + "_n").value; set(parseFloat($(id + "_n").value)); };
	}

	function toggleAddMenu(show) { $("addmenu").classList.toggle("open", show); }
	function toggleHelp() { $("help").classList.toggle("open"); }

	// --- boot ---

	// Axis key (bottom right of the view): X across, Y depth, Z height as the view projects them, over a patch of ground.
	// In the tileset view depth and height both run up and down the screen (depth down, height up); in 3D they separate.
	function drawAxes() {
		const svg = $("axes"), f = renderer.free;
		const p = f.blend > 0 ? f.target : [renderer.cam.x, renderer.cam.y, 0], s0 = renderer.toScreen(p);
		if (!s0) return;
		const dirs = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((a) => { const s = renderer.toScreen(v3.add(p, v3.scale(a, 32))); return s ? [s[0] - s0[0], s[1] - s0[1]] : [0, 0]; });
		const len = Math.max(1e-6, ...dirs.map((d) => Math.hypot(d[0], d[1]))), C = [75, 60], R = 32;
		if (!isFinite(len) || dirs.some((d) => !isFinite(d[0] + d[1]))) return; // canvas has no size yet
		const at = (d, k = 1) => [C[0] + (d[0] / len) * R * k, C[1] + (d[1] / len) * R * k];
		const [x, y] = [at(dirs[0]), at(dirs[1])], xy = [x[0] + y[0] - C[0], x[1] + y[1] - C[1]];
		let html = `<polygon points="${[C, x, xy, y].map((q) => q.join(",")).join(" ")}" class="ground"/>`;
		["X across", "Y depth", "Z height"].forEach((name, k) => {
			const tip = at(dirs[k]), lab = at(dirs[k], 1.25), anchor = Math.abs(dirs[k][0]) < len * 0.3 ? "middle" : dirs[k][0] > 0 ? "start" : "end";
			html += `<line x1="${C[0]}" y1="${C[1]}" x2="${tip[0]}" y2="${tip[1]}" class="ax ax-${"xyz"[k]}"/><circle cx="${tip[0]}" cy="${tip[1]}" r="3" class="ax-${"xyz"[k]}"/>` +
				`<text x="${lab[0]}" y="${lab[1] + 4}" text-anchor="${anchor}" class="ax-${"xyz"[k]}">${name}</text>`;
		});
		svg.innerHTML = html;
	}

	function frame() {
		if (anim) anim();
		if (dirty && renderer) { dirty = false; if (knife || $("modalbar").classList.contains("open")) modalBar(); renderer.draw(buildGeometry(), { backdrop: true, opacity: S.opacity, shade: S.shade, xray: S.xray, refs: S.refs.filter((r) => r.visible) }); drawAxes(); drawPencil(); if (exchange) exchange.drawPreview(); }
		requestAnimationFrame(frame);
	}

	function boot() {
		S.tool = "select";
		for (const b of document.querySelectorAll("[data-tool]"))
			b.onclick = () => setTool(S.tool === b.dataset.tool && b.dataset.tool !== "select" ? "select" : b.dataset.tool);
		const acts = {
			add: () => toggleAddMenu(true), grab: () => startTool("grab", true), scale: () => startTool("scale", true),
			rotate: () => startTool("rotate", true), extrude: () => startTool("extrude", true), inset: () => startTool("inset", true),
			bevel: () => startTool("bevel", true), edit: toggleEdit, vert: () => setElemMode("vert"), edge: () => setElemMode("edge"),
			face: () => setElemMode("face"), loopcut: startLoopCut, duplicate, delete: deleteSelection, undo, redo,
			zoomin: () => zoomStep(...viewCentre(), 1), zoomout: () => zoomStep(...viewCentre(), -1),
			pixel: () => zoomAt(...viewCentre(), Math.max(1, Math.round(renderer.cam.zoom))), frame: frameSelection,
			stay3d: () => toggleStay3d(),
			fit: () => { if (S.stay3d) toggleStay3d(false); renderer.fit(); $("zoomlabel").textContent = `${Math.round(renderer.cam.zoom * 100)}%`; dirty = true; },
		};
		acts.extrudeman = () => { if (S.edit && S.elemMode === "face") { S.armed = "extrude"; S.armedOpts = { manifold: true }; modalBar(); status("Press on the view, drag, and let go to extrude (manifold)."); } else status("Extrude manifold works on faces (3)."); };
		acts.fill = fillSelection; acts.bridge = bridgeSelection; acts.join = joinSelection; acts.knife = startKnife;
		acts.mirror = (e) => mirrorSelection(e && e.shiftKey ? "y" : "x");
		acts.hide = (e) => (e && e.shiftKey ? unhideAll() : hideModels("selected"));
		for (const b of document.querySelectorAll("[data-act]")) b.onclick = (e) => {
			e.stopPropagation();
			if ((pencil || S.tool === "stamp") && !["undo", "redo", "zoomin", "zoomout", "pixel", "fit", "frame"].includes(b.dataset.act)) setTool("select");
			if (pencil && pencil.pts.length && b.dataset.act === "undo") pencilBack();
			else acts[b.dataset.act](e);
			$("view").focus();
		};
		$("pencil_finish").onclick = () => { pencilFinish(); $("view").focus(); };
		$("pencil_clear").onclick = () => { clearPencil(); $("view").focus(); };
		$("pencil_back").onclick = () => { pencilBack(); $("view").focus(); };
		$("pencil_done").onclick = () => { setTool("select"); $("view").focus(); };
		$("pencil_mode").onchange = () => { clearPencil(); $("pencil_simplify").disabled = $("pencil_mode").value === "corners"; pencilHint(); };
		$("pencil_surface").onchange = () => { if (pencil) { pencil.surface = $("pencil_surface").checked && pencil.pts.length ? pencilPickSurface(...renderer.toScreen([pencil.pts[0][0], pencil.pts[0][1], 0])) : null; pencil.hoverSurface = null; pencil.error = false; dirty = true; pencilHint(); } };
		for (const id of ["pencil_plane", "pencil_thickness", "pencil_simplify", "pencil_snap"]) $(id).onchange = () => { if (pencil) { pencil.error = false; dirty = true; } };
		// « / » fold the palette and nav panels (remembered per browser).
		for (const b of document.querySelectorAll("[data-fold]")) {
			const panel = $(b.dataset.fold), key = "ts.fold." + b.dataset.fold, open = b.textContent;
			const set = (folded) => {
				panel.classList.toggle("folded", folded);
				b.textContent = folded ? (open === "«" ? "»" : "«") : open;
				try { localStorage.setItem(key, folded ? "1" : ""); } catch (err) { /* storage blocked: not remembered */ }
			};
			let stored = false;
			try { stored = localStorage.getItem(key) === "1"; } catch (err) { /* storage blocked */ }
			set(stored);
			b.onclick = (e) => { e.stopPropagation(); set(!panel.classList.contains("folded")); $("view").focus(); };
		}
		for (const ax of ["x", "y", "z"]) $("mb_" + ax).onclick = () => cycleAxis(ax);
		$("mb_value").oninput = () => { if (modal) { modal.numeric = $("mb_value").value; updateModal(); } };
		$("mb_value").onkeydown = (e) => { if (e.key === "Enter") { if (modal) confirmModal(); } else if (e.key === "Escape") cancelModal(); e.stopPropagation(); };
		$("mb_fine").onclick = () => { S.fine = !S.fine; modalBar(); if (modal) updateModal(); };
		$("mb_ok").onclick = () => { if (modal) confirmModal(); else if (knife) { knifeApply(); modalBar(); } };
		$("mb_cancel").onclick = () => { if (knife && !modal) { knife = null; dirty = true; modalBar(); hint(); } else cancelModal(); };
		renderer = new TS.Renderer($("view"));
		renderer.setArt(null, 256, 256);
		output = new TS.Output($("out"));
		exchange = new TS.TransferUI({ state: S, renderer: () => renderer, status, setTool, readFile, loadImage, download,
			changed: () => { dirty = true; }, frame: frameSelection, commit: commitModels });
		bindViewport($("view"));
		window.addEventListener("keydown", onKey);
		window.addEventListener("blur", () => { spaceDown = false; if (exchange?.draft) exchange.draft.pointer = null; if (pencil) { if (pencil.pointer !== null) clearPencil(); pointers.clear(); pinch = null; press = null; marquee(null); } });
		window.addEventListener("keyup", (e) => { if (e.key === " ") spaceDown = false; if (modal && (e.key === "Shift" || e.key === "Control")) updateModal(e); });
		window.addEventListener("resize", () => { dirty = true; if (S.result) output.render(); });
		$("f_tileset").onchange = (e) => e.target.files[0] && openTilesetFile(e.target.files[0]);
		$("f_project").onchange = async (e) => e.target.files[0] && openProject(await readFile(e.target.files[0], true));
		$("f_ref").onchange = async (e) => {
			for (const f of e.target.files) { try { await addReference(await readFile(f, true)); } catch (err) { alert(err.message); } }
			e.target.value = "";
		};
		$("b_addref").onclick = (e) => { e.stopPropagation(); $("refmenu").classList.toggle("open"); };
		document.addEventListener("click", () => $("refmenu").classList.remove("open"));
		$("ref_sample").onclick = () => addReference(JSON.stringify(TS.samples.basic)).catch((err) => alert(err.message));
		$("ref_file").onclick = () => $("f_ref").click();
		refPanel();
		$("b_tileset").onclick = () => $("f_tileset").click();
		$("b_project").onclick = () => $("f_project").click();
		$("b_save").onclick = saveProject;
		$("b_add").onclick = () => toggleAddMenu(!$("addmenu").classList.contains("open"));
		for (const b of document.querySelectorAll("#addmenu button")) b.onclick = () => { toggleAddMenu(false); addPrimitive(b.dataset.kind); };
		$("snap").onchange = () => { S.snap = parseFloat($("snap").value); status(`Snapping: ${snapText()} ([ / ] step it)`); };
		$("shade").onchange = () => { S.shade = $("shade").value; dirty = true; };
		$("opacity").oninput = () => { S.opacity = parseFloat($("opacity").value); dirty = true; };
		$("xray").onchange = () => { S.xray = $("xray").checked; dirty = true; };
		$("grid").onchange = () => { S.grid = $("grid").checked; dirty = true; };
		$("outfilter").oninput = () => panels();
		$("outfilter").onkeydown = (e) => { if (e.key === "Escape") { $("outfilter").value = ""; panels(); $("view").focus(); } e.stopPropagation(); };
		$("b_process").onclick = processNow;
		$("auto").onchange = () => { S.autoProcess = $("auto").checked; if (S.autoProcess) processNow(); };
		for (const b of document.querySelectorAll("[data-export]")) b.onclick = () => exportMaps(b.dataset.export);
		// Export name: cleaned to a safe file name as you leave the field; Enter exports the Godot bundle.
		$("exportname").onchange = () => {
			const v = cleanName($("exportname").value);
			$("exportname").value = v;
			if (v !== (S.exportName || "")) { S.exportName = v; markUnsaved(); status(v ? `Exports will be called ${v}` : `Exports will use the tileset's name (${S.name})`); }
		};
		$("exportname").onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") { $("exportname").onchange(); exportMaps("bundle"); } else if (e.key === "Escape") $("exportname").blur(); };
		$("b_help").onclick = toggleHelp;
		$("help").onclick = toggleHelp;
		for (const b of document.querySelectorAll("#outmodes button[data-mode]"))
			b.onclick = () => { output.mode = b.dataset.mode; document.querySelectorAll("#outmodes button[data-mode]").forEach((x) => x.classList.toggle("on", x === b)); pieceInfo(); syncModeTabs(); output.render(); };
		initModeTabs();
			$("lightz").oninput = () => { output.light.z = parseFloat($("lightz").value); $("lightz_v").textContent = output.light.z; output.render(); };
		$("lightr").oninput = () => { output.light.radius = parseFloat($("lightr").value); output.render(); };
		$("shadows").onchange = () => { output.shadows = $("shadows").checked; output.render(); };
		for (const [id, key, parse, lo, hi] of SETTING_IDS)
			$(id).onchange = () => {
				let v = parse($(id).value);
				if (!isNaN(v) && lo !== undefined) v = TS.clamp(v, lo, hi);
				if (!isNaN(v)) S.settings[key] = v; $(id).value = S.settings[key];
				markUnsaved(); processNow();
			};
		$("s_pack").onchange = () => { S.settings.packHighlights = $("s_pack").checked; processNow(); };
		const out = $("out");
		let lightDrag = false;
		// Output view: drag = move the light; middle/right drag or Space-drag = pan; wheel = zoom; Shift+wheel = light height.
		const outPos = (e) => { const r = out.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
		const moveLight = (e) => { if (!S.result) return; const p = output.toArt(...outPos(e)); output.light.x = p[0]; output.light.y = p[1]; output.render(); };
		let outPan = null;
		out.addEventListener("pointerdown", (e) => {
			try { out.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already-released pointer */ }
			if (e.button === 1 || e.button === 2 || spaceDown) { outPan = outPos(e); e.preventDefault(); return; }
			lightDrag = true; moveLight(e);
		});
		out.addEventListener("pointermove", (e) => {
			if (outPan) { const p = outPos(e); output.pan(p[0] - outPan[0], p[1] - outPan[1]); outPan = p; }
			else if (lightDrag) moveLight(e);
		});
		// Hover readout: what the maps hold at the pixel under the pointer (floor plan data in the Floor view).
		const probe = (e) => {
			const r = S.result;
			if (!r) return;
			const [ax, ay] = output.toArt(...outPos(e)), x = Math.floor(ax), y = Math.floor(ay);
			const rows = output.rows();
			if (output.mode === "collision") { output.feet = [ax, ay]; output.draw(); }
			if (x < 0 || y < 0 || x >= r.w || y >= rows) { $("probe").textContent = ""; return; }
			const i = y * r.w + x, f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
			if (output.mode === "collision") {
				const hit = output.feetHit(), c = r.collision, m = c.mask[i];
				const here = m & 2 ? `collision of ${S.objects[c.owner[i]].name}` : m & 4 ? "a strip model's strip (Godot builds it)" : m & 1 ? "blocked floor (the body pull-in leaves it open)" : r.floor.top[i] >= 0 ? "under / over the body: open" : "open floor";
				$("probe").textContent = `feet ${x}, ${y} · ` + (hit ? `BLOCKED by ${hit.mask & 2 ? S.objects[hit.owner].name : "a strip"}` : "free") + ` · here: ${here}`;
				return;
			}
			if (output.mode === "kind") {
				const oi = y < r.h && r.alpha[i] > S.settings.alphaCut && r.owner[i] >= 0 ? r.owner[i] : r.floor.top[i] >= 0 ? r.floor.owner[i] : -1, role = oi >= 0 ? r.roles[oi] : null;
				$("probe").textContent = `cell ${x >> 5}, ${y >> 5}` + (role ? ` · ${S.objects[oi].name}: ${role.kind}${role.kindOverridden ? " (set by you)" : " (inferred)"} · height ${role.heightMin}-${role.heightMax} px${role.flat ? " · flat" : ""} · collision ${role.requested === "auto" ? "auto → " : ""}${role.mode}` : " · empty");
				return;
			}
			if (output.mode === "pieces" && r.pieceMap) {
				const pm = r.pieceMap, cell = pm.cells.find((c) => c.cx === (x >> 5) && c.cy === (y >> 5)), nm = (ids) => ids.map((p) => pm.pieces[p].names.join(" + ")).join(", ");
				const own = r.owner[i] >= 0 && y < r.h ? S.objects[r.owner[i]] : null;
				$("probe").textContent = `cell ${x >> 5}, ${y >> 5}` + (own ? ` · pixel of ${own.name}` : "") + (!cell ? " · empty" :
					` · painted by: ${nm(cell.content) || "nothing"} · engine reads: ${nm(cell.engine) || "flat art"}` +
					(cell.anchored.length ? ` · anchor of ${nm(cell.anchored)}` : "") + (cell.status === 2 ? ` · CONFLICT: ${cell.msg}` : cell.status === 1 ? ` · FLOATING: ${cell.msg}` : " · ok"));
				return;
			}
			if (output.mode === "heightfield") {
				const f = r.floor, sp = f.spans[i];
				$("probe").textContent = f.top[i] < 0 ? `floor ${x}, ${y} · open floor` :
					`floor ${x}, ${y} · top ${f2(f.top[i])} px · bottom ${f2(f.bottom[i])} px` + (sp && sp.length > 2 ? ` · ${sp.length / 2} spans (gaps between parts)` : "");
				return;
			}
			const owner = r.owner[i] >= 0 ? S.objects[r.owner[i]] : null, has = !isNaN(r.height[i]);
			const state = r.hole[i] === 1 ? " · HOLE (no model)" : r.hole[i] === 2 ? " · filled from a neighbour" : r.alpha[i] <= S.settings.alphaCut ? " · no art here" : "";
			$("probe").textContent = `canvas ${x}, ${y}` + (has ? ` · height ${f2(r.height[i])} px · normal ${[0, 1, 2].map((k) => f2(r.normal[i * 3 + k])).join(", ")}` +
				` · rough ${f2(r.rough[i])} · metal ${f2(r.metal[i])}` : "") + (owner ? ` · ${owner.name}` : "") + state;
		};
		out.addEventListener("pointermove", (e) => { if (!outPan && !lightDrag) probe(e); });
		out.addEventListener("pointerleave", () => { $("probe").textContent = "Hover the output to read a pixel."; if (output.feet) { output.feet = null; output.draw(); } });
		out.addEventListener("dblclick", (e) => {
			const r = S.result;
			if (!r || output.floorPlan() || S.edit) return;
			const [ax, ay] = output.toArt(...outPos(e)), x = Math.floor(ax), y = Math.floor(ay);
			if (x < 0 || y < 0 || x >= r.w || y >= r.h) return;
			const o = S.objects[r.owner[y * r.w + x]];
			if (!o) return status("No model at that pixel.");
			S.selected = new Set([o.id]); S.active = o.id;
			changed(true); panels();
			status(`Selected ${o.name} (from the output view). F frames it.`);
		});
		const outUp = () => { lightDrag = false; outPan = null; };
		out.addEventListener("pointerup", outUp);
		out.addEventListener("pointercancel", outUp);
		out.addEventListener("contextmenu", (e) => e.preventDefault());
		out.addEventListener("wheel", (e) => {
			e.preventDefault();
			if (e.shiftKey) {
				const d = e.deltaY || e.deltaX; // Shift turns some wheels sideways
				output.light.z = TS.clamp(output.light.z + (d < 0 ? 4 : -4), 0, 255); $("lightz").value = output.light.z; $("lightz_v").textContent = output.light.z; output.render();
			} else output.zoomAt(...outPos(e), e.deltaY < 0 ? 1 : -1);
		}, { passive: false });
		const outCentre = () => [out.width / 2, out.height / 2];
		$("o_zoomin").onclick = () => output.zoomAt(...outCentre(), 1);
		$("o_zoomout").onclick = () => output.zoomAt(...outCentre(), -1);
		$("o_fit").onclick = () => output.fit();
		output.onzoom = (s) => { $("o_zoom").textContent = s ? `${Math.round(s * 100)}%` : ""; };
		// Drop a tileset or project anywhere.
		document.addEventListener("dragover", (e) => e.preventDefault());
		document.addEventListener("drop", async (e) => {
			e.preventDefault();
			const f = e.dataTransfer.files[0];
			if (!f) return;
			if (f.name.endsWith(".json")) openProject(await readFile(f, true)); else openTilesetFile(f);
		});
		for (const id of PREF_IDS) $(id).addEventListener("change", savePrefs);
		for (const b of document.querySelectorAll("#outmodes button[data-mode]")) b.addEventListener("click", savePrefs);
		loadPrefs();
		// The view settings follow their controls, whatever set them: our prefs, or the browser restoring a reloaded / back-
		// navigated page's form (that fires no events, so X-ray could show ticked while it was off).
		const syncControls = () => {
			{ const sv = parseFloat($("snap").value); S.snap = isNaN(sv) ? 1 : sv; } S.shade = $("shade").value; S.opacity = parseFloat($("opacity").value);
			S.xray = $("xray").checked; S.grid = $("grid").checked; S.autoProcess = $("auto").checked;
			output.light.z = parseFloat($("lightz").value); $("lightz_v").textContent = output.light.z;
			output.light.radius = parseFloat($("lightr").value); output.shadows = $("shadows").checked;
			dirty = true;
		};
		syncControls();
		window.addEventListener("pageshow", syncControls);
		window.addEventListener("load", syncControls);
		window.addEventListener("beforeunload", (e) => { if (unsaved && S.objects.length) { autosave(); e.preventDefault(); e.returnValue = ""; } });
		panels();
		hint();
		requestAnimationFrame(frame);
		offerRestore();
		const q = new URLSearchParams(location.search);
		if (q.get("tileset")) openTilesetURL(q.get("tileset")).catch((err) => status("Could not open " + q.get("tileset") + ": " + err));
		if (q.get("project")) fetch(q.get("project")).then((r) => r.text()).then(openProject).catch((err) => status("Could not open project: " + err));
	}

	function commitModels(models, verb) {
		if (!models.length) return;
		if (modal) cancelModal();
		pushUndo(); Mesh.bumpIds(S.objects);
		const copies = models.map(o => { const copy = Mesh.cloneNew(o); copy.hidden = false; return copy; });
		S.objects.push(...copies); S.selected = new Set(copies.map(o => o.id)); S.active = copies[copies.length - 1].id;
		S.edit = false; S.elemSel.clear(); hover = null; cycle = null;
		changed(); status(verb + " " + copies.length + " model(s). Ctrl+Z undoes the whole placement.");
	}

	// For scripted use and tests (window.TS.api).
	TS.api = {
		state: S, get renderer() { return renderer; }, get output() { return output; },
		setTool, pencilFinish, get pencil() { return pencil; }, get exchange() { return exchange; },
		addPrimitive, processNow, exportMaps, bundleJSON, addReference, removeReference, get refs() { return S.refs; }, exportName, undo, redo, openTilesetURL, openProject, projectJSON, changed,
		select: (id) => { S.selected = new Set([id]); S.active = id; changed(); },
		// Internals, for scripted checks.
		get modal() { return modal; }, get hover() { return hover; }, get anim() { return anim; }, get dirty() { return dirty; },
		// Draw now (a hidden tab gets no animation frames): for scripted captures.
		redraw: () => { dirty = false; renderer.draw(buildGeometry(), { backdrop: true, opacity: S.opacity, shade: S.shade, xray: S.xray, refs: S.refs.filter((r) => r.visible) }); drawAxes(); drawPencil(); if (exchange) exchange.drawPreview(); },
		get undoDepth() { return undoStack.length; }, get knife() { return knife; }, elemCandidates, objCandidates, toggleStay3d, frameSelection, savePrefs,
	};

	window.addEventListener("DOMContentLoaded", boot);
})();
