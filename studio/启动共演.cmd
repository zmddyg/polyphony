@echo off
setlocal
pushd "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer to host a classroom.
  echo For offline practice, open the standalone HTML file in the release folder.
  pause
  exit /b 1
)
node server.mjs --open
if errorlevel 1 pause
popd
