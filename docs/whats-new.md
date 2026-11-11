# What's new

For anyone coming back to Tileset Studio. This covers the most recent updates: **Pins and IK that just works**, **Lights** and the **Animation workflow**. Nothing here changes your saved projects or exports unless noted, and old projects open as before.

## Update log

### 12 Nov 2026: Pins, IK that works out of the box, faster GPU lighting
- **Pins:** select a foot (or hand) and press **P** to plant it. Then move or turn the hips and the body: the leg bends so the foot stays put, on this frame and every frame you pose next. **P** again unpins. See Tutorial 3.
- **IK works without setup:** dragging the ball at a shin's or forearm's tip now bends the whole leg or arm by default (**IK chain: Auto**). Rigs imported from Blender work as they are, because a bone whose head sits on its parent's tip counts as a joint (no need to tick Connected).
- The **IK** checkbox is now called **IK limbs** and says what it does. The IK chain field is a menu: Auto, 1 (this bone only), 2, 3, 4.
- New lesson in **Learn ▸ Animation: IK limbs and pins**.
- **Lit view, GPU renderer:** lights every light in the scene, not just one (area lights included), and stays in step with the Current renderer. Each light's shadows are cached, so dragging one light or changing a colour is quick, and with GPU selected the lighting follows a light live while you drag it in the 3D view.

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

## Tutorial 3: IK limbs and pins

IK (inverse kinematics) means you place the end of a limb and the bones above it work out how to bend. **Pins** keep part of the body in place (a foot on the ground, a hand on a table) while you pose the rest. Both are posing aids: they save as ordinary rotation keys, so **exports don't change**. There's an animated version in **Learn ▸ Animation ▸ IK limbs and pins**.

**What counts as a joint**
A bone is jointed to its parent when its head sits on the parent's tip. Rigs imported from Blender are already like this, so there is nothing to set up. (Ticking **Connected** also makes a joint, and additionally stops the bone from sliding off its parent.) IK and pins bend through joints and stop at the first bone that isn't jointed, such as a thigh that starts beside the spine rather than at its tip.

**Drag a limb (IK limbs)**
1. Under **Bones**, keep **IK limbs** ticked (it is on by default).
2. Go to the frame you want to pose.
3. **Drag the ball at the shin's tip** (the ankle) or the forearm's tip (the wrist). The thigh and shin (or upper arm and forearm) bend to reach it. Or select the shin and press **G**.
4. Every bone that bent gets a key on this frame.

The **IK chain** menu in a bone's panel sets how many bones bend when you drag its tip: **Auto** (2 for a jointed bone: an arm or a leg; 1 otherwise), **1** (this bone only), **3** (also the body above it), and so on. Untick **IK limbs** and dragging a tip turns only that one bone.

**Plant a foot (pins)**
1. Select the **foot** and press **P** (or **📌 Pin** under Bones). A red pin marks the spot, and the bone's name in the view gets a 📌.
2. Pin the other foot too if both should stay down.
3. Select the **hips** (the root bone) and move them with **G** or turn them with **R**. The legs bend so the feet stay exactly where they were, angle and all. Every bone the pins bend is keyed.
4. Go to the next frame and pose the hips again: the feet are still pinned there.
5. Select a pinned bone and press **P** again to unpin it. **Unpin all** under Bones removes every pin in the clip, and the poses they made stay keyed.

What a pin holds:
- **A hand or foot** (the short bone at the end of an arm or leg) stays whole: its position *and* its angle. The two bones above it bend.
- **Any other bone** (a shin, a forearm, a tail tip) holds its **tip**. Its IK chain bends to keep it there, and a hand or foot hanging off it keeps its angle.
- If the limb can't reach (the hips went too far), it stretches toward the pin and a dashed red line shows the gap.
- Dragging a pinned bone itself moves the pin to where you leave it.

**Good to know**
- The bend **keeps its direction**, so a knee won't flip backwards halfway through a drag.
- IK and pins work in the **view's plane** first. Press **X / Y / Z** while dragging to pick a different plane.
- Pins are saved with the clip, so they are still there when you reopen the project. They are never exported.
- Fine-tune any single bone afterwards by turning it with its gizmo ring. That just changes its key.

**Quick example: a crouch with planted feet**
1. Frame 1: select `foot.L`, press **P**. Select `foot.R`, press **P**.
2. Frame 4: select the hips, press **G**, move them down and a little forward, click. Both knees bend and the feet stay put.
3. Frame 8: **Close loop** (or pose the hips back up).
4. Press **Space**: the character crouches without its feet sliding.

For the full reference, see `docs/animation.md`. The in-app **Learn** window (top bar, or **L**) has animated lessons for the Animation and Aseprite link sections too.
