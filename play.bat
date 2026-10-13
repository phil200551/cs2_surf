@echo off
setlocal
cd /d "%~dp0"
title Skyline Surf

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js was not found. Install the LTS version from https://nodejs.org
  echo   then open a new cmd window and run play.bat again.
  echo.
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo   No prebuilt game found, building it once - this needs internet...
  if not exist "node_modules\" (
    call npm install
    if errorlevel 1 goto fail
  )
  call npm run build
  if errorlevel 1 goto fail
)

echo.
echo   Starting Skyline Surf. Your browser opens at http://localhost:8080
echo   If it does not, open that address yourself. Chrome or Edge recommended.
echo.
node serve.mjs --open
goto :eof

:fail
echo.
echo   Something went wrong, see the messages above.
pause
exit /b 1
