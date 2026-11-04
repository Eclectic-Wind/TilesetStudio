# The Aseprite link

Paint in Aseprite and see it on your models straight away. It works with or without animation. Press **L** and pick the **Aseprite link** tab for short visual lessons.

## Connect, step by step

You need Aseprite 1.3 or newer.

1. **Install the extension (once).** Studio's *Aseprite ▾* menu has the download. Double-click the file.
2. **Press Link online** in the same menu.
3. **Choose which art to keep:** this tileset or the Aseprite file. The other one gets replaced, except that your models always stay. Not sure? Link with a new, empty Aseprite file and keep the tileset. Studio only asks when a tileset is open.
4. **Paste the code into Aseprite.** Press *Copy* in Studio, open your file in Aseprite, then go to *File ▸ Scripts ▸ Tileset Studio Link (online)…*, paste and press *Link*.
5. **Press Set up file** in Aseprite's link window, then paint inside the group called **Albedo**. Keep that window open while you paint.

Next time, repeat steps 2 to 4. Aseprite remembers the code, so you only press *Link*.

## The words

- **Reference:** what Studio sends to Aseprite as the locked layer **Normal (Studio)**, a guide under your painting: the models' base
  colours (the colours an imported model came with), else the tileset art on them, grey where they have neither. (It used to be the normal map, hence the layer's name.)
- **Albedo:** the plain colours you paint, without lighting. Only the **Albedo** group goes back to Studio.
- **Room code:** how the two programs find each other online. Treat it like a password.
- **Relay:** the small online service that passes pictures between the two programs.

## If something looks wrong

The dot by the *Aseprite ▾* menu is grey when not linked, orange while waiting for Aseprite, green when all is well and red when something needs a look. Open the menu to see what's wrong.

| What you see | What to do |
|---|---|
| The dot stays orange | Aseprite hasn't joined. Check the extension is installed, run the script and paste the code shown in the menu. |
| "No group named Albedo" or "not in RGB colour" | Press **Set up file** in Aseprite's link window. |
| "Studio's tiles are … but this canvas is …" | Press **Fit canvas** in Aseprite's link window. |
| Painting doesn't reach Studio | Paint inside the Albedo group and keep Aseprite's link window open. Closing it stops the link. |
| "Not a power of two" | Use a tile size of 16, 32, 64, 128 and so on. |
| Asked to update the extension | Download it again from the menu and double-click it. |

## Reference

## Frames in Aseprite

The Aseprite sprite is **one tile big** (the size of your tileset) and every animation frame is a **real frame on Aseprite's timeline**.

- **Each clip has its own frames**, marked by a tag named `<clip name> [<clip id>]` (extension 1.3 or newer). Pick another clip in Studio and the
  link moves to its tag; the other clips' frames are not touched. A clip seen for the first time takes the frames already there if the file has no
  tags yet, else a new empty range at the end (nothing is sent back until you paint in it, so the sheet Studio keeps for the clip is safe). Keep the tag's `[id]`; a deleted clip's tag and frames stay until you remove them.
- **Studio to Aseprite.** Studio's normal map appears on each frame in the locked layer **Normal (Studio)**. Change the frame count in Studio and
  Aseprite adds or removes frames at the end of the clip's tag (one undo step there). The frame length follows the clip's fps.
- **Aseprite to Studio.** Paint each frame inside the group **Albedo**. The extension lays every frame out in Studio's sheet grid and sends it.
- **Adding and deleting frames in Aseprite** changes the clip in Studio: a **deleted** frame takes its key with it and later keys move up one;
  an **inserted** (or duplicated) frame pushes later keys down. Studio works out which frame it was by comparing frame contents, so a frame that is
  an exact copy of its neighbour is matched to the later one. Reordering frames by dragging is not tracked.
- **Not in animation mode?** Only frame 1 is linked and your timeline is left alone.

## How the shared folder link works

Both programs watch one folder. This works from a GitHub Pages / https page; the folder picker needs Chrome or Edge.

| Direction | File | Content |
|---|---|---|
| Studio → Aseprite | `normal.png`, `studio_link.json` | the normal sheet; the json (written last) has `rev` and the sheet size |
| Aseprite → Studio | `albedo.png` | the flattened group named **Albedo**, saved on every edit that changes it |
| Aseprite → Studio | `aseprite_status.json` | the extension's heartbeat: file name, size, frames, anything wrong |

**Presence.** The *Aseprite ▾* menu ticks off each step of the link and shows anything wrong on Aseprite's side (no Albedo group, wrong
colour mode, wrong canvas size); a toast says when Aseprite joins or leaves, and the dot is green only while Aseprite is really there.
Studio takes pictures only from an extension that is there now, so an `albedo.png` or a relay picture left from an earlier session can
never overwrite the tileset art. An older extension is told to update (its pictures are ignored).

