# Tileset Studio

A standalone web app for giving hand-drawn tilesets the surface data the lighting engine needs. An artist lays simple 3D models
over the drawing, in the tileset's own projection, and the studio renders height, normal and roughness/metallic maps from them.

**Upload tileset → model over the art → Process → check → Export.**

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
model along that pixel's line of sight. The output view tests the result before you export:

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

The stats line gives covered / hole / filled pixel counts. Aim for no magenta: **next hole ›** centres both views on the next
uncovered spot (switching to Holes). Hover the output to read the pixel under the pointer (height, normal, roughness, metallic,
which model, hole or not; floor top / bottom / spans in the Floor view); **double-click** it to select that model.

A **⚠ column clash** line appears when pieces would clash in the importer (`tools/import_studio.gd` prints the same): models within
2 px of each other are one piece, and two pieces standing on different rows of one 32 px tile column, close enough to overlap
there, get measured as one piece in a single tile layer. Hover it for the full list; move one of the pieces to its own columns
or onto the same row.

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
`{"format": "tileset-studio-export", "version": 1, "name", "tile", "canvas", "images": {"atlas", "height", "normal", "pbr"}, "footprints": {...}}`.
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

Tilesets must be power-of-two on both sides (64, 128, ..., 4096); the studio refuses others.

## Code

Plain ES2020 in classic scripts (so it runs from `file://`), WebGL2, no libraries:

- `js/math.js`: vectors, matrices, snapping
- `js/mesh.js`: n-gon meshes (plus loose lines), primitives, extrude (plain / manifold, faces / edges / points) / inset / bevel /
  loop cut / knife / fill / bridge / join / transforms
- `js/render.js`: the oblique and free-look views, art projection, picking
- `js/process.js`: rasterises models into surface data, maps, holes, floor heightfield, footprints
- `js/output.js`: the output view
- `js/app.js`: state, undo, tools, input, panels, files (`window.TS.api` for scripting and tests)

`serve.ps1` is a small static server for opening project art by URL.
