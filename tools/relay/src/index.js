// Tileset Studio relay: passes messages between Studio (in a browser) and the Aseprite extension that share a room code.
// Both dial out to wss://<this worker>/r/<room>; the room is a Durable Object that forwards every frame to the other peers and keeps
// the latest picture so a late joiner gets it at once.
//
// Free-plan friendly: the room uses the WebSocket Hibernation API, so while nobody is sending it is evicted from memory and costs no
// duration. That is also why the cached pictures live in the room's storage (they would be lost on eviction); everything is deleted
// when the last peer leaves. Only the newest ping stays in memory: it is resent every 30 s anyway, and storing it would cost a write.
//
// Frames (the same in the page and the extension):
//   text   {"t":"meta",...}                     Studio's sheet layout (cached); {"t":"frames",...} Aseprite's timeline changes (not cached)
//          {"t":"ping",...} / {"t":"pong",...}  who is there now; the newest ping is kept so a late Aseprite answers at once
//   binary [kind][index][count][png bytes...]  kind 1 = normal.png, 2 = albedo.png, 3 = the tileset's art, sent as `count` chunks of <= 60 KB
// The relay never looks inside; it only keys its cache on kind (binary) or the text's "t" (text) and restarts a kind when index 0 arrives.
import { DurableObject } from "cloudflare:workers";

const pad = (i) => String(i).padStart(3, "0");

export class Room extends DurableObject {
	constructor(ctx, env) {
		super(ctx, env);
		this.ping = null; // the newest ping; lost on eviction, which is fine
	}

	async fetch(request) {
		if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a websocket", { status: 426 });
		const [client, server] = Object.values(new WebSocketPair());
		this.ctx.acceptWebSocket(server);
		// Text first (Studio's layout), then each picture's chunks in order: the layout must arrive before the picture it describes.
		const stored = await this.ctx.storage.list();
		for (const [k, f] of stored) if (k.startsWith("t:")) server.send(f);
		for (const [k, f] of stored) if (k.startsWith("b:")) server.send(f);
		if (this.ping) server.send(this.ping);
		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws, m) {
		if (typeof m === "string") {
			let t = "";
			try { t = JSON.parse(m).t || ""; } catch (err) { /* plain text */ }
			if (t === "ping") this.ping = m;
			else if (t !== "frames" && t !== "pong") await this.ctx.storage.put("t:" + t, m); // frame changes are events: only the peers there now get them
		} else if (m.byteLength >= 3) {
			const b = new Uint8Array(m, 0, 3), prefix = `b:${b[0]}:`;
			if (b[1] === 0) { // a new picture of this kind: forget the old one's chunks
				const old = [...(await this.ctx.storage.list({ prefix })).keys()];
				if (old.length) await this.ctx.storage.delete(old);
			}
			await this.ctx.storage.put(prefix + pad(b[1]), m);
		} else return;
		for (const p of this.ctx.getWebSockets()) if (p !== ws) { try { p.send(m); } catch (err) { /* closing */ } }
	}

	async webSocketClose(ws, code) {
		try { ws.close(code === 1005 || code === 1006 ? 1000 : code, "bye"); } catch (err) { /* already closed */ }
		await this.forgetIfEmpty(ws);
	}

	async webSocketError(ws) { await this.forgetIfEmpty(ws); }

	// Everyone left: forget the pictures.
	async forgetIfEmpty(gone) {
		if (this.ctx.getWebSockets().some((p) => p !== gone && p.readyState === 1)) return;
		this.ping = null;
		await this.ctx.storage.deleteAll();
	}
}

export default {
	async fetch(request, env) {
		const match = new URL(request.url).pathname.match(/^\/r\/([a-z0-9]{16,64})$/);
		if (!match) return new Response("Tileset Studio relay", { status: 200 });
		return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request);
	},
};
