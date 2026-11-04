# Blockout mode

Blockout uses the existing **Add** and **Free Draw** tools. Turn it on in the modeling view bar. There is no separate preset system.

## Start

1. Open your project and enable **Blockout**, or choose **File → New isometric blockout** for a blank 1024 × 1024 canvas at the tool's 26° isometric setting.
2. Choose **Object color** beside the Blockout toggle.
3. Use **Add / Shift+A** or **Free Draw / P** normally. New objects receive that color automatically. Tops and sides get simple directional shading so their volume is readable.
4. Move, rotate, resize, duplicate, cut, or edit the objects using the existing controls. The project’s source PNG regenerates automatically after each committed edit, including recoloring and deletion. No Apply or reimport step is needed.
5. Select an object and change **Properties → Blockout color** to recolor it. Multiple selected objects can be recolored together; undo/redo works.

Turning Blockout off keeps the latest generated PNG as the project’s source image. Add and Free Draw then use their normal behavior without applying procedural colors or regenerating that image. Turn Blockout back on to resume automatic updates. Existing objects without a saved color use the default brown while Blockout is on. Undoing the initial switch into Blockout restores the preceding source image; undo/redo of edits inside Blockout regenerates the matching pixels.

## Isometric Free Draw

Free Draw now draws in the chosen surface's coordinates in isometric view. A rectangular footprint follows the floor or wall plane. The first click locks the drawing plane; subsequent points stay on it.

- **Draw on object surfaces:** start on an object's visible face. Thickness grows outward from that face.
- **Empty space / Flat top:** draw on a horizontal plane at the 3D cursor's Z height.
- **Empty space / Upright front:** in isometric view, draw on an upright plane at the cursor's Y position.
- **Snap outline to grid:** snap within the drawing plane using the main Snap step.
- **Box / Cylinder / Sphere:** drag the footprint, release to preview, then click or press Enter to apply.
- **Freehand / Click corners:** outline the shape, preview, then apply. Corner Radius applies to outlines.
- **Cut Through / Carve Recess:** start on a closed solid's face; preview and apply as before.
- **[ / ]:** decrease/increase thickness or Carve depth by 1 px; Shift changes it by 0.1 px. Cut Through uses the full target depth.
- **Wheel:** zoom; Space-drag pans. Esc clears the pending shape, Q returns to selection.

Isometric drawing also works with Blockout off. The existing top-down and held 3D views remain available.

## Save and export

- **Ctrl+S / Save project:** saves editable geometry, object colors, projection, Blockout mode, and the latest generated source image in `.studio.json`. Saving immediately after an edit flushes any pending refresh first.
- **Color** in the output view displays the generated blockout image without editor overlays. It updates after committed edits, including when normal Auto processing is off.
- **Export → Blockout PNG:** exports the current geometry as a transparent PNG while Blockout is enabled.
- **Fit PNG to all models** is on by default. It adds a 16 px transparent border around the projected scene without moving objects or changing the project canvas. The project’s automatically updated source image always retains its canvas dimensions and projection origin. Disable it to keep the original canvas dimensions. Fitted images are limited to 4096 px per side.
- The viewport's Hide control remains an editing aid: hidden objects are still included in processing and export, as in the existing tool.
- **Godot bundle** exports the generated blockout atlas while Blockout is on, including through `tools/export_project.js`. Its dimensions remain the project's original canvas size. The fitted-PNG option does not resize bundles.

While Blockout is active, the source image is the complete procedural scene render; painted pixels outside the objects become transparent. Aseprite sends, incoming albedo updates, and animation entry are paused while Blockout is on. Old incoming images cannot overwrite the latest generated frame when the mode is turned off; save again in Aseprite afterward to resume painting updates.

Automatic updates happen inside the open project. Save project persists the generated PNG with the editable 3D objects. Export PNG downloads a standalone image; this does not silently overwrite a separate PNG file on your computer. This build does not add a playable character controller.

## Validation

Automated geometry/export checks: `node tools/test_blockout.js` (no dependencies).

Simulated-browser interaction checks: install `jsdom@26` and `pngjs@7` as development dependencies, then run `node tools/test_blockout_ui.cjs`. These exercise actual application handlers, geometry, processing, project roundtrips, and PNG data, with canvas/WebGL calls mocked.

The build passed 8 geometry/export checks and 11 simulated-browser checks. A real browser could not launch in the build environment, so WebGL appearance and interaction feel still need a local Chrome/Edge/Firefox check. Extract the complete ZIP and open `index.html` to run the tool; no test dependencies are needed for normal use.
