@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-ollama.ps1"
if errorlevel 1 (
  echo Ollama setup needs attention. See the message above.
  pause
  exit /b 1
)
echo Open http://localhost:3000 after the ready message.
node server.js
pause
