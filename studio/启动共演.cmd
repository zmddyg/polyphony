@echo off
setlocal
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer to host a classroom.
  echo For offline practice, open the standalone HTML file in the release folder.
  pause
  exit /b 1
)
pushd "%~dp0" || exit /b 1
node server.mjs --open
set "POLYPHONY_EXIT_CODE=%errorlevel%"
popd
if not "%POLYPHONY_EXIT_CODE%"=="0" pause
exit /b %POLYPHONY_EXIT_CODE%
