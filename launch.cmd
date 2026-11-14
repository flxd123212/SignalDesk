@echo off
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron runtime is missing. Run npm install, then node node_modules\electron\install.js.
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  call npm run build
  if errorlevel 1 exit /b 1
)
start "SignalDesk" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
