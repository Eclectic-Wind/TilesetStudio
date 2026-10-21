# Animation mode and the Aseprite link

**Animate** (top bar) opens the *Rig & animation* panel and a timeline. Model over your drawing as usual, then:

1. **Bones.** `＋ Bone` adds a bone at the 3D cursor (24 px tall); with a bone selected the new one starts at its tip and is its child.
   `Bone per model` makes one bone per selected model (bottom to top) and binds it. Head, tip, name and parent are editable.
2. **Bind.** Select models, select a bone, `Bind selected models`. A bound model follows its bone rigidly; unbound models stand still.
3. **Pose.** Pick a frame on the timeline (`,` and `.` step). Change a bone's Turn X/Y/Z or Move values and that frame gets a key
   (◆). Or drag a bone's tip in the view: it turns the bone about the depth axis (Y), which is the side-view swing. Frames between
   keys blend linearly; before the first key a bone eases in from rest at frame 0; after the last key it holds.
4. **Clips.** Any number of clips, each with its own frame count (1–64) and fps. ▶ plays it in the view.

The panel previews the current frame lit by the normal map (move the pointer over it to move the light), with your Albedo if linked.

## The spritesheet

Every frame is rendered through the normal Process pipeline into one **normal-map sheet**: cells the size of the tileset, in a grid of
power-of-two columns and rows (8 frames of 128x128 = 4x2 cells = 512x256). Empty pixels are transparent. A power-of-two tileset always
gives a power-of-two sheet. Rigging is saved in the `.studio.json` project (`anim`), including the last Albedo sheet received.

## Aseprite link (live)

Both programs watch one folder. This works from a GitHub Pages / https page; the folder picker needs Chrome or Edge.

| Direction | File | Content |
|---|---|---|
| Studio → Aseprite | `normal.png`, `studio_link.json` | the normal sheet; the json (written last) has `rev` and the sheet size |
| Aseprite → Studio | `albedo.png` | the flattened group named **Albedo**, saved on every edit |

**Setup**
1. Install `tools/aseprite/TilesetStudioLink.aseprite-extension` (double-click it, or Edit ▸ Preferences ▸ Extensions ▸ Add Extension). Needs Aseprite 1.3+.
2. In Studio: *Animate ▸ Link Aseprite folder…* and pick an empty folder. Studio writes `normal.png` and `studio_link.json` into it.
3. In Aseprite, create a sprite the size of the sheet shown in Studio (e.g. 512x256, RGB), then *File ▸ Scripts ▸ Tileset Studio Link…* and
   pick any file in that folder. A layer **Normal (Studio)** appears (locked, kept up to date as you change the rig).
4. Make a group called **Albedo** and draw in it. Each edit is flattened and sent; Studio shows it in the preview.

**Canvas rule.** Only power-of-two canvases (16, 32, 64, 128 ...) are accepted, and the canvas must match Studio's sheet. If the Aseprite
canvas changes, Studio shows a red warning and **keeps the previous page**; the extension warns too. Fix the canvas (or change the clip's
frame count in Studio) and the next edit goes through.

**Other browsers:** use *Download normal sheet* and *Load albedo sheet…* (same size checks).

Not covered yet: the extension can't be tested headless, so it follows the documented Aseprite 1.3 API; report any API differences.
Bones rotate models rigidly (no smooth skinning), and the Albedo preview is the whole sheet cell, not re-skinned onto the pose.
