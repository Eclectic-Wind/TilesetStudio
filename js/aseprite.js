// Aseprite link: a shared folder both programs watch (works from any https page, e.g. GitHub Pages; needs a browser with the File System
// Access API, which is Chromium's; elsewhere use the manual download / load buttons).
//
//   Studio -> Aseprite   normal.png        the animation's normal-map spritesheet
//                        studio_link.json  {rev, sheet, cell, cols, rows, frames}; written AFTER normal.png, so a changed rev means
//                                          the png is complete
//   Aseprite -> Studio   albedo.png        the flattened "Albedo" group, saved by the extension on every edit
//
// The sheet must be a power-of-two canvas. If the Aseprite canvas changes size, Studio warns and keeps the previous page.
"use strict";
(function () {
	const L = (TS.Link = {});
	const FILES = { normal: "normal.png", meta: "studio_link.json", albedo: "albedo.png" };
	L.FILES = FILES;
	L.supported = typeof window.showDirectoryPicker === "function";

	let dir = null, timer = 0, lastModified = 0, rev = 0, busy = false, lastProblem = "";
	let framesRev = null; // the last aseprite_frames.json seen (folder link)
	let ws = null, wsRoom = "", wsRetry = 0, wsWait = 0, inbox = null;
	// The relay (tools/relay): lets any browser link over the internet, no folder access needed. Its address is filled in on deploy.
	L.RELAY = "wss://tileset-studio-relay.tileset-studio.workers.dev";
	L.onRelayOpen = null; // () -> void: the relay connected, send the current picture
	L.onAlbedo = null; // (ImageData) -> void
	L.onFrames = null; // ({n, ops: [{op: "del" | "ins", i}]}) -> void: frames were added / deleted on Aseprite's timeline
	L.onStatus = null; // (state, text) -> void   state: off | ok | warn | wait
	L.expected = null; // {w, h}: the sheet size Aseprite must keep
	L.linked = () => !!dir || !!ws;
	L.folderLinked = () => !!dir;
	L.relayRoom = () => (ws ? wsRoom : "");
	L.relayOpen = () => !!ws && ws.readyState === 1;
	const say = (state, text) => { if (L.onStatus) L.onStatus(state, text); };

	L.connect = async () => {
		if (!L.supported) throw new Error("This browser can't watch a folder. Use Chrome or Edge, or the manual download / load buttons.");
		dir = await window.showDirectoryPicker({ id: "tileset-studio-aseprite", mode: "readwrite" });
		lastModified = 0; lastProblem = ""; framesRev = null;
		say("wait", `Linked to the folder "${dir.name}". Waiting for Aseprite's ${FILES.albedo}.`);
		clearInterval(timer);
		timer = setInterval(poll, 400);
		poll();
		return dir.name;
	};
	L.disconnect = () => { clearInterval(timer); dir = null; L.disconnectRelay(); say("off", "Not linked."); };

	// --- the relay: a websocket both programs dial out to, so it works in any browser (Firefox included) ---

	L.newRoom = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => "abcdefghijklmnopqrstuvwxyz234567"[b & 31]).join("");
	L.connectRelay = (room) => {
		if (!/^[a-z0-9]{16,64}$/.test(room)) throw new Error("A room code is 16 to 64 lowercase letters and digits.");
		L.disconnectRelay();
		wsRoom = room; wsRetry = 0;
		openRelay();
	};
	L.disconnectRelay = () => {
		clearTimeout(wsWait);
		if (ws) { const w = ws; ws = null; w.onclose = null; try { w.close(); } catch (e) { /* already closed */ } }
		wsRoom = ""; inbox = null;
	};
	function openRelay() {
		const w = (ws = new WebSocket(`${L.RELAY}/r/${wsRoom}`));
		w.binaryType = "arraybuffer";
		say("wait", "Connecting to the relay…");
		w.onopen = () => { wsRetry = 0; say("wait", `Online in room ${wsRoom}. Waiting for Aseprite's extension to join the same room.`); if (L.onRelayOpen) L.onRelayOpen(); };
		w.onmessage = (e) => {
			if (typeof e.data !== "string") return relayChunk(new Uint8Array(e.data));
			try { const msg = JSON.parse(e.data); if (msg.t === "frames" && L.onFrames) L.onFrames(msg); } catch (err) { /* not for us */ }
		};
		w.onclose = () => {
			if (ws !== w) return;
			say("warn", "Relay disconnected; retrying…");
			wsWait = setTimeout(() => { if (ws === w) openRelay(); }, Math.min(15000, 1000 * 2 ** wsRetry++));
		};
	}
	// Chunked frames: [kind][index][count][bytes]. Kind 2 is Aseprite's albedo; kind 1 (the normal map) is ours.
	function relayChunk(b) {
		if (b.length < 3 || b[0] !== 2) return;
		if (b[1] === 0) inbox = { parts: [], count: b[2] };
		if (!inbox || b[1] !== inbox.parts.length) return;
		inbox.parts.push(b.subarray(3));
		if (inbox.parts.length < inbox.count) return;
		const png = new Blob(inbox.parts, { type: "image/png" });
		inbox = null;
		createImageBitmap(png).then(accept, () => { /* not a picture */ });
	}
	async function relaySend(kind, blob) {
		const bytes = new Uint8Array(await blob.arrayBuffer()), CH = 60000, count = Math.max(1, Math.ceil(bytes.length / CH));
		if (count > 255) throw new Error("The picture is too big for the relay.");
		for (let i = 0; i < count && L.relayOpen(); i++) {
			const part = bytes.subarray(i * CH, (i + 1) * CH), f = new Uint8Array(3 + part.length);
			f[0] = kind; f[1] = i; f[2] = count; f.set(part, 3);
			ws.send(f);
		}
	}

	const write = async (name, data) => {
		const handle = await dir.getFileHandle(name, { create: true }), w = await handle.createWritable();
		await w.write(data);
		await w.close();
	};

	// Send the normal sheet (ImageData) and its layout to Aseprite. extra: {anim: true, fps} when an animation is being linked (then
	// Aseprite's timeline follows the frame count; otherwise only frame 1 is linked).
	L.push = async (sheet, layout, extra) => {
		if (!dir && !ws) return;
		const c = document.createElement("canvas");
		c.width = sheet.width; c.height = sheet.height;
		c.getContext("2d").putImageData(sheet, 0, 0);
		const blob = await new Promise((ok) => c.toBlob(ok, "image/png"));
		const meta = JSON.stringify(Object.assign({ t: "meta", version: 2, rev: ++rev, sheet: [layout.w, layout.h], cell: [layout.cw, layout.ch], cols: layout.cols, rows: layout.rows, frames: layout.frames, anim: false }, extra));
		if (dir) { await write(FILES.normal, blob); await write(FILES.meta, meta); }
		// Over the relay the meta goes first so the picture always arrives with its layout known.
		if (L.relayOpen()) { ws.send(meta); await relaySend(1, blob); }
	};

	// Checks an incoming sheet against what Studio expects. Returns a problem text, or "".
	L.check = (w, h, expected) => {
		const strict = !TS.AnimUI || TS.AnimUI.on; // animation sheets must be 2^n; a plain tileset just has to keep its size
		if (strict && (!TS.Rig.isPow2(w) || !TS.Rig.isPow2(h))) return `Aseprite's canvas is ${w}x${h}: it must be a power of two (16, 32, 64, 128...) each way.`;
		if (expected && (w !== expected.w || h !== expected.h)) return `Aseprite's canvas changed to ${w}x${h}; the sheet is ${expected.w}x${expected.h}. Kept the previous page. Resize the canvas back, or re-link after changing the clip.`;
		return "";
	};

	// A picture arrived from Aseprite (a file in the folder, or over the relay).
	function accept(bmp) {
		const problem = L.check(bmp.width, bmp.height, L.expected);
		if (problem) {
			if (problem !== lastProblem) { lastProblem = problem; say("warn", problem); }
			return;
		}
		lastProblem = "";
		const c = document.createElement("canvas");
		c.width = bmp.width; c.height = bmp.height;
		const g = c.getContext("2d");
		g.drawImage(bmp, 0, 0);
		if (L.onAlbedo) L.onAlbedo(g.getImageData(0, 0, c.width, c.height));
		say("ok", `Live: received ${bmp.width}x${bmp.height} from Aseprite at ${new Date().toLocaleTimeString()}.`);
	}

	// Aseprite's frame changes, written by the extension to aseprite_frames.json (the first read only notes where it stands).
	async function pollFrames() {
		let msg;
		try { msg = JSON.parse(await (await (await dir.getFileHandle("aseprite_frames.json")).getFile()).text()); } catch (e) { return; }
		if (framesRev === null) { framesRev = msg.rev; return; }
		if (msg.rev !== framesRev) { framesRev = msg.rev; if (L.onFrames) L.onFrames(msg); }
	}

	async function poll() {
		if (!dir || busy) return;
		busy = true;
		try {
			await pollFrames();
			let file;
			try { file = await (await dir.getFileHandle(FILES.albedo)).getFile(); } catch (e) { return; } // not written yet
			if (file.lastModified === lastModified || !file.size) return;
			let bmp;
			try { bmp = await createImageBitmap(file); } catch (e) { return; } // caught mid-write: the next poll reads it whole
			lastModified = file.lastModified;
			accept(bmp);
		} finally { busy = false; }
	}
})();
