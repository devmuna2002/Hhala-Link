@echo off
echo Adding Windows Firewall rule for Hlala Link...
netsh advfirewall firewall delete rule name="Hlala Link Server" >nul 2>&1
netsh advfirewall firewall add rule name="Hlala Link Server" dir=in action=allow protocol=TCP localport=8000 profile=any
if %errorlevel%==0 (
    echo.
    echo [OK] Port 8000 is now open - your phone can reach the server!
) else (
    echo.
    echo [FAILED] Right-click this file and choose Run as administrator.
)
pause
