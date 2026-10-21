# Godot bundle schema, version 3 (`<name>.export.json`)

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

`auto` resolves to `none` when the model is flat **or** `heightMax < collision.step`, else `strip`. An explicit `strip` / `footprint` / `none` is honoured as chosen. So a model lower than the step produces no strip or polygon unless the artist picked strip or footprint explicitly. Kind does not affect collision.

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
