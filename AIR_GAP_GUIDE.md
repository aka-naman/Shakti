# 🛡️ AeroForm Suite: Air-Gap Deployment Guide

This guide details how to host the complete AeroForm Suite on a LAN with **zero internet access**.

## 📦 What to Bundle
Before leaving the internet-connected machine, ensure your ZIP file contains:

1.  **Agra-sandhani/server/node_modules/** (Pre-installed backend dependencies)
2.  **Agra-sandhani/client/dist/** (The compiled, production-ready frontend)
3.  **smart-office-noting/venv/** (The pre-populated Python virtual environment)
4.  **Portal/node_modules/** (Portal hub dependencies)
5.  **smart-office-noting/offline_packages/** (Backup .whl files for emergency repairs)

## 🚚 The Transfer Process
1.  Run `PREPARE_ALL_OFFLINE.bat` on the internet-connected PC.
2.  Compress the entire root project folder into `AeroForm_Suite_vX.zip`.
3.  Transfer the ZIP to the offline PC via USB/CD/SSD.
4.  Extract the ZIP to a permanent location (e.g., `C:\AeroForm\`).

## 🛠️ Offline Machine Setup
The offline PC must have these runtimes installed (available via USB installers):
*   **Node.js v18+** (Windows Installer .msi)
*   **Python v3.12+** (Windows Installer .exe)
*   **PostgreSQL 15+** (The database engine)

## 📡 Network & Hosting
Once extracted, run **`HOST_ON_LAN.bat`**. This script will:
1.  Detect the machine's LAN IP.
2.  Initialize the offline database.
3.  Start the three servers.

### 🧱 Windows Firewall Rule
To allow other LAN users to connect, you must open the ports. Run this in an **Admin PowerShell**:
```powershell
New-NetFirewallRule -DisplayName "AeroForm Suite" -Direction Inbound -LocalPort 8080,5000,5001 -Protocol TCP -Action Allow
```

## 🔒 Security in Air-Gap
*   **Database Backups**: Since there is no cloud, use the `DB_BACKUP.bat` (if provided) to manually dump the Postgres database to an external drive weekly.
*   **Logs**: Audit logs in `logs/` folders should be reviewed manually for unauthorized access patterns.
*   **No CDN**: The system is configured to use local fonts. If any UI elements appear broken, check that `index.html` does not reference external Google Fonts or FontAwesome CDN links.
