# 🛠️ AeroForm Suite: Troubleshooting & Configuration Guide

This guide addresses common issues during offline installation and explains how to configure the "Noting Builder" system to work with your specific forms.

---

## 📋 Part 1: Initial Setup & Common Issues

### 1. Python "Path Not Found" or Venv Errors
**Issue**: When running `HOST_ON_LAN.bat`, you see errors about `python.exe` not found.
**Solution**: 
*   Ensure Python 3.12+ is installed on the offline machine and "Add to PATH" was checked during installation.
*   The script will automatically try to repair the `venv`. If it fails, delete the `Noting_builder/venv` folder manually and run the script again.

### 2. Database Connection Failure
**Issue**: "Error: connect ECONNREFUSED 127.0.0.1:5432".
**Solution**:
*   Ensure PostgreSQL service is running (`services.msc` -> PostgreSQL -> Start).
*   Check `Agra-sandhani/.env`. Ensure `DB_USER` and `DB_PASSWORD` match what you set during Postgres installation.

### 3. "Port 8080 already in use"
**Issue**: The Portal fails to start.
**Solution**:
*   Another application (like Skype or an old web server) is using the port. 
*   Open `Portal/server.js` and change `const PORT = 8080;` to `8081`. 
*   Update your LAN users to the new URL.

---

## 🔗 Part 2: Linking Forms to Noting Builder (The "ID" Problem)

When you create a new form in Agra-sandhani, the database assigns it a unique **Form ID** (e.g., 23, 24, 25). The Noting Builder system needs to know which form to pull data from.

### Step 1: Find your Form ID
1.  Open the **Agra-sandhani** dashboard.
2.  Click on the form you want to use as your "Master" (the one containing employee data).
3.  Look at the URL in your browser: `http://localhost:5000/forms/view/33`.
4.  The number at the end (**33**) is your **Form ID**.

### Step 2: Configure the Noting App
You must tell the Noting app which ID to use for lookups.
1.  Open `Noting_builder/config.json`.
2.  Update the `master_form_id` and the `agra_api_url`:
    ```json
    "integration": {
        "enabled": true,
        "master_form_id": 33,
        "agra_api_url": "http://localhost:5000/api/service/lookup"
    }
    ```

### Step 3: Handle Different Field Labels
**Issue**: One form calls it "PIS Number", another calls it "Personnel ID".
**Solution**:
The system uses **Dynamic Fuzzy Matching**. It will automatically try to find fields containing "PIS", "ID", or "Name".
*   **If autofill fails**: Ensure your form field label in Agra-sandhani contains one of these keywords.
*   **Manual Mapping**: In the Noting App, go to the **Master Manager** (Password protected) to manually map which Agra-sandhani field should fill which Noting variable.

---

## 🛡️ Part 4: The "Emergency Repair" Protocol

If the system was moved and is completely broken:
1.  **Stop all processes**: Close all CMD windows.
2.  **Clear Caches**:
    *   Delete `Agra-sandhani/server/node_modules` (If you have internet to re-run `npm install`).
    *   Delete `Noting_builder/venv`.
3.  **Run Repair**: Run `PREPARE_ALL_OFFLINE.bat` (needs internet) then `HOST_ON_LAN.bat` (offline).

---

## 📡 Part 5: Firewall & Access
If others can't connect to your IP:
1.  **Turn off Public Firewall** (Temporary test) to see if it works.
2.  **Add Exceptions**: Specifically allow `node.exe` and `python.exe` through the Windows Firewall.
