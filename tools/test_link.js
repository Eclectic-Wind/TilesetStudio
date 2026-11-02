// Tests for Studio's side of the Aseprite link, with a fake relay socket and a fake shared folder. Usage: node tools/test_link.js
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const root = path.join(__dirname, "..");

// A fresh copy of js/aseprite.js. Pictures decode to whatever createImageBitmap is given, so accept() needs a small canvas stand-in.
function load() {
	const sockets = [], folder = {};
	class WebSocket { constructor(url) { this.url = url; this.readyState = 1; this.sent = []; sockets.push(this); } send(m) { this.sent.push(m); } close() { this.readyState = 3; } }
	const handle = (name) => { if (!(name in folder)) throw new Error("NotFound"); return { getFile: async () => folder[name] }; };
	const dirHandle = { name: "shared", getFileHandle: async (name, o) => (o && o.create ? { createWritable: async () => ({ write: async () => {}, close: async () => {} }) } : handle(name)) };
	const ctx = {
		console, crypto: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = Math.random() * 256; return a; } }, WebSocket, Blob, Date, JSON, setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {},
		showDirectoryPicker: async () => dirHandle,
		createImageBitmap: async (b) => { if (b === "broken") throw new Error("not a picture"); return { width: 32, height: 32 }; },
		document: { addEventListener: () => {}, createElement: () => ({ getContext: () => ({ drawImage: () => {}, getImageData: () => ({ width: 32, height: 32 }), putImageData: () => {} }), toBlob: (ok) => ok(new Blob(["png"])) }) },
		TS: { Rig: { isPow2: () => true } },
	};
	ctx.window = ctx;
	vm.createContext(ctx);
	vm.runInContext(fs.readFileSync(path.join(root, "js", "aseprite.js"), "utf8"), ctx, { filename: "aseprite.js" });
	const L = ctx.TS.Link, got = { albedo: 0, frames: 0, peers: [], status: [] };
	L.onAlbedo = () => got.albedo++;
	L.onFrames = () => got.frames++;
	L.onPeer = (p) => got.peers.push(p);
	L.onStatus = (state, text) => got.status.push([state, text]);
	return { L, ctx, sockets, folder, got };
}
const room = "abcdefghijklmnopqrstuvwx";
const ws = (t) => t.sockets[t.sockets.length - 1];
const pingToken = (t) => JSON.parse(ws(t).sent.find((m) => typeof m === "string" && m.includes('"ping"'))).token;
const picture = () => new Uint8Array([2, 0, 1, 1, 2, 3]).buffer; // albedo, one chunk
const settle = () => new Promise((r) => setTimeout(r, 5));
const open = (t) => { t.L.connectRelay(room); ws(t).onopen(); };
const pong = (t, token, extra) => ws(t).onmessage({ data: JSON.stringify(Object.assign({ t: "pong", token, file: "a.aseprite", w: 32, h: 32, frames: 1, normal: false, problem: null }, extra)) });

let failed = 0, passed = 0;
const test = async (name, fn) => {
	try { await fn(); passed++; console.log("  ok  " + name); }
	catch (e) { failed++; console.log("FAIL  " + name + "\n      " + e.message); }
};

