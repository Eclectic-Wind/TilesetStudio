// "What's new" window: opens by itself once per release for returning visitors, and from the top bar's "What's new" button.
// To announce a new release, add an entry at the top of NEWS (newest first) with a new id; people who saw an older id see it again.
"use strict";
(() => {
	const NEWS = [
		{
			id: "2026-11-13-3",
			date: "13 Nov 2026",
			title: "Onion ghosts stay behind your model",
			sections: [
				["Animation", [
					"The <b>Onion</b> ghosts no longer cover the model you are posing: they show only where the frames before and after reach past it, so the current pose stays clear to see and grab.",
				]],
			],
		},
		{
			id: "2026-11-13-2",
			date: "13 Nov 2026",
			title: "Onion skin: solid ghosts, more frames",
			sections: [
				["Animation", [
					"<b>Onion</b> (under the timeline) now shows the frames around the playhead as see-through <b>solid ghosts</b>, shaded so you can read their shape: red for frames before, green for frames after. Before, they were thin wires that were easy to miss.",
					"The numbers either side of <b>Onion</b> set <b>how many frames back and forward</b> to show (0 to 8 each). Ghosts further from the playhead are fainter. Changing a number turns the onion skin on.",
					"Ghosts show while stopped, in Pose mode. Larger models no longer hide them silently: if there are too many faces for that many ghosts, a note at the top of the view says so; show fewer frames.",
				]],
			],
		},
		{
			id: "2026-11-13",
			date: "13 Nov 2026",
			title: "Lights can go below the floor",
			sections: [
				["Lights", [
					"A light's <b>Z</b> (its height) can now be <b>negative</b>, to put it below the floor Z=0. Type it in the light's Properties, or move it with <b>G</b> then <b>Z</b>. Before, it stopped at 0.",
					"The quick preview light's <b>height</b> slider (Lit view, while the project has no lights) goes below 0 too.",
					"A light below the floor lights the undersides of models, and the empty floor no longer goes darker next to it.",
				]],
			],
		},
		{
			id: "2026-11-12-2",
			date: "12 Nov 2026",
			title: "A freer 3D camera, one-click panel toggles",
			sections: [
				["3D view (press 5)", [
					"<b>Pan goes anywhere</b>: Shift-drag, Space-drag or Shift+middle-drag now moves the view up and down too, not only across the floor. The scene follows the pointer.",
					"<b>The wheel zooms toward the pointer</b>, so you can dive straight in on a detail. You can pull much further back over a big map, and go much closer in.",
					"<b>Trackpads</b>: pinch zooms, a two-finger slide pans. On a touch screen two fingers pan and pinch.",
					"<b>Ctrl+middle-drag</b> (or the zoom tool) zooms smoothly. The orbit now tilts all the way to looking straight down or up.",
					"<b>Keys</b>: Numpad 4 / 6 turn round, 8 / 2 tilt (Shift: small steps), Numpad + / − zoom, <b>Home</b> frames every model, <b>F</b> or <b>.</b> frames the selection.",
				]],
				["More room to work", [
					"Two new buttons at the ends of the model view's top bar close and reopen the side panels: the one on the <b>far left</b> hides the left panel (models, properties), the one on the <b>far right</b> hides the right panel (the preview). Click again to bring it back. The filled strip in the icon shows the panel is open.",
					"With a panel closed, the model view now fills all the room it frees (Window ▸ Modeling only used to leave a gap).",
				]],
			],
		},
		{
			id: "2026-11-12",
			date: "12 Nov 2026",
			title: "Pins, IK that just works, faster GPU lighting",
			sections: [
				["Animation", [
					"<b>Pins</b>: select a foot and press <b>P</b> to plant it. Move or turn the hips and the leg bends so the foot stays put, on every frame you pose. <b>P</b> again unpins. Steps below.",
					"<b>IK limbs works out of the box</b>: drag the ball at a shin's or forearm's tip and the whole leg or arm bends. No IK chain to set (it's <b>Auto</b>).",
					"Rigs from Blender work as they are: a bone whose head sits on its parent's tip counts as a joint, with no need to tick Connected.",
					"New lesson: <b>Learn ▸ Animation ▸ IK limbs and pins</b>.",
				]],
				["Lit view", [
					"The <b>GPU</b> renderer now lights every light in the scene (area lights too) and matches Current.",
					"Much quicker while editing lights: each light's shadows are kept, so moving one light or changing a colour redraws fast. With GPU selected, the lighting follows a light live as you drag it in the 3D view.",
				]],
			],
			stepsTitle: "Plant a foot with pins",
			ik: [
				"Animate panel, under Bones: keep <b>IK limbs</b> ticked.",
				"Select the <b>foot</b> (or hand) and press <b>P</b>. A red pin marks the spot. Pin the other foot too if both stay down.",
				"Select the <b>hips</b> and press <b>G</b> (move) or <b>R</b> (turn). The legs bend, the feet stay, and every bent bone is keyed.",
				"Go to the next frame and pose the hips again: the feet are still pinned. <b>P</b> on a pinned bone unpins it; <b>Unpin all</b> clears the clip.",
				"Pins only help you pose: they save as ordinary keys, so exports don't change.",
			],
		},
		{
			id: "2026-11-10",
			date: "10 Nov 2026",
			title: "Lights, and a better animation workflow",
			sections: [
				["Lights", [
					"<b>Point and area lights</b> are now real objects. Put the 3D cursor where you want one, then <b>Add ▸ Point light / Area light</b>.",
					"Click a light to select it. <b>G</b> moves it (<b>Z</b> = height), <b>S</b> sets a point light's reach or resizes an area light, <b>X</b> deletes. Colour, intensity, priority and shadows are in Properties.",
					"The <b>Lit</b> view adds up every light (with shadows). Lights are saved with the project, undoable, and exported in the bundle as an optional <code>lights</code> list.",
					"The Lit view's old light list and drag-to-move are gone. While a project has no lights you still get the quick preview light.",
				]],
				["Animation", [
					"<b>IK posing</b>: drag a hand or foot and the arm or leg bends to follow. Details below.",
					"A click only selects. Turning by the tip no longer jumps. <b>Ctrl</b> snaps turns to 15° (<b>Ctrl+Shift</b> 5°) and moves to whole pixels.",
					"<b>Shift+I</b> keys the whole pose. <b>Ctrl+C / Ctrl+V</b> copy and paste a pose, <b>Ctrl+Shift+V</b> pastes it mirrored.",
					"Dopesheet: <b>Ctrl+wheel</b> zooms, <b>+ Frame / − Frame</b> insert or remove a frame, <b>Ctrl+A</b> picks all keys, double-click a key to jump to it, right-click a key for its menu, drag the playhead.",
					"A <b>Bones</b> toggle hides the bone overlay while posing.",
				]],
			],
			ik: [
				"Animate panel, under Bones: tick <b>IK</b>.",
				"Select the <b>end bone</b> of the limb (the forearm or shin, whose tip is the hand or foot).",
				"Set its <b>IK chain</b> to <b>2</b> for an arm or leg (3 adds the body above it, 0 is off). Bones need to be connected to their parents.",
				"On a frame, <b>drag that bone's tip</b>, or select it and press <b>G</b>. The chain bends to reach it and every bone in the chain is keyed.",
				"<b>X / Y / Z</b> while dragging picks another plane. Space plays it. IK saves as ordinary rotation keys, so exports don't change.",
			],
		},
	];

	const $ = (id) => document.getElementById(id), KEY = "tsSeenNews", latest = NEWS[0];
	const list = (items) => `<ul>${items.map((t) => `<li>${t}</li>`).join("")}</ul>`;
	$("wn_body").innerHTML = NEWS.map((n, i) => `<section${i ? ' class="old"' : ""}>
		<h3>${n.title} <span class="dim">${n.date}</span></h3>
		${n.sections.map(([h, items]) => `<h4>${h}</h4>${list(items)}`).join("")}
		${n.ik ? `<h4>${n.stepsTitle || "How to use IK"}</h4><ol>${n.ik.map((t) => `<li>${t}</li>`).join("")}</ol>` : ""}
	</section>`).join("");

	const modal = $("whatsnew");
	function show(on) {
		modal.classList.toggle("open", on);
		if (on) { TS.store.set(KEY, latest.id); $("wn_card").focus(); } else document.activeElement && document.activeElement.blur && document.activeElement.blur();
	}
	$("b_news").onclick = () => show(!modal.classList.contains("open"));
	$("wn_close").onclick = () => show(false);
	modal.onclick = (e) => { if (e.target === modal) show(false); };
	modal.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") { show(false); e.preventDefault(); } });

	// Open once per release, unless something else (such as the restore-autosave question) is already open.
	if (TS.store.get(KEY) !== latest.id) setTimeout(() => { if (!document.querySelector(".modal.open")) show(true); }, 600);
})();
