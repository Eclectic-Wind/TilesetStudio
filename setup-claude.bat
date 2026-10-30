@echo off
echo Installing Claude Code...
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"
echo.
echo Starting Claude Code in TilesetStudio...
start "Claude Code" powershell -NoExit -Command "cd \"%USERPROFILE%\Documents\TilesetStudio\"; & \"%USERPROFILE%\.local\bin\claude.exe\""
pause
