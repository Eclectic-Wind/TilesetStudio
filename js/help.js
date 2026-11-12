// The Help dialog's shortcut list: grouped, filled from this table, and filtered by the box above it.
"use strict";
(() => {
	const KEYS = {
		"Select": [
			["Click / Shift+click", "Select / add to selection. Click again for the next thing under the pointer (white outline = what a click takes); X-ray picks through faces"],
			["Q", "Select tool: drag a selected piece to move it, drag empty space to box-select"],
			["B", "Box select: drag a rectangle (3D too) to select every model it touches; Shift adds. Properties then edits them all"],
			["A / Alt+A", "Select all / none"],
			["Ctrl+I", "Invert selection"],
			["H / Shift+H / Alt+H", "Hide selected / hide others / show all (hidden models still export)"],
			["Outliner", "Double-click renames, the dot hides, the box filters"],
		],
		"Add and arrange": [
			["Shift+A", "Add a primitive in the tile south-east of the red cursor"],
			["Right-click, C", "Place the 3D cursor (on a top: stack on it)"],
			["G", "Move over the ground; Z = only height, X = only across, Y = only depth"],
			["S", "Scale (X / Y / Z = width / depth / height only)"],
			["R", "Turn in 15° steps (Z = upright axis; X / Y tip it over)"],
			["X / Y / Z twice", "Local axis while moving, scaling or turning"],
			["Type a number", "Exact value while a tool runs"],
			["Shift", "Half the snap step (Snap off: no snapping)"],
			["Ctrl+arrows, PageUp/Down", "Nudge one snap step (Shift: half)"],
			["[ / ]", "Snap step down / up"],
			["Shift+D / X", "Duplicate / delete"],
			["Ctrl+C / Ctrl+V", "Copy / paste models in place (also between projects)"],
			["Ctrl+J", "Join the selected models into the active one"],
			["Ctrl+M, X / Y / Z", "Mirror the selection on that axis"],
		],
		"Edit mode": [
			["Tab", "Edit the active model"],
			["1 / 2 / 3", "Vertex / edge / face mode"],
			["E", "Extrude faces; on edges or vertices, grow quads or new points on lines"],
			["Alt+E", "Extrude manifold: pushed in, a face cuts the model; pulled out flush, it merges with its neighbours"],
			["I", "Inset faces (even all round)"],
			["Ctrl+B", "Bevel edges"],
			["Ctrl+R", "Loop cut: click an edge, slide, click"],
			["K", "Knife: click points along a cut, Enter or right-click cuts, Backspace drops a point, the first point closes; X-ray cuts through"],
			["F", "Fill: 2 vertices → a line, 3+ vertices or an edge loop → a face"],
			["Ctrl+E", "Bridge two faces (a tunnel) or two edge loops or strips (a band); same vertex counts"],
			["Ctrl+right-click", "New point at the pointer, joined to the selected one: draw an outline, F, E up (Add ▾ Point starts from nothing)"],
			["P", "Free Draw: add a shape, or cut through or carve a closed solid; works in the held 3D camera"],
		],
		"View": [
			["Alt-drag, middle-drag", "Look round (eases back on release)"],
			["5, 3D button", "Stay in 3D and model there: drag orbits, Ctrl-drag box-selects, Shift/Space-drag pans; again to go back"],
			["3D: wheel, pinch", "Zoom toward the pointer (Ctrl+middle-drag zooms smoothly); a trackpad two-finger slide pans"],
			["3D: Numpad 4 / 6 / 8 / 2, + / −", "Turn round, tilt, zoom (Shift: small steps); Home frames every model"],
			["Axis key balls", "Look down an axis (or Numpad 1 / 3 / 7; Ctrl: the opposite side). Click the ringed ball to flip. Moves and turns then stay on that plane, until the padlock button clears it"],
			["Space-drag, Shift+middle", "Pan"],
			["Arrows", "Pan a tile"],
			["Wheel, + / −", "Zoom in whole-pixel steps"],
			[". (F outside edit mode) / Home", "Frame selection / fit the tileset"],
			["Alt+Z", "X-ray"],
		],
		"File": [
			["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"],
			["Animate: Delete, Ctrl+C, Ctrl+V", "With keys picked in the dopesheet: delete them, copy them, paste at the playhead (Alt-drag copies too)"],
			["Ctrl+S", "Save project (unsaved work is autosaved and offered back on the next start)"],
			["Ctrl+O / Ctrl+Shift+O", "Open a project / a tileset PNG"],
			["Ctrl+Shift+E", "Export the Godot bundle"],
			["L", "Learn: visual lessons"],
			["F1", "This help"],
		],
	};

	const box = document.getElementById("help_keys"), search = document.getElementById("help_search"), none = document.getElementById("help_none");
	box.innerHTML = Object.entries(KEYS).map(([group, rows]) => `<section><h3>${TS.esc(group)}</h3><dl>${
		rows.map(([k, what]) => `<div><dt>${TS.esc(k)}</dt><dd>${TS.esc(what)}</dd></div>`).join("")}</dl></section>`).join("");

	search.oninput = () => {
		const q = search.value.trim().toLowerCase();
		for (const row of box.querySelectorAll("dl > div")) row.hidden = !!q && !row.textContent.toLowerCase().includes(q);
		for (const sec of box.children) sec.hidden = !sec.querySelector("dl > div:not([hidden])");
		none.hidden = !![...box.children].some((sec) => !sec.hidden);
	};
})();
