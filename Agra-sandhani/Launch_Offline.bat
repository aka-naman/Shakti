@echo off
setlocal enabledelayedexpansion

echo 🚀 Launching Agra Sandhani (AIR-GAPPED MODE)...
echo --------------------------------------------------
echo Checking local environment...

:: 1. Check for local Node.js (Assume it's pre-installed on the air-gapped machine)
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ ERROR: Node.js is not found. Please install Node.js on this machine.
    pause
    exit /b 1
)

:: 2. Check if bundle was prepared
if not exist "client\dist" (
    echo ❌ ERROR: Frontend "dist" folder not found. 
    echo Did you run "Prepare_Offline_Bundle.bat" on an internet machine first?
    pause
    exit /b 1
)

:: 3. Run Migrations (Uses local node_modules)
echo 🔄 Running Database Migrations...
cd server
:: We use node directly to avoid npm call which might check registry
node db/migrate.js
node db/upgrade-v2.js
node db/industry-upgrade.js
node db/production-upgrade.js
node db/admin-upgrade.js
node db/add-banks.js
node db/add-delegations.js
node db/add-group-type.js
node db/add-notifications.js
node db/add-remarks-column.js
node db/add-scaling-indexes.js
node db/add-user-isolation.js
node db/add-ip-tracking.js
node db/fix-timezones.js
node db/add-login-logout-tracking.js
node db/backfill-login.js
node db/add-trigram-indexes.js

if %errorlevel% neq 0 (
    echo ❌ ERROR: Migration failed. Check your .env credentials and DB connection.
    pause
    exit /b 1
)

:: 4. Start Server
echo 🚀 Starting Unified Server...
echo 🌐 The application will be available on this machine's IP at port 5000.
echo 📜 Logs are being recorded to server/logs/
echo --------------------------------------------------
node index.js
pause
