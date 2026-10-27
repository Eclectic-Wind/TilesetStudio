<p align="center">
  <img src="assets/logo.png" alt="Tileset Studio" width="320">
</p>

<p align="center">
  <b>Give hand-drawn tilesets the surface data a lighting engine needs.</b><br>
  Model simple 3D shapes over your art, then export height, normal and roughness/metallic maps.
</p>

<p align="center">
  <a href="#run-it">Run it</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#what-you-can-do">Features</a> ·
  <a href="#exports">Exports</a> ·
  <a href="docs/reference.md">Full reference</a>
</p>

---

## Run it

Tileset Studio is a standalone web app. No install, no build, no internet.

1. Open `index.html` in a desktop browser (Chrome, Edge or Firefox with WebGL2).
2. Click **Open project** and pick `samples/ward_bedroom2.studio.json` to see a finished scene, or **Open tileset** to start with your own art.

Prefer a local server? Run `serve.ps1` and visit `http://127.0.0.1:8765/`. Files can then be opened by URL with `?tileset=/art/x.png` or `?project=/samples/ward_bedroom2.studio.json`.

The whole tool is this folder, so you can copy it anywhere to hand it out. New here? Press **L** for the animated **Learn** lessons (modelling, and animating with Aseprite).

## How it works

**Upload tileset → model over the art → Process → check → Export**

Your tileset is drawn in a fixed projection, and the models you place sit in that same projection. The studio renders what the models say about every pixel (height, surface direction, material) into maps the engine can light. Axes are colour-coded everywhere: **X** across (red), **Y** depth (green), **Z** height (blue).

## What you can do

- **Model** with Blender-style tools: boxes, cylinders, wedges, spheres, extrude, inset, bevel, loop cut, knife, bridge, snapping to the tile grid. Draw custom shapes with the **Pencil**.
- **Look round** in 3D (hold Alt and drag, or press **5** to stay there) to check depth and stacking.
- **Check the result** in the output view: lit preview with shadows, height / normal / roughness / metal maps, holes the models miss, floor plan, collision and tile-piece problems.
- **Import 3D** from glTF (`.glb`, with bones and animation), OBJ or other projects, and reuse parts as **stamps**.
- **Animate** with bones (rigid or bending), a timeline and clips, and render every frame's normal map into a spritesheet. It can link live to Aseprite ([guide](docs/animation-aseprite.md)).
- **Stay safe**: changes autosave in the browser, with undo/redo, and the next start offers to restore unsaved work.

## Exports

| Export | What you get |
|---|---|
| **Godot bundle** | One `<name>.export.json` holding the art, height / normal / PBR maps and footprints. Plain JSON any engine can read ([how to use it](#use-the-export-in-your-own-project), [schema](docs/export-schema.md)) |
| **3D models** | glTF `.glb` (bones and clips included) or Wavefront OBJ |
| **Project** | `<name>.studio.json`, with the tileset embedded (Ctrl+S) |

## Use the export in your own project

**Export ▸ Godot bundle** writes a single `<name>.export.json`. The menu item says Godot, but the file is plain JSON (not a Godot `.res`) and nothing in it is engine-specific. The full field list is in the [export schema](docs/export-schema.md).

| Field | Contents |
|---|---|
| `images.atlas` | Your tileset art as a PNG data URL |
| `maps.data` | Base64 of one raw RGBA8 image, `maps.w` wide and `maps.h + maps.rows` tall. Raw bytes, so don't decode it through a canvas |
| `maps.materials` | `[[roughness, metallic], ...]`, 0 to 1 |
| `footprints` | Per-model floor footprints and exact outlines, height range, kind, collision polygons, piece names, and the piece table (`pieces`), in floor-plan pixels |
| `tile`, `canvas` | Tile size (32) and art size |

**Art rows** (`0 .. h-1`) hold one texel per art pixel:

| Channel | Meaning |
|---|---|
| R | Height above the floor, in px (0 to 255) |
| G, B | Normal x and y, stored as `n * 0.5 + 0.5`; z is `sqrt(1 - x² - y²)` |
| A | Material index + 1 into `maps.materials` (0 = no art) |

**Floor rows** (`h .. h+rows-1`) hold the floor-plan heightfield, one texel per floor point: R top + 1 (0 = nothing stands there), G underside, B gap bottom + 1, A gap top. Skip them if you only need the maps.

### Unpack it

This Node script writes the atlas and the three map PNGs. It uses the `pngjs` package, but any PNG writer works.

```js
const fs = require("fs"), { PNG } = require("pngjs");
const b = JSON.parse(fs.readFileSync("name.export.json", "utf8"));
const { w, h, data, materials } = b.maps, raw = Buffer.from(data, "base64");

fs.writeFileSync("name.png", Buffer.from(b.images.atlas.split(",")[1], "base64"));

const height = new PNG({ width: w, height: h }), normal = new PNG({ width: w, height: h }), pbr = new PNG({ width: w, height: h });
for (let i = 0; i < w * h; i++) {
  const [r, g, bl, a] = raw.subarray(i * 4, i * 4 + 4), [rough, metal] = materials[a - 1] || [1, 0];
  const nx = g / 255 * 2 - 1, ny = bl / 255 * 2 - 1, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  height.data.set([r, r, r, 255], i * 4);
  normal.data.set([g, bl, Math.round((nz * 0.5 + 0.5) * 255), 255], i * 4);
  pbr.data.set([Math.round(rough * 255), Math.round(metal * 255), 0, 255], i * 4);
}
for (const [n, p] of [["height", height], ["normal", normal], ["pbr", pbr]]) fs.writeFileSync(`name_${n}.png`, PNG.sync.write(p));
```

Load `name.png` as your albedo/atlas and the maps as your engine's height, normal and roughness/metallic inputs. The normal map is R = east, G = up, B = toward the viewer, so flip G if your engine expects the other convention.

### Footprints and collision

`footprints.objects[]` is what you need for gameplay. Each model gives its `footprint` (convex hull) and `z` range, its `kind` (`floor`, `wall_h`, `wall_v`, `deco`), its `piece` name, its `pieceIndex` (its piece's number in `footprints.pieces`), its exact `outline` and `cells` (the 32 px atlas cells it occupies). Its `collision.mode` is `footprint`, `strip` or `none`, and `footprint` mode carries `collision.polygons` ready to use as colliders. Top-level `footprints.collision` describes the player box those polygons were built for. Coordinates are floor-plan pixels: X east, Y south, Z up.

### Any engine

The same three steps work anywhere: unpack the atlas and maps, load them as textures, and turn `footprints` into colliders and sort origins. Godot, Unity, GameMaker, Love2D, Phaser or a custom renderer all just need a PNG loader and a JSON parser. The author's own Godot project does this with an editor plugin that builds a TileSet from the bundle. That plugin is not part of this repo.

Whatever you build, keep both tileset sides a multiple of 32 px and keep separate pieces out of each other's tile columns. The Studio's **⚠ Tile problems** line warns about both before you export.

## Repo layout

| Path | Contents |
|---|---|
| `index.html`, `style.css`, `js/` | The app: plain ES2020 and WebGL2, no libraries, runs from `file://` |
| `samples/` | Example projects (`ward_bedroom2`, `BasicSample` used by Learn) |
| `docs/` | [Full reference](docs/reference.md), [export schema](docs/export-schema.md), [animation and Aseprite](docs/animation-aseprite.md) |
| `tools/aseprite/` | The Aseprite extension for the live animation link |
