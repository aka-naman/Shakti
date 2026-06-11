@echo off
setlocal enabledelayedexpansion

title 📦 AEROFORM SUITE - AIR-GAP PACKAGER 📦

echo ======================================================
echo   🛠️  AEROFORM SUITE - AIR-GAP PREPARATION TOOL 🛠️
echo ======================================================
echo.
echo [IMPORTANT] RUN THIS ON A MACHINE WITH INTERNET ACCESS.
echo.

:: 1. Agra-Sandhani Preparation
echo 📋 Phase 1: Preparing Agra-sandhani (Form Builder)...
cd Agra-sandhani\server
echo    - Installing Backend Node Modules...
call npm install --production --silent
cd ..\client
echo    - Installing Frontend Node Modules...
call npm install --silent
echo    - Building Production Frontend Assets...
call npm run build
cd ..\..

:: 2. Smart-Office-Noting Preparation
echo.
echo 📋 Phase 2: Preparing Smart-Office-Noting (Python)...
cd smart-office-noting
echo    - Setting up Virtual Environment...
if not exist "venv" python -m venv venv
echo    - Installing Python Dependencies locally...
call venv\Scripts\python.exe -m pip install -r requirements.txt --quiet
echo    - Downloading Offline Wheel Packages (Backup)...
if not exist "offline_packages" mkdir offline_packages
call venv\Scripts\python.exe -m pip download -r requirements.txt -d offline_packages --quiet
cd ..

:: 3. Portal Preparation
echo.
echo 📋 Phase 3: Preparing Unified Portal...
cd Portal
echo    - Installing Portal Node Modules...
call npm install --production --silent
cd ..

:: 4. Asset Audit (Fonts & Icons)
echo.
echo 📋 Phase 4: Bundling External Assets...
echo [INFO] System is configured to use local fonts where possible.
echo [INFO] PDF rendering (pdfmake) uses standard built-in fonts.

:: 5. Create the Master Zip Package
echo.
echo ======================================================
echo ✅ PREPARATION COMPLETE!
echo ======================================================
echo.
echo 📦 NEXT STEPS FOR AIR-GAP DEPLOYMENT:
echo.
echo 1. ZIP THE ENTIRE ROOT FOLDER:
echo    Select all folders (Agra-sandhani, smart-office-noting, Portal) 
echo    and the Launch files. Right-click -^> Send to Compressed Folder.
echo.
echo 2. TRANSFER TO OFFLINE PC:
echo    Move the ZIP file to the Air-Gapped machine via USB or CD.
echo.
echo 3. HOSTING:
echo    Extract the ZIP on the offline PC and run:
echo    -^> HOST_ON_LAN.bat
echo.
echo [NOTE] Ensure the offline PC has Node.js (v18+) and Python (v3.12+) installed.
echo.
echo ------------------------------------------------------
pause
exit
