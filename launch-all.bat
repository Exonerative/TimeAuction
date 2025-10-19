@echo off
setlocal enabledelayedexpansion

:: Move to the directory containing this script
cd /d "%~dp0"

if not exist node_modules (
    echo [TimeAuction] Installing dependencies...
    call npm install || goto :error
)

echo [TimeAuction] Starting server in new window...
start "TimeAuction Server" cmd /c "npm start"

:: Allow the server a moment to boot before opening the browser
for /l %%i in (1,1,5) do (
    timeout /t 1 /nobreak >nul
    echo [TimeAuction] Waiting for server to initialize... (%%i/5)
)

echo [TimeAuction] Launching game in browser...
start "" http://localhost:3000/

goto :eof

:error
echo.
echo Failed to set up TimeAuction.
pause
