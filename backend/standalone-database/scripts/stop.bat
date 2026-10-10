@echo off
setlocal
cd /d "%~dp0\.."

echo Stopping Hlala Link Standalone Database Stack...
docker compose down
echo Done.
pause
