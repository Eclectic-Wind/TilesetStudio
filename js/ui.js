// Interface polish that doesn't touch the modelling code: click menus, styled tooltips, the start screen, the drop overlay,
// remembered panel sections. Loaded after app.js; everything here is optional (the Studio works without it).
"use strict";
(() => {
	const $ = (id) => document.getElementById(id);
	const store = {
		get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
		set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
	};

	// --- Menus: File and Export open on click and stay open until you pick something or click away (Add is app.js's) ---
	const closeMenus = (except) => {
		for (const m of document.querySelectorAll(".menu.open")) if (!except || !except.contains(m)) m.classList.remove("open");
	};
	for (const wrap of document.querySelectorAll(".menuwrap[data-click]")) {
		const btn = wrap.querySelector(":scope > button"), menu = wrap.querySelector(".menu");
		btn.addEventListener("click", (e) => { e.stopPropagation(); const open = !menu.classList.contains("open"); closeMenus(); menu.classList.toggle("open", open); });
		menu.addEventListener("click", (e) => { if (e.target.closest("button")) menu.classList.remove("open"); });
		menu.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") setTimeout(() => menu.classList.remove("open"), 0); });
	}
	document.addEventListener("click", (e) => {
		const add = $("addmenu");
		if (add.classList.contains("open") && !add.parentElement.contains(e.target)) add.classList.remove("open");
		for (const m of document.querySelectorAll(".menuwrap[data-click] .menu.open")) if (!m.parentElement.contains(e.target)) m.classList.remove("open");
	});
	window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenus(); });

	// --- Tooltips: every title="" becomes an instant, styled tip (name in bold, the explanation under it) ---
	const tip = document.createElement("div");
	tip.className = "tip"; tip.setAttribute("role", "tooltip");
	document.body.append(tip);
	let cur = null, timer = 0, lastShown = 0;
	const hideTip = () => { clearTimeout(timer); tip.classList.remove("on"); cur = null; };
	const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
	const fillTip = (text) => {
		const m = text.match(/^(.{1,48}?)(?::\s|;\s|\.\s)([\s\S]+)$/);
		if (m) tip.innerHTML = `<b>${esc(m[1])}</b><span>${esc(m[2])}</span>`;
		else if (text.length <= 60) tip.innerHTML = `<b>${esc(text)}</b>`;
		else tip.innerHTML = `<span>${esc(text)}</span>`;
	};
	const placeTip = (el) => {
		const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, vw = innerWidth, vh = innerHeight;
		let x, y;
		if (el.closest(".palette")) { x = r.right + 8; y = r.top + r.height / 2 - h / 2; }
		else if (el.closest(".nav")) { x = r.left - w - 8; y = r.top + r.height / 2 - h / 2; }
		else {
			x = r.left + r.width / 2 - w / 2; y = r.bottom + 8;
			if (y + h > vh - 4) y = r.top - h - 8;
		}
		tip.style.left = Math.max(4, Math.min(vw - w - 4, x)) + "px";
		tip.style.top = Math.max(4, Math.min(vh - h - 4, y)) + "px";
	};
	document.addEventListener("mouseover", (e) => {
		const el = e.target.closest ? e.target.closest("[title],[data-tip]") : null;
		if (el === cur) return;
		hideTip();
		if (!el || (matchMedia("(pointer: coarse)").matches)) return;
		if (el.hasAttribute("title")) {
			const t = el.getAttribute("title");
			el.removeAttribute("title");
			if (t) el.dataset.tip = t;
			if (t && !el.getAttribute("aria-label") && !el.textContent.trim()) el.setAttribute("aria-label", t.split(/[:.;(]/)[0].trim());
		}
		const text = el.dataset.tip;
		if (!text) return;
		cur = el;
		const show = () => { fillTip(text); tip.classList.add("on"); placeTip(el); lastShown = performance.now(); };
		timer = setTimeout(show, performance.now() - lastShown < 600 ? 0 : 350);
	});
	document.addEventListener("mouseout", (e) => { if (cur && !cur.contains(e.relatedTarget)) { if (tip.classList.contains("on")) lastShown = performance.now(); hideTip(); } });
	for (const ev of ["mousedown", "wheel", "keydown", "dragstart"]) window.addEventListener(ev, hideTip, true);

	// --- Start screen buttons ---
	const status = (t) => { $("status").textContent = t; };
	$("e_open").onclick = () => $("f_tileset").click();
	$("e_project").onclick = () => $("f_project").click();
	$("e_learn").onclick = () => $("b_learn").click();
	if (location.protocol === "file:") $("e_sample").style.display = $("e_sample").nextElementSibling.style.display = "none"; // fetch() can't read samples from disk
	else $("e_sample").onclick = () => fetch("samples/BasicSample.studio.json").then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); }).then((t) => TS.api.openProject(t)).catch((err) => status("Could not open the sample: " + err));

	// --- Drop overlay: say what a drop will do ---
	const veil = document.createElement("div");
	veil.className = "dropveil"; veil.innerHTML = "<div>Drop a tileset PNG or a project (.json) to open it</div>";
	document.body.append(veil);
	let depth = 0;
	const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
	document.addEventListener("dragenter", (e) => { if (hasFiles(e)) { depth++; veil.classList.add("on"); } });
	document.addEventListener("dragleave", (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; veil.classList.remove("on"); } });
	document.addEventListener("drop", () => { depth = 0; veil.classList.remove("on"); });

	// --- Panel sections remember whether they were open ---
	for (const d of document.querySelectorAll("details.sec")) {
		const k = "ts.sec." + d.id, v = store.get(k);
		if (v === "1") d.open = true; else if (v === "0") d.open = false;
		d.addEventListener("toggle", () => store.set(k, d.open ? "1" : "0"));
	}

	// --- The light controls only matter in the Lit view ---
	const outSection = document.querySelector("section.output");
	const syncMode = () => { const o = TS.api && TS.api.output; if (o && outSection.dataset.mode !== o.mode) outSection.dataset.mode = o.mode; };
	$("outmodes").addEventListener("click", () => setTimeout(syncMode, 0));
	setInterval(syncMode, 400);
	syncMode();
})();
