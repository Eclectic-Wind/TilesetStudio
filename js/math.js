// Small vector / matrix helpers. World axes everywhere: X east (screen x), Y south (on the floor), Z up, in art pixels.
// A world point (X, Y, Z) is drawn at canvas pixel (X, Y - Z): the projection the tilesets are drawn in.
"use strict";
var TS = window.TS || (window.TS = {});

TS.v3 = {
	add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
	sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
	scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
	dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
	cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
	len: (a) => Math.hypot(a[0], a[1], a[2]),
	norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; },
	lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
	dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
	copy: (a) => [a[0], a[1], a[2]],
	// Rotate about the vertical axis through `c` by `rad` (+ turns east toward south, i.e. clockwise seen from above).
	rotZ: (p, c, rad) => {
		const s = Math.sin(rad), k = Math.cos(rad), x = p[0] - c[0], y = p[1] - c[1];
		return [c[0] + x * k - y * s, c[1] + x * s + y * k, p[2]];
	},
};

// Column-major 4x4 matrices (WebGL order).
TS.m4 = {
	identity: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
	mul: (a, b) => {
		const o = new Float32Array(16);
		for (let c = 0; c < 4; c++)
			for (let r = 0; r < 4; r++) {
				let s = 0;
				for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
				o[c * 4 + r] = s;
			}
		return o;
	},
	perspective: (fovy, aspect, near, far) => {
		const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
		return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
	},
	lookAt: (eye, target, up) => {
		const z = TS.v3.norm(TS.v3.sub(eye, target));
		const x = TS.v3.norm(TS.v3.cross(up, z));
		const y = TS.v3.cross(z, x);
		return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
			-TS.v3.dot(x, eye), -TS.v3.dot(y, eye), -TS.v3.dot(z, eye), 1]);
	},
	lerp: (a, b, t) => { const o = new Float32Array(16); for (let i = 0; i < 16; i++) o[i] = a[i] + (b[i] - a[i]) * t; return o; },
	invert: (m) => {
		const inv = new Float32Array(16);
		inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
		inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
		inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
		inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
		inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
		inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
		inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
		inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
		inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
		inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
		inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
		inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
		inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
		inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
		inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
		inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
		let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
		det = det === 0 ? 0 : 1 / det;
		for (let i = 0; i < 16; i++) inv[i] *= det;
		return inv;
	},
	// [x, y, z, w] = m * [p, 1]
	apply: (m, p) => [
		m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
		m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
		m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
		m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15],
	],
};

TS.snap = (v, step) => (step > 0 ? Math.round(v / step) * step : v);
TS.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
TS.isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;
