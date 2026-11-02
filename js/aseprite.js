// Aseprite link: a shared folder both programs watch (works from any https page, e.g. GitHub Pages; needs a browser with the File System
// Access API, which is Chromium's; elsewhere use the manual download / load buttons).
//
//   Studio -> Aseprite   normal.png        the animation's normal-map spritesheet
//                        studio_link.json  {rev, sheet, cell, cols, rows, frames}; written AFTER normal.png, so a changed rev means
//                                          the png is complete
//                        art.png           optional, once per link: the tileset's art, to start Aseprite's Albedo group with
//   Aseprite -> Studio   albedo.png        the flattened "Albedo" group, saved by the extension on every edit
//                        aseprite_status.json  the extension's heartbeat: {beat, started, file, w, h, frames, normal, problem}
//
// Presence: a picture is only taken from an Aseprite that is there now, because the folder and the relay's cache can both hold one from
// an earlier session, and taking it would overwrite the tileset art. Online, Studio pings with a token made for this connection and the
// extension's answer proves it is live (a cached answer carries an old token). In the folder, the beat has to change while we watch.
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
	let token = "", verified = false, openedAt = 0, pingTimer = 0, lastPing = 0, lastPong = 0;
	let beat = null, beatAt = 0, started = 0, linkedAt = 0, artKeep = null, artSent = false, session = "", warnedOld = false;
	const PING_MS = 5000, GONE_MS = 8000;
	// The relay (tools/relay): lets any browser link over the internet, no folder access needed. Its address is filled in on deploy.
	L.RELAY = "wss://tileset-studio-relay.tileset-studio.workers.dev";
	L.onRelayOpen = null; // () -> void: the relay connected, send the current picture
	L.onAlbedo = null; // (ImageData) -> void
	L.onFrames = null; // ({n, ops: [{op: "del" | "ins", i}]}) -> void: frames were added / deleted on Aseprite's timeline
	L.onStatus = null; // (state, text) -> void   state: off | ok | warn | wait
	L.artPending = null; // ImageData: the tileset's art, sent once to Aseprite as its starting Albedo layer (kind 3 / art.png)
	L.origin = "aseprite"; // which side's project starts the link: "studio" (overwrites Aseprite's file) or "aseprite" (Studio adopts it)
	L.adoptPending = false; // origin aseprite: the first picture from Aseprite replaces the tileset art whatever its size
	L.expected = null; // {w, h}: the sheet size Aseprite must keep
	L.peer = null; // the extension while it is there: {file, w, h, frames, normal, problem, text}
	L.onPeer = null; // (peer, previous) -> void
	L.lastAlbedo = 0; // when the last picture came in (ms)
	L.linked = () => !!dir || !!ws;
	L.folderLinked = () => !!dir;
	L.relayRoom = () => (ws ? wsRoom : "");
	L.relayOpen = () => !!ws && ws.readyState === 1;
	const say = (state, text) => { if (L.onStatus) L.onStatus(state, text); };

	const setPeer = (p) => { const was = L.peer; L.peer = p; if ((p || was) && L.onPeer) L.onPeer(p, was); };
	// A new link: Aseprite redoes its once-per-link work (fit the canvas, take the art) when this changes.
	function beginLink() { session = L.newRoom().slice(0, 12); artSent = false; artKeep = null; warnedOld = false; L.lastAlbedo = 0; setPeer(null); }
	const oldExtension = () => { if (!warnedOld) { warnedOld = true; say("warn", "Aseprite's extension is out of date, so its pictures were ignored. Download it again from this menu and install it over the old one."); } };

	L.connect = async () => {
		if (!L.supported) throw new Error("This browser can't watch a folder. Use Chrome or Edge, or the manual download / load buttons.");
		dir = await window.showDirectoryPicker({ id: "tileset-studio-aseprite", mode: "readwrite" });
		L.disconnectRelay(); // one link at a time
		beginLink();
		lastModified = 0; lastProblem = ""; framesRev = null; beat = null; started = 0; linkedAt = Date.now();
		say("wait", `Linked to the folder "${dir.name}". Waiting for Aseprite's ${FILES.albedo}.`);
		clearInterval(timer);
		timer = setInterval(poll, 400);
		poll();
		return dir.name;
	};
	L.disconnect = () => { clearInterval(timer); dir = null; L.disconnectRelay(); L.adoptPending = false; L.artPending = null; session = ""; setPeer(null); say("off", "Not linked."); };

	// --- the relay: a websocket both programs dial out to, so it works in any browser (Firefox included) ---

	L.newRoom = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => "abcdefghijklmnopqrstuvwxyz234567"[b & 31]).join("");
	L.connectRelay = (room) => {
		if (!/^[a-z0-9]{16,64}$/.test(room)) throw new Error("A room code is 16 to 64 lowercase letters and digits.");
		L.disconnectRelay();
		clearInterval(timer); dir = null; // one link at a time
		beginLink();
		wsRoom = room; wsRetry = 0;
		openRelay();
	};
	L.disconnectRelay = () => {
		clearTimeout(wsWait); clearInterval(pingTimer);
		if (ws) { const w = ws; ws = null; w.onclose = null; try { w.close(); } catch (e) { /* already closed */ } }
		wsRoom = ""; inbox = null;
		setPeer(null);
	};
	// Background tabs may tick only once a minute: "gone" means a ping went unanswered, not that a timer is late.
	function ping() {
		if (!L.relayOpen()) return;
		if (L.peer && lastPing > lastPong && Date.now() - lastPing > GONE_MS) setPeer(null);
		if (lastPing <= lastPong) lastPing = Date.now();
		ws.send(JSON.stringify({ t: "ping", token }));
	}
	if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (!document.hidden) ping(); });
	function openRelay() {
		const w = (ws = new WebSocket(`${L.RELAY}/r/${wsRoom}`));
		w.binaryType = "arraybuffer";
		say("wait", "Connecting to the relay…");
		w.onopen = () => {
			wsRetry = 0; token = L.newRoom().slice(0, 12); verified = false; openedAt = Date.now(); lastPing = lastPong = 0;
			say("wait", "Online. Waiting for Aseprite to join with this room code.");
			if (artKeep) L.artPending = artKeep; // the relay forgot it if it restarted, and a late Aseprite still needs it
			ping();
			clearInterval(pingTimer); pingTimer = setInterval(ping, PING_MS);
			if (L.onRelayOpen) L.onRelayOpen();
		};
		w.onmessage = (e) => {
			if (typeof e.data !== "string") return relayChunk(new Uint8Array(e.data));
			try {
				const msg = JSON.parse(e.data);
				if (msg.t === "pong" && msg.token === token) { verified = true; lastPong = Date.now(); setPeer(msg); }
				else if (msg.t === "frames" && verified && L.onFrames) L.onFrames(msg);
			} catch (err) { /* not for us */ }
		};
		w.onclose = () => {
			if (ws !== w) return;
			clearInterval(pingTimer); verified = false; setPeer(null);
			say("warn", "Relay disconnected; retrying…");
			wsWait = setTimeout(() => { if (ws === w) openRelay(); }, Math.min(15000, 1000 * 2 ** wsRetry++));
		};
	}
	// Chunked frames: [kind][index][count][bytes]. Kind 2 is Aseprite's albedo; kind 1 (the normal map) is ours.
	function relayChunk(b) {
		if (b.length < 3 || b[0] !== 2) return;
		if (!verified) { // the relay's cached picture from an earlier session; after a few seconds it can only be an extension that doesn't answer pings
			if (b[1] === 0 && Date.now() - openedAt > 3000) oldExtension();
			inbox = null;
			return;
		}
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

	const toBlob = (img) => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; c.getContext("2d").putImageData(img, 0, 0); return new Promise((ok) => c.toBlob(ok, "image/png")); };

	// Send the normal sheet (ImageData) and its layout to Aseprite. extra: {anim: true, fps} when an animation is being linked (then
	// Aseprite's timeline follows the frame count; otherwise only frame 1 is linked).
	L.push = async (sheet, layout, extra) => {
		if (!dir && !ws) return;
		if (L.adoptPending) return L.hello(); // Aseprite's file starts the project: no sheet goes out until Studio has taken its size
		const c = document.createElement("canvas");
		c.width = sheet.width; c.height = sheet.height;
		c.getContext("2d").putImageData(sheet, 0, 0);
		const blob = await new Promise((ok) => c.toBlob(ok, "image/png"));
		const art = L.artPending, artBlob = art && await toBlob(art);
		// "art" stays true for the whole link: a late Aseprite reads only the newest meta, and must know Studio's art is on its way.
		const meta = JSON.stringify(Object.assign({ t: "meta", version: 2, session, art: !!artBlob || artSent, origin: L.origin, rev: ++rev, sheet: [layout.w, layout.h], cell: [layout.cw, layout.ch], cols: layout.cols, rows: layout.rows, frames: layout.frames, anim: false }, extra));
		if (dir) { if (artBlob) await write("art.png", artBlob); await write(FILES.normal, blob); await write(FILES.meta, meta); }
		// Over the relay the meta goes first so the picture always arrives with its layout known.
		if (L.relayOpen()) { ws.send(meta); if (artBlob) await relaySend(3, artBlob); await relaySend(1, blob); }
		if (artBlob && (dir || L.relayOpen())) { L.artPending = null; artKeep = art; artSent = true; }
	};

	// Origin aseprite: tell Aseprite we are waiting for its file (no sheet yet; rev 0 so no normal map is imported).
	L.hello = async () => {
		L.expected = null;
		const meta = JSON.stringify({ t: "meta", version: 2, session, rev: 0, origin: "aseprite", adopt: true });
		if (dir) await write(FILES.meta, meta);
		if (L.relayOpen()) ws.send(meta);
	};

	// Checks an incoming sheet against what Studio expects. Returns a problem text, or "".
	L.check = (w, h, expected) => {
		if (L.adoptPending) return "";
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
		L.lastAlbedo = Date.now();
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

	// The extension's heartbeat. A file that is merely there may be left over; the beat has to move while we watch.
	async function pollStatus() {
		let msg = null;
		try { msg = JSON.parse(await (await (await dir.getFileHandle("aseprite_status.json")).getFile()).text()); } catch (e) { /* none yet, or caught mid-write */ }
		if (msg && msg.beat !== beat) {
			const first = beat === null;
			beat = msg.beat;
			if (!first) { beatAt = Date.now(); started = msg.started * 1000; setPeer(msg); }
		} else if (L.peer && Date.now() - beatAt > GONE_MS) setPeer(null);
	}

	async function poll() {
		if (!dir || busy) return;
		busy = true;
		try {
			await pollStatus();
			if (L.peer) await pollFrames();
			let file;
			try { file = await (await dir.getFileHandle(FILES.albedo)).getFile(); } catch (e) { return; } // not written yet
			if (file.lastModified === lastModified || !file.size) return;
			if (!L.peer) { if (beat === null && file.lastModified > linkedAt + 3000) oldExtension(); return; }
			if (file.lastModified < started - 2000) return; // left over from before this Aseprite session
			let bmp;
			try { bmp = await createImageBitmap(file); } catch (e) { return; } // caught mid-write: the next poll reads it whole
			lastModified = file.lastModified;
			accept(bmp);
		} finally { busy = false; }
	}
})();
