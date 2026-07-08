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

echo Activating virtual environment...
call venv\Scripts\activate.bat

echo.
echo Launching browser at http://127.0.0.1:5001/ ...
start http://127.0.0.1:5001/

echo Starting Flask Application Server...
python app.py
pause
