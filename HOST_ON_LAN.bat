@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

title 🚀 AEROFORM SUITE - LAN HOSTING 🚀

echo ======================================================
echo   🔱 AEROFORM SUITE - ONE-CLICK LAN HOSTING 🔱
echo ======================================================
echo.

:: 1. Detect LAN IP Address
echo 🔍 Detecting LAN IP Address...
set "LAN_IP=127.0.0.1"

:: Try using PowerShell to get the connected physical adapter's IP (Wi-Fi or Ethernet)
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "Get-NetIPInterface -ConnectionState Connected -AddressFamily IPv4 2>$null | Get-NetIPAddress 2>$null | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1 -ExpandProperty IPAddress"`) do (
    set "LAN_IP=%%i"
)

:: Fallback to ipconfig if PowerShell method failed or returned loopback
if "%LAN_IP%"=="127.0.0.1" (
    for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /r "IPv4 Address"') do (
        set "temp_ip=%%a"
        set "temp_ip=!temp_ip: =!"
        for /f "tokens=1" %%b in ("!temp_ip!") do set "temp_ip=%%b"
        if not "!temp_ip!"=="127.0.0.1" (
            if not "!temp_ip!"=="" set "LAN_IP=!temp_ip!"
        )
    )
)

echo 📡 Found Host IP: %LAN_IP%
echo.

:: 2. Dependency Verification (Air-Gap Protection)
echo 📋 Checking Node.js dependencies...

if not exist "Agra-sandhani\server\node_modules" (
    echo ⚠️  Agra-sandhani dependencies missing! Please run PREPARE_ALL_OFFLINE.bat on an internet-connected machine.
    pause
    exit /b
)

if not exist "Portal\node_modules" (
    echo ⚠️  Portal dependencies missing! Please run PREPARE_ALL_OFFLINE.bat on an internet-connected machine.
    pause
    exit /b
)

:: 3. Database Health Check & Migrations
echo 🔄 Step 1: Synchronizing Database ^& Optimizing Performance...
cd Agra-sandhani\server
node db/migrate.js
if errorlevel 1 (
    echo.
    echo ❌ ERROR: Database migration failed!
    echo Please check if:
    echo 1. PostgreSQL service is running.
    echo 2. The database 'form2builder' exists.
    echo 3. The credentials in Agra-sandhani/.env are correct.
    echo.
    cd ..\..
    pause
    exit /b 1
)
node db/upgrade-v2.js
node db/industry-upgrade.js
node db/production-upgrade.js
node db/admin-upgrade.js
node db/add-banks.js
node db/add-delegations.js
node db/add-group-type.js
node db/add-notifications.js
node db/add-remarks-column.js
node db/add-scaling-indexes.js
node db/add-user-isolation.js
node db/add-ip-tracking.js
node db/fix-timezones.js
node db/add-login-logout-tracking.js
node db/backfill-login.js
node db/add-trigram-indexes.js
cd ..\..

:: 4. Launch Services
echo 🚀 Step 2: Igniting Backend Services...

:: --- Python Dependency Verification (Air-Gap Protection) ---
cd Noting_builder
if not exist "venv\Scripts\python.exe" (
    echo ⚠️  Python environment missing/broken. Reconstructing from offline wheels...
    python -m venv venv
    venv\Scripts\python.exe -m pip install --no-index --find-links=offline_packages -r requirements.txt
) else (
    :: Verify if venv path matches current location and dependencies are importable
    venv\Scripts\python.exe -c "import flask, docx, requests, ctranslate2, transformers, sacremoses, sentencepiece" >nul 2>nul
    if errorlevel 1 (
        echo ⚠️  Environment validation failed due to missing packages or path mismatch. Re-linking...
        rmdir /s /q venv
        python -m venv venv
        venv\Scripts\python.exe -m pip install --no-index --find-links=offline_packages -r requirements.txt
    )
)
cd ..

:: Set Environment for Python Integration (Optimized Communication)
set "AGRA_API_URL=http://127.0.0.1:5000/api/service/lookup"

:: Start Agra-sandhani Server (Port 5000)
start "Agra-sandhani Server" cmd /k "cd /d "%~dp0Agra-sandhani\server" && node index.js"

:: Start Noting Builder (Port 5001)
start "Noting Builder" cmd /k "cd /d "%~dp0Noting_builder" && call venv\Scripts\activate.bat && python app.py"

:: Start Unified Portal (Port 8080)
start "AeroForm Portal" cmd /k "cd /d "%~dp0Portal" && node server.js"

:: Wait for servers to initialize
echo.
echo ⏳ Waiting for servers to initialize (5 seconds)...
timeout /t 5 /nobreak >nul

echo 🔍 Verifying service status...
set "AGRA_STATUS=FAIL"
set "NOTING_STATUS=FAIL"
set "PORTAL_STATUS=FAIL"

:: Check Agra-sandhani
curl -s -m 2 http://localhost:5000/api/health >nul 2>&1
if not errorlevel 1 set "AGRA_STATUS=OK"

:: Check Noting Builder
curl -s -m 2 http://localhost:5001/ >nul 2>&1
if not errorlevel 1 set "NOTING_STATUS=OK"

:: Check Unified Portal
curl -s -m 2 http://localhost:8080/api/config >nul 2>&1
if not errorlevel 1 set "PORTAL_STATUS=OK"

echo.
echo ------------------------------------------------------
echo 📊 Service Health Dashboard:
echo    - Agra-sandhani (Form Builder): [%AGRA_STATUS%]
echo    - Noting Builder (Python App):  [%NOTING_STATUS%]
echo    - Unified Portal (Port 8080):   [%PORTAL_STATUS%]
echo ------------------------------------------------------
echo.

if "%AGRA_STATUS%"=="FAIL" (
    echo ⚠️  WARNING: Agra-sandhani Server failed to respond!
    echo    Please check the minimized command prompt window for errors.
)
if "%NOTING_STATUS%"=="FAIL" (
    echo ⚠️  WARNING: Noting Builder Server failed to respond!
    echo    Please check the minimized command prompt window for errors.
)
if "%PORTAL_STATUS%"=="FAIL" (
    echo ⚠️  WARNING: AeroForm Unified Portal failed to respond!
    echo    Please check the minimized command prompt window for errors.
)

:: 5. Final Display
echo.
echo ======================================================
echo 🎉 SUCCESS! THE SUITE IS NOW LIVE ON YOUR LAN 🎉
echo ======================================================
echo.
echo 👤 YOUR MACHINE:   http://localhost:8080
echo 👥 OTHER COMPUTERS: http://%LAN_IP%:8080
echo.
echo ------------------------------------------------------
echo 📋 INSTRUCTIONS:
echo 1. Share the URL http://%LAN_IP%:8080 with others.
echo 2. Ensure your Windows Firewall allows Ports 8080, 5000, and 5001.
echo 3. Keep this window and minimized windows open.
echo ------------------------------------------------------
echo.

:: 6. Open Browser for the Host
if "%PORTAL_STATUS%"=="OK" (
    start http://localhost:8080
)

echo [INFO] All services started. Press any key to stop this script.
pause
exit
