#!/bin/bash
echo "========================================================"
echo "Noting Builder - Unix Offline Installer"
echo "========================================================"
echo

# 1. Check if python is installed
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python 3 is not installed or not in PATH!"
    echo "Please install Python 3.12 first."
    exit 1
fi

# 2. Create virtual environment
echo "Creating virtual environment (venv)..."
python3 -m venv venv
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to create virtual environment!"
    exit 1
fi

# 3. Activate venv and install libraries offline
echo
echo "Installing dependencies offline from offline_packages/..."
source venv/bin/activate

python3 -m pip install --no-index --find-links=offline_packages -r requirements.txt
if [ $? -ne 0 ]; then
    echo "[ERROR] Offline installation failed!"
    exit 1
fi

echo
echo "========================================================"
echo "[SUCCESS] Offline environment setup completed perfectly!"
echo "To start the application, run:"
echo "  venv/bin/python app.py"
echo "========================================================"
echo
