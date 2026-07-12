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

:: 2. Noting-Builder Preparation
echo.
echo 📋 Phase 2: Preparing Noting-Builder (Python)...
cd Noting_builder
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo    [WARNING] Python is not installed or not in PATH. Skipping venv setup.
    echo              Please make sure to set up Python and download dependencies later.
) else (
    echo    - Setting up Virtual Environment...
    if not exist "venv" python -m venv venv
    echo    - Upgrading pip...
    call venv\Scripts\python.exe -m pip install --upgrade pip --quiet 2>nul
    echo    - Installing Python Dependencies locally...
    call venv\Scripts\python.exe -m pip install -r requirements.txt --quiet
    echo    - Installing temporary PyTorch for model conversion...
    call venv\Scripts\python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cpu --quiet
    echo    - Downloading and converting Translation Models (Helsinki-NLP)...
    call venv\Scripts\python.exe download_models.py
    echo    - Cleaning up temporary PyTorch installation...
    call venv\Scripts\python.exe -m pip uninstall torch -y --quiet
    echo    - Downloading Offline Wheel Packages (Backup)...
    if not exist "offline_packages" mkdir offline_packages
    call venv\Scripts\python.exe -m pip download -r requirements.txt -d offline_packages --quiet
)
cd ..


:: 3. Portal Preparation
echo.
echo 📋 Phase 3: Preparing Unified Portal...
cd Portal
echo    - Installing Portal Node Modules...
call npm install --production --silent
cd ..

:: 4. Asset Audit
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
echo    Select all folders (Agra-sandhani, Noting_builder, Portal) 

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
