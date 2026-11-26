@echo off
cd /d "%~dp0"
if exist "%~dp0..\..\work\ollama\ollama.exe" (
  "%~dp0..\..\work\ollama\ollama.exe" %*
) else (
  ollama.exe %*
)
