@echo off
setlocal enabledelayedexpansion

:: Move to the directory containing this script
cd /d "%~dp0"

if not exist node_modules ( 
    echo [TimeAuction] Installing dependencies...
    call npm install || goto :error
)

echo [TimeAuction] Starting server...
call npm start

goto :eof

:error
echo.
echo Failed to set up TimeAuction.
pause

