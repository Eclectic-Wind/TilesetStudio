# Godot bundle schema, version 6 (`<name>.export.json`)

Version 6 only **adds** to version 5 (below): every version 5 field keeps its shape, and a reader that ignores `anim` gets the base frame of every animated piece as an ordinary still tile (the atlas, `maps.data`, `maps.pieces` and the piece table are unchanged: no frame lives in the atlas grid, no cell moves, frames add no pieces and no paintable tiles).

New: the top-level **`anim`**, written only when a clip is exported or there is something to warn about. First version: **flipbooks** (frames painted in Aseprite, geometry unchanged), **static shadow and collision**. `source: "rig"` (bone-animated frames with their own height / normal data) is reserved and not written yet.

## `anim`

```
anim: {
  clips: [{
    name, fps, frames,
    loop: "loop" | "once" | "pingpong",   // what happens at the last frame. Playback itself (auto-play, from code) is the game's
    shadow: "static",                    // the base frame's: "frames" is reserved
    collision: "static",                 // always the base frame's
    targets: [{
      piece,                             // the animated piece: its number in footprints.pieces (1-based), as pieceIndex
      rect: [x, y, w, h],                // atlas px, multiples of 32: holds the piece's art and everything its frames paint. Every frame is drawn here, in place of the piece
      cols, rows,                        // the frames are packed cols per row, left to right then down, each w x h (frame f at ((f % cols) * w, floor(f / cols) * h))
      source: "flipbook",                // "rig" reserved
      color: "<base64 PNG>",             // cols*w x rows*h RGBA: the frames' albedo, as painted (transparent pixels show what is behind)
      data?: "<base64 zlib>"             // reserved (rig): per-frame height / normal / material in maps.data's art-row layout.
                                         // Absent = every frame reuses the base frame's height, normal and material: read maps.data at `rect`
    }]
  }],
  warnings: [string]                     // for the artist, as the Animate panel shows them
}
```

- The game draws the target **instead of** the base piece while the clip plays (transparent frame pixels show what is behind, not the base art), and keeps the piece's sort row, shadow, collision and `walk` as in the base frame. A frame can be smaller than `rect`: it is transparent where it paints nothing. `rect` can reach past the base art (a door swinging open): pixels painted over another piece's art are not counted, since they belong to that piece in a whole-tileset sheet.
- The frame count and the sheet: the Studio takes each frame from the clip's Albedo sheet (`Rig.layout` cells of the whole tileset), crops it to `rect` and packs the crops. `rows * cols >= frames`; `cols` is at most 2048 / w.
- `piece` is the piece the clip's models belong to (models are chosen per clip). The whole piece is swapped, so the frames must show the whole piece, not only the models that change.
- A clip target is **not exported** (and `warnings` says why) when: the clip has no Albedo sheet or its size is not `Rig.layout` of the tileset for `frames`; the piece holds stairs (`walk: "stairs"`: a moving walk surface is not supported); the models have no art on the canvas. Warnings only (still exported): a frame with no painted pixel; pixels painted where the base frame has no art (height and normal are flat there); a rect reaching south of the piece's base row (oblique), which the game sorts by.

## Making one in the Studio