(async () => {
	console.log("Online");
	await test("a picture the relay cached from an earlier session never reaches the tileset", async () => {
		const t = load(); open(t);
		ws(t).onmessage({ data: picture() });
		await settle();
		assert.strictEqual(t.got.albedo, 0);
		assert.strictEqual(t.L.peer, null);
	});
	await test("a cached answer from an earlier connection does not count as Aseprite being there", async () => {
		const t = load(); open(t);
		pong(t, "oldtoken");
		ws(t).onmessage({ data: picture() });
		await settle();
		assert.strictEqual(t.L.peer, null);
		assert.strictEqual(t.got.albedo, 0);
	});
	await test("a live answer lets pictures and frame changes through", async () => {
		const t = load(); open(t);
		ws(t).onmessage({ data: JSON.stringify({ t: "frames", n: 2, ops: [] }) });
		assert.strictEqual(t.got.frames, 0);
		pong(t, pingToken(t));
		assert.strictEqual(t.L.peer.file, "a.aseprite");
		ws(t).onmessage({ data: picture() });
		ws(t).onmessage({ data: JSON.stringify({ t: "frames", n: 2, ops: [] }) });
		await settle();
		assert.strictEqual(t.got.albedo, 1);
		assert.strictEqual(t.got.frames, 1);
		assert(t.L.lastAlbedo > 0);
	});
	await test("after a dropped connection, Aseprite has to prove itself again", async () => {
		const t = load(); open(t);
		pong(t, pingToken(t));
		ws(t).onmessage({ data: picture() });
		await settle();
		assert.strictEqual(t.got.albedo, 1);
		const old = ws(t);
		old.readyState = 3;
		old.onclose();
		assert.strictEqual(t.L.peer, null);
		t.L.connectRelay(room); ws(t).onopen();
		ws(t).onmessage({ data: picture() });
		await settle();
		assert.strictEqual(t.got.albedo, 1);
	});
	await test("an extension that doesn't answer pings is told to update", async () => {
		const t = load(); open(t);
		const realNow = Date.now, later = realNow() + 5000;
		Date.now = () => later;
		try { ws(t).onmessage({ data: picture() }); } finally { Date.now = realNow; }
		assert(t.got.status.some(([s, text]) => s === "warn" && text.includes("out of date")));
		assert.strictEqual(t.got.albedo, 0);
	});
	await test("the art flag stays on for the whole link, and every link has its own session", async () => {
		const t = load(); open(t);
		t.L.origin = "studio";
		t.L.artPending = { width: 32, height: 32 };
		const layout = { w: 32, h: 32, cw: 32, ch: 32, cols: 1, rows: 1, frames: 1 };
		await t.L.push({ width: 32, height: 32 }, layout);
		await t.L.push({ width: 32, height: 32 }, layout);
		const metas = ws(t).sent.filter((m) => typeof m === "string" && m.includes('"meta"')).map((m) => JSON.parse(m));
		assert.deepStrictEqual(metas.map((m) => m.art), [true, true]);
		assert.strictEqual(ws(t).sent.filter((m) => typeof m !== "string" && m[0] === 3).length, 1);
		const before = metas[0].session;
		assert(before);
		t.L.connectRelay(room); ws(t).onopen();
		await t.L.push({ width: 32, height: 32 }, layout);
		const next = JSON.parse(ws(t).sent.find((m) => typeof m === "string" && m.includes('"meta"')));
		assert.notStrictEqual(next.session, before);
		assert.strictEqual(next.art, false);
	});

	console.log("Folder");
	const file = (text, lastModified) => ({ text: async () => text, size: 10, lastModified });
	const beat = (t, n, started) => { t.folder["aseprite_status.json"] = file(JSON.stringify({ beat: n, started, file: "a.aseprite", w: 32, h: 32, frames: 1 }), Date.now()); };
	const tick = async (t) => { t.ctx.pollNow(); await settle(); };
	const linkFolder = async () => {
		const t = load();
		// setInterval is faked, so the test drives the poll the link would run.
		t.ctx.setInterval = (fn) => { t.ctx.pollNow = fn; return 1; };
		await t.L.connect();
		await settle();
		return t;
	};
	await test("a left-over albedo.png and status file do nothing until the beat moves", async () => {
		const t = await linkFolder();
		const started = Math.floor(Date.now() / 1000) - 100;
		beat(t, 1, started);
		t.folder["albedo.png"] = Object.assign(file("", Date.now() - 200000), { size: 10 });
		await tick(t);
		assert.strictEqual(t.L.peer, null);
		assert.strictEqual(t.got.albedo, 0);
	});
	await test("an albedo.png older than this Aseprite session is ignored once it is there, a new one is taken", async () => {
		const t = await linkFolder();
		const started = Math.floor(Date.now() / 1000);
		beat(t, 1, started); await tick(t);
		t.folder["albedo.png"] = file("", Date.now() - 100000);
		beat(t, 2, started); await tick(t);
		assert.strictEqual(t.L.peer.file, "a.aseprite");
		assert.strictEqual(t.got.albedo, 0);
		t.folder["albedo.png"] = file("", Date.now());
		await tick(t);
		assert.strictEqual(t.got.albedo, 1);
	});
	await test("Aseprite counts as gone when the beat stops", async () => {
		const t = await linkFolder();
		beat(t, 1, 1); await tick(t);
		beat(t, 2, 1); await tick(t);
		assert(t.L.peer);
		const realNow = Date.now, later = realNow() + 9000;
		Date.now = () => later;
		try { await tick(t); } finally { Date.now = realNow; }
		assert.strictEqual(t.L.peer, null);
	});
	await test("linking a folder ends an online link", async () => {
		const t = load();
		t.ctx.setInterval = () => 1;
		open(t);
		await t.L.connect();
		assert.strictEqual(t.L.relayRoom(), "");
		assert(t.L.folderLinked());
	});

	console.log(`\n${passed} passed, ${failed} failed`);
	process.exit(failed ? 1 : 0);
})();
