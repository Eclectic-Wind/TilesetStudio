# Tileset Studio

A standalone web app for giving hand-drawn tilesets the surface data the lighting engine needs. An artist lays simple 3D models
over the drawing, in the tileset's own projection, and the studio renders height, normal and roughness/metallic maps from them.

**Upload tileset → model over the art → Process → check → Export.**

## The interface

The top bar holds **File** (open tileset / project, save, Import 3D / stamp), **Add**, and on the right **Export** (with **Process** beside it when "auto" is off), then **Learn** and **?**. View settings (snap, art/solid, opacity, X-ray, grid) sit on a bar above the model view. The left panel is four collapsible sections (Models, Properties, References, Processing settings; open/closed is remembered). With no tileset open a start screen offers Open tileset / Open project / the sample / the quick lesson, and dropping a file anywhere shows what it will open. Hover any button for its name, shortcut and explanation. `js/ui.js` holds the menus, tooltips and start screen.
No install, no build, no internet: open `index.html` in a desktop browser (Chrome/Edge/Firefox with WebGL2), or serve the
project with `serve.ps1` (`http://127.0.0.1:8765/tools/tileset_studio/`), which also lets you open files by URL:
`?tileset=/art/x.png` or `?project=/tools/tileset_studio/samples/ward_bedroom2.studio.json`. The whole tool is this folder;
copy it anywhere to hand it out.

Try the sample: open `samples/ward_bedroom2.studio.json` (Open project), a 128x128 crop of the Ward's Bedroom 2 with the bed,
wheelchair, bucket and cart modelled.

## The view

The model view shows the tileset exactly as drawn, with the tile grid (32 px). The three axes have names and colours
everywhere in the app:

- **X across** (red): east-west.
- **Y depth** (green): north-south *on the ground*; bigger = further south, nearer you.
- **Z height** (blue): up from the floor.

The tileset's projection draws a point `(X, Y, Z)` at canvas `(X, Y − Z)`. So depth and height both run up and down the
screen, in opposite directions: going 10 px deeper moves a point down 10 px, rising 10 px moves it up 10 px. Nothing is
foreshortened, so a top 16 px deep is drawn 16 px tall, and a front 20 px high is drawn 20 px tall. The axis key at the bottom
right of the view shows the three directions as the current view draws them; in the 3D view depth and height come apart.

Model what the art shows: a front stands on the line where it meets the floor; a top sits at its height and is drawn that many
px above the floor it covers. The models show the art projected onto them ("art on models"), so a model that lines up with the
drawing looks like the drawing.