**Setup**
1. Install `tools/aseprite/TilesetStudioLink.aseprite-extension` (double-click it, or Edit ▸ Preferences ▸ Extensions ▸ Add Extension). Needs Aseprite 1.3+.
2. In Studio: *Aseprite ▾ ▸ Link a shared folder…* (*Link Aseprite…* in the Animate panel opens the same menu) and pick an empty folder. Studio writes `normal.png` and `studio_link.json` into it.
3. In Aseprite, open your file (with none open, the extension offers a new one), then *File ▸ Scripts ▸ Tileset Studio Link…* and
   pick any file in that folder. A layer **Normal (Studio)** appears (locked, kept up to date as you change the rig).
4. Press **Set up file** in the link window: it switches the file to RGB and puts the layers already there into a group called **Albedo**
   (one undo step). Draw in that group. Each edit is flattened and sent; Studio shows it in the preview.

**Canvas rule.** The Aseprite canvas must be exactly one tile (Studio's tileset size), and the sheet it builds must be a power of two
(16, 32, 64, 128 ... per cell; 2^n columns and rows). If it is not, Studio shows a red warning and **keeps the previous page**; the extension
warns too. Fix the canvas and the next edit goes through.

### Online link (any browser, including Firefox / Zen)

The folder picker is Chromium-only, so there is a second transport that needs no folder access. Studio (in the browser) and the
extension (in Aseprite) both **dial out** to a tiny relay (`tools/relay`, a Cloudflare Worker) and share a random room code. The relay
only forwards the PNGs and keeps the latest until everyone has left, then deletes it.

**Online, updates are manual.** The relay runs on Cloudflare's free plan, and every message counts against its daily quota, so
only the first picture of a connection goes out by itself. After that, press **Send now** in Aseprite's link window to send your
Albedo (and any frames you added or deleted), and **Send normal map now** in Studio's *Aseprite ▾* menu to send the normal map. Tick
**Send every edit** in Aseprite's link window to go back to live updates (it uses up the quota much faster). The folder link costs
nothing and stays live. The relay hibernates between messages (Cloudflare's WebSocket Hibernation), and Studio pings only every 30 s.

1. **Requirements:** Aseprite **1.3 or newer** (the extension uses its Lua `WebSocket` API) and the extension
   [`TilesetStudioLink.aseprite-extension`](../tools/aseprite/TilesetStudioLink.aseprite-extension) (double-click to install, or
   Edit ▸ Preferences ▸ Extensions ▸ Add Extension). The same download link is in Studio's *Aseprite ▾* menu.
2. In Studio: *Aseprite ▾ ▸ Link online (any browser)* and copy the room code.
3. In Aseprite: *File ▸ Scripts ▸ Tileset Studio Link (online)…*, paste the room code, *Link*. The rest is as above (layer
   **Normal (Studio)**, group **Albedo**).

The room code is the only secret: anyone with it can read and send pictures in that room, so treat it like a password. It is kept
in the browser between visits; **Use a new room code** swaps it for a fresh random one at once, cutting off the old code, and you
paste the new one into Aseprite. Deploying your
own relay: `cd tools/relay && npx wrangler login && npx wrangler deploy`, then put its address in `L.RELAY` (js/aseprite.js) and `RELAY`
(the extension's plugin.lua).

The non-animated tileset uses the same link: the *Aseprite ▾* menu in the top bar sends the tileset's normal map and can take
Aseprite's `albedo.png` back as the tileset art.

**No link at all:** use *Download normal sheet* and *Load albedo sheet…* (same size checks).

Tests: `node tools/test_link.js` covers Studio's side of the link and `tools/aseprite/test_headless.lua` runs the extension in Aseprite's batch mode. Aseprite's WebSocket and dialogs don't run in batch mode, so those follow the documented 1.3 API.
