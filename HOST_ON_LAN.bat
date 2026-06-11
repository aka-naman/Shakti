@echo off
setlocal enabledelayedexpansion

title 🚀 AEROFORM SUITE - LAN HOSTING 🚀

echo ======================================================
echo   🔱 AEROFORM SUITE - ONE-CLICK LAN HOSTING 🔱
echo ======================================================
echo.

:: 1. Detect LAN IP Address
echo 🔍 Detecting LAN IP Address...
set "LAN_IP=127.0.0.1"
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /r "IPv4 Address"') do (
    set "temp_ip=%%a"
    set "temp_ip=!temp_ip: =!"
    if not "!temp_ip!"=="127.0.0.1" (
        set "LAN_IP=!temp_ip!"
    )
)

echo 📡 Found Host IP: %LAN_IP%
echo.

:: 2. Database Health Check & Migrations
echo 🔄 Step 1: Synchronizing Database...
cd Agra-sandhani\server
node db/migrate.js >nul
node db/production-upgrade.js >nul
node db/add-user-isolation.js >nul
cd ..\..

:: 3. Launch Services
echo 🚀 Step 2: Igniting Backend Services...

:: --- Python Dependency Verification (Air-Gap Protection) ---
cd smart-office-noting
if not exist "venv\Scripts\python.exe" (
    echo ⚠️  Python environment missing/broken. Reconstructing from offline wheels...
    python -m venv venv
    venv\Scripts\python.exe -m pip install --no-index --find-links=offline_packages -r requirements.txt
) else (
    :: Verify if venv path matches current location
    venv\Scripts\python.exe -c "import os; exit(0)" >nul 2>nul
    if %errorlevel% neq 0 (
        echo ⚠️  Path mismatch detected. Re-linking environment...
        rmdir /s /q venv
        python -m venv venv
        venv\Scripts\python.exe -m pip install --no-index --find-links=offline_packages -r requirements.txt
    )
)
cd ..

:: Start Agra-sandhani Server (Port 5000)
start "Agra-sandhani Server" /min cmd /k "cd Agra-sandhani\server && node index.js"

:: Start Smart Office Noting (Port 5001)
start "Smart Office Noting" /min cmd /k "cd smart-office-noting && venv\Scripts\python.exe app.py"

:: Start Unified Portal (Port 8080)
start "AeroForm Portal" /min cmd /k "cd Portal && node server.js"

:: 4. Final Display
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

:: 5. Open Browser for the Host
timeout /t 3 /nobreak >nul
start http://localhost:8080

pause
exit
