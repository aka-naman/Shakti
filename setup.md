# 🚀 Setup & Migration Guide for Air-Gapped/LAN Environment

This guide provides step-by-step instructions to migrate and deploy the **AeroForm Suite** (Form Builder, Noting Engine, and Unified Portal) from your development environment to a completely **offline, air-gapped server** on your local network (LAN).

---

## 📦 Step 1: Directory Copy Checklist

You must copy the entire project directory (`setups_test`) to the air-gapped server. Ensure you copy the following folders along with their pre-installed dependencies:

1. **`Agra-sandhani/`**:
   * Includes the compiled production frontend in `client/dist/` (already built).
   * Includes `server/node_modules/` (Node.js dependencies).
2. **`smart-office-noting/`**:
   * Includes the python virtual environment `venv/` (contains Flask, docx, waitress, etc., pre-installed for offline support).
   * Includes the offline Bootstrap stylesheet `static/css/bootstrap.min.css`.
3. **`Portal/`**:
   * Includes `node_modules/` (Unified portal dependencies).
4. **`HOST_ON_LAN.bat`**:
   * The master script that launches all three services on the LAN.

---

## 🗄️ Step 2: Database Migration (PostgreSQL)

Since you are running in an air-gapped environment, you must setup PostgreSQL locally on the server:

### 1. Export database from Dev PC
Run this command in command prompt on your developer machine:
```bash
pg_dump -U postgres -h localhost -p 5432 -d form2builder -F c -b -v -f "D:\form2builder_backup.dump"
```

### 2. Setup PostgreSQL on the Air-Gapped Server
1. Download and run the offline PostgreSQL installer (Version 15 or 16 recommended) on the server.
2. During installation, set the superuser password to **`pass123`** (or match whatever is in your `.env`).
3. Open **pgAdmin** or **psql** and create a new database named **`form2builder`**:
   ```sql
   CREATE DATABASE form2builder;
   ```

### 3. Restore database on the Air-Gapped Server
Run this command to import your schema and data:
```bash
pg_restore -U postgres -d form2builder -v "D:\form2builder_backup.dump"
```

---

## ⚙️ Step 3: Offline Optimizations (Already Configured)

To prevent errors on the air-gapped PC, the following fixes have been applied:
1. **No External Fonts (Vite CSS)**: Google Fonts CDN links were commented out in [index.html](file:///D:/transfer/setups_test/Agra-sandhani/client/index.html) to prevent browser load blocks. It defaults to the system's local Segoe UI/Roboto fonts.
2. **Local Bootstrap (Noting Templates)**: Bootstrap CSS has been downloaded locally to [bootstrap.min.css](file:///D:/transfer/setups_test/smart-office-noting/static/css/bootstrap.min.css). All noting forms now pull from this local copy instead of JSDelivr.
3. **Bypassing DNS Latency**: In [Agra-sandhani/.env](file:///D:/transfer/setups_test/Agra-sandhani/.env), `DB_HOST` is set to `127.0.0.1` (instead of `localhost`). This prevents a 5-second connection delay caused by offline DNS lookups.
4. **Resilient Field Mapping Links**: The integration bridge uses loopback (`127.0.0.1`) internally and `window.location.hostname` externally. This makes the system immune to LAN IP changes.

---

## 🚀 Step 4: Launching on the LAN

1. Find the local LAN IP address of your host machine:
   * Open command prompt, type `ipconfig`, and find your **IPv4 Address** (e.g. `192.168.31.182`).
2. Double-click the file **`HOST_ON_LAN.bat`** in the project root.
3. The script will automatically:
   * Run schema migrations.
   * Start the Form Builder API on port `5000`.
   * Start the Noting Server on port `5001`.
   * Start the Unified Portal on port `8080`.

---

## 🛡️ Step 5: Windows Firewall Exception (Critical)

To allow other computers on the LAN to access the portal and complete field mapping:

1. Open **PowerShell (Run as Administrator)** on the server machine.
2. Run the following command:
   ```powershell
   New-NetFirewallRule -DisplayName "AeroForm Suite" -Direction Inbound -LocalPort 8080,5000,5001 -Protocol TCP -Action Allow
   ```

---

## 💻 Accessing from Client PCs

From any computer connected to the same LAN/Wi-Fi router, open the browser and navigate to:
* **Unified Portal**: `http://<server-ip>:8080` (Primary access point)
* **Form Builder**: `http://<server-ip>:5000`
* **Noting System**: `http://<server-ip>:5001`

---

## 🛠️ Step 6: (Optional) Recreating Python Virtual Environment Offline

If you ever need to recreate or repair the Python virtual environment on the air-gapped server, you can do so completely offline using the pre-compiled packages in the `offline_packages/` directory:

1. Delete the old `venv/` folder if it exists.
2. Create a new virtual environment:
   ```cmd
   python -m venv venv
   ```
3. Activate the new virtual environment:
   ```cmd
   venv\Scripts\activate
   ```
4. Install all dependencies offline:
   ```cmd
   pip install --no-index --find-links=offline_packages -r requirements.txt
   ```
   *(This uses the pre-downloaded `.whl` files inside `offline_packages/` without trying to connect to the internet).*
