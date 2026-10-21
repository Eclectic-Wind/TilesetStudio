// Animation mode: the Rig & animation panel, the timeline, bones drawn over the model view (drag a bone's tip to turn it), the lit
// preview of the spritesheet, and the Aseprite link. The data and maths are in rig.js; the folder link is in aseprite.js.
"use strict";
(() => {
	const $ = (id) => document.getElementById(id);
	const Rig = TS.Rig, Link = TS.Link, v3 = TS.v3;
	const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
	const round = (v) => Math.round(v * 100) / 100;
	let on = false, boneSel = null, playing = 0, sheet = null, albedo = null, albedoURL = null, renderTimer = 0, linkState = ["off", "Not linked."], light = [0.3, 0.4];
	const S = () => TS.state, A = () => TS.state.anim, api = () => TS.api;
	const clip = () => Rig.clipOf(A());
	const cell = () => (S().art ? { w: S().art.w, h: S().art.h } : { w: 64, h: 64 });

	// An undoable change to the animation data.
	function edit(fn) {
		const before = api().snapshot();
		fn();
		api().pushUndo(before);
		touched();
	}
	function touched() { api().markUnsaved(); api().redrawSoon(); render(); scheduleSheet(); }

	function ensureClip() {
		const a = A();
		if (!a.clips.length) { const c = Rig.newClip("Clip 1", 8, 8); a.clips.push(c); a.clip = c.id; }
		if (!Rig.clipOf(a)) a.clip = a.clips[0].id;
		a.frame = TS.clamp(a.frame | 0, 0, Rig.clipOf(a).frames - 1);
	}

	// --- the sheet: normals rendered for every frame, shown lit, and sent to Aseprite ---

	function scheduleSheet() { clearTimeout(renderTimer); renderTimer = setTimeout(renderSheet, 450); }
	function renderSheet() {
		if (!on || !S().art || !clip() || !S().objects.length) { sheet = null; drawPreview(); return; }
		const c = cell();
		try { sheet = Rig.normalSheet(S().objects, A(), clip(), c.w, c.h, S().settings); } catch (e) { sheet = null; setLink("warn", "Could not render the frames: " + e.message); }
		if (sheet) {
			Link.expected = { w: sheet.layout.w, h: sheet.layout.h };
			if (Link.linked()) Link.push(sheet.sheet, sheet.layout).catch((e) => setLink("warn", "Could not write to the folder: " + e.message));
		}
		drawPreview();
		const info = $("an_sheetinfo");
		if (info) info.textContent = sheetText();
	}
	function sheetText() {
		if (!clip()) return "";
		const c = cell(), lay = Rig.layout(c.w, c.h, clip().frames), pow = Rig.isPow2(lay.w) && Rig.isPow2(lay.h);
		return `${clip().frames} frames, ${lay.cols}x${lay.rows} cells of ${c.w}x${c.h} = a ${lay.w}x${lay.h} sheet${pow ? "" : " (not a power of two: use a power-of-two tileset so Aseprite will accept it)"}`;
	}

	function drawPreview() {
		const cv = $("an_prev");
		if (!cv) return;
		const c = cell(), g = cv.getContext("2d");
		cv.width = c.w; cv.height = c.h;
		g.clearRect(0, 0, c.w, c.h);
		if (!sheet) return;
		const lay = sheet.layout, [ox, oy] = Rig.cellOrigin(lay, A().frame), out = g.createImageData(c.w, c.h);
		const L = v3.norm([light[0] * 2, light[1] * 2, 0.7]);
		for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
			const si = ((oy + y) * lay.w + ox + x) * 4, di = (y * c.w + x) * 4, d = sheet.sheet.data;
			if (!d[si + 3]) continue;
			const n = v3.norm([d[si] / 127.5 - 1, d[si + 1] / 127.5 - 1, d[si + 2] / 127.5 - 1]), lit = 0.25 + 0.75 * Math.max(0, v3.dot(n, L));
			let r = 150, gr = 150, b = 150, a = 255;
			if (albedo && albedo.width === lay.w && albedo.height === lay.h) { r = albedo.data[si]; gr = albedo.data[si + 1]; b = albedo.data[si + 2]; a = albedo.data[si + 3] || 40; }
			out.data.set([r * lit, gr * lit, b * lit, a], di);
		}
		g.putImageData(out, 0, 0);
	}

	// --- the Aseprite link ---

	function setLink(state, text) {
		linkState = [state, text];
		const el = $("an_linkstate");
		if (el) { el.textContent = text; el.className = "linkstate " + state; }
		const bar = $("an_linkdot");
		if (bar) bar.className = "dot " + state;
	}
	Link.onStatus = setLink;
	Link.onAlbedo = (img) => { acceptAlbedo(img); };
	function acceptAlbedo(img) {
		albedo = img;
		const c = document.createElement("canvas");
		c.width = img.width; c.height = img.height;
		c.getContext("2d").putImageData(img, 0, 0);
		A().albedo = albedoURL = c.toDataURL("image/png");
		api().markUnsaved();
		drawPreview();
	}
	async function loadAlbedoURL() {
		if (A().albedo === albedoURL) return;
		albedoURL = A().albedo;
		albedo = null;
		if (!albedoURL) return drawPreview();
		const img = new Image();
		img.onload = () => {
			const c = document.createElement("canvas");
			c.width = img.width; c.height = img.height;
			const g = c.getContext("2d");
			g.drawImage(img, 0, 0);
			albedo = g.getImageData(0, 0, c.width, c.height);
			drawPreview();
		};
		img.src = albedoURL;
	}
	function downloadSheet() {
		if (!sheet) return api().toast("Add models and bones first; there is nothing to render yet.", "bad");
		const c = document.createElement("canvas");
		c.width = sheet.sheet.width; c.height = sheet.sheet.height;
		c.getContext("2d").putImageData(sheet.sheet, 0, 0);
		c.toBlob((b) => {
			const a = document.createElement("a");
			a.href = URL.createObjectURL(b); a.download = `${api().exportName()}_${clip().name.replace(/\W+/g, "_")}_normal.png`;
			document.body.append(a); a.click(); a.remove();
			setTimeout(() => URL.revokeObjectURL(a.href), 2000);
		}, "image/png");
	}
	function loadAlbedoFile() {
		const inp = document.createElement("input");
		inp.type = "file"; inp.accept = "image/png";
		inp.onchange = async () => {
			if (!inp.files[0]) return;
			const bmp = await createImageBitmap(inp.files[0]);
			const problem = Link.check(bmp.width, bmp.height, sheet ? { w: sheet.layout.w, h: sheet.layout.h } : null);
			if (problem) { api().toast(problem, "bad"); return setLink("warn", problem); }
			const c = document.createElement("canvas");
			c.width = bmp.width; c.height = bmp.height;
			const g = c.getContext("2d");
			g.drawImage(bmp, 0, 0);
			acceptAlbedo(g.getImageData(0, 0, c.width, c.height));
		};
		inp.click();
	}

	// --- the panel ---

	const numField = (id, v, step) => `<input id="${id}" type="number" step="${step || 1}" value="${round(v)}">`;
	const vecRow = (label, key, v, step) => `<div class="vrow"><span>${label}</span>${[0, 1, 2].map((i) => numField(`${key}${i}`, v[i], step)).join("")}</div>`;

	function render() {
		const body = $("an_body");
		if (!body || !on) return;
		ensureClip();
		const a = A(), c = clip(), bone = boneSel && Rig.bone(a, boneSel);
		if (boneSel && !bone) boneSel = null;
		const depth = (b) => { let d = 0; for (let p = b.parent && Rig.bone(a, b.parent); p && d < 50; p = p.parent && Rig.bone(a, p.parent)) d++; return d; };
		const bound = (id) => S().objects.filter((o) => a.bind[o.id] === id).length;
		let h = `<div class="arow"><select id="an_clip" title="Animation clip">${a.clips.map((x) => `<option value="${x.id}"${x.id === a.clip ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
			<button id="an_clipnew" title="New clip">＋</button><button id="an_clipdel" title="Delete this clip"${a.clips.length < 2 ? " disabled" : ""}>✕</button></div>
			<div class="arow"><label>Name <input id="an_clipname" type="text" value="${esc(c.name)}"></label></div>
			<div class="arow"><label title="Frames in this clip. Each is one cell of the spritesheet.">Frames <input id="an_frames" type="number" min="1" max="64" value="${c.frames}"></label>
			<label title="Playback speed in the preview">FPS <input id="an_fps" type="number" min="1" max="60" value="${c.fps}"></label></div>
			<h4>Bones</h4><ul id="an_bones" class="bonelist">${a.bones.length ? Rig.ordered(a).map((b) => `<li data-id="${b.id}" class="${b.id === boneSel ? "on" : ""}" style="padding-left:${6 + depth(b) * 12}px">${esc(b.name)}<span class="dim"> ${bound(b.id) ? `· ${bound(b.id)} model${bound(b.id) > 1 ? "s" : ""}` : ""}</span></li>`).join("") : '<li class="dim">No bones yet.</li>'}</ul>
			<div class="arow"><button id="an_boneadd" title="A bone at the 3D cursor, 24 px tall. With a bone selected, the new one starts at its tip and is its child.">＋ Bone</button>
			<button id="an_bonemodel" title="One bone per selected model, from the bottom of the model to its top, bound to it">Bone per model</button>
			<button id="an_bonedel" title="Delete the selected bone (its children move up)"${bone ? "" : " disabled"}>✕</button></div>`;
		if (bone) {
			const pose = Rig.localPose(c, bone.id, a.frame), key = Rig.keyAt(c, bone.id, a.frame);
			h += `<div class="boneprops"><label>Name <input id="an_bname" type="text" value="${esc(bone.name)}"></label>
				<label>Parent <select id="an_bparent"><option value="">(none)</option>${Rig.ordered(a).filter((b) => b.id !== bone.id && !Rig.wouldLoop(a, bone, b.id)).map((b) => `<option value="${b.id}"${b.id === bone.parent ? " selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>
				${vecRow("Head", "an_h", bone.head)}${vecRow("Tip", "an_t", bone.tail)}
				<div class="arow"><button id="an_bind" title="Make the selected models follow this bone">Bind selected models</button><button id="an_unbind" title="Let the selected models stand still">Unbind</button></div></div>
				<h4>Pose · frame ${a.frame + 1}${key ? ' <span class="keyflag">◆ key</span>' : ""}</h4><div class="poseprops">
				${["X", "Y", "Z"].map((n, i) => `<div class="vrow"><span class="ax-${n.toLowerCase()}" title="Turn about ${n}">Turn ${n}</span><input id="an_rr${i}" type="range" min="-180" max="180" step="1" value="${round(pose.rot[i])}">${numField("an_r" + i, pose.rot[i])}</div>`).join("")}
				${vecRow("Move", "an_p", pose.pos)}
				<div class="arow"><button id="an_keydel" title="Remove this frame's key"${key ? "" : " disabled"}>Remove key</button><button id="an_keyrest" title="Back to the rest pose on this frame (keeps a key)">Rest here</button></div>
				<p class="dim">Changing a value keys it on this frame. Or drag the bone's tip in the view (turns about the depth axis).</p></div>`;
		}
		h += `<h4>Spritesheet &amp; Aseprite</h4><canvas id="an_prev" class="prev" title="This frame, lit by the normal map and your Albedo. Move the pointer over it to move the light."></canvas>
			<p id="an_sheetinfo" class="dim">${sheetText()}</p>
			<div class="arow"><button id="an_link" title="Pick the folder the Aseprite extension saves into. Studio writes normal.png there and reads albedo.png from it.">${Link.linked() ? "Re-link folder…" : "Link Aseprite folder…"}</button>${Link.linked() ? '<button id="an_unlink">Unlink</button>' : ""}</div>
			<p class="linkline"><span id="an_linkdot" class="dot ${linkState[0]}"></span><span id="an_linkstate" class="linkstate ${linkState[0]}">${esc(linkState[1])}</span></p>
			${Link.supported ? "" : '<p class="dim">This browser can\'t watch a folder; use the buttons below (Chrome or Edge can link live).</p>'}
			<div class="arow"><button id="an_dl" title="Download the normal-map sheet as a PNG to put in Aseprite">Download normal sheet</button><button id="an_ld" title="Load a flattened Albedo sheet PNG from Aseprite (must match the sheet size)">Load albedo sheet…</button></div>`;
		body.innerHTML = h;
		wire();
		drawPreview();
		timeline();
	}

	function wire() {
		const q = (id) => $(id), a = A(), c = clip(), bone = boneSel && Rig.bone(a, boneSel);
		q("an_clip").onchange = () => { a.clip = q("an_clip").value; a.frame = 0; touched(); };
		q("an_clipnew").onclick = () => edit(() => { const n = Rig.newClip("Clip " + (a.clips.length + 1), c.frames, c.fps); a.clips.push(n); a.clip = n.id; a.frame = 0; });
		q("an_clipdel").onclick = () => edit(() => { a.clips = a.clips.filter((x) => x !== c); a.clip = a.clips[0].id; a.frame = 0; });
		q("an_clipname").onchange = () => edit(() => { c.name = q("an_clipname").value.trim() || c.name; });
		q("an_frames").onchange = () => edit(() => { c.frames = TS.clamp(parseInt(q("an_frames").value, 10) || c.frames, 1, 64); a.frame = Math.min(a.frame, c.frames - 1); });
		q("an_fps").onchange = () => edit(() => { c.fps = TS.clamp(parseInt(q("an_fps").value, 10) || c.fps, 1, 60); });
		for (const li of document.querySelectorAll("#an_bones li[data-id]")) li.onclick = () => { boneSel = li.dataset.id; api().redrawSoon(); render(); };
		q("an_boneadd").onclick = () => edit(() => {
			const parent = bone, head = parent ? parent.tail.slice() : S().cursor.slice();
			const b = Rig.newBone("Bone " + (a.bones.length + 1), head, [head[0], head[1], head[2] + 24], parent && parent.id);
			a.bones.push(b); boneSel = b.id;
		});
		q("an_bonemodel").onclick = () => {
			const objs = [...S().selected].map((id) => S().objects.find((o) => o.id === id)).filter(Boolean);
			if (!objs.length) return api().toast("Select the models first.", "bad");
			edit(() => {
				for (const o of objs) {
					const xs = o.verts.map((p) => p[0]), ys = o.verts.map((p) => p[1]), zs = o.verts.map((p) => p[2]);
					const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2, z0 = Math.min(...zs), z1 = Math.max(...zs);
					const b = Rig.newBone(o.name, [mx, my, z0], [mx, my, Math.max(z1, z0 + 8)]);
					a.bones.push(b); a.bind[o.id] = b.id; boneSel = b.id;
				}
			});
		};
		q("an_bonedel").onclick = () => bone && edit(() => {
			a.bones = a.bones.filter((b) => b !== bone);
			for (const b of a.bones) if (b.parent === bone.id) b.parent = bone.parent;
			for (const k of Object.keys(a.bind)) if (a.bind[k] === bone.id) delete a.bind[k];
			for (const cl of a.clips) delete cl.tracks[bone.id];
			boneSel = null;
		});
		if (bone) {
			q("an_bname").onchange = () => edit(() => { bone.name = q("an_bname").value.trim() || bone.name; });
			q("an_bparent").onchange = () => edit(() => { bone.parent = q("an_bparent").value || null; });
			for (const [key, prop] of [["an_h", "head"], ["an_t", "tail"]]) for (let i = 0; i < 3; i++)
				q(key + i).onchange = () => { const v = parseFloat(q(key + i).value); if (!isNaN(v)) edit(() => { bone[prop][i] = v; }); };
			const objs = () => [...S().selected];
			q("an_bind").onclick = () => objs().length ? edit(() => { for (const id of objs()) a.bind[id] = bone.id; }) : api().toast("Select the models first.", "bad");
			q("an_unbind").onclick = () => edit(() => { for (const id of objs()) delete a.bind[id]; });
			// Pose fields: apply live while dragging, one undo step per gesture.
			let before = null;
			const live = () => {
				const pose = Rig.localPose(c, bone.id, a.frame);
				const rot = [0, 1, 2].map((i) => parseFloat(q("an_r" + i).value) || 0), pos = [0, 1, 2].map((i) => parseFloat(q("an_p" + i).value) || 0);
				Rig.setKey(c, bone.id, a.frame, rot.map((v, i) => (isNaN(v) ? pose.rot[i] : v)), pos);
				api().redrawSoon(); scheduleSheet(); timeline(); drawPreview();
			};
			const settle = () => { if (before) { api().pushUndo(before); before = null; api().markUnsaved(); render(); } };
			for (const id of [0, 1, 2].flatMap((i) => ["an_rr" + i, "an_r" + i, "an_p" + i])) {
				q(id).onfocus = q(id).onpointerdown = () => { before = before || api().snapshot(); };
				q(id).oninput = () => { if (id.startsWith("an_rr")) q("an_r" + id.slice(5)).value = q(id).value; before = before || api().snapshot(); live(); };
				q(id).onchange = () => { if (id.startsWith("an_r") && !id.startsWith("an_rr")) q("an_rr" + id.slice(4)).value = q(id).value; live(); settle(); };
			}
			q("an_keydel").onclick = () => edit(() => Rig.deleteKey(c, bone.id, a.frame));
			q("an_keyrest").onclick = () => edit(() => Rig.setKey(c, bone.id, a.frame, [0, 0, 0], [0, 0, 0]));
		}
		q("an_link").onclick = async () => {
			try { await Link.connect(); await renderSheet(); render(); } catch (e) { if (e.name !== "AbortError") api().toast(e.message, "bad"); }
		};
		if (q("an_unlink")) q("an_unlink").onclick = () => { Link.disconnect(); render(); };
		q("an_dl").onclick = downloadSheet;
		q("an_ld").onclick = loadAlbedoFile;
		const pv = q("an_prev");
		pv.onpointermove = (e) => { const r = pv.getBoundingClientRect(); light = [(e.clientX - r.left) / r.width - 0.5, 0.5 - (e.clientY - r.top) / r.height]; drawPreview(); };
	}

	// --- timeline ---

	function setFrame(f) {
		const c = clip();
		if (!c) return;
		A().frame = ((f % c.frames) + c.frames) % c.frames;
		api().redrawSoon();
		timeline(); drawPreview();
		if (boneSel) render();
	}
	function timeline() {
		const el = $("timeline");
		if (!el || !on) return;
		const c = clip(), a = A();
		if (!c) return;
		const keys = boneSel ? (c.tracks[boneSel] || []).map((k) => k.f) : [];
		el.innerHTML = `<button id="tl_prev" title="Previous frame (,)">◀</button><button id="tl_play" class="${playing ? "on" : ""}" title="Play the clip in the view (Space-free: just click)">${playing ? "■" : "▶"}</button><button id="tl_next" title="Next frame (.)">▶▶</button>` +
			`<div class="frames">${Array.from({ length: c.frames }, (_, i) => `<button data-f="${i}" class="fr${i === a.frame ? " on" : ""}${keys.includes(i) ? " key" : ""}" title="Frame ${i + 1}">${i + 1}</button>`).join("")}</div>` +
			`<span class="dim">${esc(c.name)} · ${c.fps} fps${boneSel ? " · ◆ = key on the selected bone" : " · select a bone to see its keys"}</span>`;
		$("tl_prev").onclick = () => setFrame(a.frame - 1);
		$("tl_next").onclick = () => setFrame(a.frame + 1);
		$("tl_play").onclick = togglePlay;
		for (const b of el.querySelectorAll("[data-f]")) b.onclick = () => setFrame(parseInt(b.dataset.f, 10));
	}
	function togglePlay() {
		if (playing) { clearInterval(playing); playing = 0; return timeline(); }
		playing = setInterval(() => { const c = clip(); if (!c) return; A().frame = (A().frame + 1) % c.frames; api().redrawSoon(); drawPreview(); document.querySelectorAll("#timeline .fr").forEach((b, i) => b.classList.toggle("on", i === A().frame)); }, 1000 / (clip().fps || 8));
		timeline();
	}

	// --- bones over the model view ---

	const NS = "http://www.w3.org/2000/svg";
	function draw() {
		const svg = $("bone_overlay");
		if (!svg) return;
		svg.replaceChildren();
		if (!on) return;
		const a = A(), r = api().renderer, mats = Rig.matrices(a, clip(), a.frame);
		const add = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); svg.appendChild(el); return el; };
		for (const b of a.bones) {
			const m = mats.get(b.id), h = r.toScreen(Rig.apply(m, b.head)), t = r.toScreen(Rig.apply(m, b.tail));
			if (!h || !t) continue;
			const sel = b.id === boneSel, col = sel ? "#ffcf4a" : "#5ad1ff";
			// A tapered diamond from head to tip, like a bone in a 3D package.
			const dx = t[0] - h[0], dy = t[1] - h[1], len = Math.hypot(dx, dy) || 1, nx = (-dy / len) * Math.min(5, len / 4), ny = (dx / len) * Math.min(5, len / 4);
			const mid = [h[0] + dx * 0.15, h[1] + dy * 0.15];
			add("polygon", { points: `${h} ${mid[0] + nx},${mid[1] + ny} ${t} ${mid[0] - nx},${mid[1] - ny}`, fill: col + "55", stroke: col, "stroke-width": 1.2 });
			add("circle", { cx: h[0], cy: h[1], r: 3, fill: col });
			const tip = add("circle", { cx: t[0], cy: t[1], r: 7, fill: sel ? col : "#14141899", stroke: col, "stroke-width": 1.5, class: "bonetip", "data-bone": b.id });
			tip.style.cursor = "grab";
		}
	}
	let drag = null;
	function dragMove(e) {
		const b = Rig.bone(A(), drag.id);
		if (!b) return;
		const rect = $("view").getBoundingClientRect(), a = A(), c = clip();
		const mats = Rig.matrices(a, c, a.frame), M = mats.get(b.id), H = Rig.apply(M, b.head), T = Rig.apply(M, b.tail);
		const ray = api().renderer.ray(e.clientX - rect.left, e.clientY - rect.top);
		if (Math.abs(ray.d[1]) < 1e-6 || Math.hypot(T[0] - H[0], T[2] - H[2]) < 1e-6) return;
		const t = (H[1] - ray.o[1]) / ray.d[1], P = [ray.o[0] + ray.d[0] * t, ray.o[2] + ray.d[2] * t];
		const th = Math.atan2(T[2] - H[2], T[0] - H[0]) - Math.atan2(P[1] - H[2], P[0] - H[0]), cs = Math.cos(th), sn = Math.sin(th);
		const Rw = [[cs, 0, sn], [0, 1, 0], [-sn, 0, cs]], Rp = b.parent ? Rig.rotPart(mats.get(b.parent)) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
		const pose = Rig.localPose(c, b.id, a.frame), { mul, transpose } = Rig.mat3;
		const next = mul(transpose(Rp), mul(Rw, mul(Rp, Rig.eulerToMat(pose.rot))));
		Rig.setKey(c, b.id, a.frame, Rig.matToEuler(next), pose.pos);
		drag.moved = true;
		api().redrawSoon(); scheduleSheet(); drawPreview();
	}
	function dragEnd() {
		window.removeEventListener("pointermove", dragMove);
		window.removeEventListener("pointerup", dragEnd);
		if (drag && drag.moved) { api().pushUndo(drag.before); api().markUnsaved(); }
		drag = null;
		render();
	}

	function setMode(v) {
		on = v;
		document.body.classList.toggle("animating", on);
		$("b_animate").classList.toggle("on", on);
		if (!on && playing) togglePlay();
		if (on) { ensureClip(); render(); scheduleSheet(); }
		api().redrawSoon();
		draw();
	}

	TS.AnimUI = {
		get on() { return on; },
		posed: (objs) => (on && A().bones.length ? Rig.posedObjects(objs, A(), clip(), A().frame) : objs),
		draw,
		// The models or the whole project changed (an edit, undo, or a project opened).
		changed() {
			if (!on) return;
			clearTimeout(TS.AnimUI._t);
			TS.AnimUI._t = setTimeout(() => { loadAlbedoURL(); render(); scheduleSheet(); }, 60);
		},
	};

	window.addEventListener("DOMContentLoaded", () => {
		$("b_animate").onclick = () => setMode(!on);
		$("bone_overlay").addEventListener("pointerdown", (e) => {
			const id = e.target.dataset && e.target.dataset.bone;
			if (!id) return;
			e.preventDefault(); e.stopPropagation();
			boneSel = id;
			drag = { id, before: api().snapshot(), moved: false };
			window.addEventListener("pointermove", dragMove);
			window.addEventListener("pointerup", dragEnd);
			ensureClip();
		});
		window.addEventListener("keydown", (e) => {
			if (!on || e.target.closest("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
			if (e.key === ",") setFrame(A().frame - 1);
			else if (e.key === ".") { setFrame(A().frame + 1); e.stopPropagation(); }
		}, true);
		loadAlbedoURL();
	});
})();
