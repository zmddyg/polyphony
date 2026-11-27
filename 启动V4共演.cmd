@echo off
setlocal
for %%D in ("%~dp0polyphony-studio" "%~dp0studio" "%~dp0.polyphony-work\source\studio") do (
  if exist "%%~D\server.mjs" (
    set "POLYPHONY_STUDIO_DIR=%%~D"
    goto launch
  )
)
echo Extract the entire Polyphony release and run this launcher from the extracted folder.
pause
exit /b 1

:launch
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer to host a classroom.
  echo For offline practice, open the standalone HTML file in the release folder.
  pause
  exit /b 1
)
pushd "%POLYPHONY_STUDIO_DIR%" || exit /b 1
echo Open the Polyphony URL printed below. Press Ctrl+C to stop the server.
node server.mjs
set "POLYPHONY_EXIT_CODE=%errorlevel%"
popd
if not "%POLYPHONY_EXIT_CODE%"=="0" pause
exit /b %POLYPHONY_EXIT_CODE%
