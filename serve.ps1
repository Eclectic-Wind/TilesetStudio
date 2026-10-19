# Serves the project folder on http://127.0.0.1:8765/ so the studio can open project art by URL
# (http://127.0.0.1:8765/tools/tileset_studio/?tileset=/art/...png). The studio itself also works opened straight from disk.
param([int]$Port = 8765)
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$types = @{ ".html" = "text/html"; ".js" = "text/javascript"; ".css" = "text/css"; ".png" = "image/png"; ".json" = "application/json" }
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "Tileset Studio: http://127.0.0.1:$Port/tools/tileset_studio/  (serving $root)"
while ($listener.IsListening) {
	$context = $listener.GetContext()
	$path = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath).TrimStart("/")
	if ($path -eq "" -or $path.EndsWith("/")) { $path += "index.html" }
	$file = [IO.Path]::GetFullPath((Join-Path $root $path))
	$response = $context.Response
	if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
		$bytes = [IO.File]::ReadAllBytes($file)
		$ext = [IO.Path]::GetExtension($file).ToLower()
		$response.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { "application/octet-stream" }
		$response.Headers.Add("Cache-Control", "no-store")
		$response.OutputStream.Write($bytes, 0, $bytes.Length)
	} else {
		$response.StatusCode = 404
	}
	$response.Close()
}
