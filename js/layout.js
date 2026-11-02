// Docked workspace layout: resizable sidebar and viewports, panel visibility and the Window menu.
// These are this browser's preferences; they never touch project data.
"use strict";
(() => {
	const $ = (id) => document.getElementById(id);
	const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
	const main = document.querySelector("main"), side = main.querySelector("aside.left"), view = main.querySelector("section.view"), out = main.querySelector("section.output");
	const KEY = "ts.workspace.layout.v1", WIDTH = 280, RATIO = 0.62, MIN_WIDTH = 180, MAX_WIDTH = 520;
	const defaults = () => ({ width: WIDTH, ratio: RATIO, mode: "split", hidden: [], collapsed: [] });

	let state = defaults();
	const saved = TS.store.json(KEY);
	if (saved && typeof saved === "object") {
		if (Number.isFinite(saved.width)) state.width = clamp(saved.width, MIN_WIDTH, MAX_WIDTH);
		if (Number.isFinite(saved.ratio)) state.ratio = clamp(saved.ratio, 0.15, 0.85);
		if (["split", "model", "preview"].includes(saved.mode)) state.mode = saved.mode;
		if (Array.isArray(saved.hidden)) state.hidden = saved.hidden;
		if (Array.isArray(saved.collapsed)) state.collapsed = saved.collapsed;
	}
	const save = () => TS.store.set(KEY, JSON.stringify(state));
	const without = (list, x) => list.filter((y) => y !== x);

	// The canvases size themselves on window resize; one frame's worth of layout changes makes one redraw.
	let frame = 0;
	const redraw = () => {
		if (frame) return;
		frame = requestAnimationFrame(() => { frame = 0; window.dispatchEvent(new Event("resize")); });
	};

	// Collapsible strips under the output view.
	function collapsible(label, nodes, id) {
		const d = document.createElement("details"), sum = document.createElement("summary");
		d.className = "workspace-details"; d.id = id; d.open = !state.collapsed.includes(id);
		sum.textContent = label;
		nodes[0].before(d);
		d.append(sum, ...nodes);
		d.addEventListener("toggle", () => {
			state.collapsed = without(state.collapsed, id);
			if (!d.open) state.collapsed.push(id);
			save(); redraw();
		});
		return d;
	}
	const lights = collapsible("Lighting", [out.querySelector(".lightbar")], "workspace-light");
	const stats = collapsible("Statistics", [$("pieceinfo"), $("stats"), $("probe")], "workspace-stats");

	const PANELS = {
		sidebar: ["Sidebar", [side]],
		tools: ["Modeling toolbar", [$("palette")]],
		navigation: ["Navigation toolbar", [$("nav")]],
		lighting: ["Lighting", [lights]],
		statistics: ["Statistics", [stats]],
		references: ["References", [$("sec_refs")]],
		animation: ["Animation panels", [$("sec_anim"), $("timeline")]],
	};

	// --- Window menu ---
	const wrap = document.createElement("div");
	wrap.className = "menuwrap workspace-menu"; wrap.dataset.click = "";
	wrap.innerHTML = '<button class="ghost">Window ▾</button><div class="menu"><b>Panels</b></div>';
	$("b_learn").before(wrap);
	const menu = wrap.querySelector(".menu"), checks = {}, modes = {};
	for (const [id, [label]] of Object.entries(PANELS)) {
		const row = document.createElement("label"), input = document.createElement("input");
		input.type = "checkbox";
		input.onchange = () => {
			state.hidden = without(state.hidden, id);
			if (!input.checked) state.hidden.push(id);
			apply();
		};
		checks[id] = input;
		row.append(input, label);
		menu.append(row);
	}
	menu.append(document.createElement("hr"));
	for (const [mode, label] of Object.entries({ split: "Split view", model: "Modeling only", preview: "Preview only" })) {
		const b = document.createElement("button");
		b.textContent = label;
		b.onclick = () => { state.mode = mode; apply(); };
		modes[mode] = b;
		menu.append(b);
	}
	const reset = document.createElement("button");
	reset.textContent = "Reset layout";
	reset.onclick = () => {
		state = defaults();
		for (const d of [lights, stats, ...side.querySelectorAll("details")]) d.open = true;
		// Through the fold button, so its arrow turns back too.
		for (const b of document.querySelectorAll("[data-fold]")) if ($(b.dataset.fold).classList.contains("folded")) b.click();
		apply();
	};
	menu.append(document.createElement("hr"), reset);

	// --- Dividers ---
	function divider(before, label, change) {
		const bar = document.createElement("div");
		bar.className = "workspace-divider"; bar.tabIndex = 0;
		bar.setAttribute("role", "separator"); bar.setAttribute("aria-label", label); bar.setAttribute("aria-orientation", "vertical");
		before.before(bar);
		const home = () => { state.width = WIDTH; state.ratio = RATIO; apply(); };
		let pointer = null;
		bar.onpointerdown = (e) => {
			if (e.button !== 0) return;
			e.preventDefault();
			pointer = e.pointerId;
			bar.setPointerCapture(pointer);
		};
		bar.onpointermove = (e) => { if (pointer === e.pointerId) { change(e.clientX); apply(); } };
		bar.onpointerup = bar.onpointercancel = () => { pointer = null; save(); };
		bar.ondblclick = home;
		bar.onkeydown = (e) => {
			if (e.key === "Home") home();
			else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { change(bar.getBoundingClientRect().left + (e.key === "ArrowLeft" ? -16 : 16)); apply(); }
			else return;
			e.preventDefault();
		};
		return bar;
	}
	const sideBar = divider(view, "Resize sidebar", (x) => { state.width = clamp(x - main.getBoundingClientRect().left, MIN_WIDTH, Math.min(MAX_WIDTH, main.clientWidth * 0.5)); });
	const center = divider(out, "Resize modeling and preview", (x) => {
		const left = view.getBoundingClientRect().left, right = out.getBoundingClientRect().right;
		state.ratio = clamp((x - left) / Math.max(1, right - left), 0.15, 0.85);
	});

	// Each viewport's maximize / restore button.
	for (const [bar, mode] of [[$("viewbar"), "model"], [$("outmodes"), "preview"]]) {
		const b = document.createElement("button");
		b.className = "workspace-max"; b.innerHTML = TS.icon("max");
		b.title = "Maximize / restore viewport"; b.setAttribute("aria-label", b.title);
		b.onclick = () => { state.mode = state.mode === mode ? "split" : mode; apply(); };
		bar.append(b);
	}

	function apply() {
		for (const [id, [, nodes]] of Object.entries(PANELS)) {
			const hide = state.hidden.includes(id);
			for (const n of nodes) n.classList.toggle("workspace-hidden", hide);
			checks[id].checked = !hide;
		}
		side.style.flexBasis = Math.min(state.width, main.clientWidth * 0.5) + "px";
		view.style.flex = state.ratio + " 1 0px";
		out.style.flex = (1 - state.ratio) + " 1 0px";
		view.classList.toggle("workspace-hidden", state.mode === "preview");
		out.classList.toggle("workspace-hidden", state.mode === "model");
		sideBar.classList.toggle("workspace-hidden", state.hidden.includes("sidebar"));
		center.classList.toggle("workspace-hidden", state.mode !== "split");
		for (const [m, b] of Object.entries(modes)) b.setAttribute("aria-pressed", String(m === state.mode));
		sideBar.setAttribute("aria-valuenow", Math.round(state.width));
		center.setAttribute("aria-valuenow", Math.round(state.ratio * 100));
		save(); redraw();
	}

	main.classList.add("workspace-docked");
	apply();
	new ResizeObserver(apply).observe(main);
})();
