"use strict";
(function () {
	const $ = id => document.getElementById(id), T = TS.Transfer;
	class TransferUI {
		constructor(api) {
			this.api = api; this.source = null; this.selected = new Set(); this.draft = null;
			this.cam = { x: 0, y: 0, zoom: 1 }; this.drag = null; this.generation = 0; this.clipSel = new Set(); this.preview = null; this.previewT0 = 0; this.raf = 0;
			$("b_import3d").onclick = () => this.showSource();
			$("stamp_choose").onclick = () => this.showSource();
			$("source_load").onclick = () => $("f_source").click();
			$("f_source").onchange = async e => { // several files at once: the main file plus the .bin / textures a .gltf points at
				const picked = [...e.target.files]; e.target.value = ""; if (!picked.length) return;
				try {
					const main = picked.find(f => TS.Gltf.looksLikeGltf(f.name) || /.(fbx|obj|json)$/i.test(f.name)) || picked[0];
					if (main.size > 40 * 1024 * 1024) throw new Error("Use a source file smaller than 40 MB.");
					const binary = TS.Gltf.looksLikeGltf(main.name) || /.fbx$/i.test(main.name), files = {};
					for (const f of picked) if (f !== main) files[f.name] = await f.arrayBuffer();
					await this.loadSource(binary ? await main.arrayBuffer() : await api.readFile(main, true), main.name, files, true);
				} catch (err) { this.message(err.message, true); }
			};
			$("source_close").onclick = () => this.closeSource();
			$("source_dialog").addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Escape") this.closeSource(); });
			$("source_filter").oninput = () => this.list();
			$("source_all").onclick = () => { if (this.source) this.selected = new Set(this.source.objects.map((_, i) => i)); this.selectionChanged(); };
			$("source_none").onclick = () => { this.selected.clear(); this.selectionChanged(); };
			$("source_fit").onclick = () => this.fit();
			$("source_frame").onclick = () => this.fit(true);
			$("source_stamp").onclick = () => { if (!this.hasSelection()) return; this.closeSource(); this.api.setTool("stamp"); };
			$("source_add").onclick = () => this.addAtCursor();
			$("clips_all").onclick = () => { if (this.source?.rig) this.clipSel = new Set(this.source.rig.clips.map((_, i) => i)); this.clipList(); };
			$("clips_none").onclick = () => { this.clipSel.clear(); this.clipList(); };
			$("source_keep").onclick = () => this.addInPlace();
			$("source_units").addEventListener("input", () => { this.unitsSet = true; }); // typed by hand: kept for later files too
			for (const id of ["source_units", "source_up"]) $(id).onchange = () => { if (["obj", "gltf", "fbx"].includes(this.source?.kind)) this.loadSource(this.source.raw, this.source.name, this.source.files).catch(err => this.message(err.message, true)); };
			for (const id of ["stamp_scale", "stamp_base", "stamp_x", "stamp_y"]) $(id).oninput = () => this.controls();
			$("stamp_snap").onchange = () => this.api.changed();
			$("stamp_place").onclick = () => this.place();
			$("stamp_move").onclick = () => { if (this.draft) { this.draft.pinned = false; this.hint(); } };
			$("stamp_done").onclick = () => this.api.setTool("select");
			$("b_export3d").onclick = () => { $("obj_selected").checked = api.state.selected.size > 0; $("obj_export").classList.add("open"); $("obj_export_error").textContent = ""; };
			$("obj_close").onclick = () => $("obj_export").classList.remove("open");
			$("obj_export").addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Escape") $("obj_export").classList.remove("open"); });
			const format = () => { const glb = $("obj_format").value === "glb"; $("obj_up_row").hidden = glb; $("obj_rig_row").hidden = !glb; };
			$("obj_format").onchange = format; format();
			$("obj_download").onclick = () => {
				try { const objects = api.state.objects.filter(o => !$("obj_selected").checked || api.state.selected.has(o.id)), scale = Number($("obj_units").value), base = api.state.name || "models";
					if ($("obj_format").value === "glb") {
						const rig = $("obj_rig").checked && api.state.anim.bones.length > 0, buf = TS.Gltf.write(objects, api.state.anim, { scale, rig, allBones: !$("obj_selected").checked });
						api.download(base + ".glb", new Blob([buf], { type: "model/gltf-binary" }), "model/gltf-binary");
						api.status(`Exported ${objects.length} model(s) as glTF${rig ? ` with ${api.state.anim.bones.length} bone(s) and ${api.state.anim.clips.length} clip(s)` : ""}.`);
					} else {
						const text = T.writeOBJ(objects, { scale, up: $("obj_up").value });
						api.download(base + ".obj", text, "text/plain"); api.status(`Exported ${objects.length} model(s) as OBJ.`);
					}
					$("obj_export").classList.remove("open");
				} catch (err) { $("obj_export_error").textContent = err.message; }
			};
			this.bindSource();
			window.addEventListener("resize", () => { if ($("source_dialog").classList.contains("open")) this.drawSource(); });
		}
		message(text, error = false) { $("source_message").textContent = text; $("source_message").classList.toggle("bad", error); }
		async loadSource(raw, name, files = {}, fresh = false) {
			const token = ++this.generation; let objects, image = null, kind, warning = "", rig = null;
			if (fresh) this.autoScale = null;
			if (TS.Gltf.looksLikeGltf(name)) { kind = "gltf"; const images = await TS.Gltf.images(raw, files); if (token !== this.generation) return; const res = TS.Gltf.read(raw, { scale: Number($("source_units").value), files, images }); objects = T.validate(res.objects); rig = res.rig; }
				else if (/.fbx$/i.test(name)) { kind = "fbx"; objects = T.validate(TS.Fbx.read(raw, { scale: Number($("source_units").value), up: $("source_up").value }).objects); }
			else if (/\.obj$/i.test(name)) { // its .mtl (picked with it) gives the faces their base colours
				kind = "obj"; const mtlName = Object.keys(files).find(n => /\.mtl$/i.test(n));
				objects = T.readOBJ(raw, { scale: Number($("source_units").value), up: $("source_up").value, mtl: mtlName ? T.readMTL(new TextDecoder().decode(files[mtlName])) : null });
			}
			else {
				const p = JSON.parse(raw); if (p.format !== "tileset-studio") throw new Error("Choose a glTF .glb, a Tileset Studio .studio.json project or a Wavefront .obj mesh.");
				kind = "studio"; objects = T.validate(p.objects);
				if (typeof p.tileset === "string" && /^data:image\/(png|jpeg|webp);base64,/i.test(p.tileset)) {
					try { image = await this.api.loadImage(p.tileset); } catch (err) { warning = " The source image could not load; wire selection is available."; }
				}
			}
			if (token !== this.generation) return;
			// A model file's units are rarely pixels (Blender writes metres): a new one is sized to stand about two tiles tall, unless a
			// scale was typed by hand. The size picked shows in the box and in the message, to change.
			if (fresh && !this.unitsSet && kind !== "studio") {
				const s = Number($("source_units").value) || 1;
				const ext = (k) => { let lo = Infinity, hi = -Infinity; for (const o of objects) for (const p of o.verts) { if (p[k] < lo) lo = p[k]; if (p[k] > hi) hi = p[k]; } return hi - lo; };
				const size = Math.max(ext(0), ext(1), ext(2));
				if (size > 0) {
					const want = s * 64 / size, mag = Math.pow(10, Math.floor(Math.log10(want))), nice = Math.round(want / mag * 10) / 10 * mag;
					if (Math.abs(nice - s) / s > 0.01) { $("source_units").value = +nice.toPrecision(2); this.autoScale = +nice.toPrecision(2); return this.loadSource(raw, name, files); }
				}
			}
			// A project's own canvas is drawn in the projection it was made in; a mesh file has none (oblique).
			const proj = kind === "studio" ? TS.Proj.of(JSON.parse(raw).settings, image && { w: image.width }) : TS.Proj.OBLIQUE;
			this.source = { name, raw, kind, objects, image, rig, proj, files }; this.selected.clear();
			this.clipSel = new Set(rig ? rig.clips.map((_, i) => i) : []); // every animation comes along unless unticked
			if (kind === "obj" || kind === "gltf" || kind === "fbx") objects.forEach((o, i) => this.selected.add(i));
			this.end(); this.api.setTool("select");
			$("source_filter").value = ""; $("source_name").textContent = name; this.preview = null; this.setPreview(rig && rig.clips.length ? T.bestClip(rig.clips) : null);
			$("source_obj_options").hidden = kind === "studio"; $("source_up_wrap").hidden = kind === "gltf";
			const used = rig && T.rigFor(rig, objects.map(o => o.id)); // a file can carry armatures nothing is skinned to
			const rigText = rig ? ` with ${used ? used.bones.length : 0} bone(s)${rig.clips.length ? ` and ${rig.clips.length} clip(s)` : ""}` : "";
			this.message(`${objects.length} model(s)${rigText}. ${this.autoScale ? `Sized to about 64 px tall (${this.autoScale} pixels per unit); change it above if you need. ` : ""}${kind === "gltf" ? "Add at cursor brings the bones, weights and the ticked animations along (a stamp places the models only)." : kind === "obj" ? "OBJ imports mesh geometry only. Check scale and up axis." : kind === "fbx" ? "FBX imports mesh geometry in its bind pose (no bones or animation yet). Check the scale (pixels per unit; FBX files are often in centimetres) and the up axis." : "Box-select all the parts you want, or use the checkboxes."}${warning}`);
			this.selectionChanged(); this.fit();
		}
		// The file's animations, each with a tick: only ticked ones are added (the one with the most motion is shown first).
		clipList() {
			const rig = this.source && this.source.rig, box = $("source_clips"), list = $("source_cliplist"); list.replaceChildren();
			box.hidden = !(rig && rig.clips.length); if (box.hidden) return;
			rig.clips.forEach((c, i) => {
				const row = document.createElement("label"), check = document.createElement("input"), play = document.createElement("button"), name = document.createElement("span"), info = document.createElement("small");
				check.type = "checkbox"; check.checked = this.clipSel.has(i); check.onchange = () => { check.checked ? this.clipSel.add(i) : this.clipSel.delete(i); };
				play.type = "button"; play.className = "clipplay"; play.textContent = this.preview === i ? "■" : "▶"; play.title = this.preview === i ? "Stop the preview" : "Preview this animation on the models";
				play.onclick = (e) => { e.preventDefault(); this.setPreview(this.preview === i ? null : i); };
				name.textContent = c.name; info.textContent = `${c.frames} frame(s) @ ${c.fps} fps · ${Object.keys(c.tracks).length} bone(s)`;
				row.classList.toggle("sel", this.preview === i); row.title = c.name; row.append(check, play, name, info); list.appendChild(row);
			});
		}
		// The models as the previewed animation poses them (at rest when nothing plays).
		shown() {
			const s = this.source, clip = s && s.rig && this.preview !== null ? s.rig.clips[this.preview] : null;
			if (!clip) return s ? s.objects : [];
			const f = TS.Rig.playFrame(clip, 0, Math.floor((performance.now() - this.previewT0) / 1000 * clip.fps)).f;
			return TS.Rig.posedObjects(s.objects, s.rig, clip, f);
		}
		setPreview(i) {
			this.preview = i; this.previewT0 = performance.now(); cancelAnimationFrame(this.raf); this.raf = 0;
			const tick = () => { if (this.preview === null || !this.source || !$("source_dialog").classList.contains("open")) { this.raf = 0; return; } this.drawSource(); this.raf = requestAnimationFrame(tick); };
			if (i !== null) this.raf = requestAnimationFrame(tick);
			this.clipList(); this.drawSource();
		}
		showSource() { $("source_dialog").classList.add("open"); this.list(); this.fit(); if (this.preview !== null) this.setPreview(this.preview); $("source_load").focus(); }
		closeSource() { this.drag = null; cancelAnimationFrame(this.raf); this.raf = 0; $("source_dialog").classList.remove("open"); $("view").focus(); }
		hasSelection() { return !!this.source && this.selected.size > 0; }
		objects() { return this.source ? this.source.objects.filter((_, i) => this.selected.has(i)) : []; }
		selectionChanged() { this.list(); this.drawSource(); }
		list() {
			const list = $("source_list"), scroll = list.scrollTop, filter = $("source_filter").value.toLowerCase(); list.replaceChildren();
			if (this.source) this.source.objects.forEach((o, i) => {
				if (!o.name.toLowerCase().includes(filter)) return;
				const row = document.createElement("label"), check = document.createElement("input"), label = document.createElement("span");
				check.type = "checkbox"; check.checked = this.selected.has(i); check.dataset.index = i;
				label.textContent = o.name; row.title = `${o.name} (${o.verts.length} vertices)`;
				check.onchange = () => { check.checked ? this.selected.add(i) : this.selected.delete(i); this.selectionChanged(); };
				row.append(check, label); row.classList.toggle("sel", check.checked); list.appendChild(row);
			});
			list.scrollTop = scroll; $("source_count").textContent = `${this.selected.size} part(s) selected`;
			for (const id of ["source_stamp", "source_add", "source_keep", "source_frame"]) $(id).disabled = !this.hasSelection();
		}
		fit(selection = false) {
			if (!this.source) { this.drawSource(); return; }
			const objects = selection ? this.objects() : this.source.objects; if (!objects.length) return;
			const b = T.bounds(objects, this.source.proj), img = this.source.image;
			if (!selection && img) { b.x0 = Math.min(0, b.x0); b.y0 = Math.min(0, b.y0); b.x1 = Math.max(img.width, b.x1); b.y1 = Math.max(img.height, b.y1); }
			const r = $("source_view").getBoundingClientRect();
			this.cam = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, zoom: Math.max(.01, Math.min((r.width - 30) / Math.max(1, b.x1 - b.x0), (r.height - 30) / Math.max(1, b.y1 - b.y0))) };
			this.drawSource();
		}
		point(e) { const r = $("source_view").getBoundingClientRect(); return [(e.clientX - r.left - r.width / 2) / this.cam.zoom + this.cam.x, (e.clientY - r.top - r.height / 2) / this.cam.zoom + this.cam.y]; }
		drawSource() {
			const c = $("source_view"), r = c.getBoundingClientRect(); if (!r.width || !r.height) return;
			const dpr = window.devicePixelRatio || 1; c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
			const g = c.getContext("2d"), z = this.cam.zoom; g.scale(dpr, dpr); g.fillStyle = "#171b24"; g.fillRect(0, 0, r.width, r.height);
			g.translate(r.width / 2 - this.cam.x * z, r.height / 2 - this.cam.y * z); g.scale(z, z); g.imageSmoothingEnabled = false;
			if (!this.source) return;
			if (this.source.image) g.drawImage(this.source.image, 0, 0);
			this.shown().forEach((o, i) => this.drawMesh(g, o, this.selected.has(i) ? "#ffbd68" : "#6ddccc88", z, this.selected.has(i), this.source.proj));
			if (this.drag && !this.drag.pan) { const a = this.drag.start, b = this.drag.end; g.strokeStyle = "#fff"; g.lineWidth = 1 / z; g.setLineDash([4 / z, 3 / z]); g.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); }
		}
		drawMesh(g, o, color, z, fill, proj) {
			g.strokeStyle = color; g.fillStyle = "#ffb45d15"; g.lineWidth = 1 / z;
			const path = indices => { g.beginPath(); indices.forEach((i, n) => { const p = proj.toCanvas(o.verts[i]); n ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }); };
			for (const f of o.faces) { path(f.v); g.closePath(); if (fill) g.fill(); g.stroke(); }
			for (const l of o.lines || []) { path(l); g.stroke(); }
			if (!o.faces.length && !(o.lines || []).length) for (const v of o.verts) { const p = proj.toCanvas(v); g.fillStyle = color; g.fillRect(p[0] - 2 / z, p[1] - 2 / z, 4 / z, 4 / z); }
		}
		bindSource() {
			const c = $("source_view"); c.oncontextmenu = e => e.preventDefault();
			c.onpointerdown = e => { if (!this.source) return; c.setPointerCapture(e.pointerId); const p = this.point(e); this.drag = { id: e.pointerId, start: p, end: p, pan: e.button !== 0 || e.altKey, add: e.shiftKey, last: [e.clientX, e.clientY], distance: 0 }; };
			c.onpointermove = e => {
				if (!this.drag || this.drag.id !== e.pointerId) return; const d = this.drag;
				d.distance += Math.hypot(e.clientX - d.last[0], e.clientY - d.last[1]);
				if (d.pan) { this.cam.x -= (e.clientX - d.last[0]) / this.cam.zoom; this.cam.y -= (e.clientY - d.last[1]) / this.cam.zoom; }
				d.last = [e.clientX, e.clientY]; d.end = this.point(e); this.drawSource();
			};
			c.onpointerup = e => {
				const d = this.drag; this.drag = null; if (!d || d.id !== e.pointerId || d.pan) return;
				if (!d.add) this.selected.clear();
				if (d.distance > 5) {
					const x0 = Math.min(d.start[0], d.end[0]), x1 = Math.max(d.start[0], d.end[0]), y0 = Math.min(d.start[1], d.end[1]), y1 = Math.max(d.start[1], d.end[1]);
					this.source.objects.forEach((o, i) => { const b = T.bounds([o], this.source.proj); if (b.x0 >= x0 && b.x1 <= x1 && b.y0 >= y0 && b.y1 <= y1) this.selected.add(i); });
				} else {
					const p = this.point(e); let best = -1, depth = -Infinity;
					this.source.objects.forEach((o, i) => {
						const sp = this.source.proj, far = sp.toWorld(p[0], p[1], 0).map((v, k) => v + sp.dir[k] * 1e7), back = sp.dir.map(v => -v);
						for (const tri of TS.Mesh.triangles(o)) {
							const hit = TS.Renderer.rayTri(far, back, o.verts[tri.a], o.verts[tri.b], o.verts[tri.c]);
							if (hit !== null && -hit > depth) { depth = -hit; best = i; }
						}
						if (!o.faces.length && o.verts.some(v => { const c = sp.toCanvas(v); return Math.hypot(c[0] - p[0], c[1] - p[1]) * this.cam.zoom < 6; })) best = i;
					});
					if (best >= 0) { d.add && this.selected.has(best) ? this.selected.delete(best) : this.selected.add(best); }
				}
				this.selectionChanged();
			};
			c.onpointercancel = () => { this.drag = null; this.drawSource(); };
			c.addEventListener("wheel", e => { e.preventDefault(); const p = this.point(e); this.cam.zoom = TS.clamp(this.cam.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), .01, 64); const q = this.point(e); this.cam.x += p[0] - q[0]; this.cam.y += p[1] - q[1]; this.drawSource(); }, { passive: false });
		}
		addAtCursor() {
			if (!this.hasSelection()) return;
			const proj = this.api.renderer().proj, objects = this.objects(), b = T.bounds(objects, proj), p = this.api.state.cursor, cc = proj.toCanvas(p);
			const x = cc[0] - (b.x1 - b.x0) / 2, y = cc[1] - (b.y1 - b.y0), moved = T.place(objects, x, y, 1, p[2], proj);
			this.api.commit(moved, "Imported", T.rigFor(this.source.rig, objects.map(o => o.id), T.placeMap(objects, x, y, 1, p[2], proj), this.clipSel)); this.closeSource(); this.api.frame();
		}
		addInPlace() { if (!this.hasSelection()) return; const objects = this.objects(); this.api.commit(objects, "Imported", T.rigFor(this.source.rig, objects.map(o => o.id), null, this.clipSel)); this.closeSource(); this.api.frame(); }
		begin() {
			const objects = this.objects(), b = T.bounds(objects, this.api.renderer().proj), cam = this.api.renderer().cam;
			// Starts at its own height, but never under the floor (a mesh file's model is often centred on its origin).
			this.draft = { objects, x: cam.x - (b.x1 - b.x0) / 2, y: cam.y - (b.y1 - b.y0) / 2, scale: 1, base: Math.max(0, b.z0), pinned: false, pointer: null, valid: true };
			$("stamp_name").textContent = `${objects.length} part(s) from ${this.source.name}`;
			this.syncControls(); this.hint();
		}
		end() { this.draft = null; }
		hint() {
			if (!this.draft) return;
			const msg = this.draft.pinned ? "Preview pinned. Adjust size / height, then Place stamp or Enter. Drag to reposition." : "Move over your image to preview. Click to pin, then Place stamp or Enter.";
			$("stamp_help").textContent = msg; this.api.status("Stamp: " + msg + " Esc cancels; Space-drag pans.");
		}
		syncControls() { const d = this.draft; if (!d) return; for (const [id, v] of [["stamp_x", d.x], ["stamp_y", d.y], ["stamp_scale", d.scale * 100], ["stamp_base", d.base]]) $(id).value = Math.round(v * 1000) / 1000; }
		controls() {
			if (!this.draft) return; const d = this.draft;
			d.x = Number($("stamp_x").value); d.y = Number($("stamp_y").value); d.scale = Number($("stamp_scale").value) / 100; d.base = Number($("stamp_base").value);
			d.pinned = true; this.api.changed(); this.hint();
		}
		move(point, down = false) {
			const d = this.draft; if (!d || (d.pinned && !down && d.pointer === null)) return;
			const b = T.bounds(d.objects, this.api.renderer().proj), step = $("stamp_snap").checked ? this.api.state.snap : 1;
			d.x = TS.snap(point[0] - (b.x1 - b.x0) * d.scale / 2, step); d.y = TS.snap(point[1] - (b.y1 - b.y0) * d.scale / 2, step);
			if (down) d.pinned = true; this.syncControls(); this.api.changed(); if (down) this.hint();
		}
		preview() { const d = this.draft; if (!d) return []; return T.place(d.objects, d.x, d.y, d.scale, d.base, this.api.renderer().proj); }
		place() {
			if (!this.draft) return;
			try {
				const objects = this.preview(); this.api.commit(objects, "Stamped");
				if ($("stamp_repeat").checked) { this.draft.pinned = false; this.draft.pointer = null; this.hint(); } else this.api.setTool("select");
			} catch (err) { $("stamp_help").textContent = err.message; this.api.status(err.message); }
		}
		drawPreview() {
			// Without a stamp in progress, only clear what the last preview left (resizing reallocates the canvas every frame).
			if (!this.draft && !this.drawn) return;
			const c = $("stamp_overlay"), r = $("view").getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
			c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr));
			this.drawn = !!this.draft; if (!this.draft) return;
			const d = this.draft; let objects;
			try { objects = this.preview(); d.valid = true; } catch (err) { d.valid = false; $("stamp_help").textContent = err.message; $("stamp_place").disabled = true; return; }
			$("stamp_place").disabled = false;
			const g = c.getContext("2d"), cam = this.api.renderer().cam, z = cam.zoom;
			g.scale(dpr, dpr); g.translate(r.width / 2 - cam.x * z, r.height / 2 - cam.y * z); g.scale(z, z);
			for (const o of objects) this.drawMesh(g, o, "#ffc578", z, true, this.api.renderer().proj);
			const b = T.bounds(objects, this.api.renderer().proj); g.strokeStyle = "#6ddccc"; g.lineWidth = 1 / z; g.setLineDash([5 / z, 4 / z]); g.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
		}
	}
	TS.TransferUI = TransferUI;
})();
