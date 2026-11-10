# What's new

For anyone coming back to Tileset Studio. This covers the two most recent updates: **Lights** and **Animation workflow (with IK)**. Nothing here changes your saved projects or exports unless noted, and old projects open as before.

## Update log

### 10 Nov 2026: Lights are real objects now
- **Point and area lights** you place and edit in the 3D viewport, the same way you edit models.
- Each light has a colour, intensity, reach, priority and a "Casts shadows" switch.
- The **Lit** view sums every light in the project (area lights are soft, and each light does its own shadow test).
- Lights are **saved in the project** (.studio.json), are **undoable**, and are **exported** in the bundle as an optional top-level `lights` array (format in `docs/export-schema.md`).
- The Lit view's old light list and drag-to-move are gone. Lights now live in the 3D view. Lit still shows them as read-only markers. While a project has no lights you still get the quick preview light you drag around.

### 10 Nov 2026: Animation workflow and IK
- **IK posing:** drag a hand or foot and the arm or leg bends to follow.
- **Steadier posing:** clicking only selects, tip turns no longer jump to the pointer, Ctrl snaps turns and moves.
- **Pose shortcuts:** key the whole pose in one press, copy and paste poses, paste them mirrored.
- **Dopesheet upgrades:** zoom, insert and remove frames, select all keys, double-click a key to jump to it, right-click key menu, draggable playhead.
- Earlier the same week: a **Bones** toggle to hide the bone overlay while posing, animation picking and preview in the Import dialog, glTF animation import fixes, and a more reliable Aseprite link (local folder first in Chromium, one-click relink).

---

## Tutorial 1: Add and edit a light

1. Lights are added at the **3D cursor**, so put the cursor where you want the light first. (If the cursor is on the floor, the light starts at a default height of 36 px. Change it later.)
2. **Add > Point light** (or **Area light**), or press **Shift+A**. It appears at the cursor.
3. **Click the light's marker** to select it. This deselects any model, and the **Properties** panel shows the light's fields.
4. Move and resize it like a model:
   - **G** moves it. Press **X / Y / Z** to lock an axis. **Z is height.**
   - **S** sets a point light's **reach**, or resizes an area light.
   - **X** deletes it, **Esc** deselects. Ctrl+Z undoes any of this.
5. In Properties, set:
   - **Colour** and **Intensity** (1 is the Studio default).
   - **Reach** (radius in px). Light falls off to zero at that distance.
   - **Width / Depth** (area lights only): the size of the lit rectangle.
   - **Priority**: higher wins when the game can't show every lamp.
   - **Casts shadows**: on by default.
6. Switch to the **Lit** view to see the result. Lights show as markers there, and you edit them back in the 3D view.

Tip: for a lamp over a table, put the light a little above the table top, not at floor level. Otherwise the table shades it from itself.

## Tutorial 2: Animation workflow

1. Open the **Animate** panel and make or pick a **clip** (1 to 64 frames, with fps and a Loop setting).
2. Move a model with **G** or **R** on a frame and it gets a bone of its own. Or add bones yourself and bind models to them.
3. Pick a frame on the dopesheet, pose, and **key** it:
   - **I** keys the selected bones. **Shift+I** keys the **whole pose**. **Alt+I** removes a key.
4. Reuse poses:
   - With no keys picked, **Ctrl+C** copies this frame's pose and **Ctrl+V** pastes it as keys on the current frame.
   - **Ctrl+Shift+V** pastes it **mirrored** onto the other side's bones (`arm.L` and `arm.R`, and so on). That is how you get a walk's second half.
   - **Close loop** keys the first pose on the last frame.
5. Tidy the timing on the dopesheet:
   - **Ctrl+wheel** or **− / +** zooms.
   - **+ Frame / − Frame** inserts or removes a frame at the playhead and shifts later keys.
   - **Ctrl+A** picks every key. **Double-click** a key to jump to it. **Right-click** a key for Ease, Copy, Paste at playhead and Delete.
   - Drag the playhead line to scrub.
6. Press **Space** to preview. Use **Onion** to see the previous (red) and next (green) frames.
7. Turn **Bones** off to see the model without the bone overlay.

Posing feels different now:
- A **click only selects**. A drag starts after about 3 px, so selecting never adds a key by accident.
- Turning by the tip turns by the angle you swing from where you grabbed, so it doesn't jump.
- Hold **Ctrl** to snap turns to 15 degrees (**Ctrl+Shift**: 5 degrees), or to snap moves to whole pixels.

## Tutorial 3: Using IK

IK (inverse kinematics) means you place the end of a limb and the bones above it work out how to bend. It is optional and saves as ordinary rotation keys, so **exports don't change**.

**Set up once per limb**
1. In the Animate panel, under Bones, tick **IK** (next to Gizmos and Names).
2. Select the **end bone** of the limb. That is the forearm or the shin, the one whose tip is the hand or foot.
3. In its panel, set **IK chain** to **2** for an arm or leg. **3** also takes in the body above it. **0** turns IK off for that bone.
4. The bone's label in the view now reads `IK 2`.

Your bones need to be **connected** (each bone starts where its parent ends). The chain stops at a bone that isn't connected to its parent.

**Pose with it**
1. Go to the frame you want to pose.
2. **Drag the tip** of the end bone (the hand or foot) to where you want it. The chain bends to reach it. Or select the bone and press **G**.
3. Every bone in the chain gets a rotation key on this frame. Do the next frame the same way.
4. Press **Space** to check the motion.

**Good to know**
- The bend **keeps its direction**, so a knee won't flip backwards halfway through a drag.
- IK works in the **view's plane**. Press **X / Y / Z** while dragging to pick a different plane.
- With **IK unticked**, dragging a tip turns only that one bone (the old behaviour).
- If the target is out of reach, the limb stretches out straight toward it as far as it goes.
- IK is a posing aid. Fine-tune any single bone afterwards by turning it with its gizmo ring. That just changes its key.

**Quick example: a foot step**
1. Bones: `thigh`, `shin`, with the shin connected to the thigh. Set the shin's **IK chain** to 2.
2. Frame 1: drag the foot forward and down. Press **Shift+I**.
3. Frame 4: drag the foot back and up. Press **Shift+I**.
4. **Close loop**, press **Space**, and the leg steps.

For the full reference, see `docs/animation.md`. The in-app **Learn** window (top bar, or **L**) has animated lessons for the Animation and Aseprite link sections too.
