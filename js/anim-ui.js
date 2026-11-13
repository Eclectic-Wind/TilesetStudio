// Animation mode: the Rig & animation panel, the timeline, bones drawn over the model view (drag a bone's tip to turn it), the lit
// preview of the spritesheet, and the Aseprite link. The data and maths are in rig.js; the folder link is in aseprite.js.
"use strict";
(() => {
	const $ = (id) => document.getElementById(id);
	const Rig = TS.Rig, Link = TS.Link, v3 = TS.v3;
	const esc = TS.esc;
	const round = (v) => Math.round(v * 100) / 100;
	let previewMode = "lit"; // the panel's own preview: lit | normal | albedo
	let on = false, boneSel = null, playing = 0, sheet = null, albedo = null, albedoURL = null, renderTimer = 0, linkState = ["off", "Not linked."], light = [0.3, 0.4];
	const S = () => TS.state, A = () => TS.state.anim, api = () => TS.api;
	const clip = () => Rig.clipOf(A());
	// Weight painting: with a bone selected, drag over the models to give it more (or less) of each vertex under the brush.
	let paintMode = false, stroke = null, brushAt = null;
	// The dopesheet: keys picked ("boneId|frame"), the last copied keys, and whether the view shows the neighbouring frames as ghosts.
	const keySel = new Set();
	let keyClip = null, showOnion = TS.store.get("tsOnion") === "1", onionBack = onionCount("tsOnionBack"), onionFwd = onionCount("tsOnionFwd"), showBones = TS.store.get("tsBones") !== "0", tlCollapsed = TS.store.get("tsTlRows") === "0";
	function onionCount(k) { const v = parseInt(TS.store.get(k), 10); return Number.isFinite(v) ? TS.clamp(v, 0, 8) : 1; }
	const keyName = (id, f) => id + "|" + f;
	const picked = () => [...keySel].map((s) => { const i = s.lastIndexOf("|"); return { id: s.slice(0, i), f: +s.slice(i + 1) }; });
	const brush = { mode: "mix", weight: 1, strength: 0.5, radius: 36, through: false };
	const cell =() => (S().art ? { w: S().art.w, h: S().art.h } : { w: 64, h: 64 });

	// An undoable change to the animation data.
	function edit(fn) {
		const before = api().snapshot();
		fn();
		api().pushUndo(before);
		touched();
	}
	// Bone selection: boneSel is the active bone, multi the others picked with Shift / Ctrl-click. A bone may be "connected": its head
	// stays glued to its parent's tip.
	const multi = new Set();
	const isSel = (id) => id === boneSel || multi.has(id);
	const selIds = () => A().bones.filter((b) => isSel(b.id)).map((b) => b.id);
	function selectBone(id, add) {
		if (!add) { multi.clear(); boneSel = id; return; }
		if (!isSel(id)) { if (boneSel) multi.add(boneSel); boneSel = id; return; }
		if (id === boneSel) { boneSel = [...multi][0] || null; if (boneSel) multi.delete(boneSel); } else multi.delete(id);
	}
	function subtree(a, ids) {
		const out = new Set(ids);
		for (let grow = true; grow;) { grow = false; for (const b of a.bones) if (b.parent && out.has(b.parent) && !out.has(b.id)) { out.add(b.id); grow = true; } }
		return out;
	}
	// The selected bones that have no selected ancestor (they carry the rest along when posed).
	// --- Pins (see Rig.applyPins): P or the Pin button pins the selected bones where they are on this frame, or unpins them. ---
	const viewPlane = () => (S().viewLock ? S().viewLock.k : 1);
	// Re-solve the pins on the frame on show (skip: bones being posed directly). -> true when any pin moved something.
	function holdPins(skip) {
		const a = A(), c = clip();
		return !!(c && c.pins && Rig.applyPins(a, c, a.frame, skip, viewPlane()).length);
	}
	function togglePins() {
		const a = A(), c = clip(), ids = selIds();
		if (!ids.length) { api().toast("Select a bone first (a shin or a foot to plant a foot), then press P.", "bad"); return; }
		if (restMode) { api().status("Pins work while posing: leave the rest pose first (Tab)."); return; }
		if (playing) togglePlay();
		const off = ids.every((id) => c.pins && c.pins[id]);
		edit(() => {
			if (off) { for (const id of ids) delete c.pins[id]; if (!Object.keys(c.pins).length) delete c.pins; }
			else { c.pins = c.pins || {}; for (const id of ids) c.pins[id] = Rig.makePin(a, c, a.frame, Rig.bone(a, id)); }
		});
		const names = ids.map((id) => Rig.bone(a, id).name).join(", ");
		api().status(off ? `Unpinned ${names}.` : `Pinned ${names}: ${ids.length > 1 ? "they stay" : "it stays"} put while you pose the rest (move the hips with G, turn the body...), on any frame. P again unpins.`);
	}
	function pinRow(a, c, bone) {
		const ids = Object.keys((c && c.pins) || {}).filter((id) => Rig.bone(a, id)), pinned = bone && ids.includes(bone.id);
		const what = (id) => { const b = Rig.bone(a, id), p = c.pins[id], n = Rig.ikLen(a, b); return p.mode === "whole" ? `${b.name} stays as it is; the limb above it bends` : `${b.name}'s tip stays; ${n} bone${n > 1 ? "s" : ""} bend`; };
		return `<div class="arow"><button id="an_pin" class="${pinned ? "on" : ""}" title="Pin (P): keep the selected bone where it is while you pose the rest of the body, on this frame and any other. Pin a foot (or the shin, whose tip is the ankle) to plant it on the ground, then move or turn the hips: the leg bends so the foot stays. The bent bones are keyed as you pose."${bone && !restMode ? "" : " disabled"}>📌 ${pinned ? "Unpin" : "Pin"} (P)</button>${ids.length ? `<button id="an_unpinall" title="Remove every pin in this clip (the poses they made stay keyed)">Unpin all</button>` : ""}</div>
			${ids.length ? `<ul class="pinlist">${ids.map((id) => `<li title="${esc(what(id))}">📌 ${esc(Rig.bone(a, id).name)} <span class="dim">${c.pins[id].mode === "whole" ? "whole bone" : "tip"}</span> <button class="link" data-unpin="${id}" title="Unpin">✕</button></li>`).join("")}</ul>` : ""}`;
	}
	function rootsOf(a, ids) {
		const set = new Set(ids);
		return ids.filter((id) => { for (let p = Rig.bone(a, id).parent, n = 0; p && n < 1000; p = (Rig.bone(a, p) || {}).parent, n++) if (set.has(p)) return false; return true; });
	}
	function reconnect(a) { for (const b of a.bones) { const p = b.parent && Rig.bone(a, b.parent); if (b.connected && p) b.head = p.tail.slice(); } }
	// Edit one coordinate of a bone's head or tip; a connected head is its parent's tip, so that is what moves.
	function setPoint(bone, prop, i, v) {
		const a = A(), p = bone.parent && Rig.bone(a, bone.parent);
		if (prop === "head" && bone.connected && p) p.tail[i] = v; else bone[prop][i] = v;
		reconnect(a);
	}
	function deleteBones(ids) {
		const a = A(), gone = new Set(ids);
		for (const id of ids) {
			const bone = Rig.bone(a, id);
			if (!bone) continue;
			let up = bone.parent; while (up && gone.has(up)) up = (Rig.bone(a, up) || {}).parent;
			// A child stays connected only if its head already sits on its new parent's tip (its rest pose never jumps).
			const tip = up && Rig.bone(a, up) && Rig.bone(a, up).tail;
			for (const b of a.bones) if (b.parent === id) { b.parent = up || null; if (b.connected && !(tip && Math.hypot(...b.head.map((v, i) => v - tip[i])) < 0.5)) b.connected = false; }
		}
		a.bones = a.bones.filter((b) => !gone.has(b.id));
		for (const id of ids) {
			for (const k of Object.keys(a.bind)) if (a.bind[k] === id) delete a.bind[k];
			for (const cl of a.clips) delete cl.tracks[id];
		}
		multi.clear(); boneSel = null;
	}
	function touched() { api().markUnsaved(); api().redrawSoon(); loadAlbedoURL(); scheduleSheet(); render(); }

	function ensureClip() {
		const a = A();
		if (!a.clips.length) { const c = Rig.newClip("Clip 1", 8, 8); a.clips.push(c); a.clip = c.id; }
		if (!Rig.clipOf(a)) a.clip = a.clips[0].id;
		a.frame = TS.clamp(a.frame | 0, 0, Rig.clipOf(a).frames - 1);
	}

	// --- the sheet: normals rendered for every frame, shown lit, and sent to Aseprite ---

	function scheduleSheet() { pass++; clearTimeout(renderTimer); renderTimer = setTimeout(renderSheet, 250); }
	// Frames are kept by pose, so an edit only redoes the frames it changed and frames with the same pose share one picture. Everything
	// else a frame depends on (models, rest pose, weights, settings, size) is rigBase: when it changes, the kept frames go.
	const NORMAL_BYTES = 256e6, LIT_BYTES = 320e6;
	let rigBase = "", litArt = null, litAlbedo = null;
	const normalFrames = new Map(), litFrames = new Map();
	const remember = (map, key, value, room) => { map.set(key, value); while (map.size > Math.max(8, room)) map.delete(map.keys().next().value); };
	function checkRigBase(c) {
		const a = A(), base = JSON.stringify([S().objects, a.bones, a.bind, a.rigid, a.skin, a.paint, S().settings, c.w, c.h]);
		if (base !== rigBase) { rigBase = base; normalFrames.clear(); litFrames.clear(); colourFrames.clear(); }
	}
	// Aseprite is sent the asset's base colour, not the normals: the tileset's art carried along with the posed models, frame by frame
	// (pixels the normals cover but the art has nothing for are plain grey). Kept by pose like the normals.
	const colourFrames = new Map();
	let colourArt = null;
	function colourSheet(img, lay, cl) {
		const art = S().art, out = new ImageData(img.width, img.height), d = img.data, a = A();
		checkRigBase({ w: lay.cw, h: lay.ch });
		if (colourArt !== art) { colourFrames.clear(); colourArt = art; }
		for (let f = 0; f < lay.frames; f++) {
			const sig = Rig.frameSig(a, cl, f), [ox, oy] = Rig.cellOrigin(lay, f);
			let col = colourFrames.get(sig);
			if (!col) { col = Rig.frameColours(S().objects, a, cl, f, lay.cw, lay.ch, S().settings, art); remember(colourFrames, sig, col, NORMAL_BYTES / (lay.cw * lay.ch * 4)); }
			for (let y = 0; y < lay.ch; y++) for (let x = 0; x < lay.cw; x++) {
				const si = ((oy + y) * lay.w + ox + x) * 4, ci = (y * lay.cw + x) * 4;
				if (!d[si + 3]) continue;
				out.data.set(col.data[ci + 3] ? col.data.subarray(ci, ci + 4) : [150, 150, 150, 255], si);
			}
		}
		return out;
	}
	const pushSheet = (img, lay, cl) => Link.push(colourSheet(img, lay, cl), lay, { anim: true, fps: cl.fps, clip: cl.id, clipName: cl.name.replace(/["\\]/g, "") });
	// The big Lit / Normals view shows the clip's frame while animating and the rest pose otherwise: redraw it when that changes.
	function refreshOutput() { const o = api().output; if (o && o.result) o.render(); }
	// Frames render a few at a time so a long clip never freezes the page: the frame on screen first, then the rest in short slices
	// (cells not redone yet keep the previous picture). A newer edit cancels an unfinished pass; Aseprite gets the sheet once it is whole.
	let pass = 0, pending = 0;
	function renderSheet() {
		const gen = ++pass;
		clearTimeout(renderTimer);
		if (!on || !S().art || !clip() || !S().objects.length) { sheet = null; pending = 0; drawPreview(); refreshOutput(); showSheetInfo(); return; }
		const c = cell(), cl = clip(), a = A(), objs = S().objects, st = S().settings, lay = Rig.layout(c.w, c.h, cl.frames);
		checkRigBase(c);
		const old = sheet && sheet.layout.w === lay.w && sheet.layout.h === lay.h && sheet.layout.cw === c.w && sheet.layout.ch === c.h ? sheet.sheet : null;
		const next = { sheet: old ? new ImageData(new Uint8ClampedArray(old.data), lay.w, lay.h) : new ImageData(lay.w, lay.h), layout: lay };
		const todo = Array.from({ length: cl.frames }, (_, i) => i).sort((x, y) => (x === a.frame ? -1 : y === a.frame ? 1 : x - y));
		const one = (f) => {
			const sig = Rig.frameSig(a, cl, f), [ox, oy] = Rig.cellOrigin(lay, f);
			let img = normalFrames.get(sig);
			if (!img) { img = Rig.frameNormals(objs, a, cl, f, c.w, c.h, st); remember(normalFrames, sig, img, NORMAL_BYTES / (c.w * c.h * 4)); }
			for (let y = 0; y < c.h; y++) next.sheet.data.set(img.data.subarray(y * c.w * 4, (y + 1) * c.w * 4), ((oy + y) * lay.w + ox) * 4);
		};
		const step = () => {
			if (gen !== pass) return;
			const t0 = performance.now();
			try { do one(todo.shift()); while (todo.length && performance.now() - t0 < 30); }
			catch (e) { sheet = null; pending = 0; setLink("warn", "Could not render the frames: " + e.message); showSheetInfo(); return; }
			const first = sheet !== next;
			sheet = next; pending = todo.length;
			if (first || !todo.length) drawPreview(); // the frame on screen is in the first slice
			showSheetInfo();
			if (todo.length) return void setTimeout(step, 0);
			refreshOutput();
			Link.expected = { w: lay.w, h: lay.h };
			if (Link.linked()) pushSheet(next.sheet, lay, cl).catch((e) => setLink("warn", "Could not write to the folder: " + e.message));
		};
		step();
	}
	function showSheetInfo() { const info = $("an_sheetinfo"); if (info) info.textContent = sheetText(); }
	function sheetText() {
		if (!clip()) return "";
		if (!S().objects.length) return "Add models to render frames.";
		const c = cell(), lay = Rig.layout(c.w, c.h, clip().frames), pow = Rig.isPow2(lay.w) && Rig.isPow2(lay.h);
		return `${clip().frames} frames, ${lay.cols}x${lay.rows} cells of ${c.w}x${c.h} = a ${lay.w}x${lay.h} sheet${pow ? "" : " (not a power of two: use a power-of-two tileset so Aseprite will accept it)"}${pending ? ` · rendering, ${pending} to go…` : ""}`;
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
			const si = ((oy + y) * lay.w + ox + x) * 4, di = (y * c.w + x) * 4, d = sheet.sheet.data, ai = (y * c.w + x) * 4, art = S().art;
			if (!d[si + 3]) continue;
			if (previewMode === "normal") { out.data.set([d[si], d[si + 1], d[si + 2], 255], di); continue; }
			if (previewMode === "albedo") {
				const ok = albedo && albedo.width === lay.w && albedo.height === lay.h && albedo.data[si + 3];
				out.data.set(ok ? [albedo.data[si], albedo.data[si + 1], albedo.data[si + 2], albedo.data[si + 3]] : [150, 150, 150, 255], di);
				continue;
			}
			const n = v3.norm([d[si] / 127.5 - 1, d[si + 1] / 127.5 - 1, d[si + 2] / 127.5 - 1]), lit = 0.25 + 0.75 * Math.max(0, v3.dot(n, L));
			let r = 150, gr = 150, b = 150, a = 255;
			// The normals are the reference: the linked Albedo colours the frame, else the tileset's own art; where neither has a pixel they show as plain grey.
			const alb = albedo && albedo.width === lay.w && albedo.height === lay.h && albedo.data[si + 3] ? { d: albedo.data, i: si } : art && art.data[ai + 3] ? { d: art.data, i: ai } : null;
			if (alb) { r = alb.d[alb.i]; gr = alb.d[alb.i + 1]; b = alb.d[alb.i + 2]; a = alb.d[alb.i + 3]; }
			out.data.set([r * lit, gr * lit, b * lit, a], di);
		}
		g.putImageData(out, 0, 0);
		// The big Lit / Normals view follows the frame too (playback runs there with the albedo).
		const o = api().output;
		if (o && (o.mode === "lit" || o.mode === "normals")) o.render();
	}
	// Fills img (art-sized) with the current frame's normals for the output panel; false when there is nothing to show.
	function frameImage(img, sourceSize = img) {
		if (!on || !sheet || !clip()) return false;
		const c = cell(), lay = sheet.layout;
		if (sourceSize.width !== c.w || sourceSize.height !== c.h) return false;
		const [ox, oy] = Rig.cellOrigin(lay, A().frame), d = sheet.sheet.data, out = img.data;
		for (let py = 0; py < img.height; py++) for (let px = 0; px < img.width; px++) {
			const x=Math.min(c.w-1,Math.floor((px+.5)*c.w/img.width)), y=Math.min(c.h-1,Math.floor((py+.5)*c.h/img.height));
			const si = ((oy + y) * lay.w + ox + x) * 4, di = (py * img.width + px) * 4;
			if (!d[si + 3]) { out.set([22, 22, 27, 255], di); continue; }
			out.set([d[si], d[si + 1], d[si + 2], 255], di);
		}
		return true;
	}

	// The Lit view while animating: the clip's current frame processed like the rest pose (the posed models, the tileset's art, or the
	// linked Albedo for the frame's cell), so its colour and shadows match. Kept until the frame, the models or the Albedo change.
	function litResult() {
		if (!on || !S().art || !clip() || !S().objects.length) return null;
		const f = A().frame, key = f + "|" + Rig.frameSig(A(), clip(), f);
		if (litArt !== S().art || litAlbedo !== albedo) { litFrames.clear(); litArt = S().art; litAlbedo = albedo; }
		const hit = litFrames.get(key);
		if (hit) return hit;
		const c = cell(), lay = Rig.layout(c.w, c.h, clip().frames);
		const r = TS.Process.run(Rig.posedObjects(S().objects, A(), clip(), f), S().art, S().settings);
		const data = new Uint8ClampedArray(S().art.data);
		if (albedo && albedo.width === lay.w && albedo.height === lay.h) {
			const [ox, oy] = Rig.cellOrigin(lay, f);
			for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
				const si = ((oy + y) * lay.w + ox + x) * 4;
				if (albedo.data[si + 3]) data.set(albedo.data.subarray(si, si + 3), (y * c.w + x) * 4);
			}
		}
		r.art = Object.assign({}, r.art, { data });
		const entry = { result: r, litNormal: TS.Process.litNormals(r, S().settings), prisms: null };
		remember(litFrames, key, entry, LIT_BYTES / (c.w * c.h * 40));
		return entry;
	}

	// --- the Aseprite link ---

	let linkedShown = false;
	function setLink(state, text) {
		const wasLinked = linkedShown;
		linkedShown = Link.linked();
		linkState = [state, text];
		if (on && wasLinked !== linkedShown) render(); // the buttons follow
		const el = $("an_linkstate");
		if (el) { el.textContent = text; el.className = "linkstate " + state; }
		const bar = $("an_linkdot");
		if (bar) bar.className = "dot " + state;
	}
	Link.onStatus = setLink;
	Link.onAlbedo = (img) => { acceptAlbedo(img); };
	// Frames added / deleted on Aseprite's timeline: the clip follows. A deleted frame takes its key with it and later keys move up;
	// an inserted frame pushes later keys down (the new frame's pose is just the blend between its neighbours).
	Link.onFrames = (msg) => {
		const c = clip();
		if (!on || !c) return;
		const before = api().snapshot(), a = A();
		for (const op of msg.ops || []) {
			const i = op.i | 0;
			if (op.op === "del" && c.frames > 1) {
				for (const id of Object.keys(c.tracks)) {
					c.tracks[id] = c.tracks[id].filter((k) => k.f !== i).map((k) => (k.f > i ? Object.assign({}, k, { f: k.f - 1 }) : k));
					if (!c.tracks[id].length) delete c.tracks[id];
				}
				c.frames--;
			} else if (op.op === "ins" && c.frames < 64) {
				for (const id of Object.keys(c.tracks)) c.tracks[id] = c.tracks[id].map((k) => (k.f >= i ? Object.assign({}, k, { f: k.f + 1 }) : k));
				c.frames++;
			}
		}
		c.frames = TS.clamp(msg.n | 0 || c.frames, 1, 64); // Aseprite's count is the truth
		a.frame = Math.min(a.frame, c.frames - 1);
		api().pushUndo(before);
		touched();
		clearTimeout(renderTimer);
		renderSheet(); // Aseprite is waiting for the new sheet
		Link.onStatus("ok", `Aseprite's timeline now has ${c.frames} frame${c.frames === 1 ? "" : "s"}; the clip followed.`);
	};
	// The names of the models a clip animates (escaped).
	const clipModels = (c) => { const ids = c.models || []; return S().objects.filter((o) => ids.includes(o.id)).map((o) => esc(o.name)); };
	// A clip's lines in the Export menu: what it exports, or why not (the same checks as the bundle, without building the sheets).
	// sheetImg: the clip's decoded Albedo sheet, or null.
	function exportNote(c, sheetImg) {
		try {
			const r = S().result;
			if (c.export === false) return '<p class="dim">Not exported.</p>';
			const names = clipModels(c);
			const head = names.length ? `<p class="dim">Flipbook of ${names.join(", ")}.</p>` : '<p class="dim">No models chosen (Animate ▸ Clip ▸ Use selected models), so it is not exported.</p>';
			if (!names.length || !r || !r.pieceMap) return head;
			const out = TS.Bundle.anim({ anim: Object.assign({}, A(), { clips: [c] }), objects: S().objects, settings: S().settings, result: r, art: S().art, albedoOf: (cl) => (cl === c ? sheetImg : null), dry: true });
			if (!out) return head;
			const ok = out.clips.length ? `<p class="dim">Exports ${out.clips[0].targets.map((t) => `${t.rect[2]}x${t.rect[3]} px`).join(" + ")} per frame. ${out.clips[0].targets.some((t) => t.moves) ? (out.clips[0].targets.some((t) => t.floor) ? "Height, normals and the floor shadow follow the bones, frame by frame." : "Height and normals follow the bones, frame by frame (the floor shadow stays the base frame's: isometric).") : "Height and normals stay the base frame's (no bone moves these models)."}</p>` : "";
			return head + ok + out.warnings.map((w) => `<p class="warnline">⚠ ${esc(w)}</p>`).join("");
		} catch (e) { return ""; }
	}
	// The Export menu's "Animated clips" part: every clip with models or keys, with its Export tick and what it sends to the game.
	// Filled each time the menu opens, so it shows the clips as they are now.
	let menuPass = 0;
	async function exportMenu(el) {
		const clips = (A().clips || []).filter((c) => (c.models || []).length || Object.values(c.tracks || {}).some((ks) => ks.length));
		const my = ++menuPass;
		if (!clips.length) { el.hidden = true; el.innerHTML = ""; return; }
		const sheets = await albedoImages();
		if (my !== menuPass) return; // the menu was opened again meanwhile
		const active = clip();
		if (albedo && active) sheets.set(active.id, albedo);
		el.hidden = false;
		el.innerHTML = `<hr><p class="menuhead">Animated clips</p>` + clips.map((c) => `<div class="expclip">
			<label class="chk" title="Put this clip in the Godot bundle (bundle version 6, anim). Only a clip with models chosen is exported."><input type="checkbox" data-clip="${c.id}"${c.export === false ? "" : " checked"}> ${esc(c.name)} <span class="dim">· ${c.frames} frame${c.frames === 1 ? "" : "s"}, ${c.fps | 0 || 8} fps</span></label>
			${exportNote(c, sheets.get(c.id) || null)}</div>`).join("");
		for (const box of el.querySelectorAll("input[data-clip]")) box.onchange = () => {
			const c = A().clips.find((x) => x.id === box.dataset.clip);
			if (c) edit(() => { if (box.checked) delete c.export; else c.export = false; });
			exportMenu(el);
		};
	}
	// Every exported clip's Albedo sheet, decoded: Map clip id -> ImageData (the clip's own, else the sheet on screen for the active clip).
	async function albedoImages() {
		const out = new Map();
		for (const c of A().clips) {
			const url = c.albedo;
			if (!url || !(c.models || []).length) continue;
			const img = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = url; });
			if (!img) continue;
			const cv = document.createElement("canvas");
			cv.width = img.width; cv.height = img.height;
			const g = cv.getContext("2d");
			g.drawImage(img, 0, 0);
			out.set(c.id, g.getImageData(0, 0, cv.width, cv.height));
		}
		return out;
	}
	function acceptAlbedo(img) {
		albedo = img;
		const c = document.createElement("canvas");
		c.width = img.width; c.height = img.height;
		c.getContext("2d").putImageData(img, 0, 0);
		albedoURL = c.toDataURL("image/png");
		const active = Rig.clipOf(A());
		if (active) active.albedo = albedoURL; // each clip keeps its own sheet: the preview and the game export read it
		api().markUnsaved();
		drawPreview(); showFrameArt();
	}
	async function loadAlbedoURL() {
		const url = (clip() || {}).albedo || null;
		if (url === albedoURL) return;
		albedoURL = url;
		albedo = null;
		if (!albedoURL) { drawPreview(); showFrameArt(); return; }
		const img = new Image();
		img.onload = () => {
			if (url !== albedoURL) return; // another clip was picked meanwhile
			const c = document.createElement("canvas");
			c.width = img.width; c.height = img.height;
			const g = c.getContext("2d");
			g.drawImage(img, 0, 0);
			albedo = g.getImageData(0, 0, c.width, c.height);
			drawPreview(); showFrameArt();
		};
		img.src = albedoURL;
	}
	function downloadSheet() {
		if (!sheet) return api().toast("Add models and bones first; there is nothing to render yet.", "bad");
		if (pending) { // a pass is still running: finish it now so the download is whole
			const cl = cell();
			pass++; sheet = Rig.normalSheet(S().objects, A(), clip(), cl.w, cl.h, S().settings); pending = 0; showSheetInfo();
			if (Link.linked()) pushSheet(sheet.sheet, sheet.layout, clip()).catch((e) => setLink("warn", "Could not write to the folder: " + e.message));
		}
		const c = document.createElement("canvas");
		c.width = sheet.sheet.width; c.height = sheet.sheet.height;
		c.getContext("2d").putImageData(colourSheet(sheet.sheet, sheet.layout, clip()), 0, 0); // the reference, as Aseprite gets it
		c.toBlob((b) => {
			const a = document.createElement("a");
			a.href = URL.createObjectURL(b); a.download = `${api().exportName()}_${clip().name.replace(/\W+/g, "_")}_reference.png`;
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
		for (const id of [...multi]) if (!Rig.bone(a, id)) multi.delete(id);
		const depth = (b) => { let d = 0; for (let p = b.parent && Rig.bone(a, b.parent); p && d < 50; p = p.parent && Rig.bone(a, p.parent)) d++; return d; };
		const deformSel = () => { const id = [...S().selected][0]; return !(id !== undefined && a.rigid && a.rigid[id]); };
		const skinStiff = () => { const s = a.skin && S().selected.size && a.skin[[...S().selected][0]]; return s ? s.stiff || 3 : 3; };
		const bound = (id) => S().objects.filter((o) => a.bind[o.id] === id).length;
		let h = `<button id="an_learn" class="link" title="Short visual lessons: your first animation, bones, timing, getting frames into your game">New to animating? Watch the lessons</button><div class="arow"><select id="an_clip" title="Animation clip">${a.clips.map((x) => `<option value="${x.id}"${x.id === a.clip ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
			<button id="an_clipnew" title="New clip">＋</button><button id="an_clipdel" title="Delete this clip"${a.clips.length < 2 ? " disabled" : ""}>✕</button></div>
			<div class="arow"><label>Name <input id="an_clipname" type="text" value="${esc(c.name)}"></label></div>
			<div class="arow"><label title="Frames in this clip. Each is one cell of the spritesheet.">Frames <input id="an_frames" type="number" min="1" max="64" value="${c.frames}"></label>
			<label title="Playback speed in the preview">FPS <input id="an_fps" type="number" min="1" max="60" value="${c.fps}"></label></div>
			<div class="arow"><label title="What happens at the last frame, in the preview and in the game: loop, play once and hold, or ping-pong back and forth">Loop <select id="an_loop">${[["loop", "loop"], ["once", "once"], ["pingpong", "ping-pong"]].map(([v, t]) => `<option value="${v}"${(c.loop || "loop") === v ? " selected" : ""}>${t}</option>`).join("")}</select></label></div>
			<div class="arow"><button id="an_models" title="The models this flipbook animates: select them in the view, then press this. The pieces they belong to are swapped for the frames while the clip plays; the frames are the Albedo painted in Aseprite. When bones move the models, height, normals, the floor shadow (exact floor spans, oblique projection) and collision follow them frame by frame.">Use selected models</button><button id="an_modelsclear"${(c.models || []).length ? "" : " disabled"}>Clear</button></div>
			<p class="dim">${clipModels(c).length ? `Flipbook of ${clipModels(c).join(", ")}.` : "No models chosen: the game gets no frames from this clip."} Export ▾ shows what goes into the game.</p>`;
		h = section("clip", "Clip", h);
		let rig = `<div class="arow"><label class="chk" title="Coloured turn rings and move arrows on the selected bone: drag a ring to turn about that axis (red X, green Y, blue Z), an arrow to slide the bone along it. Only the axes the current view can work with show."><input id="an_gz" type="checkbox"${showGizmos ? " checked" : ""}> Gizmos</label><label class="chk" title="Bone names in the view, with the selected bone's turn, and dashed lines from a parent's tip to a child that isn't connected."><input id="an_names" type="checkbox"${showNames ? " checked" : ""}> Names</label><label class="chk" title="IK limbs (inverse kinematics): drag the ball at a hand or foot (the tip of a forearm or shin) and the whole arm or leg bends to follow, keying every bone in it. Works on any bone connected to its parent; the bone's IK chain field sets how many bones bend. Off: dragging a tip only turns that one bone."><input id="an_ik" type="checkbox"${ikOn ? " checked" : ""}> IK limbs</label></div><ul id="an_bones" class="bonelist">${a.bones.length ? Rig.ordered(a).map((b) => { const nk = (c.tracks[b.id] || []).length; return `<li data-id="${b.id}" class="${isSel(b.id) ? "on" : ""}" style="padding-left:${6 + depth(b) * 12}px" title="Click to select, Shift / Ctrl-click to add">${esc(b.name)}<span class="dim">${bound(b.id) ? ` · ${bound(b.id)} model${bound(b.id) > 1 ? "s" : ""}` : ""}</span>${nk ? `<span class="keyflag" title="${nk} key${nk > 1 ? "s" : ""} in this clip"> ◆${nk}</span>` : ""}</li>`; }).join("") : '<li class="dim empty">No bones yet. Add one below, or just move a model with G / R on a frame: it gets a bone of its own.</li>'}</ul>
			${(() => { const away = S().objects.filter((o) => a.bind[o.id] && Rig.awayFromBones(a, o)).map((o) => esc(o.name)); return away.length ? `<p class="warnline" title="The bones keep the pose they were rigged in. Use Edit rest pose to move the bones back to the model, or Bind selected models to a bone beside it.">⚠ ${away.join(", ")} ${away.length > 1 ? "sit" : "sits"} away from ${away.length > 1 ? "their" : "its"} bones (edited after rigging?), so nothing bends. Edit rest pose to realign the bones.</p>` : ""; })()}
			<div class="arow"><button id="an_boneadd" title="A bone at the 3D cursor, 24 px tall. With a bone selected, the new one starts at its tip and is its child.">＋ Bone</button>
			<button id="an_bonemodel" title="One bone per selected model, from the bottom of the model to its top, bound to it">Bone per model</button>
			<button id="an_rest" class="${restMode ? "on" : ""}" title="Edit the rest pose (Tab): drag a bone's head, tip or body to where it belongs. Models show at rest meanwhile.">${restMode ? "Done (Tab)" : "Edit rest pose"}</button><button id="an_bonedel" class="danger" title="Delete the selected bone(s); their children move up"${bone ? "" : " disabled"}>Delete</button></div>
			${pinRow(a, c, bone)}`;
		if (bone) {
			rig += `<div class="boneprops"><div class="arow"><label>Name <input id="an_bname" type="text" value="${esc(bone.name)}"></label></div>
				<div class="arow"><label>Parent <select id="an_bparent"><option value="">(none)</option>${Rig.ordered(a).filter((b) => b.id !== bone.id && !Rig.wouldLoop(a, bone, b.id)).map((b) => `<option value="${b.id}"${b.id === bone.parent ? " selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label></div>
				<label class="chk" title="Keep this bone's head glued to its parent's tip: moving the parent's tip drags it along, and its head can't be pulled away."><input id="an_conn" type="checkbox"${bone.connected && bone.parent ? " checked" : ""}${bone.parent ? "" : " disabled"}> Connected to the parent's tip</label>
				<div class="arow"><label title="How many bones bend when you drag this bone's tip with IK limbs on. Auto: this bone and its parent (an arm or leg) when it is connected to its parent, else just this bone. 3 adds the body above it.">IK chain <select id="an_bik">${[[0, `Auto (${Rig.ikLen(a, Object.assign({}, bone, { ik: 0 }))})`], [1, "1 (this bone only)"], [2, "2 (arm or leg)"], [3, "3"], [4, "4"]].map(([v, t]) => `<option value="${v}"${(bone.ik || 0) === v ? " selected" : ""}>${t}</option>`).join("")}</select></label></div>
				${vecRow("Head", "an_h", bone.head)}${vecRow("Tip", "an_t", bone.tail)}
				<div class="arow"><button id="an_bind" title="Make the selected models follow this bone">Bind selected models</button><button id="an_unbind" title="Let the selected models stand still">Unbind</button></div>
				<div class="arow"><button id="an_skin" class="${deformSel() ? "on" : ""}" title="Deform (the default): a bound model bends with every bone, vertex by vertex, weighted by distance. Nothing to set up beyond binding it.">Deform</button><button id="an_unskin" class="${deformSel() ? "" : "on"}" title="Rigid: the model moves as one solid piece with its bound bone.">Rigid</button>
				<label title="How sharply weights fall off with distance. Higher: vertices stick to their nearest bone; lower: blends over a wider span.">Stiffness <input id="an_stiff" type="number" min="0.5" max="12" step="0.5" value="${skinStiff()}"></label></div></div>
`;
		}
		h += section("bones", `Bones${a.bones.length ? ` <span class="dim">(${a.bones.length})</span>` : ""}`, rig);
		if (bone) {
			const pose = Rig.localPose(c, bone.id, a.frame), key = Rig.keyAt(c, bone.id, a.frame);
			h += section("pose", `Pose · frame ${a.frame + 1}${key ? ' <span class="keyflag">◆ key</span>' : ""}`, `<div class="poseprops">
				${["X", "Y", "Z"].map((n, i) => `<div class="vrow"><span class="ax-${n.toLowerCase()}" title="Turn about ${n}">Turn ${n}</span><input id="an_rr${i}" type="range" min="-180" max="180" step="1" value="${round(pose.rot[i])}">${numField("an_r" + i, pose.rot[i])}</div>`).join("")}
				${bone.connected && bone.parent ? '<p class="dim">Connected: turns only (its head stays on the parent tip).</p>' : vecRow("Move", "an_p", pose.pos)}
				<div class="arow"><button id="an_keydel" title="Remove this frame's key"${key ? "" : " disabled"}>Remove key</button><button id="an_keyrest" title="Back to the rest pose on this frame (keeps a key)">Rest here</button></div>
				<p class="dim">Changing a value keys it on this frame. Or drag the bone's tip in the view (turns about the depth axis); to move it in depth drag its green Y arrow, or press G then Y.</p></div>`);
		}
		h += section("weights", "Weights", weightsPanel(a, bone));
		h += section("sheet", "Preview &amp; Aseprite", `<div class="arow"><label title="What the preview below shows. The big Lit / Normals tab on the right plays the same frames.">Preview <select id="an_pmode"><option value="lit"${previewMode === "lit" ? " selected" : ""}>Lit</option><option value="normal"${previewMode === "normal" ? " selected" : ""}>Normal</option><option value="albedo"${previewMode === "albedo" ? " selected" : ""}>Albedo</option></select></label></div><canvas id="an_prev" class="prev" title="This frame, lit by the normal map and your Albedo. Move the pointer over it to move the light."></canvas>
			<p id="an_sheetinfo" class="dim">${sheetText()}</p>
			<div class="arow"><button id="an_link" title="Link to Aseprite through a folder on this computer, and see each step of the link">${Link.linked() ? "Link status…" : "Link Aseprite…"}</button>${Link.linked() ? '<button id="an_unlink">Unlink</button>' : ""}</div>
			<p class="linkline"><span id="an_linkdot" class="dot ${linkState[0]}"></span><span id="an_linkstate" class="linkstate ${linkState[0]}">${esc(linkState[1])}</span></p>
			<div class="arow"><button id="an_dl" title="Download the reference sheet (the models' base colours, the same picture Aseprite gets) as a PNG to paint over in any program">Download reference sheet</button><button id="an_ld" title="Load a flattened Albedo sheet PNG from Aseprite (must match the sheet size)">Load albedo sheet…</button></div>`);
		// The panel is rebuilt on every edit: keep its scroll, and let Tab reach the next field though the one it left is gone.
		const scroller = body.closest(".sec")?.parentElement, top = scroller ? scroller.scrollTop : 0;
		body.innerHTML = h;
		if (scroller) scroller.scrollTop = top;
		for (const d of body.querySelectorAll("details[data-sec]")) d.ontoggle = () => { secClosed[d.open ? "delete" : "add"](d.dataset.sec); TS.store.set("tsAnClosed", [...secClosed].join(",")); };
		wire();
		drawPreview();
		timeline();
		const fields = [...body.querySelectorAll("input, select, button")].filter((el) => !el.disabled && el.id);
		if (tabFrom) {
			const i = fields.findIndex((el) => el.id === tabFrom.id), to = i >= 0 && fields[i + (tabFrom.back ? -1 : 1)];
			if (to) to.focus();
			tabFrom = null;
		}
	}
	// Sections of the panel fold, and stay as they were left.
	const secClosed = new Set((TS.store.get("tsAnClosed") || "weights").split(",").filter(Boolean));
	let tabFrom = null;
	const section = (id, title, html) => `<details class="ansec" data-sec="${id}"${secClosed.has(id) ? "" : " open"}><summary>${title}</summary>${html}</details>`;

	// --- weight painting ---

	// Models that deform and whose skeleton holds the active bone: the ones its weights can be painted on.
	function paintTargets() {
		const a = A();
		return S().objects.filter((o) => { if (o.hidden) return false; const w = Rig.skinWeights(a, o); return w && w.list.some((b) => b.id === boneSel); });
	}
	// Blue (none) through green to red (all of it): the weight of the active bone, as a vertex tint.
	const HEAT = [[0, [0.1, 0.2, 0.85]], [0.25, [0.1, 0.75, 0.95]], [0.5, [0.2, 0.85, 0.25]], [0.75, [0.98, 0.9, 0.15]], [1, [0.95, 0.15, 0.1]]];
	function heatColor(w) {
		w = TS.clamp(w, 0, 1);
		let i = 0;
		while (i < HEAT.length - 2 && w > HEAT[i + 1][0]) i++;
		const [w0, c0] = HEAT[i], [w1, c1] = HEAT[i + 1], t = (w - w0) / (w1 - w0);
		return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t, 0.92];
	}
	function weightsPanel(a, bone) {
		const total = S().objects.reduce((n, o) => n + Rig.paintCount(a, o), 0), stale = S().objects.filter((o) => Rig.paintStale(a, o)).map((o) => esc(o.name));
		let h = `<div class="arow"><button id="an_paint" class="${paintMode ? "on" : ""}"${bone || paintMode ? "" : " disabled"} title="Paint the selected bone's weights straight onto the models: red = the vertex follows this bone fully, blue = not at all. Select a bone first.">${paintMode ? "Done (Esc)" : "Weight paint"}</button><button id="an_wreset" title="Throw away the painting on the selected models (all models if none is selected) and go back to automatic weights"${total ? "" : " disabled"}>Reset to auto</button></div>`;
		if (stale.length) h += `<p class="warnline">⚠ ${stale.join(", ")} changed shape since it was painted, so its painted weights are ignored. Reset to auto to clear them.</p>`;
		if (!paintMode) return h + `<p class="dim">${total ? `${total} painted vertices; the rest follow the bones' distance.` : "Weights are automatic (by distance to the bones). Paint to fix a joint by hand."}</p>`;
		const opt = (v, t) => `<option value="${v}"${brush.mode === v ? " selected" : ""}>${t}</option>`, targets = bone ? paintTargets().length : 0;
		return h + `<div class="arow"><label title="Mix: paint toward the Weight below. Add / Subtract: give or take weight on this bone (Ctrl flips them). Smooth: blend each vertex with its neighbours.">Brush <select id="an_bmode">${opt("mix", "Mix")}${opt("add", "Add")}${opt("sub", "Subtract")}${opt("smooth", "Smooth")}</select></label></div>
			<div class="arow"><label title="The weight Mix paints toward">Weight <input id="an_bw" type="range" min="0" max="1" step="0.05" value="${brush.weight}"><span id="an_bwv" class="dim">${brush.weight}</span></label></div>
			<div class="arow"><label title="How much each dab changes (hold still to keep painting)">Strength <input id="an_bs" type="range" min="0.05" max="1" step="0.05" value="${brush.strength}"><span id="an_bsv" class="dim">${brush.strength}</span></label></div>
			<div class="arow"><label title="Brush size in screen pixels ( [ and ] change it )">Radius <input id="an_br" type="range" min="6" max="160" step="2" value="${brush.radius}"><span id="an_brv" class="dim">${brush.radius}</span></label></div>
			<label class="chk" title="Also paint vertices hidden behind the front of a model"><input id="an_bthru" type="checkbox"${brush.through ? " checked" : ""}> Paint through the model</label>
			<p class="dim">${bone ? (targets ? `Painting <b>${esc(bone.name)}</b> on ${targets} model${targets > 1 ? "s" : ""}. Drag in the view; Ctrl flips Add / Subtract; pick another bone in the list to paint it. Every vertex always adds up to 100% across the bones. Pose the bones to check the bend.` : `<span class="warn">${esc(bone.name)} is not part of a deforming model's skeleton. Bind a model to it (and keep it on Deform), or pick another bone.</span>`) : "Select a bone in the list to paint its weights."}</p>`;
	}
	function togglePaint(v) {
		const want = v === undefined ? !paintMode : v;
		if (want && !boneSel) return api().toast("Select a bone first: you paint that bone's weights.", "bad");
		if (want && restMode) toggleRest(false);
		if (want && playing) togglePlay();
		paintMode = want;
		if (!want) { stroke = null; brushAt = null; }
		api().redrawSoon(); draw(); render();
		api().status(paintMode ? "Weight painting: drag over the models to paint the selected bone's weights (Esc to finish)." : "Back to posing.");
	}
	function paintStart(e) {
		const a = A(), r = api().renderer, targets = paintTargets();
		if (!boneSel || !targets.length) return api().status("Nothing to paint: select a bone that a deforming model is bound to.");
		const posed = Rig.posedObjects(targets, a, clip(), a.frame);
		const hid = S().objects.filter((o) => !o.hidden);
		stroke = { before: api().snapshot(), targets, sp: posed.map((o) => o.verts.map((p) => r.toScreen(p))), occl: brush.through ? null : Rig.posedObjects(hid, a, clip(), a.frame), posed, changed: false, ctrl: e.ctrlKey || e.metaKey, last: null };
		window.addEventListener("pointermove", paintMove);
		window.addEventListener("pointerup", paintEnd);
		stroke.timer = setInterval(() => stroke && stroke.last && paintDab(), 70); // holding still keeps painting
		paintMove(e);
	}
	function paintMove(e) {
		stroke.ctrl = e.ctrlKey || e.metaKey;
		const rect = $("view").getBoundingClientRect();
		stroke.last = [e.clientX - rect.left, e.clientY - rect.top];
		brushAt = stroke.last;
		paintDab();
		moveBrush();
	}
	function paintDab() {
		const a = A(), r = api().renderer, [px, py] = stroke.last, R2 = brush.radius;
		const hits = [];
		stroke.targets.forEach((o, k) => stroke.sp[k].forEach((s, i) => {
			if (!s) return;
			const d = Math.hypot(s[0] - px, s[1] - py);
			if (d > R2) return;
			if (stroke.occl && !r.visible(stroke.occl, stroke.posed[k].verts[i], 1.5)) return;
			hits.push({ model: o, i, f: 0.5 * (1 + Math.cos(Math.PI * (d / R2))) });
		}));
		if (!hits.length) return;
		const flip = stroke.ctrl, mode = flip ? (brush.mode === "add" ? "sub" : brush.mode === "sub" ? "add" : brush.mode) : brush.mode;
		if (Rig.paintDab(a, boneSel, hits, mode, brush.strength, flip && mode === "mix" ? 0 : brush.weight)) {
			stroke.changed = true;
			api().redrawSoon(); scheduleSheet();
		}
	}
	function paintEnd() {
		window.removeEventListener("pointermove", paintMove);
		window.removeEventListener("pointerup", paintEnd);
		clearInterval(stroke.timer);
		const s = stroke;
		stroke = null;
		if (s.changed) { api().pushUndo(s.before); api().markUnsaved(); render(); }
	}
	// The brush ring follows the pointer over the view.
	function moveBrush() {
		const svg = $("bone_overlay"), ring = svg && svg.querySelector(".brushring");
		if (!ring) return api().redrawSoon();
		if (!brushAt) return ring.setAttribute("r", 0);
		ring.setAttribute("cx", brushAt[0]); ring.setAttribute("cy", brushAt[1]); ring.setAttribute("r", brush.radius);
	}

	function wire() {
		const q = (id) => $(id), a = A(), c = clip(), bone = boneSel && Rig.bone(a, boneSel);
		q("an_paint").onclick = () => togglePaint();
		q("an_wreset").onclick = () => {
			const ids = S().selected.size ? [...S().selected] : S().objects.map((o) => o.id);
			edit(() => { for (const o of S().objects) if (ids.includes(o.id)) Rig.clearPaint(a, o); });
		};
		if (paintMode) {
			q("an_bmode").onchange = () => { brush.mode = q("an_bmode").value; };
			for (const [id, key, out] of [["an_bw", "weight", "an_bwv"], ["an_bs", "strength", "an_bsv"], ["an_br", "radius", "an_brv"]])
				q(id).oninput = () => { brush[key] = parseFloat(q(id).value); q(out).textContent = brush[key]; moveBrush(); };
			q("an_bthru").onchange = () => { brush.through = q("an_bthru").checked; };
		}
		q("an_clip").onchange = () => { a.clip = q("an_clip").value; a.frame = 0; keySel.clear(); touched(); restartPlay(); };
		q("an_clipnew").onclick = () => edit(() => { const n = Rig.newClip("Clip " + (a.clips.length + 1), c.frames, c.fps); a.clips.push(n); a.clip = n.id; a.frame = 0; });
		q("an_clipdel").onclick = () => edit(() => { a.clips = a.clips.filter((x) => x !== c); a.clip = a.clips[0].id; a.frame = 0; });
		q("an_clipname").onchange = () => edit(() => { c.name = q("an_clipname").value.trim() || c.name; });
		q("an_frames").onchange = () => edit(() => { c.frames = TS.clamp(parseInt(q("an_frames").value, 10) || c.frames, 1, 64); a.frame = Math.min(a.frame, c.frames - 1); });
		q("an_loop").onchange = () => edit(() => { if (q("an_loop").value === "loop") delete c.loop; else c.loop = q("an_loop").value; });
		q("an_models").onclick = () => { const ids = [...S().selected]; if (!ids.length) return api().toast("Select the models this clip animates first.", "bad"); edit(() => { c.models = ids; }); };
		q("an_modelsclear").onclick = () => edit(() => { delete c.models; });
		q("an_fps").onchange = () => { edit(() => { c.fps = TS.clamp(parseInt(q("an_fps").value, 10) || c.fps, 1, 60); }); restartPlay(); };
		for (const li of document.querySelectorAll("#an_bones li[data-id]")) li.onclick = (e) => { selectBone(li.dataset.id, e.shiftKey || e.ctrlKey || e.metaKey); api().redrawSoon(); render(); };
		q("an_boneadd").onclick = () => edit(() => {
			const parent = bone, head = parent ? parent.tail.slice() : S().cursor.slice();
			const b = Rig.newBone("Bone " + (a.bones.length + 1), head, [head[0], head[1], head[2] + 24], parent && parent.id);
			if (parent) b.connected = true;
			a.bones.push(b); selectBone(b.id);
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
		q("an_rest").onclick = () => toggleRest();
		q("an_gz").onchange = () => { showGizmos = q("an_gz").checked; savePref("tsGizmos", showGizmos); draw(); };
		q("an_names").onchange = () => { showNames = q("an_names").checked; savePref("tsNames", showNames); draw(); };
		q("an_ik").onchange = () => { ikOn = q("an_ik").checked; savePref("tsIK", ikOn); api().status(ikOn ? "IK limbs on: drag the ball at a hand or foot and the arm or leg bends to follow." : "IK limbs off: dragging a tip turns only that bone."); };
		q("an_pin").onclick = () => togglePins();
		if (q("an_unpinall")) q("an_unpinall").onclick = () => edit(() => { delete c.pins; });
		for (const el of $("an_body").querySelectorAll("[data-unpin]")) el.onclick = () => edit(() => { delete c.pins[el.dataset.unpin]; if (!Object.keys(c.pins).length) delete c.pins; });
		q("an_bonedel").onclick = () => bone && edit(() => deleteBones(selIds()));
		if (bone) {
			q("an_bname").onchange = () => edit(() => { bone.name = q("an_bname").value.trim() || bone.name; });
			q("an_bparent").onchange = () => edit(() => {
				bone.parent = q("an_bparent").value || null;
				if (bone.connected) { bone.connected = false; api().status("Parent changed and the bone is no longer connected (Ctrl+Z undoes)."); }
			});
			q("an_bik").onchange = () => { const v = Math.max(0, Math.min(8, Math.round(parseFloat(q("an_bik").value) || 0))); edit(() => { if (v) bone.ik = v; else delete bone.ik; }); };
			q("an_conn").onchange = () => edit(() => { bone.connected = q("an_conn").checked && !!bone.parent; reconnect(a); });
			for (const [key, prop] of [["an_h", "head"], ["an_t", "tail"]]) for (let i = 0; i < 3; i++)
				q(key + i).onchange = () => { const v = parseFloat(q(key + i).value); if (!isNaN(v)) edit(() => { setPoint(bone, prop, i, v); }); };
			const objs = () => [...S().selected];
			q("an_bind").onclick = () => objs().length ? edit(() => { for (const id of objs()) a.bind[id] = bone.id; }) : api().toast("Select the models first.", "bad");
			q("an_unbind").onclick = () => edit(() => { for (const id of objs()) { delete a.bind[id]; if (a.rigid) delete a.rigid[id]; } });
			q("an_skin").onclick = () => objs().length ? edit(() => { for (const id of objs()) if (a.rigid) delete a.rigid[id]; }) : api().toast("Select the models first.", "bad");
			q("an_unskin").onclick = () => objs().length ? edit(() => { a.rigid = a.rigid || {}; for (const id of objs()) a.rigid[id] = true; }) : api().toast("Select the models first.", "bad");
			q("an_stiff").onchange = () => edit(() => { const v = parseFloat(q("an_stiff").value); if (!isNaN(v)) { a.skin = a.skin || {}; for (const id of objs()) a.skin[id] = { stiff: TS.clamp(v, 0.5, 12) }; } });
			// Pose fields: apply live while dragging, one undo step per gesture.
			let before = null;
			const live = () => {
				const pose = Rig.localPose(c, bone.id, a.frame);
				const rot = [0, 1, 2].map((i) => parseFloat(q("an_r" + i).value) || 0), pos = [0, 1, 2].map((i) => (q("an_p" + i) ? parseFloat(q("an_p" + i).value) || 0 : pose.pos[i]));
				Rig.setKey(c, bone.id, a.frame, rot.map((v, i) => (isNaN(v) ? pose.rot[i] : v)), pos);
				holdPins(new Set([bone.id]));
				api().redrawSoon(); scheduleSheet(); timeline(); drawPreview();
			};
			const settle = () => { if (before) { api().pushUndo(before); before = null; api().markUnsaved(); render(); } };
			for (const id of [0, 1, 2].flatMap((i) => ["an_rr" + i, "an_r" + i, "an_p" + i]).filter((id) => q(id))) {
				// Posing keys the frame on screen, so playback stops first (the fields show that frame's pose).
				q(id).onfocus = q(id).onpointerdown = () => { if (playing) { togglePlay(); return; } before = before || api().snapshot(); };
				q(id).oninput = () => { if (id.startsWith("an_rr")) q("an_r" + id.slice(5)).value = q(id).value; before = before || api().snapshot(); live(); };
				q(id).onchange = () => { if (id.startsWith("an_r") && !id.startsWith("an_rr")) q("an_rr" + id.slice(4)).value = q(id).value; live(); settle(); };
			}
			q("an_keydel").onclick = () => edit(() => Rig.deleteKey(c, bone.id, a.frame));
			q("an_keyrest").onclick = () => edit(() => Rig.setKey(c, bone.id, a.frame, [0, 0, 0], [0, 0, 0]));
		}
		q("an_learn").onclick = () => TS.Learn.openSection("anim");
		q("an_link").onclick = (e) => { e.stopPropagation(); $("b_aseprite").nextElementSibling.classList.add("open"); }; // one place to link, from the panel or the top bar
		if (q("an_unlink")) q("an_unlink").onclick = () => { Link.disconnect(); render(); };
		q("an_dl").onclick = downloadSheet;
		q("an_ld").onclick = loadAlbedoFile;
		q("an_pmode").onchange = () => { previewMode = q("an_pmode").value; drawPreview(); };
		const pv = q("an_prev");
		pv.onpointermove = (e) => { const r = pv.getBoundingClientRect(); light = [(e.clientX - r.left) / r.width - 0.5, 0.5 - (e.clientY - r.top) / r.height]; drawPreview(); };
	}

	// --- timeline ---

	function setFrame(f) {
		const c = clip();
		if (!c) return;
		A().frame = ((f % c.frames) + c.frames) % c.frames;
		api().redrawSoon();
		drawPreview(); showFrameArt();
		if (boneSel) render(); else timeline();
	}
	// The 3D view shows the current frame's Albedo (its cell of the received sheet) as the art; a frame with none shows none.
	// Without a matching sheet, or outside animation mode, the tileset art itself is shown.
	let artShown = null;
	function showFrameArt() {
		const art = S().art, r = api().renderer, c = clip();
		if (!art || !r) return;
		const lay = c && Rig.layout(art.w, art.h, c.frames), own = on && albedo && lay && albedo.width === lay.w && albedo.height === lay.h;
		// Without a sheet every frame shows the same art: it goes to the graphics card once, not on every frame of playback.
		const shown = { art, albedo: own ? albedo : null, frame: own ? A().frame : -1 };
		if (artShown && artShown.art === shown.art && artShown.albedo === shown.albedo && artShown.frame === shown.frame) return;
		artShown = shown;
		const cv = document.createElement("canvas");
		cv.width = art.w; cv.height = art.h;
		const g = cv.getContext("2d");
		if (own) {
			const [ox, oy] = Rig.cellOrigin(lay, A().frame), cellImg = new ImageData(art.w, art.h);
			for (let y = 0; y < art.h; y++) cellImg.data.set(albedo.data.subarray(((oy + y) * lay.w + ox) * 4, ((oy + y) * lay.w + ox + art.w) * 4), y * art.w * 4);
			g.putImageData(cellImg, 0, 0);
		} else g.putImageData(new ImageData(new Uint8ClampedArray(art.data), art.w, art.h), 0, 0);
		r.setArt(cv, art.w, art.h);
		api().redrawSoon();
	}
	// The dopesheet: a ruler to scrub, a row of every keyed frame, and one row per bone. Drag a key to move it (Alt copies), drag across
	// a row to box-select, Delete removes, Ctrl+C / Ctrl+V copy and paste at the playhead.
	let frameW = TS.clamp(+TS.store.get("tsTlZoom") || 20, 10, 48), tlHover = false; // pixels per frame in the dopesheet, and whether the pointer is over it
	function timeline() {
		const el = $("timeline");
		if (!el || !on) return;
		const c = clip(), a = A();
		if (!c) return;
		const old = el.querySelector(".tlgrid"), sl = old ? old.scrollLeft : 0, st = old ? old.scrollTop : 0;
		for (const s of [...keySel]) { const i = s.lastIndexOf("|"); if (!Rig.keyAt(c, s.slice(0, i), +s.slice(i + 1))) keySel.delete(s); }
		const past = Object.values(c.tracks).some((ks) => ks.some((k) => k.f >= c.frames));
		const depth = (b) => { let d = 0; for (let p = b.parent && Rig.bone(a, b.parent); p && d < 50; p = p.parent && Rig.bone(a, p.parent)) d++; return d; };
		const eases = easeTargets().map((k) => k.ease || "linear"), ease = eases.length && eases.every((v) => v === eases[0]) ? eases[0] : "";
		const diamond = (k, id) => `<i class="kd e-${k.ease || "linear"}${keySel.has(keyName(id, k.f)) ? " sel" : ""}" data-b="${id}" data-f="${k.f}" style="left:${k.f * frameW}px" title="Frame ${k.f + 1}${k.ease ? " · " + k.ease : ""}"></i>`;
		const all = new Set();
		for (const ks of Object.values(c.tracks)) for (const k of ks) if (k.f < c.frames) all.add(k.f);
		const track = `width:${c.frames * frameW}px`, lblStep = frameW >= 22 ? 1 : frameW >= 14 ? 5 : 10; // wide frames label every frame, narrow ones every 5th / 10th
		el.style.setProperty("--fw", frameW + "px");
		let rows = `<div class="tlrow sum"><div class="tlname" title="Every key on a frame together">All bones${a.bones.length && Object.keys(c.tracks).length ? "" : ' <span class="dim">(no keys yet)</span>'}${a.bones.length ? `<button id="tl_fold" title="${tlCollapsed ? "Show" : "Hide"} the bone rows">${tlCollapsed ? "▸" : "▾"}</button>` : ""}</div><div class="tltrack" style="${track}">${[...all].map((f) => `<i class="kd all${Object.keys(c.tracks).some((id) => keySel.has(keyName(id, f))) ? " sel" : ""}" data-all="1" data-f="${f}" style="left:${f * frameW}px" title="All keys on frame ${f + 1}"></i>`).join("")}</div></div>`;
		if (!tlCollapsed) for (const b of Rig.ordered(a)) rows += `<div class="tlrow${isSel(b.id) ? " on" : ""}" data-bone="${b.id}"><div class="tlname" style="padding-left:${6 + depth(b) * 10}px" title="${esc(b.name)}">${esc(b.name)}</div><div class="tltrack" style="${track}">${(c.tracks[b.id] || []).filter((k) => k.f < c.frames).map((k) => diamond(k, b.id)).join("")}</div></div>`;
		el.classList.toggle("atrest", restMode);
		el.innerHTML = `<div class="tlbar"><div class="tlmode" role="group" aria-label="Animate mode"><button id="tl_pose" class="${restMode ? "" : "on"}" aria-pressed="${!restMode}" title="Pose: bones move and keys on this frame (Tab switches)">Pose</button><button id="tl_rest" class="${restMode ? "on" : ""}" aria-pressed="${restMode}" title="Rest pose: reshape the bones themselves; models show at rest and keys don't apply (Tab switches)">Rest</button></div><div class="tlctl"><button id="tl_prev" title="Previous frame (, or Left)">◀</button><button id="tl_play" class="${playing ? "on" : ""}" title="Play / stop (Space)">${playing ? "■" : "▶"}</button><button id="tl_next" title="Next frame (. or Right)">▶▶</button><span class="tlpos" title="Current frame / frames in the clip">${a.frame + 1} / ${c.frames}</span></div>` +
			`<label class="tlease" title="How the picked keys (or the selected bones' keys on this frame) leave for the next key. Hold keeps the pose until then."><span class="dim">Ease</span> <select id="tl_ease"${eases.length ? "" : " disabled"}>${ease ? "" : '<option value="">–</option>'}${Rig.EASES.map(([v, t]) => `<option value="${v}"${v === ease ? " selected" : ""}>${t}</option>`).join("")}</select></label>` +
			`<button id="tl_bones" class="${showBones ? "on" : ""}" aria-pressed="${showBones}" title="Show the bones over the view while posing (the rest pose always shows them)">Bones</button>` +
			`<span class="tlonion" role="group" aria-label="Onion skin"><input id="tl_onb" type="number" min="0" max="8" value="${onionBack}" title="Onion skin: how many frames back to show (red)" aria-label="Onion frames back"><button id="tl_onion" class="${showOnion ? "on" : ""}" aria-pressed="${showOnion}" title="Onion skin: see-through ghosts of the models on the frames before (red) and after (green), while stopped. The numbers set how many frames each way.">Onion</button><input id="tl_ona" type="number" min="0" max="8" value="${onionFwd}" title="Onion skin: how many frames forward to show (green)" aria-label="Onion frames forward"></span>` +
			`<button id="tl_seam" title="Key the first frame's pose on the last frame, so the loop has no jump (selected bones, or all with keys)">Close loop</button>` +
			`<button id="tl_mirror" title="Flip this frame's pose across X onto the other side's bones (arm.L and arm.R; selected bones, or all)">Mirror pose</button>` +
			`<span class="tlzoom" role="group" aria-label="Frames and zoom"><button id="tl_fins" title="Insert a frame at the playhead: later keys move one frame on (up to 64 frames)">+ Frame</button><button id="tl_fdel" title="Remove the playhead's frame and its keys: later keys move one frame back">− Frame</button><button id="tl_zo" title="Narrower frames (Ctrl+wheel over the dopesheet)">−</button><button id="tl_zi" title="Wider frames (Ctrl+wheel over the dopesheet)">+</button></span>` +
			`<span class="dim tlhint" title="${esc(c.name)} · ${c.fps} fps · ${esc(c.loop || "loop")}. Drag a key to move it, Alt-drag to copy, drag a row to box-select, Delete removes, Ctrl+C / Ctrl+V paste at the playhead, Up / Down jump between keys.${past ? " Some keys lie past the last frame: raise the frame count to see them again." : ""}">${past ? '<span class="warn">keys past the end · </span>' : ""}${esc(c.name)} · ${c.fps} fps · ${esc(c.loop || "loop")}</span></div>` +
			`<div class="tlgrid"><div class="tlrow ruler"><div class="tlname"></div><div class="tltrack" data-ruler="1" style="${track}">${Array.from({ length: c.frames }, (_, i) => rulerLabel(i, lblStep)).join("")}</div></div>${rows}<div class="tlhead" id="tl_head" style="left:calc(var(--tl-names) + ${a.frame * frameW}px);width:${frameW}px;height:${(2 + (tlCollapsed ? 0 : a.bones.length)) * 18}px"></div></div>`;
		$("tl_prev").onclick = () => setFrame(a.frame - 1);
		$("tl_next").onclick = () => setFrame(a.frame + 1);
		$("tl_play").onclick = togglePlay;
		$("tl_pose").onclick = () => { if (restMode) toggleRest(false); };
		$("tl_rest").onclick = () => { if (!restMode) toggleRest(true); };
		$("tl_ease").onchange = () => setEase($("tl_ease").value);
		$("tl_bones").onclick = () => { showBones = !showBones; TS.store.set("tsBones", showBones ? "1" : "0"); const b = $("tl_bones"); b.classList.toggle("on", showBones); b.setAttribute("aria-pressed", showBones); draw(); };
		$("tl_onion").onclick = () => { showOnion = !showOnion; TS.store.set("tsOnion", showOnion ? "1" : "0"); const b = $("tl_onion"); b.classList.toggle("on", showOnion); b.setAttribute("aria-pressed", showOnion); draw(); };
		// The frame counts: changing one turns the onion skin on, since that is what the person wants to see.
		const onionInput = (id, key, set) => {
			const el = $(id);
			el.oninput = () => {
				const v = parseInt(el.value, 10);
				if (!Number.isFinite(v)) return;
				set(TS.clamp(v, 0, 8)); TS.store.set(key, String(TS.clamp(v, 0, 8)));
				if (!showOnion) { showOnion = true; TS.store.set("tsOnion", "1"); const b = $("tl_onion"); b.classList.add("on"); b.setAttribute("aria-pressed", true); }
				draw();
			};
		};
		onionInput("tl_onb", "tsOnionBack", (v) => { onionBack = v; });
		onionInput("tl_ona", "tsOnionFwd", (v) => { onionFwd = v; });
		$("tl_seam").onclick = () => {
			const ids = boneSel ? selIds() : Object.keys(c.tracks);
			if (!ids.length || c.frames < 2) return api().toast("Key a pose first: the last frame takes the first frame's pose.", "bad");
			edit(() => Rig.closeLoop(c, ids));
		};
		$("tl_mirror").onclick = () => {
			if (!a.bones.length) return api().toast("Add bones first.", "bad");
			edit(() => Rig.mirrorPose(a, c, a.frame, boneSel ? selIds() : a.bones.map((b) => b.id)));
		};
		$("tl_fins").onclick = insertFrame;
		$("tl_fdel").onclick = removeFrame;
		$("tl_zo").onclick = () => zoomTimeline(frameW - 4);
		$("tl_zi").onclick = () => zoomTimeline(frameW + 4);
		el.onpointerenter = () => { tlHover = true; };
		el.onpointerleave = () => { tlHover = false; };
		if ($("tl_fold")) $("tl_fold").onclick = (e) => { e.stopPropagation(); tlCollapsed = !tlCollapsed; TS.store.set("tsTlRows", tlCollapsed ? "0" : "1"); timeline(); };
		const grid = el.querySelector(".tlgrid");
		grid.scrollLeft = sl; grid.scrollTop = st;
		grid.onpointerdown = gridDown;
		grid.ondblclick = gridDouble;
		grid.oncontextmenu = gridMenu;
		grid.onwheel = (e) => { if (!e.ctrlKey) return; e.preventDefault(); zoomTimeline(frameW * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.deltaY < 0 ? 1 : -1); };
		followFrame();
	}
	// The keys an ease applies to: those picked, else the selected bones' keys on this frame.
	function easeTargets() {
		const c = clip(), a = A();
		const list = keySel.size ? picked().map((p) => Rig.keyAt(c, p.id, p.f)) : selIds().map((id) => Rig.keyAt(c, id, a.frame));
		return list.filter(Boolean);
	}
	function setEase(v) {
		if (!v) return;
		const keys = easeTargets();
		if (!keys.length) return;
		const c = clip(), a = A();
		// edit() takes its snapshot first, so name the keys again inside it
		const names = keySel.size ? picked() : selIds().map((id) => ({ id, f: a.frame }));
		edit(() => { for (const p of names) { const k = Rig.keyAt(c, p.id, p.f); if (k) { if (v === "linear") delete k.ease; else k.ease = v; } } });
	}
	function deleteKeys() {
		const c = clip(), list = picked();
		edit(() => { for (const p of list) Rig.deleteKey(c, p.id, p.f); keySel.clear(); });
		api().status(`Deleted ${list.length} key${list.length > 1 ? "s" : ""}.`);
	}
	function copyKeys() {
		keyClip = Rig.copyKeys(clip(), picked());
		api().status(`Copied ${keyClip ? keyClip.length : 0} key(s). Ctrl+V pastes them at the playhead.`);
	}
	function pasteKeys() {
		const c = clip(), a = A();
		edit(() => { const out = Rig.pasteKeys(c, keyClip, a.frame, a); keySel.clear(); for (const p of out) keySel.add(keyName(p.id, p.f)); });
	}
	// One ruler number: every frame when there is room, else the first and every 5th / 10th; the others stay blank.
	function rulerLabel(i, step) {
		const n = i + 1;
		if (step > 1 && n !== 1 && n % step) return "";
		return `<span class="${n % 5 === 0 || n === 1 ? "" : "minor"}" style="left:${i * frameW}px">${n}</span>`;
	}
	// Change the frame width (10-48 px, remembered). The scroll scales with it so the view stays on the same frames; the playhead is then
	// brought back into sight by timeline() -> followFrame(). `dir` makes a small step still move when rounding would hide it.
	function zoomTimeline(w, dir) {
		const old = frameW;
		w = TS.clamp(Math.round(w), 10, 48);
		if (dir && w === old) w = TS.clamp(old + dir, 10, 48);
		if (w === old) return;
		frameW = w;
		TS.store.set("tsTlZoom", String(w));
		const g = document.querySelector("#timeline .tlgrid");
		if (g) g.scrollLeft *= w / old;
		timeline();
	}
	function insertFrame() {
		const c = clip(), a = A();
		if (c.frames >= 64) return api().toast("A clip holds 64 frames at most.", "bad");
		edit(() => { Rig.insertFrames(c, a.frame, 1); keySel.clear(); });
		api().status(`Inserted a frame at ${a.frame + 1}.`);
	}
	function removeFrame() {
		const c = clip(), a = A();
		if (c.frames <= 1) return api().toast("A clip keeps at least one frame.", "bad");
		edit(() => { Rig.removeFrames(c, a.frame, 1); keySel.clear(); a.frame = Math.min(a.frame, c.frames - 1); });
		api().status(`Removed frame ${a.frame + 1}.`);
	}
	// Pick every key in the clip.
	function pickAllKeys() {
		keySel.clear();
		for (const p of Rig.allKeys(clip())) keySel.add(keyName(p.id, p.f));
		timeline();
	}
	// Double-click a key: go to its frame and select its bone.
	function gridDouble(e) {
		const kd = e.target.closest(".kd");
		if (!kd) return;
		if (kd.dataset.b) { selectBone(kd.dataset.b); S().selected.clear(); }
		showFrameNow(+kd.dataset.f);
		api().redrawSoon();
		render();
	}
	// Right-click a key: a small menu of what can be done to the picked keys.
	function closeKeyMenu() { const m = document.getElementById("tl_menu"); if (m) m.remove(); }
	function gridMenu(e) {
		const kd = e.target.closest(".kd[data-b]");
		closeKeyMenu();
		if (!kd) return;
		e.preventDefault();
		const n = keyName(kd.dataset.b, +kd.dataset.f);
		if (!keySel.has(n)) { keySel.clear(); keySel.add(n); timeline(); }
		const eases = easeTargets().map((k) => k.ease || "linear"), cur = eases.length && eases.every((v) => v === eases[0]) ? eases[0] : "";
		const m = document.createElement("div");
		m.id = "tl_menu"; m.className = "menu open tlmenu";
		const items = Rig.EASES.map(([v, t]) => [t, () => setEase(v), v === cur]).concat([null, ["Copy", copyKeys], ["Paste at playhead", pasteKeys, false, !keyClip], ["Delete", deleteKeys]]);
		for (const it of items) {
			if (!it) { m.append(document.createElement("hr")); continue; }
			const b = document.createElement("button");
			b.textContent = (it[2] ? "✓ " : "") + it[0];
			b.disabled = !!it[3];
			b.onclick = () => { closeKeyMenu(); it[1](); };
			m.append(b);
		}
		document.body.append(m);
		m.style.left = Math.min(e.clientX, innerWidth - m.offsetWidth - 4) + "px";
		m.style.top = Math.min(e.clientY, innerHeight - m.offsetHeight - 4) + "px";
		const away = (ev) => {
			if (ev.type === "keydown" ? ev.key !== "Escape" : m.contains(ev.target)) return;
			if (ev.type === "keydown") { ev.preventDefault(); ev.stopImmediatePropagation(); }
			closeKeyMenu();
			window.removeEventListener("pointerdown", away, true); window.removeEventListener("keydown", away, true);
		};
		window.addEventListener("pointerdown", away, true); window.addEventListener("keydown", away, true);
	}
	// The playhead alone, for scrubbing and playback: nothing is rebuilt.
	function movePlayhead() {
		const c = clip(), head = $("tl_head"), pos = document.querySelector("#timeline .tlpos");
		if (head) head.style.left = `calc(var(--tl-names) + ${A().frame * frameW}px)`;
		if (pos && c) pos.textContent = `${A().frame + 1} / ${c.frames}`;
		followFrame();
	}
	function showFrameNow(f) {
		const c = clip();
		A().frame = TS.clamp(f, 0, c.frames - 1);
		api().redrawSoon(); drawPreview(); showFrameArt(); movePlayhead();
	}
	function gridDown(e) {
		if (e.button !== 0 || e.target.closest("button")) return;
		const grid = e.currentTarget, c = clip(), a = A(), kd = e.target.closest(".kd"), row = e.target.closest(".tlrow"), name = e.target.closest(".tlname"), inTrack = e.target.closest(".tltrack");
		if (playing) togglePlay();
		if (document.activeElement && document.activeElement.closest("#an_body")) document.activeElement.blur(); // the keys that follow are the dopesheet's
		const frameAt = (x) => { const t = grid.querySelector(".tltrack").getBoundingClientRect(); return TS.clamp(Math.floor((x - t.left) / frameW), 0, c.frames - 1); };
		const follow = (move, up) => {
			grid.setPointerCapture(e.pointerId);
			grid.onpointermove = move;
			grid.onpointerup = grid.onpointercancel = (ev) => { grid.onpointermove = grid.onpointerup = grid.onpointercancel = null; up(ev); };
		};
		e.preventDefault();
		if (name) { // a bone's name selects it
			if (row.dataset.bone) { selectBone(row.dataset.bone, e.shiftKey || e.ctrlKey || e.metaKey); S().selected.clear(); api().redrawSoon(); render(); }
			return;
		}
		if (!inTrack && !e.target.closest("#tl_head")) return;
		if (!inTrack || inTrack.dataset.ruler) { // scrub (the ruler, or the playhead line itself)
			showFrameNow(frameAt(e.clientX));
			follow((ev) => { const f = frameAt(ev.clientX); if (f !== A().frame) showFrameNow(f); }, () => { if (boneSel) render(); else timeline(); });
			return;
		}
		if (kd) { // pick a key, and drag the picked keys along the frames
			const f = +kd.dataset.f, names = kd.dataset.all ? Object.keys(c.tracks).filter((id) => Rig.keyAt(c, id, f)).map((id) => keyName(id, f)) : [keyName(kd.dataset.b, f)];
			const had = names.every((n) => keySel.has(n)), add = e.shiftKey || e.ctrlKey || e.metaKey;
			if (!had && !add) keySel.clear();
			if (add && had) names.forEach((n) => keySel.delete(n)); else names.forEach((n) => keySel.add(n));
			const marks = () => [...grid.querySelectorAll(".kd[data-b]")].filter((m) => keySel.has(keyName(m.dataset.b, +m.dataset.f)));
			grid.querySelectorAll(".kd[data-b]").forEach((m) => m.classList.toggle("sel", keySel.has(keyName(m.dataset.b, +m.dataset.f))));
			kd.classList.add("sel");
			const moving = marks();
			let df = 0;
			follow((ev) => {
				df = Math.round((ev.clientX - e.clientX) / frameW);
				for (const m of moving) m.style.transform = `translateX(${df * frameW}px) rotate(45deg)`;
			}, (ev) => {
				if (!df) { if (!add) { A().frame = f; } if (boneSel) render(); else timeline(); api().redrawSoon(); drawPreview(); showFrameArt(); return; }
				edit(() => {
					const out = Rig.moveKeys(c, picked(), df, ev.altKey || e.altKey);
					keySel.clear();
					for (const p of out) keySel.add(keyName(p.id, p.f));
				});
			});
			return;
		}
		// An empty place on a row: a click goes to that frame (and selects the row's bone); a drag draws a box round keys.
		const box = document.createElement("div"), g0 = grid.getBoundingClientRect(), x0 = e.clientX - g0.left + grid.scrollLeft, y0 = e.clientY - g0.top + grid.scrollTop;
		box.className = "tlbox";
		let boxed = false;
		follow((ev) => {
			const x1 = ev.clientX - g0.left + grid.scrollLeft, y1 = ev.clientY - g0.top + grid.scrollTop;
			if (!boxed && Math.hypot(x1 - x0, y1 - y0) < 4) return;
			if (!boxed) { boxed = true; grid.append(box); }
			box.style.cssText = `left:${Math.min(x0, x1)}px;top:${Math.min(y0, y1)}px;width:${Math.abs(x1 - x0)}px;height:${Math.abs(y1 - y0)}px`;
			const b = box.getBoundingClientRect();
			keySel.clear();
			for (const m of grid.querySelectorAll(".kd[data-b]")) {
				const r = m.getBoundingClientRect(), hit = r.right > b.left && r.left < b.right && r.bottom > b.top && r.top < b.bottom;
				m.classList.toggle("sel", hit);
				if (hit) keySel.add(keyName(m.dataset.b, +m.dataset.f));
			}
		}, () => {
			if (boxed) { box.remove(); timeline(); return; }
			keySel.clear();
			if (row && row.dataset.bone && !(e.shiftKey || e.ctrlKey || e.metaKey)) { selectBone(row.dataset.bone); S().selected.clear(); }
			a.frame = frameAt(e.clientX);
			api().redrawSoon(); drawPreview(); showFrameArt();
			if (boneSel) render(); else timeline();
		});
	}
	// Keep the current frame in sight in a long clip.
	function followFrame() {
		const box = document.querySelector("#timeline .tlgrid"), head = $("tl_head");
		if (!box || !head) return;
		const r = head.getBoundingClientRect(), br = box.getBoundingClientRect(), names = box.querySelector(".tlname");
		const left = br.left + (names ? names.offsetWidth : 0);
		if (r.left < left) box.scrollLeft -= left - r.left + 4;
		else if (r.right > br.right) box.scrollLeft += r.right - br.right + 4;
	}
	function togglePlay() {
		if (playing) { clearInterval(playing); playing = 0; draw(); timeline(); if (boneSel) render(); return; } // the Pose fields catch up with the frame
		const c0 = clip();
		if (!c0) return;
		// A "once" clip played from its last frame starts over. The frame follows the clock, so a slow redraw skips a frame rather than slowing the clip down.
		const t0 = performance.now(), f0 = c0.loop === "once" && A().frame >= c0.frames - 1 ? 0 : A().frame;
		playing = setInterval(() => {
			const c = clip();
			if (!c) return;
			const { f, done } = Rig.playFrame(c, f0, Math.floor(((performance.now() - t0) / 1000) * c.fps));
			if (f !== A().frame) {
				A().frame = f;
				api().redrawSoon(); drawPreview(); showFrameArt(); movePlayhead();
			}
			if (done) togglePlay();
		}, 500 / (clip().fps || 8));
		timeline();
	}
	// A new fps takes effect at once while playing.
	function restartPlay() { if (playing) { clearInterval(playing); playing = 0; togglePlay(); } }

	// --- bones over the model view ---

	const NS = "http://www.w3.org/2000/svg";
	// Gizmos on the selected bone: a coloured ring per axis (drag to turn about it) and an arrow per axis (drag to slide the bone),
	// shown only for the axes the current view can actually work with. Names label every bone; a dashed line joins a child to its
	// parent's tip when they aren't connected. Both are switchable and remembered.
	const AXC = ["#ff5b5b", "#5bd16b", "#5b8cff"];
	let showGizmos = true, showNames = true, ikOn = true;
	showGizmos = TS.store.get("tsGizmos") !== "0"; showNames = TS.store.get("tsNames") !== "0"; ikOn = TS.store.get("tsIK") !== "0";
	const savePref = (k, v) => TS.store.set(k, v ? "1" : "0");
	function viewDir() {
		const el = $("view"), r = el && api().renderer;
		if (!el || !r) return [0, 1, 0];
		const rect = el.getBoundingClientRect();
		return r.ray(rect.width / 2, rect.height / 2).d;
	}
	function drawGizmos(add, a, mats, r) {
		const bone = boneSel && Rig.bone(a, boneSel);
		if (!showGizmos || !bone || drag || paintMode) return;
		const M = mats.get(bone.id), H = Rig.apply(M, bone.head), T = Rig.apply(M, bone.tail), d = viewDir();
		const len = Math.hypot(T[0] - H[0], T[1] - H[1], T[2] - H[2]), R3 = TS.clamp(len * 0.45, 8, 40), L = TS.clamp(len * 0.6, 12, 48);
		const joint = bone.connected && bone.parent;
		const at = (k, s, off) => { const p = H.slice(); p[k] += s; if (off) p[off[0]] += off[1]; return r.toScreen(p); };
		for (let k = 0; k < 3; k++) {
			// Turn ring: a circle in the plane normal to axis k, seen face-on enough to drag (not in rest-pose editing).
			if (!restMode && Math.abs(d[k]) > 0.3) {
				const u = (k + 1) % 3, v = (k + 2) % 3, pts = [];
				for (let i = 0; i < 48; i++) {
					const t = (i / 48) * Math.PI * 2, p = H.slice();
					p[u] += Math.cos(t) * R3; p[v] += Math.sin(t) * R3;
					const s = r.toScreen(p);
					if (s) pts.push(s.join(","));
				}
				if (pts.length === 48) {
					const hit = add("polygon", { points: pts.join(" "), fill: "none", stroke: "transparent", "stroke-width": 12, "data-bone": bone.id, "data-gizmo": "turn:" + k });
					hit.style.cursor = "grab";
					add("polygon", { points: pts.join(" "), fill: "none", stroke: AXC[k], "stroke-width": 1.6, "stroke-opacity": 0.75, "pointer-events": "none" });
				}
			}
		}
		// The arrows go on top of every ring: a ring's wide grab zone would otherwise hide the short arrows that lie inside it (in the
		// tileset view the Y arrow ran wholly under the Z ring).
		for (let k = 0; k < 3; k++) {
			// Move arrow along axis k, the depth axis too (not for a connected bone, which can't slide; not when the view looks straight
			// down the axis, where the arrow has no length on screen: G then the axis key still moves it).
			if (!joint && Math.abs(d[k]) < 0.9) {
				const s0 = r.toScreen(H), s1 = at(k, L);
				if (!s0 || !s1) continue;
				const dx = s1[0] - s0[0], dy = s1[1] - s0[1], n = Math.hypot(dx, dy) || 1, ux = dx / n, uy = dy / n;
				const hit = add("line", { x1: s0[0], y1: s0[1], x2: s1[0], y2: s1[1], stroke: "transparent", "stroke-width": 12, "data-bone": bone.id, "data-gizmo": "move:" + k });
				hit.style.cursor = "move";
				add("line", { x1: s0[0], y1: s0[1], x2: s1[0], y2: s1[1], stroke: AXC[k], "stroke-width": 2, "pointer-events": "none" });
				add("polygon", { points: `${s1} ${s1[0] - ux * 9 - uy * 4},${s1[1] - uy * 9 + ux * 4} ${s1[0] - ux * 9 + uy * 4},${s1[1] - uy * 9 - ux * 4}`, fill: AXC[k], "pointer-events": "none" });
			}
		}
	}
	function drawLabels(add, a, mats, r) {
		for (const b of a.bones) {
			const m = mats.get(b.id), h = r.toScreen(Rig.apply(m, b.head)), t = r.toScreen(Rig.apply(m, b.tail)), p = b.parent && Rig.bone(a, b.parent);
			if (!h || !t) continue;
			// A child that isn't connected is tied to its parent's tip by a dashed line, so the hierarchy reads in the view.
			if (p && !b.connected) {
				const pt = r.toScreen(Rig.apply(mats.get(p.id), p.tail));
				if (pt) add("line", { x1: pt[0], y1: pt[1], x2: h[0], y2: h[1], stroke: "#8b8e9a", "stroke-width": 1, "stroke-dasharray": "3 3", "pointer-events": "none" });
			}
			if (!showNames) continue;
			const sel = isSel(b.id), pose = !restMode && sel && b.id === boneSel ? Rig.localPose(clip(), b.id, a.frame) : null;
			const turn = pose && pose.rot.map((v, i) => (Math.abs(v) > 0.05 ? "XYZ"[i] + " " + Math.round(v) + "°" : "")).filter(Boolean).join(" ");
			const tx = add("text", { x: (h[0] + t[0]) / 2 + 9, y: (h[1] + t[1]) / 2 + 4, fill: sel ? "#ffcf4a" : "#cfe9f7", "font-size": 11, "pointer-events": "none", stroke: "#141418", "stroke-width": 3, "paint-order": "stroke" });
			const pins = clip() && clip().pins;
			tx.textContent = (pins && pins[b.id] && !restMode ? "📌 " : "") + b.name + (b.ik > 0 ? "  IK " + b.ik : "") + (turn ? "  " + turn : "");
		}
	}
	// Onion skin: the models on the frames before (red) and after (green) as see-through solid ghosts, while stopped. Each ghost is
	// drawn whole (far faces first, lit by a fixed light so its shape reads), then laid over the view at one opacity, so its own faces
	// don't stack; ghosts further from the playhead fade more. The clip wraps round unless it plays once.
	const ONION_WORK = 400000; // faces x ghosts drawn per redraw before the ghosts step aside (a note says so)
	const ONION_LIGHT = TS.v3.norm([-0.35, -0.55, 0.75]);
	let onionBuf = null;
	function onionFrames(a, c) {
		const once = c.loop === "once", seen = new Set([a.frame]), out = [];
		for (const [dir, n] of [[-1, onionBack], [1, onionFwd]])
			for (let d = 1; d <= n; d++) {
				const f = a.frame + dir * d;
				if (once && (f < 0 || f >= c.frames)) break;
				const w = ((f % c.frames) + c.frames) % c.frames;
				if (seen.has(w)) break; // a short looping clip has come round to the playhead or the other side
				seen.add(w); out.push({ f: w, d, dir, n });
			}
		return out.sort((x, y) => y.d - x.d); // furthest first, so the nearest ghosts sit on top
	}
	function drawOnion(add, a, r) {
		const cv = $("onion_overlay");
		if (!cv) return;
		const rect = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
		const W = Math.max(1, Math.round(rect.width * dpr)), H = Math.max(1, Math.round(rect.height * dpr));
		if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
		const ctx = cv.getContext("2d");
		ctx.clearRect(0, 0, W, H);
		const c = clip();
		if (!on || !showOnion || playing || restMode || paintMode || !c || c.frames < 2 || !a.bones.length) return;
		const objs = S().objects.filter((o) => !o.hidden && a.bind[o.id]);
		const ghosts = onionFrames(a, c);
		if (!objs.length || !ghosts.length) return;
		if (objs.reduce((n, o) => n + o.faces.length, 0) * ghosts.length > ONION_WORK) {
			const t = add("text", { x: "50%", y: 38, "text-anchor": "middle", fill: "#ffb15a", "font-size": 11, "pointer-events": "none", stroke: "#141418", "stroke-width": 3, "paint-order": "stroke" });
			t.textContent = "Onion skin paused: too many faces for this many ghosts (show fewer frames)";
			return;
		}
		if (!onionBuf || onionBuf.width !== W || onionBuf.height !== H) { onionBuf = document.createElement("canvas"); onionBuf.width = W; onionBuf.height = H; }
		const bx = onionBuf.getContext("2d"), vp = r.viewProj(), m4 = TS.m4, v3 = TS.v3, Mesh = TS.Mesh;
		const sw = rect.width * dpr, sh = rect.height * dpr, look = r.ray(rect.width / 2, rect.height / 2).d;
		for (const g of ghosts) {
			const tint = g.dir < 0 ? [255, 96, 96] : [80, 214, 104], faces = [];
			for (const o of Rig.posedObjects(objs, a, c, g.f)) {
				const sp = o.verts.map((p) => { const q = m4.apply(vp, p); return q[3] > 0 ? [((q[0] / q[3]) * 0.5 + 0.5) * sw, (0.5 - (q[1] / q[3]) * 0.5) * sh] : null; });
				const dep = o.verts.map((p) => v3.dot(p, look));
				for (const face of o.faces) {
					let z = 0, ok = true;
					for (const i of face.v) { if (!sp[i]) { ok = false; break; } z += dep[i]; }
					if (!ok) continue;
					const lit = Math.abs(v3.dot(v3.norm(Mesh.faceNormal(o, face)), ONION_LIGHT)) || 0;
					faces.push({ pts: face.v.map((i) => sp[i]), z: z / face.v.length, k: 0.55 + 0.45 * lit });
				}
			}
			faces.sort((x, y) => y.z - x.z); // far to near
			bx.clearRect(0, 0, W, H);
			bx.lineJoin = "round"; bx.lineWidth = 0.6 * dpr;
			for (const f of faces) {
				const col = `rgb(${tint.map((v) => Math.round(v * f.k)).join(",")})`;
				bx.beginPath();
				f.pts.forEach((p, i) => (i ? bx.lineTo(p[0], p[1]) : bx.moveTo(p[0], p[1])));
				bx.closePath();
				bx.fillStyle = col; bx.strokeStyle = col; // the hairline stroke closes the seams between faces
				bx.fill(); bx.stroke();
			}
			ctx.globalAlpha = 0.5 * (1 - (0.65 * (g.d - 1)) / Math.max(1, g.n));
			ctx.drawImage(onionBuf, 0, 0);
		}
		ctx.globalAlpha = 1;
	}
	function draw() {
		const svg = $("bone_overlay");
		if (!svg) return;
		svg.replaceChildren();
		svg.classList.toggle("painting", on && paintMode);
		svg.classList.toggle("atrest", on && restMode);
		if (!on) { const cv = $("onion_overlay"); if (cv) cv.getContext("2d").clearRect(0, 0, cv.width, cv.height); return; }
		const a = A(), r = api().renderer, mats = Rig.matrices(a, restMode ? null : clip(), a.frame);
		const add = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); svg.appendChild(el); return el; };
		drawOnion(add, a, r);
		// Bodies and heads first, every tip after them, so where a parent's tip meets a connected child's head (a joint) the ball on top
		// is the parent's tip: grabbing a joint turns the parent (pose) or moves the joint (rest), and the child follows.
		const tips = [], bonesOn = showBones || restMode; // hidden bones still come back for the rest pose, which is all about them
		if (bonesOn) for (const b of a.bones) {
			const m = mats.get(b.id), h = r.toScreen(Rig.apply(m, b.head)), t = r.toScreen(Rig.apply(m, b.tail));
			if (!h || !t) continue;
			const sel = isSel(b.id), col = b.id === boneSel ? "#ffcf4a" : sel ? "#ff9f43" : "#5ad1ff";
			const joint = b.connected && b.parent && Rig.bone(a, b.parent);
			// A tapered diamond from head to tip, like a bone in a 3D package.
			const dx = t[0] - h[0], dy = t[1] - h[1], len = Math.hypot(dx, dy) || 1, nx = (-dy / len) * Math.min(5, len / 4), ny = (dx / len) * Math.min(5, len / 4);
			const mid = [h[0] + dx * 0.15, h[1] + dy * 0.15];
			// A short bone's diamond is a sliver, so a see-through wider stroke along it keeps it easy to catch.
			add("line", { x1: h[0], y1: h[1], x2: t[0], y2: t[1], stroke: "transparent", "stroke-width": 12, "stroke-linecap": "round", "data-bone": b.id, "data-part": "body" }).style.cursor = joint && !restMode ? "grab" : "move";
			// The body and the head dot drag the whole bone (move; a connected bone turns instead); the tip turns it.
			add("polygon", { points: `${h} ${mid[0] + nx},${mid[1] + ny} ${t} ${mid[0] - nx},${mid[1] - ny}`, fill: col + "55", stroke: col, "stroke-width": 1.2, "data-bone": b.id, "data-part": "body" }).style.cursor = joint && !restMode ? "grab" : "move";
			if (!joint) add("circle", { cx: h[0], cy: h[1], r: 5, fill: col, "data-bone": b.id, "data-part": restMode ? "head" : "body" }).style.cursor = "move";
			tips.push([b, t, sel, col]);
		}
		if (bonesOn) drawLabels(add, a, mats, r);
		if (bonesOn) drawGizmos(add, a, mats, r); // under the tips, so a bone's own ball stays on top where they cross
		for (const [b, t, sel, col] of tips) {
			// A wider see-through ring makes the ball easy to catch; it belongs to the same tip.
			add("circle", { cx: t[0], cy: t[1], r: 11, fill: "transparent", "data-bone": b.id, "data-part": "tip", class: "bonetip" }).style.cursor = "grab";
			const tip = add("circle", { cx: t[0], cy: t[1], r: 7, fill: sel ? col : "#14141899", stroke: col, "stroke-width": 1.5, class: "bonetip", "data-bone": b.id });
			tip.dataset.part = "tip"; tip.style.cursor = "grab";
		}
		// Pins: a pin head at each pinned point; a dashed line to the bone when it can't reach (the limb is too short to get there).
		const pins = !restMode && clip() && clip().pins;
		if (pins) for (const id of Object.keys(pins)) {
			const b = Rig.bone(a, id), s = b && r.toScreen(pins[id].at);
			if (!s) continue;
			if (Rig.pinGap(a, clip(), a.frame, id) > 1) { const now = r.toScreen(Rig.apply(mats.get(id), pins[id].mode === "whole" ? b.head : b.tail)); if (now) add("line", { x1: s[0], y1: s[1], x2: now[0], y2: now[1], stroke: "#ff5b5b", "stroke-width": 1.5, "stroke-dasharray": "4 3", "pointer-events": "none" }); }
			add("line", { x1: s[0], y1: s[1], x2: s[0], y2: s[1] - 14, stroke: "#ff5b5b", "stroke-width": 2, "pointer-events": "none" });
			add("circle", { cx: s[0], cy: s[1] - 16, r: 4.5, fill: "#ff5b5b", stroke: "#141418", "stroke-width": 1.5, "pointer-events": "none" });
		}
		// Which mode the view is in, always in sight.
		const badge = add("text", { x: "50%", y: 20, "text-anchor": "middle", fill: restMode ? "#ffb15a" : paintMode ? "#ff8fa3" : "#5ad1ff", "font-size": 12, "font-weight": 700, "pointer-events": "none", stroke: "#141418", "stroke-width": 3, "paint-order": "stroke" });
		badge.textContent = restMode ? "REST POSE · keys don't apply · Tab to finish" : paintMode ? "WEIGHT PAINT · Esc to finish" : `POSE · frame ${a.frame + 1}`;
		if (paintMode) add("circle", { class: "brushring", cx: brushAt ? brushAt[0] : 0, cy: brushAt ? brushAt[1] : 0, r: brushAt ? brush.radius : 0, fill: "#ffffff14", stroke: "#fff", "stroke-width": 1.2, "pointer-events": "none" });
	}
	let drag = null, restMode = false;
	// Rest-pose editing (Tab, or the Edit rest pose button): the models and bones show at rest; dragging a bone's head moves the
	// head, its tip moves the tip, its body moves both, over the same view plane / X Y Z axis as everything else. Keys are relative to
	// the rest head, so set the rest first, then animate.
	function toggleRest(v) {
		restMode = v === undefined ? !restMode : v;
		if (restMode) { paintMode = false; if (playing) togglePlay(); }
		api().redrawSoon(); draw(); render();
		api().status(restMode ? "Editing the rest pose: drag a bone's head, tip or body (X / Y / Z narrows it, a preset view picks the plane). Tab to finish." : "Back to posing.");
	}
	// A move along the view's depth axis k, the one a drag over the view plane never changes (Y in the tileset view): how far the pointer
	// travelled along that axis as it is drawn on screen, in world units at the point's own depth (the way a locked-axis move on a
	// model reads). Looking straight down the axis it has no screen direction, so the pointer's travel up the screen is used instead.
	function depthStep(k, at, from, to) {
		const r = api().renderer, u = [0, 0, 0];
		u[k] = 10;
		const a = r.toScreen(at), b = r.toScreen(v3.add(at, u));
		if (!a || !b) return 0;
		const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
		if (l2 < 0.25) return (from[1] - to[1]) / r.cam.zoom;
		return (10 * ((to[0] - from[0]) * dx + (to[1] - from[1]) * dy)) / l2;
	}
	function dragRest(e, b) {
		const rect = $("view").getBoundingClientRect(), ray = api().renderer.ray(e.clientX - rect.left, e.clientY - rect.top);
		const pt = drag.part === "tip" ? b.tail : b.head, lk = S().viewLock ? S().viewLock.k : 1;
		const at = [e.clientX - rect.left, e.clientY - rect.top], from = drag.lastPt;
		drag.lastPt = at;
		let d;
		if (drag.axis === lk) { // the depth axis: followed along the screen, not over the plane
			if (!from) return;
			d = [0, 0, 0];
			d[lk] = depthStep(lk, pt, from, at);
			drag.last = null; // the plane path starts afresh if the lock is released
		} else {
			if (Math.abs(ray.d[lk]) < 0.02) return;
			const t = (pt[lk] - ray.o[lk]) / ray.d[lk], P = [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t];
			if (!drag.last) { drag.last = P; return; }
			d = [P[0] - drag.last[0], P[1] - drag.last[1], P[2] - drag.last[2]];
			d[lk] = 0;
			if (drag.axis !== null) for (let i = 0; i < 3; i++) if (i !== drag.axis) d[i] = 0;
			if (!d[0] && !d[1] && !d[2]) return;
			drag.last = P;
		}
		if (!d[0] && !d[1] && !d[2]) return;
		const a = A(), add = (p) => p.map((v, i) => v + d[i]);
		if (drag.part === "body") {
			// Selected bones and everything below them travel together; a connected bone whose parent stays put keeps its head on
			// the parent's tip (only its tip moves).
			const moving = subtree(a, drag.ids || [b.id]);
			for (const m of a.bones) if (moving.has(m.id)) { m.head = add(m.head); m.tail = add(m.tail); }
			for (const m of a.bones) if (moving.has(m.id) && m.connected && m.parent && !moving.has(m.parent)) m.head = Rig.bone(a, m.parent).tail.slice();
		} else if (drag.part === "tip") b.tail = add(b.tail);
		else {
			const p = b.connected && b.parent && Rig.bone(a, b.parent);
			if (p) p.tail = add(p.tail); else b.head = add(b.head);
		}
		reconnect(a);
		drag.moved = true;
		api().redrawSoon(); scheduleSheet(); drawPreview();
	}
	const DRAG_PX = 3;
	// Ctrl / Shift as last seen: the modal G / R have no real event to read them from.
	let heldCtrl = false, heldShift = false;
	// Every pose step of a drag is followed by the pins: the pinned limbs bend back so their pinned points stay put. A pinned bone
	// that is itself being dragged is left alone, and is pinned again where it ends up (dragEnd).
	function dragMove(e) {
		dragPose(e);
		if (drag && drag.moved && !restMode && clip() && clip().pins) {
			if (holdPins(new Set([drag.id, ...(drag.ids || [])]))) { api().redrawSoon(); scheduleSheet(); drawPreview(); }
		}
	}
	function dragPose(e) {
		const b = Rig.bone(A(), drag.id);
		if (!b) return;
		// A click only selects: a mouse drag does nothing (writes no key, dirties nothing) until the pointer is DRAG_PX from where it went down.
		if (drag.start && !drag.armed) {
			if (Math.hypot(e.clientX - drag.start[0], e.clientY - drag.start[1]) < DRAG_PX) return;
			drag.armed = true;
		}
		if (restMode) return dragRest(e, b);
		const rect = $("view").getBoundingClientRect(), a = A(), c = clip();
		const mats = Rig.matrices(a, c, a.frame), M = mats.get(b.id), H = Rig.apply(M, b.head), T = Rig.apply(M, b.tail);
		const ray = api().renderer.ray(e.clientX - rect.left, e.clientY - rect.top);
		// The plane the pointer works in: normal to the depth axis (Y, as in the tileset view) or, after a preset view (Front / Right /
		// Top), that view's depth axis, frozen. An X / Y / Z key held in the drag narrows a move to that axis, or turns about it; the
		// depth axis is the one that can only be reached this way (or by its arrow), as the plane itself never moves it.
		const lk = S().viewLock ? S().viewLock.k : 1, onPlane = (k, rr = ray) => {
			if (Math.abs(rr.d[k]) < 0.02) return null;
			const t = (H[k] - rr.o[k]) / rr.d[k];
			return [rr.o[0] + rr.d[0] * t, rr.o[1] + rr.d[1] * t, rr.o[2] + rr.d[2] * t];
		};
		// IK: the tip of a bone with an IK chain (or G on it) follows the pointer and the chain bends to reach it; every chain bone is keyed.
		if (ikOn && Rig.ikLen(a, b) > 1 && !drag.stretch && !drag.rel && (drag.part === "tip" || (drag.modal && drag.move))) {
			const k = drag.axis !== null ? drag.axis : lk, ray2 = ray;
			if (Math.abs(ray2.d[k]) < 0.02) return;
			const tt = (T[k] - ray2.o[k]) / ray2.d[k], P = [ray2.o[0] + ray2.d[0] * tt, ray2.o[1] + ray2.d[1] * tt, ray2.o[2] + ray2.d[2] * tt];
			// Grab offset, so the tip doesn't jump to the pointer. A mouse drag takes it from where the button went down, so the travel
			// before the drag threshold and this first move both count; G (or a new plane) takes it here and starts from the next move.
			if (!drag.ikOff || drag.ikPlane !== k) {
				const fresh = drag.start && drag.ikPlane === undefined, r0 = fresh ? api().renderer.ray(drag.start[0] - rect.left, drag.start[1] - rect.top) : ray2;
				if (Math.abs(r0.d[k]) < 0.02) return;
				const t0 = (T[k] - r0.o[k]) / r0.d[k], P0 = [r0.o[0] + r0.d[0] * t0, r0.o[1] + r0.d[1] * t0, r0.o[2] + r0.d[2] * t0];
				drag.ikOff = [T[0] - P0[0], T[1] - P0[1], T[2] - P0[2]]; drag.ikPlane = k;
				if (!fresh) return;
			}
			const res = Rig.solveIK(a, c, a.frame, b.id, [P[0] + drag.ikOff[0], P[1] + drag.ikOff[1], P[2] + drag.ikOff[2]], Rig.ikLen(a, b), k);
			for (const r of res) Rig.setKey(c, r.id, a.frame, r.rot, r.pos);
			drag.moved = true;
			api().status("IK: posing " + res.length + " bone" + (res.length > 1 ? "s" : "") + " (X / Y / Z picks the plane).");
			api().redrawSoon(); scheduleSheet(); drawPreview();
			return;
		}
		if (drag.stretch) { // Shift + tip: set the bone's length (its rest tip; the same on every frame)
			const W = onPlane(lk);
			if (!W) return;
			const P = TS.m4.apply(TS.m4.invert(M), W);
			if (Math.hypot(P[0] - b.head[0], P[1] - b.head[1], P[2] - b.head[2]) < 0.5) return;
			b.tail = lk === 1 ? [P[0], b.tail[1], P[2]] : P;
			reconnect(a);
			drag.moved = true;
			api().redrawSoon(); scheduleSheet(); drawPreview();
			return;
		}
		if (drag.move) { // slide the whole bone in the view plane (depth stays put), or along one locked axis, depth included
			const at = [e.clientX - rect.left, e.clientY - rect.top], from = drag.lastPt;
			drag.lastPt = at;
			let d;
			if (drag.axis === lk) { // the depth axis (Y in the tileset view): followed along the screen, since the plane never moves it
				if (!from) return;
				d = [0, 0, 0];
				d[lk] = depthStep(lk, H, from, at);
				drag.last = null; // the plane path starts afresh if the lock is released
			} else {
				const P = onPlane(lk);
				if (!P) return;
				if (!drag.last) { drag.last = P; return; }
				d = [P[0] - drag.last[0], P[1] - drag.last[1], P[2] - drag.last[2]];
				d[lk] = 0;
				if (drag.axis !== null) for (let i = 0; i < 3; i++) if (i !== drag.axis) d[i] = 0;
				if (!d[0] && !d[1] && !d[2]) return;
				drag.last = P;
			}
			if (!d[0] && !d[1] && !d[2]) return;
			// Ctrl snaps the whole move since the drag began to whole units; the step applied now is what is still owed to that.
			const tot = drag.moveTot = (drag.moveTot || [0, 0, 0]).map((v, i) => v + d[i]), got = drag.moveGot || [0, 0, 0];
			const goal = heldCtrl ? tot.map(Math.round) : tot;
			d = goal.map((v, i) => v - got[i]);
			drag.moveGot = goal;
			if (!d[0] && !d[1] && !d[2]) return;
			for (const id of drag.ids || [b.id]) {
				const bb = Rig.bone(a, id);
				if (bb.connected && bb.parent) { api().status("Connected bones only turn (R); move the parent, or untick Connected."); continue; }
				const pose = Rig.poseAfter(a, c, a.frame, bb, { d });
				Rig.setKey(c, bb.id, a.frame, pose.rot, pose.pos);
			}
			drag.moved = true;
			api().redrawSoon(); scheduleSheet(); drawPreview();
			return;
		}
		// Turn about the plane's normal (Y by default), or about the held axis, with the pointer on the plane normal to it.
		const nk = drag.axis !== null ? drag.axis : lk, Q = onPlane(nk);
		if (!Q) return;
		let a1 = [T[0] - H[0], T[1] - H[1], T[2] - H[2]];
		const b1 = [Q[0] - H[0], Q[1] - H[1], Q[2] - H[2]];
		a1[nk] = 0; b1[nk] = 0;
		if (drag.rel || drag.grab) { // turn by the pointer's swing about the head, from where it was a moment ago (a mouse press: where it went down)
			if (!drag.lastVec) {
				if (!drag.start) { drag.lastVec = b1; return; }
				const rect0 = $("view").getBoundingClientRect(), Q0 = onPlane(nk, api().renderer.ray(drag.start[0] - rect0.left, drag.start[1] - rect0.top));
				if (!Q0) return;
				drag.lastVec = [Q0[0] - H[0], Q0[1] - H[1], Q0[2] - H[2]];
				drag.lastVec[nk] = 0;
			}
			a1 = drag.lastVec;
		}
		if (Math.hypot(...a1) < 1e-6 || Math.hypot(...b1) < 1e-6) return;
		drag.lastVec = b1;
		const cr = [a1[1] * b1[2] - a1[2] * b1[1], a1[2] * b1[0] - a1[0] * b1[2], a1[0] * b1[1] - a1[1] * b1[0]];
		// The swing so far is kept whole; Ctrl snaps it to 15 degree steps (Ctrl+Shift: 5), and only the difference from what is already turned is applied.
		drag.turnTot = (drag.turnTot || 0) + Math.atan2(cr[nk], a1[0] * b1[0] + a1[1] * b1[1] + a1[2] * b1[2]);
		const step = ((heldShift ? 5 : 15) * Math.PI) / 180, goal = heldCtrl ? Math.round(drag.turnTot / step) * step : drag.turnTot;
		const th = goal - (drag.turnGot || 0);
		drag.turnGot = goal;
		api().status("Turn " + Math.round(((goal * 180) / Math.PI) * 10) / 10 + "°" + (heldCtrl ? " (snapped)" : "") + (drag.modal ? ": click or Enter confirms, Esc cancels." : ""));
		if (!th) return;
		const cs = Math.cos(th), sn = Math.sin(th), tt = 1 - cs, u = [0, 0, 0];
		u[nk] = 1;
		// th is the swing about the axis (right-handed); for Y this is the matrix the old code wrote out.
		const Rw = [[tt * u[0] * u[0] + cs, tt * u[0] * u[1] - sn * u[2], tt * u[0] * u[2] + sn * u[1]], [tt * u[0] * u[1] + sn * u[2], tt * u[1] * u[1] + cs, tt * u[1] * u[2] - sn * u[0]], [tt * u[0] * u[2] - sn * u[1], tt * u[1] * u[2] + sn * u[0], tt * u[2] * u[2] + cs]];
		const { mul, transpose } = Rig.mat3;
		for (const id of drag.ids || [b.id]) {
			const bb = Rig.bone(a, id), Rp = bb.parent ? Rig.rotPart(mats.get(bb.parent)) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
			const pose = Rig.localPose(c, bb.id, a.frame);
			Rig.setKey(c, bb.id, a.frame, Rig.nearEuler(mul(transpose(Rp), mul(Rw, mul(Rp, Rig.eulerToMat(pose.rot)))), pose.rot), pose.pos);
		}
		drag.moved = true;
		api().redrawSoon(); scheduleSheet(); drawPreview();
	}
	// --- Blender-style keys on the selected bone: G moves, R turns (X / Y / Z lock, a preset view picks the plane), click or Enter
	// confirms, right-click or Esc cancels (Ctrl snaps a turn to 15°, a move to whole units); I keys the pose, Shift+I the whole pose, Alt+I removes the key; Ctrl+C / Ctrl+V copy and paste a pose when no keys are picked (Ctrl+Shift+V: mirrored); Tab edits the rest pose; in it Shift+A adds a
	// bone, E extrudes a child from the tip, X deletes; Ctrl+P parents; Left / Right step frames, Up / Down jump between keys. ---
	let lastPtr = [0, 0], parentPick = false;
	// The bones a drag works on: pose mode, the selected roots (their children ride along); rest mode, the selection.
	const dragIds = () => (restMode ? selIds() : rootsOf(A(), selIds()));
	function keyDrag(kind) {
		const bone = boneSel && Rig.bone(A(), boneSel);
		if (!bone || drag) return false;
		if (kind === "turn" && restMode) { api().status("Rest pose: G moves the bone; drag its head or tip to reshape it."); return true; }
		if (playing) togglePlay();
		ensureClip();
		drag = { id: bone.id, ids: dragIds(), before: api().snapshot(), moved: false, move: kind === "move", rel: kind === "turn", part: restMode ? "body" : undefined, stretch: false, last: null, axis: null, modal: true };
		window.addEventListener("pointermove", dragMove);
		window.addEventListener("pointerdown", confirmKeyDrag, true);
		window.addEventListener("contextmenu", cancelKeyDrag, true);
		dragMove({ clientX: lastPtr[0], clientY: lastPtr[1] });
		api().status(kind === "move" ? "Move bone: X / Y / Z lock an axis (Y moves it in depth), click or Enter confirms, right-click or Esc cancels." : "Turn bone: X / Y / Z pick the axis, click or Enter confirms, right-click or Esc cancels.");
		return true;
	}
	function endKeyDrag() {
		window.removeEventListener("pointerdown", confirmKeyDrag, true);
		window.removeEventListener("contextmenu", cancelKeyDrag, true);
	}
	function confirmKeyDrag(e) { if (e) { e.preventDefault(); e.stopPropagation(); } endKeyDrag(); dragEnd(); }
	function cancelKeyDrag(e) {
		if (e) { e.preventDefault(); e.stopPropagation(); }
		endKeyDrag();
		const moved = drag && drag.moved, before = drag && drag.before;
		window.removeEventListener("pointermove", dragMove);
		drag = null;
		if (moved) { api().pushUndo(before); api().undo(); }
		render(); api().redrawSoon();
	}
	function keyPose(remove) {
		const a = A(), c = clip(), ids = selIds();
		if (!ids.length) return api().toast("Select a bone first.", "bad");
		edit(() => { for (const id of ids) { if (remove) Rig.deleteKey(c, id, a.frame); else { const p = Rig.localPose(c, id, a.frame); Rig.setKey(c, id, a.frame, p.rot.map(round), p.pos.map(round)); } } });
		api().status((remove ? "Key removed on frame " : "Keyed " + (ids.length > 1 ? ids.length + " bones" : Rig.bone(a, ids[0]).name) + " on frame ") + (a.frame + 1) + ".");
	}
	function clearPose(what) {
		const a = A(), c = clip(), ids = selIds();
		if (!ids.length) return false;
		edit(() => { for (const id of ids) { const p = Rig.localPose(c, id, a.frame); Rig.setKey(c, id, a.frame, what === "rot" ? [0, 0, 0] : p.rot.map(round), what === "pos" ? [0, 0, 0] : p.pos.map(round)); } });
		return true;
	}
	// Shift+I: key every animated bone (all bones when nothing is animated yet) as it is on this frame, so a pose can be pinned in one go.
	function keyWholePose() {
		if (restMode) return api().status("Rest pose: keys don't apply. Tab back to posing first.");
		ensureClip();
		const a = A(), c = clip(), animated = a.bones.filter((b) => (c.tracks[b.id] || []).length), bones = animated.length ? animated : a.bones;
		if (!bones.length) return api().toast("There are no bones to key.", "bad");
		edit(() => { for (const b of bones) { const p = Rig.localPose(c, b.id, a.frame); Rig.setKey(c, b.id, a.frame, p.rot.map(round), p.pos.map(round)); } });
		api().status("Keyed the whole pose (" + bones.length + " bone" + (bones.length > 1 ? "s" : "") + ") on frame " + (a.frame + 1) + ".");
	}
	// The pose clipboard (Ctrl+C with no keys picked, Ctrl+V): the selected bones' poses on this frame (all bones when none is selected),
	// kept apart from the dopesheet's copied keys. Pasting keys them on the current frame; Ctrl+Shift+V lands on the other side's bones, flipped.
	let poseClip = null, lastCopy = null;
	function copyPose() {
		if (restMode) return api().status("Rest pose: nothing to copy. Tab back to posing first.");
		const a = A(), c = clip(), ids = boneSel ? selIds() : a.bones.map((b) => b.id);
		if (!ids.length) return api().toast("There are no bones to copy.", "bad");
		poseClip = ids.map((id) => { const p = Rig.localPose(c, id, a.frame); return { id, rot: p.rot.map(round), pos: p.pos.map(round) }; });
		api().status("Copied the pose of " + ids.length + " bone" + (ids.length > 1 ? "s" : "") + " on frame " + (a.frame + 1) + " (Ctrl+V pastes, Ctrl+Shift+V mirrored).");
	}
	function pastePose(mirror) {
		if (restMode) return api().status("Rest pose: keys don't apply. Tab back to posing first.");
		if (!poseClip) return api().toast("Copy a pose first (Ctrl+C with no keys picked).", "bad");
		ensureClip();
		const a = A(), c = clip(), todo = [];
		for (const p of poseClip) {
			const b = Rig.bone(a, p.id);
			if (!b) continue;
			if (!mirror) todo.push([b.id, p.rot, p.pos]);
			else { const m = Rig.mirrorValues(p.rot, p.pos); todo.push([Rig.mirrorBone(a, b).id, m.rot, m.pos]); }
		}
		if (!todo.length) return api().toast("Those bones are gone.", "bad");
		edit(() => { for (const [id, rot, pos] of todo) Rig.setKey(c, id, a.frame, rot.slice(), pos.slice()); });
		api().status("Pasted " + (mirror ? "mirrored " : "") + "pose of " + todo.length + " bone" + (todo.length > 1 ? "s" : "") + " on frame " + (a.frame + 1) + ".");
	}
	function jumpKey(dir) {
		const a = A(), c = clip(), ids = boneSel ? selIds() : Object.keys(c.tracks);
		const frames = [...new Set(ids.flatMap((id) => (c.tracks[id] || []).map((k) => k.f)))].sort((x, y) => x - y);
		const next = dir > 0 ? frames.find((f) => f > a.frame) : [...frames].reverse().find((f) => f < a.frame);
		if (next !== undefined) setFrame(next);
	}
	function newBoneAt(child) {
		const a = A(), parent = child && boneSel && Rig.bone(a, boneSel), head = parent ? parent.tail.slice() : S().cursor.slice();
		edit(() => { const b = Rig.newBone("Bone " + (a.bones.length + 1), head, [head[0], head[1], head[2] + 24], parent && parent.id); if (parent) b.connected = true; a.bones.push(b); selectBone(b.id); });
	}
	// Shift+D (rest pose): copies of the selected bones, parent links among them kept, then moved with G.
	function duplicateBones() {
		const a = A(), ids = selIds();
		if (!ids.length) return false;
		const before = api().snapshot(), map = new Map(), made = [];
		for (const b of Rig.ordered({ bones: a.bones })) {
			if (!ids.includes(b.id)) continue;
			const nb = Rig.newBone(b.name.replace(/\.\d+$/, "") + "." + String(a.bones.filter((x) => x.name.startsWith(b.name.replace(/\.\d+$/, ""))).length).padStart(3, "0"), b.head.slice(), b.tail.slice(), map.has(b.parent) ? map.get(b.parent) : b.parent);
			if (b.connected) nb.connected = true;
			if (b.ik) nb.ik = b.ik;
			map.set(b.id, nb.id); made.push(nb);
		}
		a.bones.push(...made);
		multi.clear(); boneSel = made[0].id; for (const nb of made.slice(1)) multi.add(nb.id);
		keyDrag("move");
		if (drag) { drag.before = before; drag.moved = true; } // Esc takes the copies back out
		return true;
	}
	function boneKeys(e) {
		if (!on || !e.key || (e.target.closest && e.target.closest("input, select, textarea"))) return;
		const k = e.key.toLowerCase(), stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
		if (paintMode && !e.ctrlKey && !e.metaKey && !e.altKey) {
			if (k === "escape") { togglePaint(false); stop(); return; }
			if (k === "[" || k === "]") { brush.radius = TS.clamp(brush.radius + (k === "]" ? 4 : -4), 6, 160); const r = $("an_br"); if (r) { r.value = brush.radius; $("an_brv").textContent = brush.radius; } moveBrush(); stop(); return; }
		}
		if (drag && drag.modal) { // a G / R in progress
			if (k === "escape") { cancelKeyDrag(); stop(); } else if (k === "enter") { confirmKeyDrag(); stop(); }
			return;
		}
		if (drag) return;
		const mod = e.ctrlKey || e.metaKey;
		if (keySel.size && !e.altKey && !e.shiftKey && !mod && (k === "delete" || k === "x")) { deleteKeys(); stop(); return; }
		if (keySel.size && k === "escape") { keySel.clear(); timeline(); stop(); return; }
		if (mod && !e.altKey && !e.shiftKey && k === "a" && (keySel.size || tlHover)) { pickAllKeys(); stop(); return; }
		// Ctrl+C copies the picked keys, or with none picked the pose on this frame (models selected: their own copy, in app.js).
		// Ctrl+V pastes whichever was copied last; Ctrl+Shift+V pastes a pose mirrored. (Ctrl+Shift+C is the browser's inspector.)
		if (mod && !e.altKey && !e.shiftKey && k === "c" && keySel.size) { copyKeys(); lastCopy = "keys"; stop(); return; }
		if (mod && !e.altKey && !e.shiftKey && k === "c" && !S().selected.size && A().bones.length && !restMode) { copyPose(); lastCopy = "pose"; stop(); return; }
		if (mod && !e.altKey && e.shiftKey && k === "v" && poseClip) { pastePose(true); stop(); return; }
		if (mod && !e.altKey && !e.shiftKey && k === "v" && lastCopy === "pose" && poseClip) { pastePose(false); stop(); return; }
		if (mod && !e.altKey && !e.shiftKey && k === "v" && keyClip) { pasteKeys(); stop(); return; }
		if (parentPick && k === "escape") { parentPick = false; api().status("Parenting cancelled."); stop(); return; }
		if (mod && !e.altKey && k === "p") {
			if (!boneSel) { api().toast("Select the child bone first, then Ctrl+P and click its parent.", "bad"); stop(); return; }
			parentPick = true; api().status("Click the parent bone (Esc cancels)."); stop(); return;
		}
		if (mod) return;
		if (e.altKey) {
			if (k === "p") { const ids = selIds(); if (ids.length) { edit(() => { for (const id of ids) { const b = Rig.bone(A(), id); b.parent = null; b.connected = false; } }); api().status("Parent cleared on " + ids.length + " bone" + (ids.length > 1 ? "s" : "") + " (Ctrl+Z undoes)."); stop(); } }
			else if (k === "a" && boneSel) { multi.clear(); boneSel = null; api().redrawSoon(); render(); stop(); }
			else if (k === "i") { keyPose(true); stop(); } else if (k === "g" && clearPose("pos")) stop(); else if (k === "r" && clearPose("rot")) stop();
			return;
		}
		if (k === " " && !e.shiftKey) { if (!e.repeat) togglePlay(); stop(); return; }
		if (k === "arrowleft" || k === "arrowright") { const d = k === "arrowright" ? 1 : -1; if (e.shiftKey) setFrame(d > 0 ? clip().frames - 1 : 0); else setFrame(A().frame + d); stop(); return; }
		if (k === "arrowup" || k === "arrowdown") { jumpKey(k === "arrowup" ? 1 : -1); stop(); return; }
		if (k === "tab") { toggleRest(); stop(); return; }
		if (k === "i" && !e.shiftKey) { keyPose(false); stop(); return; }
		if (k === "p" && !e.shiftKey && !restMode && boneSel && !S().selected.size) { togglePins(); stop(); return; }
		if (k === "i" && e.shiftKey) { keyWholePose(); stop(); return; }
		const boneOnly = boneSel && !S().selected.size;
		if (boneOnly && !e.shiftKey && k === "a") { const all = A().bones.map((b) => b.id); multi.clear(); all.filter((id) => id !== boneSel).forEach((id) => multi.add(id)); api().redrawSoon(); render(); stop(); return; }
		if (boneOnly && !e.shiftKey && k === "l") { const a = A(), up = new Set(); for (const id of selIds()) { let r = Rig.bone(a, id); for (let n = 0; r.parent && Rig.bone(a, r.parent) && n < 1000; n++) r = Rig.bone(a, r.parent); up.add(r.id); } for (const id of subtree(a, [...up])) if (id !== boneSel) multi.add(id); api().redrawSoon(); render(); stop(); return; }
		if (boneOnly && e.shiftKey && k === "d" && restMode) { duplicateBones(); stop(); return; }
		if (boneOnly && e.shiftKey && k === "d") { api().status("Duplicate bones in the rest pose (Tab)."); stop(); return; } // models selected: G / R / S still move the models
		if (boneOnly && !e.shiftKey && (k === "g" || k === "r")) { if (keyDrag(k === "g" ? "move" : "turn")) stop(); return; }
		if (boneOnly && !e.shiftKey && k === "s") { api().status("Bones are rigid: S does nothing. Stretch a bone in the rest pose (Tab)."); stop(); return; }
		if (restMode) {
			if (e.shiftKey && k === "a") { newBoneAt(false); stop(); }
			else if (k === "e" && !e.shiftKey && boneSel) { newBoneAt(true); stop(); }
			else if ((k === "x" || k === "delete") && boneSel && !e.shiftKey && Rig.bone(A(), boneSel)) { $("an_bonedel").click(); stop(); }
		}
	}
	function dragEnd() {
		window.removeEventListener("pointermove", dragMove);
		window.removeEventListener("pointerup", dragEnd);
		const pc = clip(), pa = A();
		if (drag && drag.moved && !restMode && pc && pc.pins) for (const id of new Set([drag.id, ...(drag.ids || [])])) if (pc.pins[id]) pc.pins[id] = Rig.makePin(pa, pc, pa.frame, Rig.bone(pa, id));
		if (drag && drag.moved) { api().pushUndo(drag.before); api().markUnsaved(); }
		drag = null;
		render();
	}

	function setMode(v) {
		on = v;
		if (!on) restMode = paintMode = false;
		// Animating poses the rig as it was modelled: leave edit mode and the drawing tools so the models and bones stay in step.
		if (on) {
			if (S().edit) { S().edit = false; S().elemSel.clear(); }
			if (["pencil", "stamp"].includes(S().tool)) api().setTool("select");
			api().panels();
		}
		document.body.classList.toggle("animating", on);
		$("b_animate").classList.toggle("on", on);
		if (!on && playing) togglePlay();
		if (on) { loadAlbedoURL(); ensureClip(); scheduleSheet(); render(); } showFrameArt();
		if (!on && Link.linked()) { Link.expected = null; if (api().asepriteSend) api().asepriteSend(); } // tell Aseprite the link is back to a single tile
		api().redrawSoon();
		draw();
		refreshOutput();
	}

	TS.AnimUI = {
		albedoImages,
		get on() { return on; },
		get painting() { return on && paintMode; },
		// Per-vertex heat tints of a model for the view while painting (its weight on the active bone), else null.
		weightHeat(obj) {
			if (!on || !paintMode || !boneSel || restMode) return null;
			const o = S().objects.find((m) => m.id === obj.id), w = o && Rig.skinWeights(A(), o), t = w ? w.list.findIndex((b) => b.id === boneSel) : -1;
			return t < 0 || w.weights.length !== obj.verts.length ? null : w.weights.map((row) => heatColor(row[t]));
		},
		// Moving or turning models in the view while animating keys them: each unbound model gets its own bone (named after it,
		// visible in the Bones list), then the move / turn becomes a key on the current frame. xfs: [{id, d} | {id, c, u, rad}].
		keyTransform(xfs) {
			ensureClip();
			const a = A(), c = clip();
			let made = 0;
			for (const x of xfs) {
				const o = S().objects.find((m) => m.id === x.id);
				if (!o) continue;
				let bone = Rig.bone(a, a.bind[o.id]);
				if (!bone) {
					const xs = o.verts.map((p) => p[0]), ys = o.verts.map((p) => p[1]), zs = o.verts.map((p) => p[2]);
					const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2, z0 = Math.min(...zs), z1 = Math.max(...zs);
					bone = Rig.newBone(o.name, [mx, my, z0], [mx, my, Math.max(z1, z0 + 8)]);
					a.bones.push(bone); a.bind[o.id] = bone.id; made++;
				}
				// A connected bone can't slide off its parent, so a move of the model goes to the top of its connected chain.
				if (x.d) for (let p; bone.connected && (p = Rig.bone(a, bone.parent)); ) bone = p;
				// A turn's pivot was worked out on the model at rest; the model on screen is where its bone has put it.
				const xx = x.c ? Object.assign({}, x, { c: Rig.apply(Rig.matrices(a, c, a.frame).get(bone.id), x.c) }) : x;
				const p = Rig.poseAfter(a, c, a.frame, bone, xx);
				Rig.setKey(c, bone.id, a.frame, p.rot.map(round), p.pos.map(round));
				boneSel = bone.id;
			}
			touched();
			return { made, frame: a.frame + 1 };
		},
		frameImage,
		litResult,
		resend: () => renderSheet(), // the link opened: the normals go out even with no albedo
		posed: (objs) => (on && !restMode && A().bones.length ? Rig.posedObjects(objs, A(), clip(), A().frame) : objs),
		draw,
		// Another project was opened: nothing of the old one's rig, sheet or albedo may carry over (whether animating or not).
		projectChanged() {
			if (playing) { clearInterval(playing); playing = 0; }
			if (stroke) stroke = null;
			pass++; clearTimeout(renderTimer); clearTimeout(TS.AnimUI._t);
			boneSel = null; multi.clear(); keySel.clear(); keyClip = poseClip = null; restMode = paintMode = parentPick = false;
			sheet = null; pending = 0; albedo = null; albedoURL = null; artShown = null; rigBase = ""; normalFrames.clear(); litFrames.clear();
			loadAlbedoURL();
			if (on) { ensureClip(); scheduleSheet(); render(); timeline(); }
			showFrameArt(); draw();
		},
		// The models or the whole project changed (an edit, undo, or a project opened).
		changed() {
			if (!on) return;
			clearTimeout(TS.AnimUI._t);
			TS.AnimUI._t = setTimeout(() => { loadAlbedoURL(); scheduleSheet(); render(); }, 60);
		},
	};

	window.addEventListener("DOMContentLoaded", () => {
		$("b_animate").onclick = () => setMode(!on);
		document.querySelector(".menuwrap.export > button").addEventListener("click", () => exportMenu($("exp_anim")));
		$("an_body").addEventListener("keydown", (e) => { if (e.key === "Tab" && e.target.id) { tabFrom = { id: e.target.id, back: e.shiftKey }; setTimeout(() => { tabFrom = null; }, 0); } }, true);
		$("bone_overlay").addEventListener("pointerdown", (e) => {
			const id = e.target.dataset && e.target.dataset.bone;
			if (!id) return;
			e.preventDefault(); e.stopPropagation();
			if (playing) togglePlay();
			const gz = e.target.dataset.gizmo;
			if (gz && !parentPick) { // a ring turns about its axis, an arrow slides the bone along it
				const [kind, k] = gz.split(":");
				ensureClip();
				drag = { id, ids: dragIds(), before: api().snapshot(), moved: false, move: kind === "move", rel: kind === "turn", part: restMode ? "body" : undefined, stretch: false, last: null, axis: +k, start: [e.clientX, e.clientY] };
				window.addEventListener("pointermove", dragMove);
				window.addEventListener("pointerup", dragEnd);
				api().redrawSoon();
				return;
			}
			if (parentPick) {
				parentPick = false;
				const a = A(), child = Rig.bone(a, boneSel), parent = Rig.bone(a, id);
				if (!child || !parent || child === parent) return api().status("Pick a different bone as the parent.");
				if (Rig.wouldLoop(a, child, id)) return api().status("That would make a loop.");
				edit(() => { child.parent = id; child.connected = Math.hypot(...child.head.map((v, i) => v - parent.tail[i])) < 0.5; });
				return api().status(child.name + " is now a child of " + parent.name + (child.connected ? " (connected)." : "."));
			}
			if (e.shiftKey || e.ctrlKey || e.metaKey) { selectBone(id, true); S().selected.clear(); api().redrawSoon(); render(); if (!isSel(id)) return; }
			else if (!isSel(id)) selectBone(id);
			else boneSel = id;
			S().selected.clear(); api().redrawSoon();
			// A connected bone can't slide off its parent's tip, so dragging its body turns it (like its tip) rather than doing nothing.
			const hb = Rig.bone(A(), id), stuck = !restMode && hb && hb.connected && hb.parent && Rig.bone(A(), hb.parent);
			drag = { id, ids: dragIds(), before: api().snapshot(), moved: false, move: e.target.dataset.part === "body" && !stuck, part: e.target.dataset.part, stretch: !restMode && e.shiftKey && e.target.dataset.part === "tip", last: null, axis: null, start: [e.clientX, e.clientY] };
			// A tip, or the body of a connected bone, turns relative to where it was grabbed, so an off-centre grab gives no jump.
			drag.grab = !restMode && !drag.move && !drag.stretch;
			window.addEventListener("pointermove", dragMove);
			window.addEventListener("pointerup", dragEnd);
			ensureClip();
		});
		window.addEventListener("pointermove", (e) => { lastPtr = [e.clientX, e.clientY]; heldCtrl = e.ctrlKey || e.metaKey; heldShift = e.shiftKey; }, true);
		// Ctrl / Shift pressed or let go mid-drag: redo the move at once, so the snap shows without the pointer having to move.
		const mods = (e) => {
			const c = e.ctrlKey || e.metaKey, s = e.shiftKey;
			if (c === heldCtrl && s === heldShift) return;
			heldCtrl = c; heldShift = s;
			if (drag && on) dragMove({ clientX: lastPtr[0], clientY: lastPtr[1] });
		};
		window.addEventListener("keydown", mods, true);
		window.addEventListener("keyup", mods, true);
		// While painting, a left drag on the view is the brush (the other buttons still orbit and pan).
		window.addEventListener("pointerdown", (e) => {
			if (!on || !paintMode || stroke || e.button !== 0 || e.target !== $("view") || drag || parentPick) return;
			e.preventDefault(); e.stopPropagation();
			paintStart(e);
		}, true);
		window.addEventListener("pointermove", (e) => {
			if (!on || !paintMode || stroke) return;
			const rect = $("view").getBoundingClientRect(), inside = e.target === $("view");
			brushAt = inside ? [e.clientX - rect.left, e.clientY - rect.top] : null;
			moveBrush();
		}, true);
		window.addEventListener("keydown", boneKeys, true);
		// During a bone drag, X / Y / Z narrows it to that axis (again: off), like G then X on a model.
		window.addEventListener("keydown", (e) => {
			if (!drag || e.ctrlKey || e.metaKey || e.altKey || !["x", "y", "z"].includes(e.key.toLowerCase())) return;
			const k = "xyz".indexOf(e.key.toLowerCase());
			drag.axis = drag.axis === k ? null : k;
			e.preventDefault(); e.stopPropagation();
			TS.api.status(drag.axis === null ? "Bone drag: free in the view plane." : "Bone drag locked to " + "XYZ"[k] + (drag.move ? " (move)" : " (turn about it)") + " — press again to release.");
		}, true);
		window.addEventListener("keydown", (e) => {
			if (!on || (e.target.closest && e.target.closest("input, select, textarea")) || e.ctrlKey || e.metaKey || e.altKey) return;
			if (e.key === ",") setFrame(A().frame - 1);
			else if (e.key === ".") { setFrame(A().frame + 1); e.stopPropagation(); }
		}, true);
		loadAlbedoURL();
	});
})();