1. Model and paint the base frame as usual; the animated thing should be its own piece (its models joined by footprint, or one `piece` name).
2. Animate mode: pick or add a clip, set the frame count and fps. Paint each frame in Aseprite's **Albedo** group (the link sends the sheet), or load an Albedo sheet.
3. In the clip's **Game export** section: select the models the flipbook animates, press **Use selected models**; set **Loop**. The section lists what is exported and any warnings; **Export** unticks a clip that should not go into the bundle.
4. Export ▸ Godot bundle. `node tools/export_project.js in.studio.json out.export.json` does the same headless and prints the targets and their sizes (each clip's `albedo` sheet is a data URL in the project).

The sample: `node tools/make_anim_sample.js` writes `samples/AnimSample.studio.json` and `samples/AnimSample.export.json` (a TV box with an 8-frame static clip, a flat puddle with a 6-frame ripple, painted headless).

## Not in this round

`source: "rig"` and `data`, `shadow: "frames"` and per-frame floor spans, animated collision, frame de-duplication, isometric (untested; the rect is in canvas px either way).

---

## Version 5 (earlier)

> Describes version 5; version 6 above adds to it.

### Godot bundle schema, version 5 (`<name>.export.json`)

Version 5 only **adds** to version 4 (below): every version 4 field keeps its shape, so a version 4 reader still reads the file. What is new:

- A model property `walk` (`footprints.objects[].walk`): `"auto"` (default, nothing) or `"stairs"`. `"top"` and `"none"` are reserved for a later round; a reader should treat any value it does not know as `"auto"`.
- `footprints.walk`, written only when the project has a stairs model (or a warning about one): the **surfaces** the stairs models make.
- A model with `walk: "stairs"` and no explicit collision choice resolves to `collision.mode: "none"` (its blocking comes from the surface polygons below). An explicit `strip` / `footprint` is still honoured.

`kind` is unchanged: a stairs model is `furn` (or whatever the artist set) and renders, shadows and sorts as such. `walk` is separate because a piece's kind is the strongest of its models' kinds: a flight touching a wall would otherwise lose its stairs.

Coordinates as in version 4: floor-plan px (X east, Y south, Z up), world XY in both projections, so everything below is projection independent. Heights are absolute model z, with the asset modelled at local z = 0 (the game offsets a storey).

## Making a flight

Set **Walk ▸ stairs** on every tread model of the flight. A flight is the stairs models of one **piece** (models whose footprints come within 2 px join; give separate flights different `piece` names). Other models in the piece (side walls, a landing) are not part of the flight and are not touched. A flight is at its best axis-aligned, 16 px treads and risers; the direction is a free unit vector.

## `footprints.walk`

| field | type | meaning |
|---|---|---|
| `step`, `body` | px | the rule the walk data was made with (the Processing settings; same as `collision.step`/`body`) |
| `surfaces` | `[surface]` | one per flight; `id` is the position |
| `warnings` | `[string]` | for the artist: a flight that is not one straight run, too narrow for the feet box, raised, skipped |

A surface:

| field | type | meaning |
|---|---|---|
| `id` | int | position in `surfaces` |
| `models` | `[int]` | indices into `footprints.objects` of the flight's tread models |
| `pieces` | `[int]` | piece numbers (1-based, as `pieceIndex`) holding them. **Draw rule for the game**: an actor standing on this surface draws in front of these pieces (everything south of the feet on a rising flight is lower than the feet, everything north is behind them) |
| `plane` | `[a, b, c]` | surface height at floor point (x, y): `z = a + b*x + c*y`, from a least-squares fit through the tread tops at the cell centres. Clamp to `z` below. **Not** an edge-to-edge ramp: a straight line is at best half a riser off a staircase (+-8.4 px for 16 px treads), where a ramp from the low edge to the high edge would leave the tread up to a riser above the feet |
| `fit` | `{max, treads, riser}` | worst `|tread top - plane|` (px), number of distinct tread heights, `rise / treads` |
| `z` | `[low, high]` | height at the foot of the flight / top of the highest tread. Clamp `plane` to it |
| `outline` | `[[[x, y], ...], ...]` | the flight's exact floor outline, as `pieces[].outline` |
| `blockers` | `[[[x, y], ...], ...]` | polygons (floor px) that stop an actor **standing on the surface**: a frame 16 px wide just outside the outline, open across both end edges (the seams). The feet box collides with them as with `collision.polygons` |
| `around` | `[[[x, y], ...], ...]` | polygons that stop an actor on the **ground** (the surface below / around): the flight's footprint pulled in like a footprint-mode collision (sides 3 px, south edge 8 px), with a gate cut into the low edge so the feet can reach the low seam; the corner stubs keep the sides shut. Replaces the flight's own `collision.polygons` |
| `seams` | `[seam]` | the flight's two ends |
| `stairs` | object | the stairs table |

A seam: `{end: "low" | "high", edge: [[x, y], [x, y]], z, to}`. `edge` is the end edge as a floor-plan line; `z` its height. `to` is where it leads: `"ground"` (the low seam, when the flight starts within `step` of the ground), a surface id (reserved), or `null`: nothing in this asset, i.e. the game's level portal (the high seam, and a raised low seam).

`stairs`: `{dir: [dx, dy], low, high, zLow, zHigh, rise, run, width, slope}`. `dir` is the unit vector low -> high in floor XY (it snaps to an axis within 3 degrees); `low` / `high` are the seams' edges; `rise = zHigh - zLow`; `run` the extent along `dir`, `width` across; `slope` = dz per floor px along `dir`.

### What the game does with it

1. Standing on the ground: collide with `around` (and the rest of `collision.polygons`). Feet cross the low seam line (inside `low`'s span) -> the actor is on the surface.
2. On the surface: collide with `blockers`; feet height = `clamp(plane(x, y), z[0], z[1])`. At the low seam the plane is up to half a riser from the ground (9.3 px for the 16 px sample), so blend over a few px.
3. Feet cross the high seam: `to: null` -> level portal; the game moves the actor up a storey, z continuous.
4. Draw an actor on the surface in front of `pieces` (see above).

The headless dump `node tools/export_project.js in.studio.json out.export.json` prints the surfaces and warnings.

### Measured on the TwoStorey flight (6 treads, 16 x 16 px, 64 wide, rising north)

`plane [196.0152, 0, -0.9723]` (the slope is 35/36 of 1: a least-squares line through a staircase), `fit.max 8.4`, `z [0, 96]`, `dir [0, -1]`, low seam `[[224,192],[288,192]]` to `"ground"`, high seam `[[224,96],[288,96]]` to `null`; `blockers` two 16 px side strips `[[208,80],[224,80],[224,208],[208,208]]` and its mirror; `around` the pulled-in footprint 227..285 x 96..172 plus two 2 px corner stubs at y 180..184.

### Not in this round

Raised flat surfaces (porch, balcony tops, rails on them), `walk: top | none`, surfaces that connect to each other, a Walk output view, `piece.overhead`, a `storeyHeight` check. A project without stairs changes only in two ways: the bundle `version` is 5 and `footprints.objects[].walk` is `"auto"` and there is no `footprints.walk`.

---

## Version 4 (earlier)

> Describes version 4; version 5 above adds to it.

### Godot bundle schema, version 4 (`<name>.export.json`)

Version 4 only **adds** to version 3 (below): every version 3 field keeps its shape, so a version 3 reader still reads the file. Four things change:

- `kind` is one of four: `floor`, `wall_h`, `wall_v`, `furn` (version 3 had `floor`, `deco`, `solid`, `wall`, `side`; `deco` and `solid` are now `furn`).
- Pieces are exact: `footprints.pieces` (the Studio's piece grouping), each model's `pieceIndex` and exact `outline`, and `maps.pieces`, the piece number of every art pixel and floor point.
- Where a floor point's solid runs belong to different pieces, its gap in `maps.data` is the boundary between them (see *Maps*).
- `wallHeight` and `wallThickness` (the Processing settings the kinds were inferred with) are written at the top level and in `footprints`.

Coordinates as in version 3: floor-plan px (X east, Y south, Z up); a world point (X, Y, Z) is drawn at canvas (X, Y - Z). Cells are `[column, row]` of the 32 px atlas grid.

## Projection

The top level also carries `projection`, right after `canvas`: `{"type": "oblique"}` (the default, what every bundle before it meant) or `{"type": "iso", "origin": [ox, oy], "tilt": 30}`. It says how a world point (X, Y, Z) is drawn on the canvas (px, Z = px above the floor in both):

| type | canvas point | notes |
|---|---|---|
| `oblique` | `(X, Y - Z)` | top-down 3/4. `maps.data` normals are `(east, up, south)`: R = east, G = up, B = toward the viewer (south) |
| `iso` | `(ox + X - Y, oy + sin(tilt) * (X + Y) - Z)` | isometric at camera elevation `tilt` (degrees, 10 to 80; 30 is 2:1 pixel art, and a bundle without `tilt` means 30): a 32 px world tile is a 64 x 64 sin(tilt) diamond. The viewer looks along (-1, -1, -2 sin(tilt)), so of the points drawn at one canvas pixel the nearest has the largest `X + Y + 2 sin(tilt) Z`. **Normal maps are in screen space**: R = screen right, G = screen up, B = toward the viewer |

The floor plan (`footprints`, the floor rows of `maps`) is world XY in both: floor x is the world X column and floor y the world Y row, 32 px per tile. In an isometric project the floor plan is W wide (X from 0 to the canvas width); models further east are not on it. The height map is the same in both: R = px above the floor.

## Top level (version 4)

| field | type | default | meaning |
|---|---|---|---|
| `version` | int | 4 | was 3 |
| `wallHeight` | int px, 0-255 | 48 | a tall model at least this high can infer a wall kind (see *Kind*). Processing panel, saved in the project |
| `wallThickness` | int px, 0-255 | 24 | a tall model's shorter floor side must be at most this to be a wall. Processing panel, saved in the project |

Everything else at the top level is as in version 3 (`bundleId`, `exportedAt`, `studioVersion`, `walkOverHeight`).

## Kind (version 4)

| kind | meaning in the engine |
|---|---|
| `floor` | walked over: flat ground art (floors, rugs, papers, slabs). Never casts shadow, never joins a piece, drawn under actors |
| `wall_h` | horizontal wall, runs east-west on the map (back / front walls). Casts shadow, the torch beam lands on it, fades while the player is behind it |
| `wall_v` | vertical wall, runs north-south (side walls). Casts shadow, blocks light east / west, never fades |
| `furn` | furniture and props: anything else that stands (tables, crates, beds, pillars, stairs), what populates a room. Casts shadow, y-sorted against actors at its base line |

Inferred when the artist set nothing: `flat` (heightMax <= walkOverHeight) -> `floor`; else, when heightMax >= `wallHeight` and the shorter side of the model's floor box is <= `wallThickness`: `wall_h` if its east-west extent is at least its north-south extent, else `wall_v`; else `furn`.

Migration: a version 3 bundle's kinds map `wall` -> `wall_h`, `side` -> `wall_v`, `solid` -> `furn`, `deco` -> `furn`. Any reader should map a `deco` it meets to `furn`, so older version 4 bundles stay readable. The Studio maps the same names when it opens a project of any version.

## `footprints` (version 4 additions)

| field | type | meaning |
|---|---|---|
| `wallHeight`, `wallThickness` | int px | as at the top level |
| `pieces` | `[piece]` | the piece table: one entry per piece, in order. A piece's **number** is its position + 1 (0 always means no piece). Floor-kind models are always pieces of their own |

A piece:

| field | type | meaning |
|---|---|---|
| `names` | `[string]` | as the Pieces view shows them |
| `models` | `[int]` | indices into `footprints.objects` |
| `kind` | kind | the strongest of its models' kinds (`floor` < `furn` < `wall_v` < `wall_h`) |
| `z` | `[min, max]` | lowest underside / highest top of its models |
| `base` | number | floor y (canvas px) of its south edge: the largest floor row its footprint covers. Its sort line |
| `back` | number | floor y of its north edge: the smallest floor row its footprint covers |
| `outline` | `[[[x, y], ...], ...]` | exact floor outline: the traced mask of every floor point the piece covers, not a hull (an L stays an L) |
| `cells` | `[[x, y], ...]` | atlas cells holding its art or floor points |

## `footprints.objects[]` (version 4 additions)

| field | type | meaning |
|---|---|---|
| `kind` | kind | one of the four (see *Kind*) |
| `pieceIndex` | int >= 1 | the number of the piece this model belongs to (its place in `footprints.pieces`, + 1) |
| `outline` | `[[[x, y], ...], ...]` | the model's own exact floor outline (traced, not a hull) |

## Maps (version 4 additions)

- **`maps.pieces`** (new): base64 RGBA8, exact bytes, on the same W x (H + rows) grid as `maps.data`. Piece numbers are 16-bit: low byte, high byte; 0 = no piece.
  - rows 0..H-1 (art space): R, G = the piece of the art pixel's owner (hole-filled pixels included; 0 where no model paints). B, A = 0.
  - rows H..H+rows-1 (floor space): R, G = the piece of the run **above** the gap (the top piece when there is no gap); B, A = the piece of the run **below** the gap (the same as R, G when there is no gap). 0 where nothing stands.
- **`maps.data`, floor space, B / A** (changed): where a floor point's solid runs belong to different pieces (a floating piece over another, an arm reaching over a lower piece), the gap is the boundary between the topmost piece's lowest run and what is under it, whatever its size. Touching pieces have B = A + 1 (a 0 px gap). Otherwise the tallest gap, as before. So each half of a floor point belongs to exactly one piece.

## Export

- Export ▸ Godot bundle writes it. `tools/export_project.js <in.studio.json> <out.export.json>` writes the same bundle headless (both build it with `TS.Bundle.build`, js/bundle.js). The differences: `exportedAt`, and the atlas, which the headless tool takes as the project's own PNG bytes (the browser re-encodes it).
- The sample: `node tools/make_sample_bundle.js` regenerates `samples/sample.export.json`.

---

## Version 3 (earlier)

> The kind names and meanings below are version 3's. Version 4 replaces them (see *Kind*); the rest of this section still describes version 4 unchanged.

Version 3 only **adds** fields. Every version 1 / 2 field is written exactly as before (`exported`, `images`, `maps`, `footprints.objects[].solid / z / footprint / roughness / metallic / collision.mode / collision.polygons`, `footprints.collision`), so an older importer still reads the file. Two things change meaning:

- `collision.mode` is now the **resolved** mode (an old importer sees `strip` / `footprint` / `none` as before; it never sees `auto`).
- A model with no explicit collision choice is now `auto`, not `strip` (see *Collision*).

Coordinates: floor-plan px (X east, Y south, Z up). Model indices below are positions in `footprints.objects` (loose lines and points are not exported, so this is not the Studio's outliner order). Cells are `[column, row]` of the 32 px atlas grid.

## Top level (new)

| field | type | default | meaning |
|---|---|---|---|
| `version` | int | 3 | was 2 |
| `bundleId` | string (UUID v4) | generated once per project | stored in the `.studio.json`; an older project gets one on first open. Same id = same project (moved / renamed export); a copied project file keeps the id |
| `exportedAt` | string (ISO 8601 UTC) | now | same value as the old `exported` |
| `studioVersion` | string | `"1.0.0"` | constant in `js/app.js`; the Studio had no version before |
| `walkOverHeight` | int, 0-16 px | 2 | Processing panel, saved in the project; also in `footprints.walkOverHeight` |

## `footprints` (new)

| field | type | meaning |
|---|---|---|
| `walkOverHeight` | int | as above (so the standalone `_footprints.json` is self-contained) |
| `cellOwners` | `[{cell: [x, y], models: [i, ...]}]` | every occupied atlas cell and the models in it |
| `clashes` | `[{cell: [x, y], models: [i, j], samePiece: bool}]` | one entry per pair of models sharing a cell. `samePiece: true`: the importer treats the two as one piece (footprints within 2 px), usually harmless; `false`: it cannot tell whose cell it is |

`footprints.version` stays 2 (the bundle `version` is the discriminator).

## `footprints.objects[]` (new)

| field | type | default | meaning |
|---|---|---|---|
| `heightMin` | number px | - | lowest underside of any solid span, above the floor (0 = sits on it) |
| `heightMax` | number px | - | highest top |
| `flat` | bool | - | `heightMax <= walkOverHeight` |
| `kind` | `"floor"｜"deco"｜"solid"｜"wall"｜"side"` | inferred | final kind |
| `kindInferred` | bool | - | `true`: nothing was set by the artist |
| `collision.mode` | `"strip"｜"footprint"｜"none"` | - | resolved |
| `collision.requested` | `"auto"｜"strip"｜"footprint"｜"none"` | `"auto"` | what the artist chose |
| `tags` | string | `""` | free text, nothing in the Studio reads it |
| `piece` | string | `""` | piece name set by the artist. Same non-empty name = one piece however far apart; a named model never joins another by footprint. `""`: group automatically (footprints within 2 px). The importer must honour it for the Studio's Pieces view to match |
| `cells` | `[[x, y], ...]` | - | atlas cells it occupies |

`polygons` still appears in `collision` only when `mode` is `footprint`.

### Kind

Inferred: `flat` -> `floor`, else `solid`. `deco`, `wall` and `side` are never inferred. `wall` = tall back wall the torch beam lands on; `side` = side wall that blocks light east / west.

### Collision

`auto` resolves to `footprint`. An explicit `strip` / `footprint` / `none` is honoured as chosen. A model nothing of which reaches into `[collision.step, collision.body]` blocks no floor, so it yields an empty `polygons` list. Kind does not affect collision.

### Cells

A cell is occupied by a model if the model's pixel is the topmost art pixel in it, or it is the topmost thing at a floor point in it (the same sampling the Pieces view uses). A model fully hidden under others, and floor points south of the canvas, are not counted.

## Examples (from `samples/sample.export.json`, walkOverHeight 2, step 4)

Flat rug:

```json
{"name":"Rug","solid":true,"z":[0,2],"footprint":[[20,40],[76,40],[76,80],[20,80]],"roughness":0.7,"metallic":0,
 "collision":{"mode":"none","requested":"auto"},"kind":"floor","kindInferred":true,
 "heightMin":0,"heightMax":2,"flat":true,"tags":"",
 "cells":[[0,1],[1,1],[2,1],[0,2],[1,2],[2,2]]}
```

Table (top on legs):

```json
{"name":"Table","solid":true,"z":[0,28],"footprint":[[136,84],[184,84],[184,116],[136,116]],"roughness":0.7,"metallic":0,
 "collision":{"mode":"strip","requested":"auto"},"kind":"solid","kindInferred":true,
 "heightMin":0,"heightMax":28,"flat":false,"tags":"furniture",
 "cells":[[4,1],[5,1],[4,2],[5,2],[4,3],[5,3]]}
```

Back wall (kind set by the artist):

```json
{"name":"Back wall","solid":true,"z":[0,56],"footprint":[[16,186],[112,186],[112,194],[16,194]],"roughness":0.7,"metallic":0,
 "collision":{"mode":"strip","requested":"auto"},"kind":"wall","kindInferred":false,
 "heightMin":0,"heightMax":56,"flat":false,"tags":"",
 "cells":[[0,4],[1,4],[2,4],[3,4],[0,5],[1,5],[2,5],[3,5],[0,6],[1,6],[2,6],[3,6]]}
```

The sample also has a `Side wall` (`kind: "side"`, explicit `footprint` collision, with polygons). It has no clashes (`"clashes": []`).

## Studio changes

- Processing: **Walk-over height**. Properties: **Collision** gains `auto` (default; shows what it resolves to), **Kind** (default shows the inferred kind; an overridden kind gets a badge in the outliner and the panel), **Tags**.
- Output ▸ Plan ▸ **Kind**: models tinted by resolved kind, with a legend. Plan ▸ **Collision** now also outlines each model's footprint by resolved mode (green dashed = none, orange = strip, red = footprint) and lists the `auto` results.
- Shared atlas cells show as a warning under the output (hover for the full list).
- Regenerate the sample: `node tools/make_sample_bundle.js`.