**Look round:** hold Alt (or the middle button) and drag, or drag with the eye tool. The view swings into perspective (east
stays on the right; dragging right turns the model the way you drag, like Blender's turntable) so you can check depth and
stacking, then eases back to the tileset view when you let go.

**Stay in 3D:** press **5** or the **3D** button (nav panel) and the look-round holds, and you can model there: every tool and
key works (G/S/R with axis locks, extrude, inset, bevel, loop cut, fill, bridge, the palette's armed tools). Drag on empty space
orbits, drag a selected piece (or selected elements) to move it over the ground, Ctrl-drag box-selects, Shift-drag / Space-drag
pans the point you orbit round, the wheel zooms, a click selects (Shift-click adds), and F (or .) orbits round the selection.
Moves follow the pointer in 3D: over the level plane through the piece, or along the locked axis. Press 5 or 3D again to go
back; the tileset view comes back centred on where you panned to.

**Picking:** things often stack on one screen spot in this projection (a box's back-bottom edge lies exactly on its front-top
edge), so a click takes the nearest thing under the pointer and **clicking again on the same spot takes the next one behind it**
(Shift-clicks gather a whole stack). In edit mode a white outline shows what a click will take before you click. Without X-ray
only what's in sight counts (clicks and box select skip vertices, edges and faces hidden behind faces, and side faces seen edge-on);
with **X-ray** (Alt+Z) faces turn see-through, everything behind shows and can be picked or box-selected, and in face mode each
face has a dot at its middle to aim at (a dot near the pointer wins over the face under it).

**Navigation:** the wheel zooms in whole-pixel steps (25% ... 3200%), trackpad pinch zooms smoothly, Space-drag / Shift+middle /
two fingers pan, arrow keys pan a tile, . (or F outside edit mode) frames the selection, Home fits the tileset. The panel at the top right has the same as
buttons (hand = pan, magnifier = drag to zoom, eye = look round, 3D = stay in 3D, +/−, 1:1 = nearest whole-pixel zoom, ◎ frame, ⛶ fit).
The small « / » at the top of the palette and the nav panel folds it away so it stops covering the view (remembered per
browser); on narrow windows the side panels also get narrower.

**Pen and touch:** everything works without a keyboard. The palette at the left has every tool. A pen tip clicks and its barrel
button places the cursor; with the select tool, drag a selected piece to move it, or drag empty space to box-select. Tools
started from the palette are "armed": press on the view where to start, drag, and let go to apply. While a tool runs, the bar at
the bottom has axis locks (X across / Y depth / Z height), an exact-value field, "fine" (half the snap step), apply and cancel.

## Modelling

### Import / export 3D (v0.8)

**File ▸ Import 3D / stamp** opens a source browser. Load a Wavefront `.obj` mesh or another `.studio.json` project. This adds models to
your current scene; it does not replace the destination image or existing models. Images can have any rectangular size,
including sheets such as 416 x 256; their pixels are not resized or padded.

- **OBJ:** check **Pixels per OBJ unit** and **File up axis**. The default is 1 pixel per unit, Z up. A model made in metre-sized
  units may need a larger value, such as 32 pixels per unit. Y-up imports convert `(x, y, z)` to Studio `(x, -z, y)`.
- **Studio project:** shows its embedded source artwork and the existing models. Scale and geometry are kept as authored.
- Drag a box that fully contains the parts you want. Click a face to select one part; Shift-click toggles it, and Shift-drag
  adds parts. The checklist also lets you select obscured parts. Wheel zooms; right-drag pans; **Frame selected** zooms in.
- **Add at cursor** places the group at the 3D cursor with its lowest point at the cursor's height. **Add at original position**
  retains the source coordinates. Both add independent editable copies in one undo step. **Use as stamp** starts placement
  over your current image instead.

**Export ▸ 3D models (OBJ)** downloads a Wavefront OBJ of the whole scene or only the selected models. Coordinates are world coordinates,
divided by **Pixels per OBJ unit**. Choose Z up or Y up, and use the matching settings on re-import. For Blender's OBJ
axis settings, see its [OBJ manual](https://docs.blender.org/manual/en/5.0/files/import_export/obj.html).

This is basic **mesh geometry** exchange: object names, polygon faces, points and loose edges. OBJ texture coordinates,
textures/material files, custom normals, rigging and animations are not transferred. Normals are calculated from the mesh.
Use **Save project** to retain the artwork, Studio materials, collision settings, and exact project state.

### Model stamps (v0.8)

Open your destination image, choose **File ▸ Import 3D / stamp**, load the source project or OBJ, select all parts of a prop, and click
**Use as stamp**. The source remains available in the current session through **Choose source / models**.

1. Move over the image to see the translucent mesh preview. Click to pin it; dragging repositions it.
2. Adjust **Size**, **Base height**, or **X/Y** (the upper-left corner of the preview in image pixels). Arrow keys nudge by
   1 px, Shift by 0.5 px; Page Up/Down adjusts the base height. **Move preview** makes it follow the pointer again.
3. Click **Place stamp** or press **Enter**. **Keep stamping** allows repeated copies. Q / Esc exits without adding the preview.

Uniform size scales the whole group together. Base height sets its lowest vertex and shifts depth along with height so
the image alignment stays fixed. The parts keep their relative shapes, heights, materials and collision modes. Stamps are
independent editable models; each placement is one undo step. The preview never enters saved projects, processing or exports.
Stamping adds geometry only; it does not paint source artwork onto the destination, auto-match sprites, or conform to surfaces.
Placed geometry is saved normally; reload the source file to create new stamps after restarting the app.

### Pencil: custom-shaped objects (v0.7)

Click **Pencil** in the header or palette, or press **P**. The options appear in the left panel.

**Draw on object surfaces** is on by default. Start your stroke (or first corner) on a visible face and the new shape sits on
that face's plane, at its actual height and orientation. Tops, upright fronts, slopes and rotated faces work, including faces of
other pencil shapes. The nearest visible face is used; hidden models are ignored. The cyan outline and label show the target.
**Thickness** builds outward from the surface; the orange preview shows the outer face. Thickness 0 makes a surface detail,
lifted just 0.01 px to prevent flicker. The finished shape is a separate, editable object.

The first point locks the plane for the entire outline, so crossing another face does not change its height unexpectedly.
The outline may extend beyond the starting face; it does not wrap around edges or conform to a curved object's changing
surface. On a warped face, the triangle under the first point supplies the plane. Clear the outline (or undo all its corners)
to pick a different face. Starting in empty space, or unchecking surface placement, uses the **Empty space** setting below.

- **Freehand:** press and drag around the object's outline, then release. The outline closes automatically and becomes one object.
- **Click corners:** click each corner; click the green first point, press **Enter**, or click **Finish shape** to close it. **Backspace** / **Undo point** removes the last corner.
- **Empty space / Upright front:** the drawn outline becomes the front face; **Thickness** adds depth behind it. Its lowest point sits at the 3D cursor's height (normally the floor).
- **Empty space / Flat top:** the outline becomes the top face of a slab. **Thickness** sets its height above the cursor's height. The drawn face stays aligned with the art.
- **Thickness 0** creates one face, useful for filling an outline and extruding later in edit mode. It starts with collision disabled.
- **Simplify** removes small freehand wobbles, in image pixels. The default is 1 px; increase it for fewer vertices. Clicked corners are kept, apart from redundant points along a straight edge.
- **Snap outline to grid** is optional; when enabled it uses the header's Snap step. Reduce the step for small shapes.

**Esc / Clear / right-click** clears an unfinished outline. **Q / Done** returns to selection. Space-drag and middle-drag pan;
the wheel zooms. Drawing uses the tileset view; choosing Pencil from 3D returns to that view. Mouse, pen and single-touch drawing
are supported; a second finger cancels the current freehand stroke and starts pan/zoom.

Each finished outline is an ordinary named model: select, move, resize, duplicate, delete, or **Tab** to edit its vertices and faces.
One shape is one undo step. Save project, autosave and exports include it. Shapes with thickness use footprint collision by default;
change that in Properties. Simple concave outlines (such as L and U shapes) are supported. Crossed outlines and holes within an
outline are not supported; the tool leaves an invalid outline visible so you can clear/redraw it, or remove a corner.

### Existing modelling tools

Blender-style, with **strict snapping**: results land on the **Snap** grid (32 px = one tile by default; 16, 8, 4, 2, 1 for detail).
Moves put the piece's corner (or the first vertex) on a grid point; scaling snaps sizes to whole steps and edges onto grid lines
(a model's base stays on the floor; a part smaller than the step, like a 3 px leg, uses the largest power-of-two step that fits it); extruding along an axis puts the face on a grid line; insets, bevels and loop cuts snap to
the step; turns go in 15° steps. Shift (or "fine") halves the step, and typing a number gives that exact amount. The 3D cursor
sits on grid points, and a new primitive fills the tile south-east of it (the red square shows where).

| Key | Does |
|---|---|
| right-click, C (cursor tool) | place the red 3D cursor: on the floor, or on the top of a model, so new pieces **stack** on it |
| Shift+A | add a box, cylinder, wedge, plane, sphere or **point** at the cursor (a point starts you in edit mode, to draw from) |
| click / Shift+click | select / add to the selection; click again on the same spot: the next one behind; A all, Alt+A none |
| G | move: over the ground (across and in depth); then Z = only height, X = only across, Y = only depth |
| S | scale (X / Y / Z for one axis: width / depth / height) |
| R | turn, 15° steps: about Z (upright axis) by default; X / Y tip it over (stand a cylinder on edge for a wheel) |
| X / Y / Z **twice** (while G / S / R run) | **local** axis: in object mode each model's own axes (they turn with it; saved in the project), and each selected model turns / scales about its own middle; in edit mode the selection's own frame (Z = its normal, X = along its first edge). A third press frees the axis. The bar shows "X local" |
| 5 | stay in the 3D view (and model there) / back to the tileset view |
| Tab | edit the active model; 1 / 2 / 3 = vertices / edges / faces |
| E | extrude: faces push out along their normal (a lone sheet, like a filled outline or a plane, keeps a bottom so it becomes a closed solid); edges grow quads; vertices grow new points on lines. Edge / vertex extrusions then move like G; Esc takes them back |
| Alt+E | **extrude manifold** (faces): walls that lie flush with the face beside them fold into it. Push a box's top down and it's just a shorter box (a plain extrude leaves walls doubled inside); pull a face out flush with its neighbours and they grow to meet it. Where nothing is flush it's a plain extrude |
| F (edit mode) | **fill**: two vertices → a line; three or more vertices, or a closed edge loop (a hole's rim, a drawn outline) → a face, wound to match the faces round it (or facing you) |
| Ctrl+E | **bridge**: two faces → both removed and their rims joined by a band (a tunnel through a model, or a neck between two pieces after Ctrl+J); two edge loops or open strips → a band between them. Both need the same number of vertices |
| Ctrl+right-click (edit mode) | new point under the pointer (on a surface, or the floor / the selected point's height), snapped, joined by a line to the selected point: click round an outline, A, F, then E up |
| Ctrl+J | join the selected models into the active one |
| K (edit mode; palette ✂) | **knife**: click points along a cut (white dot = on a vertex, green = on an edge, where it lands on grid lines along the edge in steps up to half its length; else on the face, or off the model so a cut can start outside it), then Enter / Space / right-click (pen: ✓ on the bar) cuts; Backspace drops the last point, clicking the first point closes the loop and cuts, Esc stops. It cuts what's in sight; with X-ray it cuts right through (back and side faces too). A face is only cut where the stroke crosses it from edge to edge; faces beside a cut take its new points (no T-junctions). The new edges come out selected. Works in the 3D view too |
| I | inset the selected faces (drag right): every edge moves in by the same distance, whatever the face's shape |
| Ctrl+B | bevel the selected edges (drag right) |
| Ctrl+R | loop cut: hover an edge to see the ring, click, and the loop slides with the cursor (on grid lines) until you click again (pen: press on the edge, drag, let go) |
| Shift+D, X | duplicate (Esc keeps the copy in place, as in Blender), delete (in edit mode: the selected vertices, edges or faces, and the faces using them) |
| Ctrl+C / Ctrl+V | copy / paste models in place (works across projects and tabs in one browser) |
| Ctrl+I | invert the selection (models, or elements in edit mode) |
| Ctrl+M, then X / Y / Z | mirror the selected models across their middle (palette ⇋: across; Shift-click: depth). Facing turns flip too |
| H / Shift+H / Alt+H | hide the selection / hide everything else / show all (palette ◐; Shift-click shows all). Hidden models still process and export |
| Ctrl+arrows, PageUp / PageDown | nudge the selection one snap step across / in depth, or up / down (Shift: half a step) |
| [ / ] | snap step down / up |
| Alt+Z | X-ray on / off (see Picking) |
| Esc | cancel the tool; also closes help and the Add menu |
| Ctrl+Z / Ctrl+Shift+Z, Ctrl+S | undo / redo (the status says how many steps are left), save project |
| wheel, Space-drag, arrows, . , Home | zoom, pan, pan a tile, frame selection, fit |

Loose lines (from F on two points, Ctrl+right-click, E on points) are drawing aids: picked, moved and bridged like edges, but
they have no surface, so processing, footprints and collision ignore them (and a model made only of lines exports nothing).

**Outliner** (Models list): click selects, Shift/Ctrl+click adds or removes, double-click renames, the dot hides / shows a model
(● shown, ◌ hidden), and the filter box narrows the list by name. The heading counts models, selected and hidden.

The properties panel takes exact numbers (position and size fields also take arithmetic: `32*2`, `48+8`, `(64-4)/2`): a model's bottom-centre position and size, its **collision**,
its smooth-shading angle, its **roughness / metallic**, and its **facing turn**. Select faces in edit mode to give
them their own material (and turn); "Use the object's material" clears that.

**Collision** says how the model blocks the player in the game (the player's box is 24 px wide and 12 px deep above the feet):

- **strip** (the default, as before): only a 4 px strip along the south edge of the model's convex footprint blocks, so you walk
  into its drawn top and are drawn behind it. Only models whose bottom is below 30 px count.
- **footprint** (walk-behind): the floor the model really covers blocks wherever one of its parts reaches between the **step
  height** and the **player body height** (Processing panel, default 4 and 40 px). A shelf hung at 60 px, a lamp shade over the
  head, a rug or paper under the step don't block; a table top at 30 px blocks all the floor under it. The blocked floor is pulled
  in for the feet box (sides 3 px, south edges 8 px north: the feet stop 4 px in front of the base and can stand right at its
  back edge; parts thinner than 12 px keep 4 px from their back edge) and traced to exact polygons (an L-desk stays an L).
  So you walk round the piece, stand behind it and are drawn behind it.
- **none**: never blocks (a pillow, a backrest above a seat).

The outliner marks footprint models "(walk-behind)" and none "(no collision)".

**Facing turn** (degrees, + = from south toward east; ⟲ / ⟳ step 15°) turns the surface's normals about the upright axis without
moving anything: height, outline and collision stay as modelled. Hand-drawn art often doesn't follow the projection for turned
things (a wheel drawn as an upright ellipse, a turned chair whose parts are drawn at different angles): fit the shape to the
drawn silhouette, then turn the facing to where the surface was meant to face. The model view's shading and every export use the turned normals.

## Processing and the output view

**Process** (automatic after every change unless "auto" is off) renders each canvas pixel's surface: the highest point of any
model along that pixel's line of sight. The output view tests the result before you export. Its tabs are **Lit**, **Maps ▾** (Height / Normals / Rough / Metal), **Holes** and **Plan ▾** (Floor / Collision / Kind / Pieces); a ▾ tab opens a short list and shows the view you picked:

- **Lit**: the art lit by a light you drag around (Shift+wheel or slider = its height, "reach" = its radius), shaded with the
  normals, roughness and metallic, with shadows traced through the floor heightfield the same way the engine does.

In every mode the wheel (or − / + by the tabs) zooms in whole-pixel steps around the pointer, middle- / right-drag or Space-drag
pans, and ⛶ fits it again.
- **Height / Normals / Rough / Metal**: the maps as they'll be exported.
- **Holes**: art pixels no model covers. Magenta = left on the floor; orange = filled from a neighbour ("Fill holes up to n px").
  Red = taller than 255 px (clipped).
- **Floor**: the floor plan from above. Colour = top height, dark stripes = open underneath (tops on legs, overhangs), light
  stripes = a gap between stacked parts (shelves). Solid furniture should be solid; stripes where the art shows a solid piece
  mean it floats. The lit view's shadows keep those gaps open: each floor point holds every solid span above it, so light passes
  between a cart's shelves. (The engine's heightfield keeps one span per floor point, so in the game such a gap is still filled.)
- **Collision**: the floor plan with what blocks the player. Dark red = floor a footprint model blocks, bright red outlined in
  yellow = its exported collision polygons, orange = strip models' strips (as the importer will build them), grey = open
  (under or over the body). A **24x12 feet box** follows the pointer: green where the feet can stand, red where they can't, and
  the readout names what blocks it.

- **Kind**: models tinted by their resolved kind (green floor, blue deco, orange solid, magenta wall, cyan side); a small rug or a
  2 px bump shows up as floor. Hover reads a cell's model, kind (set or inferred), height range and collision.
- **Pieces**: how the engine will group the art into "tiles". Models whose footprints come within 2 px are one **piece**; the
  view tints the art by piece (one colour each, legend under the view) and draws the 32 px cells. A cell's **border** is the piece
  the engine reads that cell as; a **diamond** marks a piece's anchor cell (its lowest row in that tile column). **Red hatched** =
  conflict: another piece's art or floor sits in a cell the engine reads as a different piece. **Yellow dashed** = floating: art
  with no anchored cell below it in its column, so the engine treats it as flat art. Hover a cell for who paints it, what the
  engine reads, and why. The legend line counts conflicts, so "No conflicts" is the goal.

The stats line gives covered / hole / filled pixel counts. Aim for no magenta: **next hole ›** centres both views on the next
uncovered spot (switching to Holes). Hover the output to read the pixel under the pointer (height, normal, roughness, metallic,
which model, hole or not; floor top / bottom / spans in the Floor view); **double-click** it to select that model.

One **⚠ Tile problems** line sums up everything the importer would misread; click it to open the Pieces view, hover it for
the full list. It counts the Pieces view's **conflict** and **floating** cells, **column clashes** (`tools/import_studio.gd`
prints the same: two pieces standing on different rows of one 32 px tile column, close enough to overlap there, get measured
as one piece in a single tile layer) and **cells shared by separate pieces** (the bundle's `clashes`; cells shared within one
piece are harmless and not counted). Move one of the pieces to its own columns or onto the same row.

## Saving and safety

**Save project** (Ctrl+S) downloads `<name>.studio.json`, with the tileset embedded. Between saves, every change is autosaved in
the browser (IndexedDB); if you close or reload with unsaved work, the browser asks first, and the next start offers to
**Restore** it (or Dismiss). Saving the project clears the autosave. View settings (snap, display, grid, X-ray, auto, output view,
light) and the folded panels are remembered per browser.

## Exports

**Name** (top of the Export menu, saved with the project): what the exported files are called. Letters, digits, `-` and `_`
(spaces become `_`, anything else is dropped); empty = the tileset's name. Enter in the field exports the Godot bundle.

**Godot bundle** (Export ▾ → Godot bundle, one file): `<name>.export.json` holds everything: the art, the three maps (PNG
data) and the footprints / collision:
(Schema of version 3: docs/export-schema.md.) `{"format": "tileset-studio-export", "version": 1, "name", "tile", "canvas", "images": {"atlas", "height", "normal", "pbr"}, "footprints": {...}}`.
Copy it anywhere under the Godot project. With the **Studio Import** plugin on (`addons/studio_import`, enabled in this
project) the editor unpacks it beside itself, `<name>.png`, `<name>_height.png`, `<name>_normal.png`, `<name>_pbr.png` and
`<name>_footprints.json`, imports them and builds `<name>_tileset.tres` (Output panel: `[StudioImport] ...`). Export again
over the same file and the TileSet is rebuilt (only images that changed are rewritten); scenes painted with it keep using it.
Project → Tools → Import Studio Bundles redoes every bundle. A second download the browser renamed (`<name>.export (1).json`)
works too: the name inside the bundle decides the file names. From the command line:
`--headless --path . --script res://tools/import_studio.gd -- res://art/x/<name>.export.json`.

**Separate files** (Export ▾ → Separate files, or one map at a time) are the same data as loose files; put them beside the atlas,
which must be called `<name>.png`:

| File | Contents |
|---|---|
| `<name>_height.png` | R = height above the floor in px / 255. G, B = R (engine defaults), or, with "Pack highlights", the engine's current highlight channels from the materials (G strength, B gloss = 1 − roughness) |
| `<name>_normal.png` | OpenGL sprite normal map: R = east, G = up (a top), B = toward the viewer (a south-facing front) |
| `<name>_pbr.png` | R = roughness, G = metallic. The engine uses it for highlights where present (instead of the height map's G/B) |
| `<name>_footprints.json` | version 2. Per model: floor footprint (convex hull, floor-plan px), height range, `solid`, material, and `collision: {mode, polygons}` (polygons in footprint mode: what the feet box collides with, floor-plan px). Top level `collision` holds the rule (step, body, feet box, pull-ins). The version 1 fields are unchanged, so an older importer reads it as strips |

The engine picks up `X_height.png`, `X_normal.png` and `X_pbr.png` next to an atlas `X.png` (`lighting/scripts/surface_maps.gd`). Save the
exports next to the tileset under the same name, then run `tools/import_studio.gd -- res://.../X.png` (headless Godot; the bundle does all this by itself) to get
`X_tileset.tres` with each tile's light outlines, collision and sort origins made from the footprints (footprint-mode polygons go
in as they are, cut by tile column onto the same cells as the light outlines; tiles sort at their column's collision bottom, so
a player behind a walk-behind piece sorts behind it). The samples have the bed and cart in footprint mode.

Keep separate pieces out of each other's tile columns, or at least on the same bottom row: one tile column holds one piece
per bottom row, so a piece drawn above another's base row in the same column is lit as part of it (the importer prints a
`clash`). `samples/ward_bedroom2_spread.studio.json` is the sample laid out that way.

The Studio opens images of any size (it does not check for power-of-two). The grid, cells and pieces assume 32 px tiles, so keep both sides a multiple of 32.

## Code

Plain ES2020 in classic scripts (so it runs from `file://`), WebGL2, no libraries:

- `js/math.js`: vectors, matrices, snapping
- `js/shape.js`: pencil outlines, simplification, validation, concave triangulation and custom solids
- `js/mesh.js`: n-gon meshes (plus loose lines), primitives, extrude (plain / manifold, faces / edges / points) / inset / bevel /
  loop cut / knife / fill / bridge / join / transforms
- `js/render.js`: the oblique and free-look views, art projection, picking
- `js/process.js`: rasterises models into surface data, maps, holes, floor heightfield, footprints
- `js/output.js`: the output view
- `js/app.js`: state, undo, tools, input, panels, files (`window.TS.api` for scripting and tests)
- `js/ui.js`: menus, tooltips, start screen, drop overlay, remembered panel sections (optional polish)
- `js/transfer.js`, `js/transfer-ui.js`: OBJ read / write, Import 3D source browser, model stamps
- `js/learn.js`, `js/sample_basic.js`: the Learn lessons and the built-in BasicSample they draw

`serve.ps1` is a small static server for opening project art by URL.


## Learn, box select, multi-edit

- **Learn** (top bar, or L): seven short animated lessons in a centred window over a dimmed Studio. Each is a self-playing loop that draws the real BasicSample scene in isometric 3D (its own boxes, textured with its own art): the big idea, height decides where it stands, light and shadows, walk over or blocked, kinds, one tile one thing, and a first-five-minutes checklist. Watch and read the caption, or take control with the timeline under the picture: drag the bar to scrub (a tick marks each step), ⏮ / ⏭ (or , and .) jump between steps, Home restarts, the speed button cycles 0.5×–2×. Arrows go back / next lesson, Space pauses, Esc closes. "See it in the Studio" buttons close the window and switch the real output view.
- **Box tool** (B, or the ▭ button): drag a rectangle to select every model it touches, in the tileset view and in 3D (Shift adds; Alt-drag or middle-drag orbits). Ctrl-drag still box-selects in 3D. Outliner: Shift+click selects a range, Ctrl+click toggles.
- With several models selected the Properties panel edits all of them: collision, kind, tags, smoothing, material (a differing field shows "mixed"). Name and placement stay per model.
- **References** (left panel, ＋ Add reference…): lay another tileset over yours as a translucent ghost: its picture and its models. Accepts a `.studio.json` (exact models) or a Godot `.export.json` (models show as footprint prisms). Dropping a bundle onto the window does the same. Move it with the ✥ Move button and drag in the view; it only slides across the floor (X, Y) and its height is locked. References are saved in the project. `samples/BasicSample.*` is the scene the Learn lessons use.
- **Snapping** (top bar): defaults to 1 px (one texel). 2 to 32 snap to coarser steps; **off** moves, scales and places freely (rotation is free too, and a typed number is always exact). `[` / `]` step through the list. The choice is saved with the project.
