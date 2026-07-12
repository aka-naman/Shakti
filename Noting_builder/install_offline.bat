@echo off
:: Ensure the working directory is the folder where this batch script lives
cd /d "%~dp0"

echo ========================================================
echo Noting Builder - Windows Offline Installer
echo ========================================================
echo.

:: 1. Check if python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH!
    echo Please install Python 3.12 (64-bit) on this PC first.
    echo Make sure to check the box "Add Python to PATH" during installation.
    echo.
    pause
    exit /b
)

:: 2. Create virtual environment
if not exist venv (
    echo Creating virtual environment (venv)...
    python -m venv venv
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to create virtual environment!
        pause
        exit /b
    )
) else (
    echo Virtual environment (venv) already exists. Proceeding...
)

:: 3. Activate venv and install libraries offline
echo.
echo Installing dependencies offline from offline_packages/...
call venv\Scripts\activate.bat

python -m pip install --no-index --find-links=offline_packages -r requirements.txt
if %errorlevel% neq 0 (
    echo.
    echo [WARNING] Direct requirements.txt installation failed, attempting fallback loop...
    :: Fallback to installing wheels individually in resolved order (dependencies first)
    python -m pip install --no-index --find-links=offline_packages colorama blinker markupsafe typing_extensions lxml click itsdangerous jinja2 werkzeug flask python_docx requests ctranslate2 transformers sacremoses setuptools sentencepiece
) else (
    :: Make sure colorama is also installed if requirements.txt succeeded
    python -m pip install --no-index --find-links=offline_packages colorama
)


if %errorlevel% neq 0 (
    echo [ERROR] Offline installation failed!
    pause
    exit /b
)

echo.
echo ========================================================
echo [SUCCESS] Offline environment setup completed perfectly!
echo To start the application, double-click:
echo   run_app.bat
echo ========================================================
echo.
pause
