# 🛡️ Agra-sandhani: Deep-Dive Technical Reference & Architecture Report

This report provides a comprehensive, deep-dive reference detailing the internal architecture, database schema, data flows, security mechanisms, and integration interfaces of the **Agra-sandhani** (अग्र-Sandhani) Form Builder & Autocomplete engine.

---

## 🛠️ Chapter 1: System Overview & Architecture

Agra-sandhani is a highly secure, offline-first dynamic form builder and personnel information storage database designed to run in airgapped environments (e.g., DRDO labs). It functions as the database repository for employee/candidate information, which is consumed by the **Smart Office Noting** client to auto-fill noting templates.

### 1.1 High-Level Component Interaction Diagram

```
+---------------------------------------------------------------------------------+
|                               AIRGAPPED LAN                                     |
|                                                                                 |
|   +--------------------------+                 +----------------------------+   |
|   |   Smart Office Noting    | --(Lookup ID)-->|        Agra-sandhani       |   |
|   |  (Python/Flask Dashboard)| <--(Prefill Data|         Node/Express       |   |
|   +--------------------------+                 +----------------------------+   |
|                 |                                             |                 |
|            (Redirect)                                    (Query/Save)           |
|                 v                                             v                 |
|   +--------------------------+                 +----------------------------+   |
|   |    Form Prefill Tab      |                 |         PostgreSQL         |   |
|   |  (React submit + Token)  |                 |      Database Engine       |   |
|   +--------------------------+                 +----------------------------+   |
+---------------------------------------------------------------------------------+
```

### 1.2 Repository Directory Structure

```
Agra-sandhani/
├── .env                  # Port, database strings, JWT secrets
├── Launch_Offline.bat    # Airgapped host process wrapper
├── client/               # React Frontend (SPA)
│   ├── dist/             # Production distribution build folder
│   └── src/              # Source code (Components, Hooks, Services)
└── server/               # Node.js backend app
    ├── db/               # PostgreSQL pool configurations
    ├── middleware/       # JWT Authentication & rate limiters
    ├── models/           # DB lookup schemas
    ├── routes/           # REST endpoints
    ├── services/         # Logger stream services (Winston)
    └── index.js          # Express entrypoint
```

### 1.3 Security Controllers & Rate Limiting

The application runs inside a local network but implements production-grade security controllers to prevent Denial of Service (DoS) and brute-force penetration:

1. **Global Rate Limiter**:
   Applied to all `/api/*` endpoints to cap requests at 1000 requests per 15-minute window (`express-rate-limit`).
2. **Brute-Force Authentication Limiter**:
   Capped at 20 login/register requests per hour (`authLimiter`) targeting `/api/auth/login` and `/api/auth/register`.
3. **Helmet Header Protection**:
   Configured with Content Security Policy (CSP) disabled (`contentSecurityPolicy: false`) to allow the local HTML frames to load client files directly inside the offline portal without SSL certificates.
4. **CORS (Cross-Origin Resource Sharing)**:
   Enabled globally via the `cors()` middleware to allow cross-port requests from the Smart Office Noting Flask server (defaulting on port `5001`).

---

## 🗄️ Chapter 2: Database Schema & Storage Mechanics

Agra-sandhani utilizes **PostgreSQL** as its persistent storage engine. Because forms are created dynamically by administrators, the data model combines traditional relational indexing with JSONB columns to store arbitrary user submissions without database migrations.

### 2.1 Connection Pool Configurations (`db/pool.js`)

Database operations utilize `pg.Pool` with connection pooling to maximize concurrent query efficiency on low-end machines. It retrieves configuration details from `.env`:

* `PGUSER`: Database username
* `PGPASSWORD`: Database password
* `PGHOST`: Database host IP (typically `localhost` or `127.0.0.1`)
* `PGDATABASE`: Database name (typically `agra_db`)
* `PGPORT`: Database connection port (typically `5432`)

### 2.2 Core Relational Tables

