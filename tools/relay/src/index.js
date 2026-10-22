// Tileset Studio relay: passes messages between Studio (in a browser) and the Aseprite extension that share a room code.
// Both dial out to wss://<this worker>/r/<room>; the room is a Durable Object that forwards every frame to the other peers and keeps
// the latest picture in memory so a late joiner gets it at once. Nothing is written to disk.
//
// Frames (the same in the page and the extension):
//   text   {"t":"meta",...}                     Studio's sheet layout (cached); {"t":"frames",...} Aseprite's timeline changes (not cached)
//   binary [kind][index][count][png bytes...]  kind 1 = normal.png, 2 = albedo.png, sent as `count` chunks of <= 60 KB
// The relay never looks inside; it only keys its cache on kind (binary) or the text's "t" (text) and restarts a kind when index 0 arrives.

export class Room {
	constructor() {
		this.peers = new Set();
		this.cache = new Map(); // key -> [frame, ...] in order
	}

	async fetch(request) {
		if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a websocket", { status: 426 });
		const [client, server] = Object.values(new WebSocketPair());
		server.accept();
		for (const frames of this.cache.values()) for (const f of frames) server.send(f);
		this.peers.add(server);
		server.addEventListener("message", (e) => {
			const m = e.data;
			if (typeof m === "string") {
				let t = "";
				try { t = JSON.parse(m).t || ""; } catch (err) { /* plain text */ }
				if (t !== "frames") this.cache.set("t:" + t, [m]); // frame changes are events: only the peers there now get them
			}
			else if (m.byteLength >= 3) {
				const b = new Uint8Array(m, 0, 3), key = b[0];
				if (b[1] === 0 || !this.cache.has(key)) this.cache.set(key, [m]);
				else this.cache.get(key).push(m);
			} else return;
			for (const p of this.peers) if (p !== server) { try { p.send(m); } catch (err) { this.peers.delete(p); } }
		});
		const drop = () => this.peers.delete(server);
		server.addEventListener("close", drop);
		server.addEventListener("error", drop);
		return new Response(null, { status: 101, webSocket: client });
	}
}

export default {
	async fetch(request, env) {
		const match = new URL(request.url).pathname.match(/^\/r\/([a-z0-9]{16,64})$/);
		if (!match) return new Response("Tileset Studio relay", { status: 200 });
		return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request);
	},
};
