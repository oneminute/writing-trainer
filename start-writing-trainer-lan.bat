@echo off
setlocal
cd /d "%~dp0"
title Writing Trainer - LAN

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 20 or newer is required.
  pause
  exit /b 1
)

if not exist ".env" (
  copy /Y ".env.example" ".env" >nul
  start "" notepad ".env"
  echo Review .env settings, save the file, then press any key.
  pause >nul
)

echo [SETUP] Checking dependencies...
call npm install --no-fund --no-audit
if errorlevel 1 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)

echo [CHECK] Running syntax checks...
call npm test
if errorlevel 1 (
  echo [ERROR] Code validation failed. Writing Trainer was not started.
  pause
  exit /b 1
)

echo.
echo Writing Trainer will listen on the local network at port 5178.
echo On the child computer, open:
echo http://THIS-PC-LAN-IP:5178
echo.
echo To find THIS-PC-LAN-IP, run ipconfig and look for IPv4 Address.
echo Both computers must be on the same home/local network.
echo Keep this window open while practicing.
echo If Windows Firewall asks, allow Node.js on Private networks only.
echo.

set HOST=0.0.0.0
set PORT=5178
call npm start

pause
