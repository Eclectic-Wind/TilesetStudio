-- Runs the extension in Aseprite's batch mode, against a real sprite and folder.
-- Usage: Aseprite.exe -b --script-param folder=<an empty folder> --script-param plugin=<plugin.lua> --script tools/aseprite/test_headless.lua
-- Prints one line per test and "N passed, M failed" at the end. WebSocket and dialogs don't run here; a fake socket stands in.

local folder, pluginPath = app.params.folder, app.params.plugin
TSL_TEST = { headless = true }
dofile(pluginPath)
local api = TSL_TEST.api

local passed, failed = 0, 0
local function test(name, fn)
  local ok, err = pcall(fn)
  if ok then passed = passed + 1; print("  ok  " .. name)
  else failed = failed + 1; print("FAIL  " .. name .. "\n      " .. tostring(err)) end
end
local function path(name) return app.fs.joinPath(folder, name) end
local function read(name)
  local f = io.open(path(name), "rb")
  if not f then return nil end
  local text = f:read("a")
  f:close()
  return text
end
local function write(name, text)
  local f = io.open(path(name), "wb")
  f:write(text)
  f:close()
end
local function meta(fields) write("studio_link.json", fields) end
local function paint(sprite, x)
  local layer = sprite.layers[1].isGroup and sprite.layers[1].layers[1] or sprite.layers[1]
  local cel = layer:cel(1) or sprite:newCel(layer, 1)
  local img = Image(sprite.width, sprite.height, ColorMode.RGB)
  img:drawPixel(x, 0, Color{ r = 255, g = 0, b = 0, a = 255 })
  cel.image = img
  cel.position = Point(0, 0)
end
for _, name in ipairs{ "albedo.png", "aseprite_status.json", "studio_link.json", "art.png", "normal.png" } do os.remove(path(name)) end

local sprite = Sprite(32, 32, ColorMode.RGB)
sprite.layers[1].name = "my art"
api.start(folder)
local state = api.getState()

test("the heartbeat file appears at once and its beat moves", function()
  local a = read("aseprite_status.json")
  assert(a and a:find('"w":32'), a)
  local before = tonumber(a:match('"beat":(%d+)'))
  api.writeHeartbeat()
  assert(tonumber(read("aseprite_status.json"):match('"beat":(%d+)')) == before + 1)
end)

test("no Albedo group: nothing is sent, and Studio is told why", function()
  meta('{"t":"meta","session":"one","rev":0,"origin":"aseprite"}')
  api.tick()
  assert(read("albedo.png") == nil)
  assert(api.statusFields():find('"problem":"This file has no group named Albedo', 1, true), api.statusFields())
end)

test("Set up file puts the existing layers into an Albedo group and clears the problem", function()
  api.setUpFile()
  local group = sprite.layers[1]
  assert(group.isGroup and group.name == "Albedo", "no group")
  assert(group.layers[1].name == "my art", "layer not moved")
  assert(api.statusFields():find('"problem":null', 1, true), api.statusFields())
end)

test("Set up file converts an indexed sprite to RGB and leaves an existing group alone", function()
  local other = Sprite(16, 16, ColorMode.INDEXED)
  local saved = state.sprite
  state.sprite = other
  app.sprite = other
  other.layers[1].name = "x"
  api.setUpFile()
  assert(other.colorMode == ColorMode.RGB, "still indexed")
  local groups = #other.layers
  api.setUpFile()
  assert(#other.layers == groups, "second group made")
  state.sprite = saved
  app.sprite = saved
  other:close()
end)

test("an edit is sent, and a picture that came out the same is not sent again", function()
  paint(sprite, 1)
  state.dirty = true
  api.tick()
  assert(read("albedo.png"), "not sent")
  os.remove(path("albedo.png"))
  state.dirty = true
  api.tick()
  assert(read("albedo.png") == nil, "sent again")
  paint(sprite, 2)
  state.dirty = true
  api.tick()
  assert(read("albedo.png"), "edit not sent")
end)

test("a file name with quotes can't break the status message", function()
  local fields = api.statusFields()
  assert(not fields:find('[%c]'))
  state.issue = 'a "quoted" \\ thing'
  fields = api.statusFields()
  assert(fields:find('"problem":"a  quoted    thing"', 1, true), fields)
  state.issue = nil
end)

test("a ping is answered with its token and Studio's new connection gets the picture again", function()
  local sent = {}
  state.ws = { sendText = function(_, text) sent[#sent + 1] = text end }
  state.lastSent = "something"
  state.dirty = false
  api.relayReceive(WebSocketMessageType.TEXT, '{"t":"ping","token":"abc123"}')
  assert(sent[1] and sent[1]:find('"t":"pong","token":"abc123"', 1, true), sent[1])
  assert(state.lastSent == nil and state.dirty == true, "not resent")
  state.dirty = false
  api.relayReceive(WebSocketMessageType.TEXT, '{"t":"ping","token":"abc123"}')
  assert(#sent == 2 and state.dirty == false, "the same connection must not resend")
  state.ws = nil
end)

test("a new link from Studio takes its art again and refits the canvas", function()
  state.artDone, state.fitted, state.lastSent = true, true, "something"
  api.relayReceive(WebSocketMessageType.TEXT, '{"t":"meta","session":"two","rev":1,"origin":"studio","art":true,"cell":[32,32]}')
  assert(state.artDone == nil and state.fitted == nil and state.lastSent == nil)
  local m = state.meta
  assert(m.session == "two" and m.art == true)
end)

test("online, an edit waits for Send now; ticking Send every edit sends it at once", function()
  local bins = 0
  state.ws = { sendText = function() end, sendBinary = function() bins = bins + 1 end }
  state.online, state.auto, state.awaiting, state.edited, state.dirty = true, false, nil, nil, false
  state.meta = { rev = 1, session = state.session }
  paint(sprite, 5)
  api.onEdit()
  assert(state.edited and not state.dirty, "an online edit must wait")
  api.tick()
  assert(bins == 0, "sent without Send now")
  state.edited, state.manualSend, state.dirty = nil, true, true -- the Send now button
  api.tick()
  assert(bins > 0 and not state.manualSend, "Send now did not send")
  state.auto = true
  api.onEdit()
  assert(state.dirty and not state.edited, "Send every edit must send")
  state.ws, state.online, state.auto, state.dirty = nil, nil, false, false
end)

print(passed .. " passed, " .. failed .. " failed")
