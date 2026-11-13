# Animation

Make your models move. You don't need Aseprite or any setup to start. Press **L** and pick the **Animation** tab for short visual lessons.

## Your first animation

1. Press **Animate** in the top bar. The timeline opens under the view.
2. Click frame 6 on the timeline, select a model, press **G** and move it (**R** turns it instead).
3. Press **Space** to play. Studio works out the frames in between.

## The words

- **Frame:** one picture of the animation.
- **Clip:** one row of frames, such as a walk or a door opening.
- **Key (◆):** a frame whose pose you chose yourself. Frames between keys are blended for you.
- **Bone:** a handle inside a model. You only need bones for things that bend.
- **Normal map:** a picture of which way each part of the shape faces, so the game's light can shade it. Studio makes one for every frame.
- **Albedo:** the plain colours of each frame, without lighting. You paint these.
- **Sheet:** one big picture holding all the frames in a grid.

## Getting the frames into your game

Studio moves the shape, but the colours of each frame are painted by you. Either use the live [Aseprite link](aseprite-link.md), or press *Download reference sheet* (the models in their base colours, the picture Aseprite gets), paint over it in any program and press *Load albedo sheet…* with a picture of the same size. Then, in the panel's *Clip* section, select the models and press *Use selected models*, and export with *Export ▾ → Godot bundle*. The *Export ▾* menu lists every animated clip with an *Export* tick, what it sends to the game and any warnings.

## Reference

**Animate** (top bar) opens the *Rig & animation* panel and a timeline. Model over your drawing as usual, then:

1. **Bones.** `＋ Bone` adds a bone at the 3D cursor (24 px tall); with a bone selected the new one starts at its tip and is its child.
   `Bone per model` makes one bone per selected model (bottom to top) and binds it. Head, tip, name and parent are editable.