```
                       +-------------------+
                       |       forms       |
                       +-------------------+
                       | id (PK)           |
                       | name              |
                       | description       |
                       | created_at        |
                       | deleted_at (soft) |
                       +-------------------+
                                 | 1
                                 |
                                 | 1..N
                       +-------------------+
                       |   form_versions   |
                       +-------------------+
                       | id (PK)           |
                       | form_id (FK)      |
                       | version_number    |
                       | created_at        |
                       +-------------------+
                                 | 1
                                 |
                       +---------+---------+
                       | 1..N              | 1..N
             +-------------------+   +-------------------+
             |    form_fields    |   |    submissions    |
             +-------------------+   +-------------------+
             | id (PK)           |   | id (PK)           |
             | form_version_id   |   | form_version_id   |
             | label (unique/row)|   | data_json (JSONB) |
             | type (text/date)  |   | submitted_at      |
             | field_order       |   | deleted_at (soft) |
             +-------------------+   +-------------------+
```

1. **`forms`**: Contains the metadata for each created form template (e.g. "DGMSS Nomination", "TBRL Candidate Info").
2. **`form_versions`**: Manages form schema revisions. When an admin updates fields, a new version is created. This ensures historical submissions are never broken if form schemas change.
3. **`form_fields`**: Defines the fields (inputs) for a specific form version (e.g., Label: "DOB", Type: "date").
4. **`submissions`**: Contains submitted user data. The `data_json` column uses PostgreSQL `JSONB` to store a key-value dictionary representing the form inputs.

### 2.3 Soft Deletion & Cron Trash Purging

* **Soft Delete**: In place of hard `DELETE` commands, entries have a `deleted_at` column. When a form or submission is removed, this column is populated with the timestamp.
* **Cron Purge**: Every 24 hours, an interval timer in `index.js` triggers a query to permanently delete items where `deleted_at` is older than 30 days:
  ```sql
  DELETE FROM submissions WHERE deleted_at < NOW() - INTERVAL '30 days';
  DELETE FROM forms WHERE deleted_at < NOW() - INTERVAL '30 days';
  ```

---

## 🔑 Chapter 3: Authentication, Permissions & Admin Systems

Access control ensures form creation, modification, and data lookups are restricted based on privileges.

### 3.1 Token-Based Authentication

JWT (JSON Web Token) authentication is enforced on all critical endpoints via `middleware/auth.js`.
* **Payload Structure**: Stores the user's ID, username, and role.
* **Token Lifetime**: Configured in `.env` (typically 8 hours).
* **Internal Routing Exemption**: The service integration API endpoints (`/api/service/*`) bypass human authentication and rely on local network routing bounds, but check for local subnet origins when configured.

### 3.2 Access Levels & Roles

* **Role: Submitter**: Can only view forms and save submissions. Cannot modify templates.
* **Role: Manager**: Can create forms, duplicate templates, edit field definitions, and export submission statistics.
* **Role: Superadmin**: Can manage user accounts, assign roles, inspect security logs, and wipe databases.

---

## 🧱 Chapter 4: Core Routing & API Reference Part 1 (Form Builder & Field Types)

The form builder interface inside Agra-sandhani allows administrators to configure dynamic forms. The field specifications are stored relationally in `form_fields` but submissions store their inputs as unstructured keys in the `data_json` of `submissions`.

### 4.1 Schema Modification & Auto-Migration Mechanics (`fields.js`)

When a form field is renamed in the form builder, the backend performs a real-time schema migration across all existing database submissions of that form version. This ensures that historical submissions are kept aligned with the new schema names:

```sql
UPDATE submissions 
SET data_json = (data_json - $1::text) || jsonb_build_object($2::text, data_json->$1)
```

* **`data_json - $1::text`**: Deletes the old key (variable name) from the JSONB document.
* **`|| jsonb_build_object($2::text, data_json->$1)`**: Concatenates a new JSONB pair mapping the new label ($2) to the value extracted from the old key ($1).
* **Locking Mechanism**: When a form has at least one submission, its version is locked (`is_locked = true`). Any subsequent schema edits automatically increment the `version_number` in `form_versions` to prevent corruption of locked datasets.

### 4.2 Supported Dynamic Field Types

* **`text`**: Standard alphanumeric input.
* **`date`**: Standard date input.
* **`number`**: Numeric values only.
* **`cgpa_converter`**: Dynamic formula converter translating CPI/CGPA directly to percentages.
* **`university_autocomplete`**: Matches against a database of Indian universities using trigram similarity.
* **`residential_address`**: Composite inputs split with the delimiter ` ||| ` (State, District, Address details).

---

## 📈 Chapter 5: Core Routing & API Reference Part 2 (Submissions & Exports)

