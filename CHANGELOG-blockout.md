# Blockout integration — 30 October 2026

Based on the supplied `tileset_studio_isoBlockoutmode.zip`.

- Integrated procedural colors into the existing Add and Free Draw tools, enabled only by Blockout mode. No preset blockout objects.
- Added object color controls, directional face shading, a Color output view, and transparent PNG export with optional fit-to-scene.
- Automatically regenerate the project source PNG after Blockout edits; preserve the latest generated image when the mode is turned off. Saves flush pending edits and retain editable objects, colors and mode. Undo/redo updates the matching source pixels. Blockout pauses Aseprite updates and animation entry.
- Adapted Free Draw footprints, surface picking, snapping, outline extrusion and cutting to isometric planes.
- Assigned [ / ] to thickness/Carve depth adjustment; wheel remains zoom.
- Updated browser and headless bundle export to use the generated blockout atlas when the mode is active.
- Fixed large floor-footprint exports exceeding the JavaScript argument stack.
- Preserved the supplied build's Copy image button and Ctrl+C text-selection behavior.

See `docs/blockout-mode.md` for usage, limits and validation details.
