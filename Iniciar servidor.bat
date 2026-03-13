@echo off
cd /d "%~dp0"
python3 -m http.server 8080
pause
