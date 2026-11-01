// A minimal 8-bit RGBA PNG encoder (zlib from Node), for the headless tools: the animated tiles' colour sheets and the sample project.
"use strict";
const zlib = require("zlib");
const table = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, body) => {
	const out = Buffer.alloc(12 + body.length);
	out.writeUInt32BE(body.length, 0); out.write(type, 4, "latin1"); body.copy(out, 8);
	out.writeUInt32BE(crc(out.subarray(4, 8 + body.length)), 8 + body.length);
	return out;
};
// rgba: Uint8Array / Uint8ClampedArray / Buffer of w * h * 4 -> Buffer (a PNG file)
exports.encodePNG = (rgba, w, h) => {
	const raw = Buffer.alloc((w * 4 + 1) * h);
	for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
	const head = Buffer.alloc(13);
	head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 6;
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
};