2. **Bind.** Select models, select a bone, `Bind selected models`. A bound model bends with the bones of its own skeleton (the bones
   that share its bone's top parent), weighted by distance; `Stiffness` sets how sharply, and `Rigid` makes it follow its bone as one
   solid piece. A bone alone in its skeleton (as `Bone per model` and G / R make them) always moves its model rigidly, so separate
   models never tug at each other. Unbound models stand still.
   **Weight paint.** The automatic weights are a starting point: select a bone and press `Weight paint` (Weights section) to fix a joint
   by hand. The models turn into a heat map of that bone's weight (red = fully on it, blue = not at all). Drag in the view: `Mix`
   paints toward the chosen Weight, `Add` / `Subtract` give or take weight (Ctrl flips them), `Smooth` blends with neighbouring
   vertices. Strength, Radius (`[` / `]`) and "Paint through the model" are beside it; pick another bone in the list to paint that one.
   Every painted vertex always adds up to 100% across the bones, and posing the bones while you paint shows the bend. A stroke is one
   undo step; `Reset to auto` clears the painting. Painting belongs to a vertex, so a model whose vertex count changes loses it.
3. **Pose.** Pick a frame on the timeline (`,` and `.` step). Change a bone's Turn X/Y/Z or Move values and that frame gets a key
   (◆). Or drag a bone's tip in the view: it turns the bone about the depth axis (Y), which is the side-view swing. Frames between
   keys blend, and a turn always takes the short way round, so a full spin needs keys along the way (each under 180 degrees apart).
   Before the first key a bone eases in from rest at frame 0; after the last key it holds.
   **Shortcut:** in animation mode, moving (G) or turning (R) a model in the view keys it on the current frame. A model with no bone
   gets one (named after it, visible in the Bones list, with the model bound to it), so you never have to rig simple movement by hand.
   The model's resting position stays put; the move lives in the key. Pick another frame and move it again. Scaling is not animated
   (bones move and turn models), so S still changes the model itself.
   **Picking and turning:** a click on a bone only selects it. A drag starts once the pointer moves a few pixels, so selecting never keys.
   Turning by the tip or by a connected bone's body turns by the angle you swing from where you grabbed, so the bone doesn't jump to the
   pointer. Hold Ctrl while turning to snap to 15 degree steps (Ctrl+Shift: 5 degrees), or while moving to snap to whole pixels; the
   status line shows the turn angle. Short bones have a wider grab area.
   **Keys:** **I** keys the selected bones, **Shift+I** keys the whole pose (every bone that has keys in the clip, or all bones) and
   **Alt+I** removes the key. With no keys picked in the dopesheet, **Ctrl+C** copies this frame's pose (the selected bones, or all) and
   **Ctrl+V** pastes it as keys on the current frame; **Ctrl+Shift+V** pastes it mirrored onto the other side's bones.
   **Gizmos** (the Gizmos checkbox under Bones): the selected bone shows a coloured ring per axis (X red, Y green, Z blue; drag to turn
   about it) and an arrow per axis (drag to slide the bone along it), only for the axes the current view can work with. Dragging a
   bone's body slides it across the view plane (in the tileset view that is X and height Z; the depth axis Y stays put), so to move a
   bone in depth drag its green Y arrow, or press G (move) and then Y: the bone follows the pointer along Y as it is drawn on screen.
   X / Y / Z pressed during any bone drag narrows it to that axis (again: off). **Names** label
   every bone, add the selected bone's turn, and draw a dashed line from a parent's tip to a child that is not connected.
   If a model was edited, moved or resized outside animation mode so that it no longer sits on its bones, the panel says so (nothing can
   bend a model that is far from every bone): use *Edit rest pose* to move the bones back to it. Duplicating a model keeps its bone.
   **IK limbs.** A bone is *jointed* to its parent when it is Connected or its head sits on the parent's tip (rigs imported from
   Blender come in like that). With **IK limbs** ticked (next to Gizmos and Names, on by default), dragging a jointed bone's tip, or
   pressing **G** on it, moves the tip to the pointer and turns the bones up the chain to reach it. The bone's `IK chain` menu sets the
   chain: Auto (2 for a jointed bone, an arm or leg; 1 otherwise), 1 to 4. The chain stops at a bone that isn't jointed, and the bend
   keeps its direction (a knee doesn't flip). It works in the view's plane; **X** / **Y** / **Z** picks another plane. The result is
   ordinary rotation keys on every bone in the chain on this frame, so export is unchanged. Names label bones with a set chain `IK n`.
   **Pins.** **P** (or 📌 Pin under Bones) pins the selected bones where they are on this frame; P again unpins, Unpin all clears the
   clip's pins. After every pose edit (drag, G / R, the Pose fields) each pin is re-solved by IK on the frame on show and the bones it
   bends are keyed, so a planted foot stays put while you move the hips, on any frame. A hand or foot (the short end bone of a jointed
   limb) is held whole, position and angle; any other bone holds its tip, and a hand or foot hanging off it keeps its angle. Dragging a
   pinned bone moves its pin. Pins are saved in the clip (`clip.pins`) and never exported.
4. **Clips.** Any number of clips, each with its own frame count (1–64), fps, Loop setting and Albedo sheet. ▶ (or Space) plays it in the
   view the way the game will (loop, once or ping-pong); posing a bone stops playback first. Lowering the frame count keeps the keys past
   the end (the timeline says so) and raising it brings them back.
5. **The dopesheet** (under the view) has a ruler, a row of every keyed frame, and one row per bone.
   - `+ Frame` / `− Frame` insert or remove a frame at the playhead, moving later keys along (a clip holds up to 64 frames).
   - **Zoom:** Ctrl+wheel over the timeline, or the `−` / `+` buttons. The zoom is remembered.
   - Drag the ruler or the playhead line to scrub. Click a row to go to that frame and select its bone; click a bone's name to select it (Shift adds).
   - Click a key to pick it (Shift adds; a key in the All bones row picks every key on that frame), or drag across a row to box-select.
   - Drag picked keys to move them, Alt-drag to copy. Delete or X removes them, Ctrl+A picks every key, Esc drops the picks. Up / Down jump between keys. Double-click a key to go to its
     frame and select its bone. Right-click a key for **Ease**, **Copy**, **Paste at playhead** and **Delete**.
   - **Ctrl+C** copies the picked keys (with no keys picked, it copies this frame's pose, see step 3), and **Ctrl+V** pastes whichever
     was copied last at the playhead.
   - **Ease** sets how the picked keys (or the selected bones' keys on this frame) leave for the next key: Linear, Ease in, Ease out, Ease in-out or Hold (keeps the pose until the next key). Eased keys show round, Hold square.
   - **Onion** shows the models on the frames before (red) and after (green) as see-through solid ghosts while stopped,
     behind the model you are posing (they show only where they reach past it). The numbers
     either side of it set how many frames back and forward (0 to 8 each); further ghosts are fainter.
   - **Close loop** keys the first frame's pose on the last frame. **Mirror pose** flips this frame's pose across X onto the other side's bones (`arm.L` and `arm.R`, `Leg_l` and `Leg_r`, `LeftArm` and `RightArm`); a bone with no other side flips itself.

The panel previews the current frame lit by the normal map (move the pointer over it to move the light), with your Albedo if linked, else the tileset's own art.

## The spritesheet

Every frame is rendered through the normal Process pipeline into one **normal-map sheet**: cells the size of the tileset, in a grid of
power-of-two columns and rows (8 frames of 128x128 = 4x2 cells = 512x256). Empty pixels are transparent. The frame on screen renders
first and the rest follow a few at a time (the panel counts down), so a long clip never freezes the page. Frames are kept by pose: an edit
only redoes the frames it changes, and frames with the same pose share a picture. Aseprite gets the sheet once
it is whole, and *Download reference sheet* finishes it on the spot. A power-of-two tileset always
gives a power-of-two sheet. Rigging is saved in the `.studio.json` project (`anim`), including the last Albedo sheet received.

glTF export carries each deforming model's skin weights (automatic or painted, up to four bones per vertex) and its whole skeleton; a skinned model imported from glTF stays one model and keeps its weights as painted ones. The Albedo preview is the whole
sheet cell, not re-skinned onto the pose.
