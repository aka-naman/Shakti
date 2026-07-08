# 🛡️ Agra-sandhani Detailed Technical Reference: Chapter 1
## System Entrypoint, Offline Infrastructure, Security, and Logging

This chapter document details the boot sequence, middleware stack, security features, logging architecture, and environment configuration of the **Agra-sandhani** server.

---

## 📂 1. Core Files & Directory Responsibilities

| File Path | Functional Purpose | Exported Symbols / Main Hook |
| :--- | :--- | :--- |
| `Launch_Offline.bat` | Windows bootstrap script for airgapped launch | None (batch file) |
| `server/index.js` | Express app initialization, middleware binding, cron tasks, port listener | Express `app` instance |
| `server/services/logger.js` | Custom Winston Logger with system-time formatted daily log rotations | Winston `logger` object, `logger.stream` |
| `server/middleware/auth.js` | Authentication & role restriction handlers | `authenticate`, `checkFormAccess`, `checkFormOwnership` |
| `.env` / `.env.example` | Server port, PostgreSQL database pool options, JWT credentials | Environmental variables |

---

## 🏁 2. Airgapped Boot Sequence (`Launch_Offline.bat`)

The batch script acts as the system installer/orchestrator in offline environments.

```
[Start Launch_Offline.bat]
       │
       ▼
[Verify Node.js Binary] ──(Not Found)──> [Exit Error 1]
       │
       ▼
[Verify client/dist Folder] ──(Not Found)──> [Exit Error 2 (Suggest offline build preparation)]
       │
       ▼
[Execute DB Migration chain]
 1. node db/migrate.js
 2. node db/upgrade-v2.js
 3. ... (Runs 18 incremental upgrades via Node directly to avoid npm registry requests)
       │
       ▼
[Execute server/index.js]
```

### Key Execution Highlights:
1. **Offline Integrity**: Commands like `npm run` or `npm install` are avoided to bypass network registry lookups, executing node scripts directly via `node <file>`.
2. **Upgrade Scripts Sequence**: Database updates are executed in a fixed transactional queue. If any script fails, the script halts to prevent half-migrated database corruption.

---

## 🎛️ 3. App Core & Middleware Stack (`server/index.js`)

`index.js` constructs the Express application, configures global middlewares, registers core routers, and schedules daily cleanup tasks.

### 3.1 Initial Environment Resolution
```javascript
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.example') });
try {
    require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
} catch (_) { }
```
* **Function**: Ensures that fallback environment variables from `.env.example` are loaded first, then overrides them with real secrets from the local production `.env` file if it exists.

### 3.2 Global Security Middlewares
* **`helmet({ contentSecurityPolicy: false })`**: Sets secure HTTP response headers. The Content Security Policy (CSP) is explicitly disabled because local React clients load resources over dynamic LAN IP addresses without certificates.
* **`cors()`**: Enables Cross-Origin Resource Sharing so that the Smart Office Noting server (on port `5001`) can execute AJAX fetches on port `5000`.
* **`express.json({ limit: '10mb' })`**: Parses incoming request JSON payloads, capping size at 10MB to block overflow denial of service (DoS) attempts via payload stuffing.

### 3.3 Network-Edge Rate Limiters
To protect the Node thread-loop in production-restricted networks:
1. **`globalLimiter`** (Applied to `/api`):
   * **Rule**: Limits each client IP to 1000 requests per 15 minutes.
   * **Purpose**: Prevents client-side loops or bulk scripting from locking the PostgreSQL database pool.
2. **`authLimiter`** (Applied to `/api/auth/login` and `/api/auth/register`):
   * **Rule**: Capped at 20 login/register attempts per hour per client IP.
   * **Purpose**: Blocks brute-force credentials guessing.

### 3.4 Relational API Route Registrations
`index.js` binds sub-routers to specific API paths:
* `/api/auth` ➡️ `routes/auth.js` (User registration, login, JWT issuance)
* `/api/forms` ➡️ `routes/forms.js`, `routes/submissions.js`, `routes/fields.js` (Form management, field definitions, submission lifecycle)
* `/api/export` ➡️ `routes/export.js` (Excel and PDF streaming exports)
* `/api/autocomplete` ➡️ `routes/autocomplete.js` (Fuzzy lists, location maps)
* `/api/service` ➡️ `routes/service-integration.js` (Cross-process Noting integrations)

### 3.5 Production SPA Hosting Fallback
```javascript
const clientBuildPath = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientBuildPath));
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(clientBuildPath, 'index.html'));
    }
});
```
* **Function**: Allows the single Node process to act as both the API server and the frontend host. In production, any non-API URL route fallback returns `index.html` to allow React Router (SPA) to resolve routing client-side.

### 3.6 Cron Purging Interval Task
An interval loop is configured upon listener initialization:
* **Timer Interval**: 24 hours (`24 * 60 * 60 * 1000` ms).
* **Executed Query**:
  ```sql
  DELETE FROM submissions WHERE deleted_at < NOW() - INTERVAL '30 days';
  DELETE FROM forms WHERE deleted_at < NOW() - INTERVAL '30 days';
  ```
* **Purpose**: Performs permanent database optimization by purging records marked for soft-deletion longer than 30 days.

---

## 📝 4. Unified Logging Subsystem (`server/services/logger.js`)

This file configures **Winston** to handle process logs alongside **Morgan** for HTTP request tracking.

### 4.1 System Clock Timestamping
```javascript
const localTimestamp = () => {
    const d = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
```
* **Purpose**: Avoids UTC standard timezone shifting. Logs are outputted with formatting matching the host server machine's regional timezone clock.

### 4.2 Log Rotation Configuration (`winston-daily-rotate-file`)
Logs are saved in the `logs/` folder with these bounds:
* `filename`: `application-%DATE%.log` (where `%DATE%` represents `YYYY-MM-DD`).
* `maxSize`: `20m` (files auto-split at 20 Megabytes).
* `maxFiles`: `90d` (removes logs older than 90 days).
* `zippedArchive`: Enabled (archives are gzip-compressed).

### 4.3 Morgan Log Redirection Stream
```javascript
logger.stream = {
  write: (message) => logger.info(message.trim())
};
```
* **Mechanism**: Express request logs generated by Morgan are redirected directly into the Winston logging stream, guaranteeing that network logs and application exceptions are recorded inside a single, unified log file.

---

## 🔒 5. Environmental Configurations (`.env`)

Variables defined inside `.env` configuration:

* `PORT`: Port the node process binds to (default: `5000`).
* `DATABASE_URL` (or split variables `PGUSER`, `PGPASSWORD`, `PGHOST`, `PGPORT`, `PGDATABASE`): Configures the PostgreSQL connection parameters.
* `JWT_SECRET`: Random hash key used to sign client authorization tokens.
* `NODE_ENV`: Runs in `production` to suppress debug stack-traces, or `development` to expose them.