Submissions manage the entry, validation, and offline reporting of form details.

### 5.1 Validation Engine

Dynamic validation is executed inside the `submissions.js` router prior to database inserts:
* **Required Check**: Iterates through the form's version fields list and throws a 400 error if mapped keys are missing.
* **Unique Check**: If a field is flagged as unique (e.g. Employee ID or PIS number), a subquery scans existing data:
  ```sql
  SELECT s.id FROM submissions s
  JOIN form_versions fv ON s.form_version_id = fv.id
  WHERE fv.form_id = $1 AND s.deleted_at IS NULL AND s.data_json->>$2 = $3 LIMIT 1
  ```
  If a collision occurs, a `409 Conflict` status is returned with details of the duplicate key.

### 5.2 Streaming Excel Export (`export.js`)

Exporting submissions uses `exceljs` with a streaming writer to support low-end PCs:
* **Memory Optimization**: Utilizes `ExcelJS.stream.xlsx.WorkbookWriter` instead of keeping the sheet in RAM.
* **Frozen Panes**: Freezes the header row (`views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]`) for high usability.
* **Dynamic Columns**: Maps the keys from `data_json` to worksheet headers dynamically.

---

## 🤝 Chapter 6: Service Integration & PIS Lookup Bridge API

The integration layer in `routes/service-integration.js` enables external services (like the Smart Office Noting dashboard) to search and retrieve personnel datasets securely.

### 6.1 Autocomplete Lookup Endpoint

* **Route**: `GET /api/service/search?query=<query>&formId=<formId>`
* **Logic**: Employs a PostgreSQL Common Table Expression (CTE) combined with fuzzy trigram matching to scan PIS numbers and names.
* **Query Performance**: Uses indexes on the `data_json` key path to retrieve candidate names/IDs within milliseconds.

### 6.2 Full Personnel Record Fetch

* **Route**: `GET /api/service/lookup?pis=<id>&formId=<formId>`
* **Logic**: Fetches the most recent submission matching the employee ID.
* **Smart Mapping Fallback**: If the requested field maps do not match exactly, the engine uses a fuzzy heuristic pass to assign database fields (e.g., matching `roll`, `emp id`, `personnel`, or `id` to the local noting PIS variables).

### 6.3 Staged Prefill Session Store

To allow the noting client to redirect users to a prefilled form without passing lengthy payload variables in the browser query string, a staged session is utilized:
* **Token Creation**: `POST /api/service/prefill-session` accepts the form values and stores them in a memory map:
  ```javascript
  const prefillToken = `prefill_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  global.prefillCache.set(prefillToken, { formId, values, createdAt: Date.now() });
  ```
* **Redirection Link**: Returns the token to the client. The client redirects to:
  `http://localhost:5000/forms/<formId>/submit?prefillToken=<token>`
* **Single-Use Consume**: When the React UI loads, it calls `GET /api/forms/:id/prefill-session/:prefillToken` to fetch and render the values, immediately deleting the token from `global.prefillCache` to free memory and prevent double submissions.

---

## 🚀 Chapter 7: Autocomplete Engines & Offline Airgap Architecture

### 7.1 University Database Autocomplete (`routes/autocomplete.js`)

* **Acronym-Fuzzy Regex Search**: Splitting abbreviations (e.g., "PEC" converts to `P.*E.*C` for fuzzy regex matches against `P.E.C.`).
* **Trigram Similarity**: Orders results based on `similarity(name, $3)` to provide highly tolerant search results.
* **Adaptive Learning**: If a user enters a university location that does not exist in the static database (`india_states_districts.json`), the system automatically inserts the new state/district pair into the database, dynamically updating future autocomplete options.

### 7.2 Airgapped Host Mechanics

Agra-sandhani runs offline using `Launch_Offline.bat` which launches the server using local PM2 or Node binaries. All UI assets are pre-built to the `client/dist/` directory, letting Express host the React single-page app static files. The system runs fully without any external gateway, DNS resolver, or package repository.

---

## 🏁 Summary Conclusion

By combining PostgreSQL JSONB structures with dynamic index mapping, rate limiting, inline dynamic migrations, and staged prefill caches, Agra-sandhani operates as a robust, enterprise-grade database engine designed for maximum offline security and high performance on low-end hardware.
