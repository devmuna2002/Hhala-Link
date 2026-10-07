@echo off
setlocal
cd /d "%~dp0\.."

echo ================================================================
echo  Starting Hlala Link Standalone Database Stack...
echo ================================================================

where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not installed or not in PATH.
    echo Please install Docker Desktop for Windows or run on your Linux VPS.
    echo See standalone-database/README.md for details.
    pause
    exit /b 1
)

docker compose up -d

if %errorlevel% equ 0 (
    echo.
    echo [SUCCESS] Standalone Database Stack is running!
    echo - Gateway / API:  http://localhost:8000
    echo - Health check:   http://localhost:8000/health
    echo - PostgreSQL:     localhost:5432 (User: postgres, DB: hlala_link)
    echo.
) else (
    echo [ERROR] Failed to start containers. Check Docker daemon.
)
pause
