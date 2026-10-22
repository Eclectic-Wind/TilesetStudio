-- Tileset Studio Link for Aseprite (1.3 or newer).
--
-- Studio -> Aseprite: its normal-map sheet is shown as a locked layer "Normal (Studio)" under your art, one cel per timeline frame.
-- Aseprite -> Studio: every edit flattens the group named "Albedo" (all frames) into one sheet and sends it as albedo.png.
--
-- The sprite is ONE TILE big (the size of Studio's tileset) and each Studio animation frame is a real frame on the timeline.
-- Studio's frame count drives the timeline (Studio adds / removes frames), and adding or deleting frames here changes Studio's
-- clip: a deleted frame in the middle takes its key with it and later keys move up.
-- (If Studio is not in animation mode, only frame 1 is linked and your frames are left alone.)
--
-- Two ways to link: a shared folder (Chrome / Edge in Studio), or "Tileset Studio Link (online)...", where both programs dial out to a
-- small relay with a shared room code, so Studio can run in any browser. Needs Aseprite 1.3 or newer (WebSocket support).

local ALBEDO_GROUP = "albedo"
local NORMAL_LAYER = "Normal (Studio)"
local state = nil

local function join(folder, name)
  return app.fs.joinPath(folder, name)
end

local function isPow2(n)
  return n >= 1 and (n & (n - 1)) == 0
end

local function findGroup(layers, wanted)
  for _, layer in ipairs(layers) do
    if layer.isGroup then
      if string.lower(layer.name) == wanted then return layer end
      local inner = findGroup(layer.layers, wanted)
      if inner then return inner end
    end
  end
  return nil
end

-- Draw a layer (or a group's children, bottom to top) onto img, skipping hidden ones.
local function drawLayer(img, layer, frame)
  if not layer.isVisible then return end
  if layer.isGroup then
    for _, child in ipairs(layer.layers) do drawLayer(img, child, frame) end
    return
  end
  local cel = layer:cel(frame)
  if not cel then return end
  local opacity = ((layer.opacity or 255) * (cel.opacity or 255)) // 255
  img:drawImage(cel.image, cel.position, opacity, layer.blendMode or BlendMode.NORMAL)
end

local function pow2up(n)
  local p = 1
  while p < n do p = p * 2 end
  return p
end

-- Same grid Studio uses: power-of-two columns and rows, frame by frame in reading order.
local function layoutFor(frames)
  local cols = pow2up(math.ceil(math.sqrt(frames)))
  return cols, pow2up(math.ceil(frames / cols))
end

-- studio_link.json / the relay's meta message.
local function parseMeta(text)
  local rev = text:match('"rev"%s*:%s*(%d+)')
  if not rev then return nil end
  local sw, sh = text:match('"sheet"%s*:%s*%[%s*(%d+)%s*,%s*(%d+)')
  local cw, ch = text:match('"cell"%s*:%s*%[%s*(%d+)%s*,%s*(%d+)')
  return {
    rev = tonumber(rev), sheetW = tonumber(sw), sheetH = tonumber(sh), cw = tonumber(cw), ch = tonumber(ch),
    cols = tonumber(text:match('"cols"%s*:%s*(%d+)')) or 1, rows = tonumber(text:match('"rows"%s*:%s*(%d+)')) or 1,
    frames = tonumber(text:match('"frames"%s*:%s*(%d+)')) or 1, fps = tonumber(text:match('"fps"%s*:%s*(%d+)')),
    anim = text:find('"anim"%s*:%s*true') ~= nil,
    art = text:find('"art"%s*:%s*true') ~= nil,
    adopt = text:find('"adopt"%s*:%s*true') ~= nil,
    origin = text:match('"origin"%s*:%s*"(%a+)"'),
  }
end

local function readMeta(folder)
  local f = io.open(join(folder, "studio_link.json"), "r")
  if not f then return nil end
  local text = f:read("a")
  f:close()
  return parseMeta(text)
end

-- A problem with Studio's picture stays on screen (the Albedo messages that follow must not bury it) until the next import works.
local function say(text, problem)
  if not state then return end
  if problem then state.problem = text elseif state.problem then return end
  if state.dlg then state.dlg:modify{ id = "status", text = text } end
end

-- The link is bound to ONE sprite: the one active when it was started. Other open files are never read or changed. Edits made by the
-- link switch to that sprite for a moment (Aseprite records undo steps on the active file) and then back.
local function onSprite(fn, ...)
  local prev = app.sprite
  if prev ~= state.sprite then app.sprite = state.sprite end
  local res = table.pack(pcall(fn, ...))
  if prev and prev ~= state.sprite then pcall(function() app.sprite = prev end) end
  if not res[1] then error(res[2], 0) end
  return table.unpack(res, 2, res.n)
end

-- Aseprite's WebSocket has no TLS on Windows ("TLS support is not enabled on this platform"), so this leg must be plain ws://.
-- Studio (the browser) still uses wss://; only the Aseprite <-> relay hop is unencrypted.
local RELAY = "ws://tileset-studio-relay.tileset-studio.workers.dev"
local TMP = function(name) return app.fs.joinPath(app.fs.tempPath, name) end

-- Relay frames: [kind][index][count][png bytes], chunks of <= 60 KB. kind 1 = Studio's normal.png, 2 = our albedo.png.
local function relaySendAlbedo(img)
  if not state.online then say("Not connected to the relay yet. Waiting...") state.dirty = true return false end
  local path = TMP("tileset_studio_albedo.png")
  img:saveAs(path)
  local f = io.open(path, "rb")
  local bytes = f:read("a")
  f:close()
  local CH = 60000
  local count = math.max(1, (#bytes + CH - 1) // CH)
  if count > 255 then say("Too big for the relay.") return false end
  for i = 0, count - 1 do
    state.ws:sendBinary(string.char(2, i, count) .. bytes:sub(i * CH + 1, (i + 1) * CH))
  end
  return true
end

local function relayReceive(mt, data, err)
  if mt == WebSocketMessageType.OPEN then
    state.online = true
    state.dirty = true
    say("Online in room " .. state.room .. ". Waiting for Studio.")
  elseif mt == WebSocketMessageType.CLOSE or mt == WebSocketMessageType.ERROR then
    state.online = false
    say("Relay not connected" .. ((err and err ~= "") and (": " .. err) or "") .. ". Retrying...")
  elseif mt == WebSocketMessageType.TEXT then
    -- Older Studio builds sent the layout without a "t" tag, so anything that parses as a layout and is not a frames message counts.
    if not data:find('"t"%s*:%s*"frames"') then
      local meta = parseMeta(data)
      if meta then state.meta = meta end
    end
  elseif mt == WebSocketMessageType.BINARY and #data >= 3 and data:byte(1) == 3 then
    -- kind 3: the tileset's art, sent once when linking
    local idx, count = data:byte(2), data:byte(3)
    if idx == 0 then state.artParts = {} end
    if not state.artParts or idx ~= #state.artParts then return end
    state.artParts[#state.artParts + 1] = data:sub(4)
    if #state.artParts == count then
      local path = TMP("tileset_studio_art.png")
      local f = io.open(path, "wb")
      f:write(table.concat(state.artParts))
      f:close()
      state.artParts = nil
      state.artPath = path
    end
  elseif mt == WebSocketMessageType.BINARY and #data >= 3 and data:byte(1) == 1 then
    local idx, count = data:byte(2), data:byte(3)
    if idx == 0 then state.parts = {} end
    if not state.parts or idx ~= #state.parts then return end
    state.parts[#state.parts + 1] = data:sub(4)
    if #state.parts == count then
      local path = TMP("tileset_studio_normal.png")
      local f = io.open(path, "wb")
      f:write(table.concat(state.parts))
      f:close()
      state.parts = nil
      state.normalPath = path
    end
  end
end

-- The sheet Studio expects: every frame's flattened Albedo group in its grid cell. Without animation (or before Studio has said
-- anything) that is just frame 1.
local sendFrames
local function exportAlbedo()
  local sprite = state.sprite
  local group = findGroup(sprite.layers, ALBEDO_GROUP)
  if not group then say("No group named Albedo. Create one and paint inside it.") return end
  if sprite.colorMode ~= ColorMode.RGB then say("Use RGB colour mode (Sprite > Color Mode).") return end
  local meta = state.meta
  local anim = meta and meta.anim
  local n = anim and #sprite.frames or 1
  local cw, ch = sprite.width, sprite.height
  local function deliver(sheet)
    if state.ws then return relaySendAlbedo(sheet) end
    sheet:saveAs(join(state.folder, "albedo.png"))
    return true
  end
  if meta and meta.adopt then
    -- This file starts the project: send one tile (frame 1) and the frame count; Studio takes its size and timeline from them.
    local tile = Image(cw, ch, ColorMode.RGB)
    drawLayer(tile, group, 1)
    if not deliver(tile) then return end
    sendFrames({}, #sprite.frames)
    say("Sent this file to Studio as the starting point (" .. cw .. "x" .. ch .. ", " .. #sprite.frames .. " frame" .. (#sprite.frames == 1 and "" or "s") .. ").")
    return
  end
  if anim then
    if meta.frames ~= n then say("Waiting for Studio to catch up on the frame count...") return end
    if meta.cw ~= cw or meta.ch ~= ch then
      say("Studio's tiles are " .. tostring(meta.cw) .. "x" .. tostring(meta.ch) .. " but this canvas is " .. cw .. "x" .. ch .. ". Resize the canvas (Sprite > Canvas Size) to one tile.")
      return
    end
  end
  local cols, rows = 1, 1
  if anim then cols, rows = meta.cols, meta.rows end
  local sheet = Image(cols * cw, rows * ch, ColorMode.RGB)
  for f = 1, n do
    local img = Image(cw, ch, ColorMode.RGB)
    drawLayer(img, group, f)
    sheet:drawImage(img, Point(((f - 1) % cols) * cw, ((f - 1) // cols) * ch))
  end
  if not deliver(sheet) then return end
  if anim and not (isPow2(sheet.width) and isPow2(sheet.height)) then
    say("Sent, but the " .. sheet.width .. "x" .. sheet.height .. " sheet is not a power of two: Studio will refuse it. Use a power-of-two tile size.")
  else
    say("Sent Albedo (" .. n .. (n == 1 and " frame, " or " frames, ") .. sheet.width .. "x" .. sheet.height .. ") to Studio.")
  end
end

-- One content snapshot per frame (every layer), to tell which frame was added or deleted when the count changes.
local function frameBytes(sprite, i)
  local img = Image(sprite.spec)
  img:drawSprite(sprite, i)
  return img.bytes
end

local function snapshotFrames()
  local list = {}
  for i = 1, #state.sprite.frames do list[i] = frameBytes(state.sprite, i) end
  state.hashes, state.nframes = list, #list
  return list
end

-- What happened between two frame lists, as Studio's ops, applied one after another: {op = "del"|"ins", i = 0-based index}.
-- Frames are matched in order by content; if that does not add up (edited and re-ordered at once) the end frames are taken.
local function frameOps(old, new)
  local ops, i, j = {}, 1, 1
  if #new < #old then
    while i <= #old do
      if j <= #new and old[i] == new[j] then i, j = i + 1, j + 1
      else ops[#ops + 1] = { op = "del", i = j - 1 }; i = i + 1 end
    end
    if #ops ~= #old - #new then
      ops = {}
      for k = 1, #old - #new do ops[#ops + 1] = { op = "del", i = #old - k } end
    end
  elseif #new > #old then
    while j <= #new do
      if i <= #old and old[i] == new[j] then i, j = i + 1, j + 1
      else ops[#ops + 1] = { op = "ins", i = j - 1 }; j = j + 1 end
    end
    if #ops ~= #new - #old then
      ops = {}
      for k = 1, #new - #old do ops[#ops + 1] = { op = "ins", i = #old + k - 1 } end
    end
  end
  return ops
end

function sendFrames(ops, n)
  local parts = {}
  for _, o in ipairs(ops) do parts[#parts + 1] = string.format('{"op":"%s","i":%d}', o.op, o.i) end
  if state.ws then
    if state.online then state.ws:sendText(string.format('{"t":"frames","n":%d,"ops":[%s]}', n, table.concat(parts, ","))) end
  else
    state.framesRev = state.framesRev + 1
    local f = io.open(join(state.folder, "aseprite_frames.json"), "w")
    f:write(string.format('{"t":"frames","rev":%d,"n":%d,"ops":[%s]}', state.framesRev, n, table.concat(parts, ",")))
    f:close()
  end
end

-- The frame count changed here (or by hand): tell Studio what happened. Returns true if Studio now has to answer with a new sheet.
local function syncFrames()
  local sprite = state.sprite
  local old, n = state.hashes or {}, #sprite.frames
  local ops = nil
  if n ~= state.nframes and state.meta and state.meta.anim then
    local list = {}
    for i = 1, n do list[i] = frameBytes(sprite, i) end
    ops = frameOps(old, list)
  end
  snapshotFrames()
  if ops and #ops > 0 then
    sendFrames(ops, n)
    say("Frames changed here (" .. n .. " now): telling Studio...")
    return true
  end
  return false
end

-- Studio's frame count wins when Studio changes it: frames are added / removed at the end (one undo step in Aseprite).
local function ensureFrames(target, fps)
  local sprite = state.sprite
  target = math.max(1, math.min(64, target))
  local changed = #sprite.frames ~= target
  state.ignore = true
  app.transaction("Tileset Studio frames", function()
    while #sprite.frames < target do sprite:newEmptyFrame(#sprite.frames + 1) end
    while #sprite.frames > target do sprite:deleteFrame(#sprite.frames) end
    if fps and fps > 0 then
      for _, fr in ipairs(sprite.frames) do fr.duration = 1 / fps end
    end
  end)
  state.ignore = false
  return changed
end

local function importNormal(path)
  local sprite = state.sprite
  local meta = state.meta
  local sheet = Image{ fromFile = path or join(state.folder, "normal.png") }
  if not sheet then say("Could not read Studio's normal map picture.", true) return false end
  local anim = meta and meta.anim
  local cw, ch = (meta and meta.cw) or sheet.width, (meta and meta.ch) or sheet.height
  local cols = (meta and meta.cols) or 1
  if cw ~= sprite.width or ch ~= sprite.height then
    state.pending = path
    say("Studio sent its normal map, but its tiles are " .. cw .. "x" .. ch .. " and this canvas is " .. sprite.width .. "x" .. sprite.height .. ". Press \"Fit canvas\" (or use Sprite > Canvas Size) to make the canvas one tile.", true)
    return false
  end
  state.problem, state.pending = nil, nil
  local framesChanged = false
  if anim then framesChanged = ensureFrames(meta.frames, meta.fps) end
  local count = anim and #sprite.frames or 1
  state.ignore = true
  app.transaction("Tileset Studio normals", function()
    local layer
    for _, l in ipairs(sprite.layers) do
      if l.name == NORMAL_LAYER then layer = l end
    end
    if not layer then
      layer = sprite:newLayer()
      layer.name = NORMAL_LAYER
      pcall(function() layer.stackIndex = 1 end)
    end
    layer.isEditable = true
    for f = 1, count do
      local cell = Image(cw, ch, ColorMode.RGB)
      cell:drawImage(sheet, Point(-((f - 1) % cols) * cw, -((f - 1) // cols) * ch))
      local old = layer:cel(f)
      if old then sprite:deleteCel(old) end
      sprite:newCel(layer, f, cell, Point(0, 0))
    end
    layer.isEditable = false
  end)
  state.ignore = false
  snapshotFrames()
  -- After a frame change here Studio answers with a fresh sheet; then our Albedo can go out again. A frame count that Studio
  -- changed needs a new Albedo sheet too. Otherwise the pictures did not change and nothing is sent.
  -- Switching Studio to or from animation changes the sheet layout Studio expects, so the Albedo has to go out again.
  local layout = table.concat({ tostring(anim), tostring(cw), tostring(ch), tostring(cols), tostring(count) }, ",")
  local layoutChanged = layout ~= state.layout
  state.layout = layout
  if state.awaiting or framesChanged or layoutChanged then state.awaiting = nil; state.dirty = true else state.dirty = false end
  app.refresh()
  say("Received Studio's normal map (rev " .. tostring(state.rev) .. (anim and (", " .. count .. " frames") or "") .. ") as layer \"" .. NORMAL_LAYER .. "\".")
  return true
end

-- Studio sent the tileset's art (once per link, when the user chose to overwrite Aseprite's): it becomes the TOP layer "Studio art" of the
-- Albedo group (the group is made if missing), on frame 1, covering what Aseprite had.
local function importArt(path)
  local sprite = state.sprite
  local pic = Image{ fromFile = path }
  if not pic then say("Could not read the tileset's art picture.", true) return end
  state.artDone = true
  state.ignore = true
  app.transaction("Tileset Studio art", function()
    local group = findGroup(sprite.layers, ALBEDO_GROUP)
    if not group then
      group = sprite:newGroup()
      group.name = "Albedo"
    end
    local function clear(layers)
      for _, l in ipairs(layers) do
        if l.isGroup then clear(l.layers)
        else local c = l:cel(1) if c then sprite:deleteCel(c) end end
      end
    end
    clear(group.layers) -- Studio's project starts the link: frame 1 of the group is overwritten
    local layer = sprite:newLayer()
    layer.name = "Studio art"
    layer.parent = group
    pcall(function() layer.stackIndex = #group.layers end) -- the top of the group, so it covers what Aseprite had
    local cel = Image(sprite.width, sprite.height, ColorMode.RGB)
    cel:drawImage(pic, Point(0, 0))
    sprite:newCel(layer, 1, cel, Point(0, 0))
  end)
  state.ignore = false
  state.dirty = true
  app.refresh()
  say("Received the tileset's art as layer \"Studio art\" in the Albedo group.")
end

-- Make the canvas exactly one tile (keeps the art at the top left), then bring in the normal map that was waiting.
local function fitCanvas()
  local meta = state and state.meta
  if not meta or not meta.cw then say("Nothing from Studio yet.", true) return end
  onSprite(function() state.sprite:crop(0, 0, meta.cw, meta.ch) end)
  state.problem = nil
  if state.pending or state.ws == nil then onSprite(importNormal, state.pending) end
  state.dirty = true
end

local function stop()
  if not state then return end
  if state.timer then state.timer:stop() end
  if state.ws then pcall(function() state.ws:close() end) end
  if state.sprite and state.listener then pcall(function() state.sprite.events:off(state.listener) end) end
  state = nil
end

local function start(folder, relay)
  local sprite = app.sprite
  if not sprite then app.alert("Open the spritesheet first.") return end
  stop()
  state = { sprite = sprite, folder = folder, dirty = true, rev = 0, framesRev = os.time() * 100 }
  snapshotFrames()
  if relay then
    state.room = relay.room
    state.ws = WebSocket{ url = relay.url .. "/r/" .. relay.room, deflate = false, onreceive = function(mt, data, err)
      if state then relayReceive(mt, data, err) end
    end }
  end
  state.listener = sprite.events:on("change", function()
    if state and not state.ignore then state.dirty = true end
  end)
  if not (rawget(_G, "TSL_TEST") and TSL_TEST.headless) then
    state.dlg = Dialog{ title = "Tileset Studio Link", onclose = stop }
    state.dlg:label{ text = "File: " .. ((sprite.filename and sprite.filename ~= "") and app.fs.fileName(sprite.filename) or "(unsaved sprite)") .. "  (only this file is linked)" }
    state.dlg:label{ id = "folder", text = relay and ("Room: " .. relay.room) or ("Folder: " .. folder) }
    state.dlg:label{ id = "status", text = "Linked. Paint in the group named Albedo." }
    state.dlg:button{ text = "Send now", onclick = function() local ok, err = pcall(exportAlbedo) if not ok then say("Error: " .. tostring(err)) end end }
    state.dlg:button{ text = "Fit canvas", onclick = function() local ok, err = pcall(fitCanvas) if not ok then say("Error: " .. tostring(err), true) end end }
    state.dlg:button{ text = "Stop", onclick = function() state.dlg:close() end }
    state.dlg:show{ wait = false }
  end
  if state.ws then state.ws:connect() end
  state.tick = function()
    if not state then return end
    local ok, err = pcall(function()
      local alive = false
      for _, s in ipairs(app.sprites) do if s == state.sprite then alive = true end end
      if not alive then
        local dlg = state.dlg
        if dlg then dlg:close() else stop() end
        app.alert("Tileset Studio Link stopped: the linked file was closed.")
        return
      end
      -- Studio -> Aseprite
      local m = state.meta
      if m and m.origin == "studio" and m.cw and not state.fitted then
        -- Studio's project starts the link: this file's canvas becomes exactly one Studio tile.
        state.fitted = true
        if m.cw ~= state.sprite.width or m.ch ~= state.sprite.height then
          state.ignore = true
          onSprite(function() state.sprite:crop(0, 0, m.cw, m.ch) end)
          state.ignore = false
          state.dirty = true
          if not state.ws then state.rev = 0 end -- the normal map that was refused for the old size is read again
        end
      end
      if state.pending and m and m.cw == state.sprite.width and m.ch == state.sprite.height then
        onSprite(importNormal, state.pending) -- the canvas was resized by hand: the waiting normal map can go in now
      end
      if state.meta and state.meta.art and not state.artDone then
        local artPath = state.ws and state.artPath or join(state.folder, "art.png")
        local exists = state.ws and state.artPath
        if not state.ws then local f = io.open(artPath, "rb") if f then f:close() exists = true end end
        if exists and state.sprite.width == state.meta.cw and state.sprite.height == state.meta.ch then
          state.artPath = nil
          onSprite(importArt, artPath)
        end
      end
      if state.ws then
        if state.normalPath and state.meta and state.meta.adopt then
          state.normalPath = nil -- this file starts the project: a normal map left in the relay's cache is stale
        elseif state.normalPath and state.meta then
          local path = state.normalPath
          state.normalPath = nil
          state.rev = state.rev + 1
          onSprite(importNormal, path)
        end
      else
        local meta = readMeta(state.folder)
        if meta then
          state.meta = meta
          if meta.rev ~= state.rev then
            state.rev = meta.rev
            onSprite(importNormal)
          end
        end
      end
      -- Aseprite -> Studio
      if state.meta and not state.artWait then state.artWait = os.clock() + 10 end -- how long to wait for Studio's art before sending ours
      if state.dirty and not state.ignore and state.meta and not (state.meta.origin == "studio" and state.meta.art and not state.artDone and os.clock() < state.artWait) then
        state.dirty = false
        if syncFrames() then state.awaiting = os.clock() + 6
        elseif not state.awaiting then exportAlbedo() end
      end
      if state.awaiting and os.clock() > state.awaiting then state.awaiting = nil; state.dirty = true end
    end)
    if not ok then say("Error: " .. tostring(err), true) end
  end
  state.timer = Timer{ interval = 0.3, ontick = state.tick }
  state.timer:start()
end

local function relayCommand(plugin)
  local dlg = Dialog("Tileset Studio Link (online)")
  dlg:label{ text = "Copy the room code from Studio (Aseprite menu > Link online), then press Link." }
  dlg:entry{ id = "room", label = "Room code:", text = plugin.preferences.room or "" }
  dlg:entry{ id = "url", label = "Relay:", text = plugin.preferences.relay or RELAY }
  dlg:button{ id = "ok", text = "Link", focus = true }
  dlg:button{ text = "Cancel" }
  dlg:show()
  local data = dlg.data
  local room = data.room and data.room:lower():gsub("%s", "") or ""
  if data.ok and room ~= "" then
    plugin.preferences.room, plugin.preferences.relay = room, data.url
    local url = data.url:gsub("/+$", ""):gsub("^wss://", "ws://") -- no TLS in Aseprite's WebSocket
    start(nil, { room = room, url = url })
  end
end

function init(plugin)
  plugin:newCommand{
    id = "TilesetStudioLinkOnline",
    title = "Tileset Studio Link (online)...",
    group = "file_scripts",
    onclick = function() relayCommand(plugin) end
  }
  plugin:newCommand{
    id = "TilesetStudioLink",
    title = "Tileset Studio Link...",
    group = "file_scripts",
    onclick = function()
      local dlg = Dialog("Tileset Studio Link")
      dlg:label{ text = "Pick any file inside the shared folder (the one you linked in Studio)." }
      dlg:file{ id = "pick", label = "File:", open = true, filename = plugin.preferences.picked or "",
                filetypes = { "json", "png" } }
      dlg:button{ id = "ok", text = "Link", focus = true }
      dlg:button{ text = "Cancel" }
      dlg:show()
      local data = dlg.data
      if data.ok and data.pick and data.pick ~= "" then
        plugin.preferences.picked = data.pick
        start(app.fs.filePath(data.pick))
      end
    end
  }
end

function exit(plugin)
  stop()
end

-- Headless tests drive these through a global table; it is absent in normal use.
if rawget(_G, "TSL_TEST") then
  TSL_TEST.api = {
    layoutFor = layoutFor, parseMeta = parseMeta, frameOps = frameOps, frameBytes = frameBytes,
    start = start, tick = function() state.tick() end, fitCanvas = fitCanvas, setState = function(v) state = v end, getState = function() return state end,
    exportAlbedo = exportAlbedo, importNormal = importNormal, syncFrames = syncFrames, ensureFrames = ensureFrames, snapshotFrames = snapshotFrames,
  }
end
