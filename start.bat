@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install it from https://nodejs.org/ then run this file again.
  pause
  exit /b 1
)
set HOST=127.0.0.1
set PORT=3000
if "%ADMIN_EMAIL%"=="" set ADMIN_EMAIL=admin@makhado.local
if "%ADMIN_PASSWORD%"=="" set ADMIN_PASSWORD=ChangeMe-Clinic-2026!
echo Starting Makhado Community Health Centre website...
node server.js
pause
