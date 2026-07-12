# 🛡️ Shakti Translation Engine: Air-Gap Deployment Guide

This guide details how to install, configure, and run the high-speed, offline English-to-Hindi and Hindi-to-English translation engine in a secure, air-gapped network environment.

---

## 1. System Overview

The translation engine is built using **CTranslate2** (a custom C++ inference engine optimized for CPUs) and Meta's **MarianMT (Helsinki-NLP)** translation models. 

To run completely offline, the system separates model weights and dependencies:
*   **Model Files**: Saved locally in `Noting_builder/models/` (split into separate `ct2` model files and `tokenizer` configurations).
*   **Offline Packages**: Cached as wheel (`.whl`) files inside `Noting_builder/offline_packages/` to allow installation without a network connection.

---

## 2. Prerequisites
The target offline machine must have the following runtimes pre-installed (installers can be transferred via USB):
*   **Python v3.12+** (64-bit Windows Installer)
*   **Node.js v18+** (Windows Installer `.msi`)

---

## 3. Deployment Steps

### Step 1: Pack the Suite (On an Internet-Connected PC)
Before moving to the secure room, prepare the complete bundle containing the models and dependency wheels:

1.  Open a terminal in the root project folder.
2.  Run the preparation script:
    ```cmd
    PREPARE_ALL_OFFLINE.bat
    ```
    This script will:
    *   Initialize a Python virtual environment (`venv`).
    *   Temporarily install PyTorch CPU to execute the model converter.
    *   Download and convert the translation models to **quantized INT8 CPU-optimized** format in `Noting_builder/models/`.
    *   Uninstall PyTorch to prevent package bloat.
    *   Download all required dependency wheels (including `ctranslate2`, `transformers`, `sacremoses`, and `sentencepiece`) recursively into `Noting_builder/offline_packages/`.

3.  Select the entire project root folder and compress it into a single ZIP file (e.g., `Shakti_Workspace_v1.zip`).

---

### Step 2: Transfer the Bundle
1.  Copy the ZIP file to a secure transfer media (USB drive, CD/DVD, or local network share).
2.  Paste and extract the ZIP file on the target **air-gapped machine** (e.g., to `C:\Shakti\`).

---

### Step 3: Launch and Install (On the Air-Gapped PC)
The startup scripts are equipped with auto-installers that recognize the offline wheels.

1.  Double-click **`HOST_ON_LAN.bat`** in the root directory.
2.  The script will:
    *   Detect the local network IP for LAN hosting.
    *   Perform a dependency import check for the translation modules.
    *   **Auto-install** all missing packages from `Noting_builder/offline_packages/` if the local virtual environment is unconfigured or incomplete.
    *   Synchronize the database and start the Portal, Form Builder, and Noting servers.
3.  Access the workspace in your browser at `http://localhost:8080` (or `http://<lan-ip>:8080` from other computers on the LAN).

*(Alternatively, you can navigate to `Noting_builder/` and run `install_offline.bat` followed by `run_app.bat` to host only the noting and translation components).*

---

## 4. Verification and Health Check

Once the portal is open in the browser:
1.  Click the **Shakti Translate** card.
2.  Look at the status badge in the top right:
    *   🟢 **Local CPU Translate Engine Active**: Everything is loaded and ready.
    *   🔴 **Translate Engine Offline**: Model files are missing or dependencies are not loaded.
3.  Type a test sentence (e.g., *"The weather is pleasant today."*) in the English box. It should translate to Hindi (*"आज मौसम बहुत सुखद है।"*) in **under 150ms**.

---

## 5. Troubleshooting in Air-Gap

### Error: `No module named 'pkg_resources'`
*   **Cause**: Python 3.12 virtual environments do not bundle `setuptools` (which contains `pkg_resources`) by default.
*   **Fix**: Ensure `setuptools` is installed in the venv. The launch scripts automatically resolve this by installing the wheel from `offline_packages/`. If running manually, activate the venv and run:
    ```cmd
    venv\Scripts\python.exe -m pip install --no-index --find-links=offline_packages setuptools
    ```

### Warning: `Translation model files for '[direction]' were not found`
*   **Cause**: `PREPARE_ALL_OFFLINE.bat` was skipped or interrupted, leaving the `Noting_builder/models/` folder empty.
*   **Fix**: Re-run the preparation script on an internet-connected PC, zip the updated `models/` directory, and copy it to the air-gapped PC.

### Slow Translation Speeds (Latency > 1s)
*   **Cause**: The CPU has limited cores, or too many parallel threads are configured.
*   **Fix**: Open `Noting_builder/app.py` and adjust the thread count in `ctranslate2.Translator`:
    ```python
    translator = ctranslate2.Translator(model_path, device="cpu", intra_threads=2) # Try 2 or 4 threads
    ```
