@echo off
setlocal

REM Change to the directory containing this script
pushd "%~dp0" >nul

REM Install dependencies (safe to run even if already installed)
echo Installing npm dependencies...
call npm install
if errorlevel 1 (
    echo Failed to install dependencies. Aborting.
    popd >nul
    exit /b %errorlevel%
)

echo Starting the Time Auction server in a new window...
REM Use escaped carets so the command runs correctly in the new window
start "Time Auction Server" cmd /k cd /d "%~dp0" ^&^& npm start

set "TARGET_URL=%TIME_AUCTION_URL%"
if not defined TARGET_URL set "TARGET_URL=http://localhost:3000/host"

echo Waiting for the server to boot...
REM Use timeout if available; fall back to ping for older Windows versions
where timeout >nul 2>nul
if errorlevel 1 (
    ping -n 4 127.0.0.1 >nul
) else (
    timeout /t 3 /nobreak >nul
)

echo Opening %TARGET_URL% in your default browser...
start "" "%TARGET_URL%"

popd >nul
endlocal
