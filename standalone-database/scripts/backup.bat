@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0\.."

if not exist backups mkdir backups

for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set TIMESTAMP=%datetime:~0,8%_%datetime:~8,6%
set OUTFILE=backups\hlala_link_backup_%TIMESTAMP%.sql

echo Backing up Hlala Link database to %OUTFILE%...
docker compose exec -T db pg_dump -U postgres hlala_link > "%OUTFILE%"

if %errorlevel% equ 0 (
    echo [SUCCESS] Backup created at %OUTFILE%
) else (
    echo [ERROR] Backup failed.
)
pause
