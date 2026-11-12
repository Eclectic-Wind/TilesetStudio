// One drawn icon set for the viewport tools, so they look alike on every system (font glyphs and emoji don't).
// A value is path data on a 24 px grid, or raw SVG when it starts with "<". Buttons without an icon here keep their text (3D, 1:1).
"use strict";
(() => {
	const ICONS = {
		select: "M5 3l14 9-6 1.5L10 20z",
		box: '<rect x="4" y="5" width="16" height="14" stroke-dasharray="3 2.5"/>',
		ref: "M8 8h12v12H8zM4 16V4h12",
		cursor: '<circle cx="12" cy="12" r="5"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/>',
		pencil: "M3 17c3-9 6-11 8-6s4 6 10-5",
		grab: "M12 3v18M3 12h18M12 3L9 6M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3",
		scale: "M4 20L20 4M20 4h-6M20 4v6M4 20h6M4 20v-6",
		rotate: "M20 12a8 8 0 1 1-2.5-5.8M20 3v5h-5",
		gizmo: "M6 18V4M6 18h14M6 18l10-10M3.5 7L6 4l2.5 3M17 15.500l3 2.500-3 2.500M12 8h4v4",
		edit: "M4 20l1-4L16 5l3 3L8 19zM14 7l3 3",
		vert: '<circle cx="12" cy="12" r="4.500" fill="currentColor"/>',
		edge: '<path d="M6 18L18 6"/><circle cx="6" cy="18" r="2" fill="currentColor"/><circle cx="18" cy="6" r="2" fill="currentColor"/>',
		face: '<path d="M8 6h12l-4 12H4z" fill="currentColor" fill-opacity=".45"/>',
		extrude: "M4 20h16M12 16V5M8 9l4-4 4 4",
		extrudeman: "M4 5h16M12 8v11M8 15l4 4 4-4",
		inset: "M4 4h16v16H4zM9 9h6v6H9z",
		bevel: "M4 20V10l6-6h10",
		loopcut: '<rect x="4" y="4" width="16" height="16"/><path d="M12 4v16" stroke-dasharray="3 2"/>',
		knife: "M3 21L14 10M14 10l4-7 3 3-7 4z",
		fill: '<path d="M5 19L12 5l7 14z" fill="currentColor" fill-opacity=".3"/>',
		bridge: "M4 6h5v12H4zM15 6h5v12h-5zM9 9h6M9 15h6",
		shadesmooth: "M4 18a8 8 0 0 1 16 0M3 18h18",
		duplicate: "M8 8h12v12H8zM16 8V4H4v12h4",
		join: "M7 4v9a5 5 0 0 0 10 0V4",
		mirror: "M12 3v18M8 7L3 17h5zM16 7l5 10h-5z",
		hide: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM4 4l16 16",
		delete: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
		undo: "M9 5L4 10l5 5M4 10h11a5 5 0 0 1 0 10h-4",
		redo: "M15 5l5 5-5 5M20 10H9a5 5 0 0 0 0 10h4",
		pan: "M8 12V6a1.500 1.500 0 0 1 3 0v5-6.500a1.500 1.500 0 0 1 3 0V11V6a1.500 1.500 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2-4a1.500 1.500 0 0 1 2.500-1.500z",
		zoom: '<circle cx="11" cy="11" r="6"/><path d="M16 16l5 5"/>',
		look: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.500"/>',
		ortho: "M12 3l8 4.500v9L12 21l-8-4.500v-9zM12 12l8-4.500M12 12L4 7.500M12 12v9",
		unlockview: "M6 11h12v9H6zM9 11V7a3 3 0 0 1 6 0",
		zoomin: "M12 5v14M5 12h14",
		zoomout: "M5 12h14",
		frame: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><circle cx="12" cy="12" r="2" fill="currentColor"/>',
		fit: "M4 4h16v16H4zM9 9L4 4M15 9l5-5M9 15l-5 5M15 15l5 5",
		max: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
		panelleft: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="M4.5 5.5h3v13h-3z" class="panelfill" fill="currentColor" stroke="none"/>',
		panelright: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/><path d="M16.5 5.5h3v13h-3z" class="panelfill" fill="currentColor" stroke="none"/>',
	};

	TS.icon = (name) => {
		const v = ICONS[name], body = v[0] === "<" ? v : `<path d="${v}"/>`;
		return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
	};

	for (const b of document.querySelectorAll(".palette [data-tool], .palette [data-act], .nav [data-tool], .nav [data-act]")) {
		// An icon button is named by its tooltip's first clause ("Move (G)" -> "Move"), since it has no text of its own.
		const title = b.getAttribute("title") || "", name = b.dataset.tool || b.dataset.act;
		b.setAttribute("aria-label", title.split(/[:.;(]/)[0].trim());
		if (ICONS[name]) b.innerHTML = TS.icon(name);
	}
})();
