# Animation mode and the Aseprite link

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
   keys blend linearly; before the first key a bone eases in from rest at frame 0; after the last key it holds.
   **Shortcut:** in animation mode, moving (G) or turning (R) a model in the view keys it on the current frame. A model with no bone
   gets one (named after it, visible in the Bones list, with the model bound to it), so you never have to rig simple movement by hand.
   The model's resting position stays put; the move lives in the key. Pick another frame and move it again. Scaling is not animated
   (bones move and turn models), so S still changes the model itself.
   **Gizmos** (the Gizmos checkbox under Bones): the selected bone shows a coloured ring per axis (X red, Y green, Z blue; drag to turn
   about it) and an arrow per axis (drag to slide the bone along it), only for the axes the current view can work with. **Names** label
   every bone, add the selected bone's turn, and draw a dashed line from a parent's tip to a child that is not connected.
   If a model was edited, moved or resized outside animation mode so that it no longer sits on its bones, the panel says so (nothing can
   bend a model that is far from every bone): use *Edit rest pose* to move the bones back to it. Duplicating a model keeps its bone.
4. **Clips.** Any number of clips, each with its own frame count (1–64) and fps. ▶ (or Space) plays it in the view; posing a bone
   stops playback first. On the timeline ◆ marks the selected bone's keys, or (dimmer) any bone's keys when none is selected; Up / Down
   jump between keys. Lowering the frame count keeps the keys past the end (the timeline says so) and raising it brings them back.

The panel previews the current frame lit by the normal map (move the pointer over it to move the light), with your Albedo if linked, else the tileset's own art.

## The spritesheet

Every frame is rendered through the normal Process pipeline into one **normal-map sheet**: cells the size of the tileset, in a grid of
power-of-two columns and rows (8 frames of 128x128 = 4x2 cells = 512x256). Empty pixels are transparent. The frame on screen renders
first and the rest follow a few at a time (the panel counts down), so a long clip never freezes the page; Aseprite gets the sheet once
it is whole, and *Download normal sheet* finishes it on the spot. A power-of-two tileset always
gives a power-of-two sheet. Rigging is saved in the `.studio.json` project (`anim`), including the last Albedo sheet received.

## Frames in Aseprite

The Aseprite sprite is **one tile big** (the size of your tileset) and every animation frame is a **real frame on Aseprite's timeline**.

- **Studio to Aseprite.** Studio's normal map appears on each frame in the locked layer **Normal (Studio)**. Change the frame count in Studio and
  Aseprite adds or removes frames at the end (one undo step there). The frame length follows the clip's fps.
- **Aseprite to Studio.** Paint each frame inside the group **Albedo**. The extension lays every frame out in Studio's sheet grid and sends it.
- **Adding and deleting frames in Aseprite** changes the clip in Studio: a **deleted** frame takes its key with it and later keys move up one;
  an **inserted** (or duplicated) frame pushes later keys down. Studio works out which frame it was by comparing frame contents, so a frame that is
  an exact copy of its neighbour is matched to the later one. Reordering frames by dragging is not tracked.
- **Not in animation mode?** Only frame 1 is linked and your timeline is left alone.

## Aseprite link (live)

Both programs watch one folder. This works from a GitHub Pages / https page; the folder picker needs Chrome or Edge.

| Direction | File | Content |
|---|---|---|
| Studio → Aseprite | `normal.png`, `studio_link.json` | the normal sheet; the json (written last) has `rev` and the sheet size |
| Aseprite → Studio | `albedo.png` | the flattened group named **Albedo**, saved on every edit |

**Setup**
1. Install `tools/aseprite/TilesetStudioLink.aseprite-extension` (double-click it, or Edit ▸ Preferences ▸ Extensions ▸ Add Extension). Needs Aseprite 1.3+.
2. In Studio: *Animate ▸ Link Aseprite folder…* and pick an empty folder. Studio writes `normal.png` and `studio_link.json` into it.
3. In Aseprite, create a sprite **one tile** big (the tileset's size, RGB), then *File ▸ Scripts ▸ Tileset Studio Link…* and
   pick any file in that folder. A layer **Normal (Studio)** appears (locked, kept up to date as you change the rig).
4. Make a group called **Albedo** and draw in it. Each edit is flattened and sent; Studio shows it in the preview.

**Canvas rule.** The Aseprite canvas must be exactly one tile (Studio's tileset size), and the sheet it builds must be a power of two
(16, 32, 64, 128 ... per cell; 2^n columns and rows). If it is not, Studio shows a red warning and **keeps the previous page**; the extension
warns too. Fix the canvas and the next edit goes through.

### Online link (any browser, including Firefox / Zen)

The folder picker is Chromium-only, so there is a second transport that needs no folder access. Studio (in the browser) and the
extension (in Aseprite) both **dial out** to a tiny relay (`tools/relay`, a Cloudflare Worker) and share a random room code. The relay
only forwards the two PNGs and keeps the latest in memory; it stores nothing.

1. **Requirements:** Aseprite **1.3 or newer** (the extension uses its Lua `WebSocket` API) and the extension
   [`TilesetStudioLink.aseprite-extension`](../tools/aseprite/TilesetStudioLink.aseprite-extension) (double-click to install, or
   Edit ▸ Preferences ▸ Extensions ▸ Add Extension). The same download link is in Studio's *Aseprite ▾* menu.
2. In Studio: *Aseprite ▾ ▸ Link online (any browser)* and copy the room code.
3. In Aseprite: *File ▸ Scripts ▸ Tileset Studio Link (online)…*, paste the room code, *Link*. The rest is as above (layer
   **Normal (Studio)**, group **Albedo**).

The room code is the only secret: anyone with it can read and send pictures in that room, so treat it like a password. It is kept
in the browser between visits; **New code** (next to Copy) swaps it for a fresh random one at once, cutting off the old code, and you
paste the new one into Aseprite. Deploying your
own relay: `cd tools/relay && npx wrangler login && npx wrangler deploy`, then put its address in `L.RELAY` (js/aseprite.js) and `RELAY`
(the extension's plugin.lua).

The non-animated tileset uses the same link: the *Aseprite ▾* menu in the top bar sends the tileset's normal map and can take
Aseprite's `albedo.png` back as the tileset art.

**No link at all:** use *Download normal sheet* and *Load albedo sheet…* (same size checks).

Not covered yet: the extension can't be tested headless, so it follows the documented Aseprite 1.3 API; report any API differences.
glTF export carries each deforming model's skin weights (automatic or painted, up to four bones per vertex). The Albedo preview is the whole
sheet cell, not re-skinned onto the pose.
