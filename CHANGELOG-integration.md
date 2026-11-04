# Blockout integration into the newer TilesetStudio build

The supplied `TilesetStudio.zip` is the base. Blockout functionality was ported from `tileset_studio_isoBlockoutmode (1).zip` using the earlier isometric build to isolate those changes.

## Available features
- Blockout toggle, object color picker and per-object color editing with undo/redo.
- Existing Add and Free Draw tools create normal editable 3D geometry with procedural colors when Blockout is on. No architectural presets added.
- Isometric Free Draw uses the selected floor or detected surface plane; supports snapping, outlines, primitives, Cut Through and Carve Recess.
- Wheel zooms; brackets change Free Draw thickness; Shift gives fine adjustment.
- New blank isometric blockout, Color output, transparent PNG export with fit-to-models option.
- Procedural edits regenerate the embedded source PNG automatically. Saving immediately flushes pending changes. Turning Blockout off retains that PNG. External PNG files still require export.
- Older Blockout projects retain object colors and their mode when opened.

## Newer functionality retained
- Background processing and stale-job rejection, including procedural color output.
- Sliced output rendering and viewport geometry caching.
- Per-face base colors and Base shading (uses a separate shader mode from Blockout).
- Animation tools, current sheet handling in undo history, animated bundle export and current Aseprite link.
- Newer UI, help, transform gizmos, import/export and other unmodified files.

## Verification
- 8 geometry/raster/export checks passed.
- 11 simulated-browser checks passed without workers.
- 12 simulated-browser checks passed with the actual worker source executing in an isolated VM and structured-clone transfers. Includes CPU/worker color equality, Color preview pixels, and rejecting stale results after mode changes.
- 35 existing animation tests and 11 existing Aseprite link tests passed.
- JavaScript syntax and archive checks passed.
- Canvas/WebGL calls in the simulated browser are mocked. Chromium could not start because this environment denies its required socket operation; real browser visual/GPU validation remains outstanding.

Run the app as usual from the extracted folder. In the viewport toolbar enable Blockout; or use File > New isometric blockout. Continue using Add and Free Draw normally.
