@echo off
:: Ensure the working directory is the folder where this batch script lives
cd /d "%~dp0"

echo ========================================================
echo Noting Builder - Launcher
echo ========================================================
echo.

if not exist venv (
    echo [ERROR] Virtual environment 'venv' not found!
    echo Please run 'install_offline.bat' first.
    echo.
    pause
    exit /b
)

:: Verify if venv contains all required translation packages
venv\Scripts\python.exe -c "import flask, docx, requests, ctranslate2, transformers, sacremoses, sentencepiece" >nul 2>nul
if errorlevel 1 (
    echo [WARNING] Missing required packages or environment mismatch. Updating venv...
    call venv\Scripts\activate.bat
    python -m pip install --no-index --find-links=offline_packages -r requirements.txt
    if errorlevel 1 (
        echo [ERROR] Failed to update packages!
        pause
        exit /b
    )
)

echo Activating virtual environment...
call venv\Scripts\activate.bat

echo.
echo Launching browser at http://127.0.0.1:5001/ ...
start http://127.0.0.1:5001/

echo Starting Flask Application Server...
python app.py
pause
