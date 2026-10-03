@echo off
setlocal
cd /d "%~dp0"
title Writing Trainer

echo ==========================================
echo          Writing Trainer Launcher
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Please install Node.js 20 or newer, then run this file again.
  pause
  exit /b 1
)

if not exist ".env" (
  if exist ".env.example" (
    copy /Y ".env.example" ".env" >nul
    echo [SETUP] Created .env from .env.example
    echo IMPORTANT: Review LLM_PROVIDER and Ollama settings in .env.
    start "" notepad ".env"
    echo Save the file, then press any key to continue.
    pause >nul
  )
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

echo [START] Starting Writing Trainer on port 5178...
start "" http://localhost:5178
call npm start

echo.
echo Writing Trainer stopped.
pause
