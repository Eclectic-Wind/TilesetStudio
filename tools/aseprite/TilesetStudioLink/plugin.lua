-- Tileset Studio Link for Aseprite (1.3 or newer).
--
-- Studio -> Aseprite: normal.png (the normal-map spritesheet) is shown as a locked layer "Normal (Studio)" under your art.
-- Aseprite -> Studio: every edit flattens the group named "Albedo" and saves it as albedo.png in the shared folder.
-- Both programs watch the same folder; pick it here and in Studio (Animate > Link Aseprite folder).
--
-- Canvas rule: the sprite must be a power-of-two size (and the same size as Studio's sheet). If the canvas changes size, Studio
-- shows a warning and keeps the previous page until the canvas matches again.

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

local function readRev(folder)
  local f = io.open(join(folder, "studio_link.json"), "r")
  if not f then return nil end
  local text = f:read("a")
  f:close()
  local rev = text:match('"rev"%s*:%s*(%d+)')
  local w, h = text:match('"sheet"%s*:%s*%[%s*(%d+)%s*,%s*(%d+)')
  return rev and tonumber(rev), w and tonumber(w), h and tonumber(h)
end

local function say(text)
  if state and state.dlg then state.dlg:modify{ id = "status", text = text } end
end

local function exportAlbedo()
  local sprite = state.sprite
  local group = findGroup(sprite.layers, ALBEDO_GROUP)
  if not group then say("No group named Albedo. Create one and paint inside it.") return end
  if sprite.colorMode ~= ColorMode.RGB then say("Use RGB colour mode (Sprite > Color Mode).") return end
  local img = Image(sprite.width, sprite.height, ColorMode.RGB)
  drawLayer(img, group, 1)
  img:saveAs(join(state.folder, "albedo.png"))
  if not (isPow2(sprite.width) and isPow2(sprite.height)) then
    say("Sent, but " .. sprite.width .. "x" .. sprite.height .. " is not a power of two: Studio will refuse it.")
  elseif state.sheetW and (state.sheetW ~= sprite.width or state.sheetH ~= sprite.height) then
    say("Sent, but Studio's sheet is " .. state.sheetW .. "x" .. state.sheetH .. ": Studio keeps its previous page.")
  else
    say("Sent Albedo " .. sprite.width .. "x" .. sprite.height .. " to Studio.")
  end
end

local function importNormal()
  local sprite = state.sprite
  local img = Image{ fromFile = join(state.folder, "normal.png") }
  if not img then return end
  if img.width ~= sprite.width or img.height ~= sprite.height then
    say("Studio's sheet is " .. img.width .. "x" .. img.height .. " but this canvas is " .. sprite.width .. "x" .. sprite.height .. ". Resize the canvas (Sprite > Canvas Size) to match.")
    return
  end
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
    local old = layer:cel(1)
    if old then sprite:deleteCel(old) end
    sprite:newCel(layer, 1, img, Point(0, 0))
    layer.isEditable = false
  end)
  state.ignore = false
  state.dirty = false
  app.refresh()
  say("Received Studio's normal map (rev " .. tostring(state.rev) .. ").")
end

local function stop()
  if not state then return end
  if state.timer then state.timer:stop() end
  if state.sprite and state.listener then pcall(function() state.sprite.events:off(state.listener) end) end
  state = nil
end

local function start(folder)
  local sprite = app.sprite
  if not sprite then app.alert("Open the spritesheet first.") return end
  stop()
  state = { sprite = sprite, folder = folder, dirty = true, rev = 0 }
  state.listener = sprite.events:on("change", function()
    if state and not state.ignore then state.dirty = true end
  end)
  state.dlg = Dialog{ title = "Tileset Studio Link", onclose = stop }
  state.dlg:label{ id = "folder", text = "Folder: " .. folder }
  state.dlg:label{ id = "status", text = "Linked. Paint in the group named Albedo." }
  state.dlg:button{ text = "Send now", onclick = function() exportAlbedo() end }
  state.dlg:button{ text = "Stop", onclick = function() state.dlg:close() end }
  state.dlg:show{ wait = false }
  state.timer = Timer{ interval = 0.3, ontick = function()
    if not state then return end
    local ok, err = pcall(function()
      local rev, w, h = readRev(state.folder)
      if w then state.sheetW, state.sheetH = w, h end
      if rev and rev ~= state.rev then
        state.rev = rev
        importNormal()
      end
      if state.dirty then
        state.dirty = false
        exportAlbedo()
      end
    end)
    if not ok then say("Error: " .. tostring(err)) end
  end }
  state.timer:start()
end

function init(plugin)
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
