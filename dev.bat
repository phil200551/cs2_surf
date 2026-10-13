@echo off
setlocal
cd /d "%~dp0"
title Skyline Surf - dev server

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js was not found. Install the LTS version from https://nodejs.org
  echo   then open a new cmd window and run dev.bat again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo   Installing dependencies, first run only - this needs internet...
  call npm install
  if errorlevel 1 goto fail
)

echo.
echo   Starting the Vite dev server at http://localhost:5173 - edits to src\ reload live.
echo   Press Ctrl+C to stop.
echo.
call npm run dev -- --open
goto :eof

:fail
echo.
echo   npm install failed, see the messages above.
pause
exit /b 1
