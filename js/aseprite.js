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
	L.onAlbedo = null; // (ImageData) -> void
	L.onStatus = null; // (state, text) -> void   state: off | ok | warn | wait
	L.expected = null; // {w, h}: the sheet size Aseprite must keep
	L.linked = () => !!dir;
	const say = (state, text) => { if (L.onStatus) L.onStatus(state, text); };

	L.connect = async () => {
		if (!L.supported) throw new Error("This browser can't watch a folder. Use Chrome or Edge, or the manual download / load buttons.");
		dir = await window.showDirectoryPicker({ id: "tileset-studio-aseprite", mode: "readwrite" });
		lastModified = 0; lastProblem = "";
		say("wait", `Linked to the folder "${dir.name}". Waiting for Aseprite's ${FILES.albedo}.`);
		clearInterval(timer);
		timer = setInterval(poll, 400);
		poll();
		return dir.name;
	};
	L.disconnect = () => { clearInterval(timer); dir = null; say("off", "Not linked."); };

	const write = async (name, data) => {
		const handle = await dir.getFileHandle(name, { create: true }), w = await handle.createWritable();
		await w.write(data);
		await w.close();
	};

	// Send the normal sheet (ImageData) and its layout to Aseprite.
	L.push = async (sheet, layout) => {
		if (!dir) return;
		const c = document.createElement("canvas");
		c.width = sheet.width; c.height = sheet.height;
		c.getContext("2d").putImageData(sheet, 0, 0);
		const blob = await new Promise((ok) => c.toBlob(ok, "image/png"));
		await write(FILES.normal, blob);
		rev++;
		await write(FILES.meta, JSON.stringify({ version: 1, rev, sheet: [layout.w, layout.h], cell: [layout.cw, layout.ch], cols: layout.cols, rows: layout.rows, frames: layout.frames }));
	};

	// Checks an incoming sheet against what Studio expects. Returns a problem text, or "".
	L.check = (w, h, expected) => {
		if (!TS.Rig.isPow2(w) || !TS.Rig.isPow2(h)) return `Aseprite's canvas is ${w}x${h}: it must be a power of two (16, 32, 64, 128...) each way.`;
		if (expected && (w !== expected.w || h !== expected.h)) return `Aseprite's canvas changed to ${w}x${h}; the sheet is ${expected.w}x${expected.h}. Kept the previous page. Resize the canvas back, or re-link after changing the clip.`;
		return "";
	};

	async function poll() {
		if (!dir || busy) return;
		busy = true;
		try {
			let file;
			try { file = await (await dir.getFileHandle(FILES.albedo)).getFile(); } catch (e) { return; } // not written yet
			if (file.lastModified === lastModified || !file.size) return;
			let bmp;
			try { bmp = await createImageBitmap(file); } catch (e) { return; } // caught mid-write: the next poll reads it whole
			lastModified = file.lastModified;
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
		} finally { busy = false; }
	}
})();
