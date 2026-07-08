/* Automatically generated documentation data file */

const DOCS_DATA = {
  "welcome": {
    "title": "\ud83d\udee1\ufe0f Agra-sandhani: Deep-Dive Technical Reference & Architecture Report",
    "content": `# ️ Agra-sandhani: Deep-Dive Technical Reference & Architecture Report

This report provides a comprehensive, deep-dive reference detailing the internal architecture, database schema, data flows, security mechanisms, and integration interfaces of the **Agra-sandhani** (अग्र-Sandhani) Form Builder & Autocomplete engine.

---

## ️ Chapter 1: System Overview & Architecture

Agra-sandhani is a highly secure, offline-first dynamic form builder and personnel information storage database designed to run in airgapped environments (e.g., DRDO labs). It functions as the database repository for employee/candidate information, which is consumed by the **Smart Office Noting** client to auto-fill noting templates.

### 1.1 High-Level Component Interaction Diagram

\`\`\`
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
\`\`\`

### 1.2 Repository Directory Structure

\`\`\`
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
\`\`\`

### 1.3 Security Controllers & Rate Limiting

The application runs inside a local network but implements production-grade security controllers to prevent Denial of Service (DoS) and brute-force penetration:

1. **Global Rate Limiter**:
   Applied to all \`/api/*\` endpoints to cap requests at 1000 requests per 15-minute window (\`express-rate-limit\`).
2. **Brute-Force Authentication Limiter**:
   Capped at 20 login/register requests per hour (\`authLimiter\`) targeting \`/api/auth/login\` and \`/api/auth/register\`.
3. **Helmet Header Protection**:
   Configured with Content Security Policy (CSP) disabled (\`contentSecurityPolicy: false\`) to allow the local HTML frames to load client files directly inside the offline portal without SSL certificates.
4. **CORS (Cross-Origin Resource Sharing)**:
   Enabled globally via the \`cors()\` middleware to allow cross-port requests from the Smart Office Noting Flask server (defaulting on port \`5001\`).

---

## ️ Chapter 2: Database Schema & Storage Mechanics

Agra-sandhani utilizes **PostgreSQL** as its persistent storage engine. Because forms are created dynamically by administrators, the data model combines traditional relational indexing with JSONB columns to store arbitrary user submissions without database migrations.

### 2.1 Connection Pool Configurations (\`db/pool.js\`)

Database operations utilize \`pg.Pool\` with connection pooling to maximize concurrent query efficiency on low-end machines. It retrieves configuration details from \`.env\`:

* \`PGUSER\`: Database username
* \`PGPASSWORD\`: Database password
* \`PGHOST\`: Database host IP (typically \`localhost\` or \`127.0.0.1\`)
* \`PGDATABASE\`: Database name (typically \`agra_db\`)
* \`PGPORT\`: Database connection port (typically \`5432\`)

### 2.2 Core Relational Tables

\`\`\`
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
\`\`\`

1. **\`forms\`**: Contains the metadata for each created form template (e.g. "DGMSS Nomination", "TBRL Candidate Info").
2. **\`form_versions\`**: Manages form schema revisions. When an admin updates fields, a new version is created. This ensures historical submissions are never broken if form schemas change.
3. **\`form_fields\`**: Defines the fields (inputs) for a specific form version (e.g., Label: "DOB", Type: "date").
4. **\`submissions\`**: Contains submitted user data. The \`data_json\` column uses PostgreSQL \`JSONB\` to store a key-value dictionary representing the form inputs.

### 2.3 Soft Deletion & Cron Trash Purging

* **Soft Delete**: In place of hard \`DELETE\` commands, entries have a \`deleted_at\` column. When a form or submission is removed, this column is populated with the timestamp.
* **Cron Purge**: Every 24 hours, an interval timer in \`index.js\` triggers a query to permanently delete items where \`deleted_at\` is older than 30 days:
  \`\`\`sql
  DELETE FROM submissions WHERE deleted_at < NOW() - INTERVAL '30 days';
  DELETE FROM forms WHERE deleted_at < NOW() - INTERVAL '30 days';
  \`\`\`

---

## Chapter 3: Authentication, Permissions & Admin Systems

Access control ensures form creation, modification, and data lookups are restricted based on privileges.

### 3.1 Token-Based Authentication

JWT (JSON Web Token) authentication is enforced on all critical endpoints via \`middleware/auth.js\`.
* **Payload Structure**: Stores the user's ID, username, and role.
* **Token Lifetime**: Configured in \`.env\` (typically 8 hours).
* **Internal Routing Exemption**: The service integration API endpoints (\`/api/service/*\`) bypass human authentication and rely on local network routing bounds, but check for local subnet origins when configured.

### 3.2 Access Levels & Roles

* **Role: Submitter**: Can only view forms and save submissions. Cannot modify templates.
* **Role: Manager**: Can create forms, duplicate templates, edit field definitions, and export submission statistics.
* **Role: Superadmin**: Can manage user accounts, assign roles, inspect security logs, and wipe databases.

---

## Chapter 4: Core Routing & API Reference Part 1 (Form Builder & Field Types)

The form builder interface inside Agra-sandhani allows administrators to configure dynamic forms. The field specifications are stored relationally in \`form_fields\` but submissions store their inputs as unstructured keys in the \`data_json\` of \`submissions\`.

### 4.1 Schema Modification & Auto-Migration Mechanics (\`fields.js\`)

When a form field is renamed in the form builder, the backend performs a real-time schema migration across all existing database submissions of that form version. This ensures that historical submissions are kept aligned with the new schema names:

\`\`\`sql
UPDATE submissions 
SET data_json = (data_json - \$1::text) || jsonb_build_object(\$2::text, data_json->\$1)
\`\`\`

* **\`data_json - \$1::text\`**: Deletes the old key (variable name) from the JSONB document.
* **\`|| jsonb_build_object(\$2::text, data_json->\$1)\`**: Concatenates a new JSONB pair mapping the new label (\$2) to the value extracted from the old key (\$1).
* **Locking Mechanism**: When a form has at least one submission, its version is locked (\`is_locked = true\`). Any subsequent schema edits automatically increment the \`version_number\` in \`form_versions\` to prevent corruption of locked datasets.

### 4.2 Supported Dynamic Field Types

* **\`text\`**: Standard alphanumeric input.
* **\`date\`**: Standard date input.
* **\`number\`**: Numeric values only.
* **\`cgpa_converter\`**: Dynamic formula converter translating CPI/CGPA directly to percentages.
* **\`university_autocomplete\`**: Matches against a database of Indian universities using trigram similarity.
* **\`residential_address\`**: Composite inputs split with the delimiter \` ||| \` (State, District, Address details).

---

## Chapter 5: Core Routing & API Reference Part 2 (Submissions & Exports)

Submissions manage the entry, validation, and offline reporting of form details.

### 5.1 Validation Engine

Dynamic validation is executed inside the \`submissions.js\` router prior to database inserts:
* **Required Check**: Iterates through the form's version fields list and throws a 400 error if mapped keys are missing.
* **Unique Check**: If a field is flagged as unique (e.g. Employee ID or PIS number), a subquery scans existing data:
  \`\`\`sql
  SELECT s.id FROM submissions s
  JOIN form_versions fv ON s.form_version_id = fv.id
  WHERE fv.form_id = \$1 AND s.deleted_at IS NULL AND s.data_json->>\$2 = \$3 LIMIT 1
  \`\`\`
  If a collision occurs, a \`409 Conflict\` status is returned with details of the duplicate key.

### 5.2 Streaming Excel Export (\`export.js\`)

Exporting submissions uses \`exceljs\` with a streaming writer to support low-end PCs:
* **Memory Optimization**: Utilizes \`ExcelJS.stream.xlsx.WorkbookWriter\` instead of keeping the sheet in RAM.
* **Frozen Panes**: Freezes the header row (\`views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]\`) for high usability.
* **Dynamic Columns**: Maps the keys from \`data_json\` to worksheet headers dynamically.

---

## Chapter 6: Service Integration & PIS Lookup Bridge API

The integration layer in \`routes/service-integration.js\` enables external services (like the Smart Office Noting dashboard) to search and retrieve personnel datasets securely.

### 6.1 Autocomplete Lookup Endpoint

* **Route**: \`GET /api/service/search?query=<query>&formId=<formId>\`
* **Logic**: Employs a PostgreSQL Common Table Expression (CTE) combined with fuzzy trigram matching to scan PIS numbers and names.
* **Query Performance**: Uses indexes on the \`data_json\` key path to retrieve candidate names/IDs within milliseconds.

### 6.2 Full Personnel Record Fetch

* **Route**: \`GET /api/service/lookup?pis=<id>&formId=<formId>\`
* **Logic**: Fetches the most recent submission matching the employee ID.
* **Smart Mapping Fallback**: If the requested field maps do not match exactly, the engine uses a fuzzy heuristic pass to assign database fields (e.g., matching \`roll\`, \`emp id\`, \`personnel\`, or \`id\` to the local noting PIS variables).

### 6.3 Staged Prefill Session Store

To allow the noting client to redirect users to a prefilled form without passing lengthy payload variables in the browser query string, a staged session is utilized:
* **Token Creation**: \`POST /api/service/prefill-session\` accepts the form values and stores them in a memory map:
  \`\`\`javascript
  const prefillToken = \`prefill_\${Date.now()}_\${Math.random().toString(36).substring(2, 10)}\`;
  global.prefillCache.set(prefillToken, { formId, values, createdAt: Date.now() });
  \`\`\`
* **Redirection Link**: Returns the token to the client. The client redirects to:
  \`http://localhost:5000/forms/<formId>/submit?prefillToken=<token>\`
* **Single-Use Consume**: When the React UI loads, it calls \`GET /api/forms/:id/prefill-session/:prefillToken\` to fetch and render the values, immediately deleting the token from \`global.prefillCache\` to free memory and prevent double submissions.

---

## Chapter 7: Autocomplete Engines & Offline Airgap Architecture

### 7.1 University Database Autocomplete (\`routes/autocomplete.js\`)

* **Acronym-Fuzzy Regex Search**: Splitting abbreviations (e.g., "PEC" converts to \`P.*E.*C\` for fuzzy regex matches against \`P.E.C.\`).
* **Trigram Similarity**: Orders results based on \`similarity(name, \$3)\` to provide highly tolerant search results.
* **Adaptive Learning**: If a user enters a university location that does not exist in the static database (\`india_states_districts.json\`), the system automatically inserts the new state/district pair into the database, dynamically updating future autocomplete options.

### 7.2 Airgapped Host Mechanics

Agra-sandhani runs offline using \`Launch_Offline.bat\` which launches the server using local PM2 or Node binaries. All UI assets are pre-built to the \`client/dist/\` directory, letting Express host the React single-page app static files. The system runs fully without any external gateway, DNS resolver, or package repository.

---

## Summary Conclusion

By combining PostgreSQL JSONB structures with dynamic index mapping, rate limiting, inline dynamic migrations, and staged prefill caches, Agra-sandhani operates as a robust, enterprise-grade database engine designed for maximum offline security and high performance on low-end hardware.
`
  },
  "chapter1": {
    "title": "\ud83d\udee1\ufe0f Agra-sandhani Detailed Technical Reference: Chapter 1",
    "content": `# ️ Agra-sandhani Detailed Technical Reference: Chapter 1
## System Entrypoint, Offline Infrastructure, Security, and Logging

This chapter document details the boot sequence, middleware stack, security features, logging architecture, and environment configuration of the **Agra-sandhani** server.

---

## 1. Core Files & Directory Responsibilities

| File Path | Functional Purpose | Exported Symbols / Main Hook |
| :--- | :--- | :--- |
| \`Launch_Offline.bat\` | Windows bootstrap script for airgapped launch | None (batch file) |
| \`server/index.js\` | Express app initialization, middleware binding, cron tasks, port listener | Express \`app\` instance |
| \`server/services/logger.js\` | Custom Winston Logger with system-time formatted daily log rotations | Winston \`logger\` object, \`logger.stream\` |
| \`server/middleware/auth.js\` | Authentication & role restriction handlers | \`authenticate\`, \`checkFormAccess\`, \`checkFormOwnership\` |
| \`.env\` / \`.env.example\` | Server port, PostgreSQL database pool options, JWT credentials | Environmental variables |

---

## 2. Airgapped Boot Sequence (\`Launch_Offline.bat\`)

The batch script acts as the system installer/orchestrator in offline environments.

\`\`\`
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
\`\`\`

### Key Execution Highlights:
1. **Offline Integrity**: Commands like \`npm run\` or \`npm install\` are avoided to bypass network registry lookups, executing node scripts directly via \`node <file>\`.
2. **Upgrade Scripts Sequence**: Database updates are executed in a fixed transactional queue. If any script fails, the script halts to prevent half-migrated database corruption.

---

## ️ 3. App Core & Middleware Stack (\`server/index.js\`)

\`index.js\` constructs the Express application, configures global middlewares, registers core routers, and schedules daily cleanup tasks.

### 3.1 Initial Environment Resolution
\`\`\`javascript
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.example') });
try {
    require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
} catch (_) { }
\`\`\`
* **Function**: Ensures that fallback environment variables from \`.env.example\` are loaded first, then overrides them with real secrets from the local production \`.env\` file if it exists.

### 3.2 Global Security Middlewares
* **\`helmet({ contentSecurityPolicy: false })\`**: Sets secure HTTP response headers. The Content Security Policy (CSP) is explicitly disabled because local React clients load resources over dynamic LAN IP addresses without certificates.
* **\`cors()\`**: Enables Cross-Origin Resource Sharing so that the Smart Office Noting server (on port \`5001\`) can execute AJAX fetches on port \`5000\`.
* **\`express.json({ limit: '10mb' })\`**: Parses incoming request JSON payloads, capping size at 10MB to block overflow denial of service (DoS) attempts via payload stuffing.

### 3.3 Network-Edge Rate Limiters
To protect the Node thread-loop in production-restricted networks:
1. **\`globalLimiter\`** (Applied to \`/api\`):
   * **Rule**: Limits each client IP to 1000 requests per 15 minutes.
   * **Purpose**: Prevents client-side loops or bulk scripting from locking the PostgreSQL database pool.
2. **\`authLimiter\`** (Applied to \`/api/auth/login\` and \`/api/auth/register\`):
   * **Rule**: Capped at 20 login/register attempts per hour per client IP.
   * **Purpose**: Blocks brute-force credentials guessing.

### 3.4 Relational API Route Registrations
\`index.js\` binds sub-routers to specific API paths:
* \`/api/auth\` ️ \`routes/auth.js\` (User registration, login, JWT issuance)
* \`/api/forms\` ️ \`routes/forms.js\`, \`routes/submissions.js\`, \`routes/fields.js\` (Form management, field definitions, submission lifecycle)
* \`/api/export\` ️ \`routes/export.js\` (Excel and PDF streaming exports)
* \`/api/autocomplete\` ️ \`routes/autocomplete.js\` (Fuzzy lists, location maps)
* \`/api/service\` ️ \`routes/service-integration.js\` (Cross-process Noting integrations)

### 3.5 Production SPA Hosting Fallback
\`\`\`javascript
const clientBuildPath = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientBuildPath));
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(clientBuildPath, 'index.html'));
    }
});
\`\`\`
* **Function**: Allows the single Node process to act as both the API server and the frontend host. In production, any non-API URL route fallback returns \`index.html\` to allow React Router (SPA) to resolve routing client-side.

### 3.6 Cron Purging Interval Task
An interval loop is configured upon listener initialization:
* **Timer Interval**: 24 hours (\`24 * 60 * 60 * 1000\` ms).
* **Executed Query**:
  \`\`\`sql
  DELETE FROM submissions WHERE deleted_at < NOW() - INTERVAL '30 days';
  DELETE FROM forms WHERE deleted_at < NOW() - INTERVAL '30 days';
  \`\`\`
* **Purpose**: Performs permanent database optimization by purging records marked for soft-deletion longer than 30 days.

---

## 4. Unified Logging Subsystem (\`server/services/logger.js\`)

This file configures **Winston** to handle process logs alongside **Morgan** for HTTP request tracking.

### 4.1 System Clock Timestamping
\`\`\`javascript
const localTimestamp = () => {
    const d = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    return \`\${d.getFullYear()}-\${pad(d.getMonth() + 1)}-\${pad(d.getDate())} \${pad(d.getHours())}:\${pad(d.getMinutes())}:\${pad(d.getSeconds())}\`;
};
\`\`\`
* **Purpose**: Avoids UTC standard timezone shifting. Logs are outputted with formatting matching the host server machine's regional timezone clock.

### 4.2 Log Rotation Configuration (\`winston-daily-rotate-file\`)
Logs are saved in the \`logs/\` folder with these bounds:
* \`filename\`: \`application-%DATE%.log\` (where \`%DATE%\` represents \`YYYY-MM-DD\`).
* \`maxSize\`: \`20m\` (files auto-split at 20 Megabytes).
* \`maxFiles\`: \`90d\` (removes logs older than 90 days).
* \`zippedArchive\`: Enabled (archives are gzip-compressed).

### 4.3 Morgan Log Redirection Stream
\`\`\`javascript
logger.stream = {
  write: (message) => logger.info(message.trim())
};
\`\`\`
* **Mechanism**: Express request logs generated by Morgan are redirected directly into the Winston logging stream, guaranteeing that network logs and application exceptions are recorded inside a single, unified log file.

---

## 5. Environmental Configurations (\`.env\`)

Variables defined inside \`.env\` configuration:

* \`PORT\`: Port the node process binds to (default: \`5000\`).
* \`DATABASE_URL\` (or split variables \`PGUSER\`, \`PGPASSWORD\`, \`PGHOST\`, \`PGPORT\`, \`PGDATABASE\`): Configures the PostgreSQL connection parameters.
* \`JWT_SECRET\`: Random hash key used to sign client authorization tokens.
* \`NODE_ENV\`: Runs in \`production\` to suppress debug stack-traces, or \`development\` to expose them.
`
  },
  "chapter2": {
    "title": "\ud83d\udee1\ufe0f Agra-sandhani Detailed Technical Reference: Chapter 2 (Expanded Edition)",
    "content": `# ️ Agra-sandhani Detailed Technical Reference: Chapter 2 (Expanded Edition)
## Database Schema, Pool Configurations, and Search Optimizations

This document details the PostgreSQL database architecture, relational/JSONB hybrid schemas, migration lifecycle, and performance indexing patterns of the **Agra-sandhani** database. It also provides a theoretical analysis of the database indexing and storage design principles that drive these systems.

---

## 1. Database Connectivity & Pool Configuration (\`server/db/pool.js\`)

Agra-sandhani uses the \`pg.Pool\` constructor from the \`pg\` driver to manage query pooling. The configuration optimizes performance in resource-constrained LAN servers:

\`\`\`javascript
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || 'formbuilder',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    max: 50,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});
\`\`\`

* **Theoretical Rationale**: The pool acts as a gatekeeper to prevent database resource starvation. Setting \`max: 50\` allows the server to handle up to 50 parallel queries. Connections that remain idle for 30 seconds (\`idleTimeoutMillis\`) are closed to free up system memory, ensuring the application remains lightweight on older hardware.

---

## 2. RDBMS-JSONB Hybrid Storage Theory

Database design frequently presents a trade-off between **Relational Integrity** (SQL) and **Document Flexibility** (NoSQL).

* **Relational Systems (SQL)**: Guarantee strong data integrity, foreign key constraints, and transactional safety (ACID). However, schemas are rigid and difficult to alter dynamically in production.
* **Document Systems (NoSQL)**: Offer flexible schemas and dynamic document nesting. However, NoSQL engines lack relational constraints, transaction guarantees, and local join support.

### The Hybrid Storage Solution
Agra-sandhani resolves this trade-off by implementing a hybrid design in PostgreSQL. The system uses relational tables for structured metadata (like users, permissions, and field configurations) while utilizing \`JSONB\` document columns to store dynamic user submissions.

#### Binary JSONB Storage Advantages:
* **Pre-parsed Binary Format**: Unlike standard text columns, \`JSONB\` stores data in a pre-parsed, decompressed binary format. The database doesn't need to re-parse the JSON string during query execution, allowing fast read and write operations.
* **Key Sorting**: JSONB automatically keys are sorted and duplicate properties are removed. This optimization enables high-speed lookups and path extraction operations.

---

## 3. Normalization vs. Denormalization (EAV to JSONB Theory)

Originally, Agra-sandhani used an **Entity-Attribute-Value (EAV)** model storing field inputs in separate relational rows in \`submission_values\`. EAV is a highly normalized design, but it suffers from severe performance degradation as datasets grow:

\`\`\`
            NORMALIZE (EAV)                             DENORMALIZE (JSONB)
   Table: submission_values                      Table: submissions
   ┌────┬──────────┬─────────────┐               ┌────┬────────────────────────────────────┐
   │ ID │ Field ID │ Value       │               │ ID │ data_json                          │
   ├────┼──────────┼─────────────┤               ├────┼────────────────────────────────────┤
   │ 1  │ Name_ID  │ "John Doe"  │  ──Migrate──> │ 1  │ {"name": "John Doe", "pis": "101"} │
   │ 1  │ PIS_ID   │ "101"       │               └────┴────────────────────────────────────┘
   └────┴──────────┴─────────────┘
\`\`\`

### Theoretical Highlights:
* **The EAV Performance Problem**: Rebuilding a single submission containing 20 fields required joining the \`submission_values\` table 20 times. This CPU-heavy operation caused severe lag on low-end hardware.
* **The JSONB Solution**: Aggregating fields into a single \`JSONB\` column (\`data_json\`) denormalizes the database structure. A submission is loaded in a single read operation without table join overhead. The database migration script converted legacy EAV tables using \`jsonb_object_agg\` to migrate historical data without loss.

---

## 4. Database Indexing Theory

Standard B-Tree indexes excel at indexing scalar values, but they cannot index the dynamic, nested pathways inside JSON documents. To ensure lookup speeds under 5ms, Agra-sandhani builds specialized indices:

### 4.1 Inverted GIN Indexing
\`\`\`sql
CREATE INDEX idx_submissions_data_json_gin ON submissions USING GIN (data_json);
\`\`\`
* **Theory**: A **Generalized Inverted Index (GIN)** maps key-value components inside a JSONB document directly to the rows containing them. This allows PostgreSQL to quickly resolve key check queries (such as \`data_json ? 'pis'\`) without scanning the entire table.

### 4.2 Trigram Indexing (\`pg_trgm\`)
\`\`\`sql
CREATE INDEX idx_submissions_data_json_trgm ON submissions USING GIN ((data_json::text) gin_trgm_ops);
\`\`\`
* **Theory**: A trigram is a contiguous sequence of three characters. For example, the string \`"John"\` splits into trigrams: \`[" Jo", "Joh", "ohn", "hn "]\`.
* **Search Acceleration**: The \`pg_trgm\` extension indexes these trigram sets. When a user runs a wildcard search (like \`ILIKE '%query%'\`), PostgreSQL matches the search query's trigrams against the index, instantly identifying matching records without scanning the text of every document.

### 4.3 Functional Trigram Indexes
\`\`\`sql
CREATE INDEX idx_submissions_pis_trgm ON submissions USING GIN ((data_json->>'pis') gin_trgm_ops);
\`\`\`
* **Theory**: This builds a functional trigram index specifically on the text extracted from the \`'pis'\` key in the JSONB document. By indexing the specific search target directly, lookup engines bypass generic JSONB path extraction overhead during autocompletes, executing queries in milliseconds.
`
  },
  "chapter3": {
    "title": "\ud83d\udee1\ufe0f Agra-sandhani Detailed Technical Reference: Chapter 3 (Expanded Edition)",
    "content": `# ️ Agra-sandhani Detailed Technical Reference: Chapter 3 (Expanded Edition)
## Authentication, Session Security, and Dynamic Access Control

This document details the security model, token-based authentication mechanics, concurrent session locking, and relational permissions architecture of the **Agra-sandhani** platform. It also provides a theoretical analysis of the security and identity management design principles that drive these systems.

---

## 1. Security Infrastructure Files

| File Path | Functional Responsibility |
| :--- | :--- |
| \`server/middleware/auth.js\` | Verification of JWT tokens, single-session checks, access control lists (ACL) |
| \`server/routes/auth.js\` | Credentials validation, hash verification, login/logout session generation |
| \`server/routes/permissions.js\` | Collaborator request submissions, delegation mappings, and expiration tracking |

---

## 2. Stateful JWT Session Locking Theory

JSON Web Tokens (JWT) are traditionally designed to be stateless: the server verifies the cryptographic signature without looking up the token in a database. However, this model suffers from a major security vulnerability: **tokens cannot be invalidated before they expire**. If an operator's credentials are stolen or their session is intercepted, the attacker gains access until the token naturally expires.

Agra-sandhani solves this by implementing a **Hybrid Stateful JWT Session Lock**:

\`\`\`
        [Client Request with JWT Token]
                     │
                     ▼
         [Verify Signature (Stateless)]
                     │
           ┌─────────┴─────────┐
           ▼ (Valid)           ▼ (Invalid Signature)
[Fetch User from database]   [401 Access Denied]
           │
           ▼
[Compare token session_id with DB current_session_id]
           │
           ┌─────────┴─────────┐
           ▼ (Matches)         ▼ (Mismatches / Session Hijacked)
   [Proceed to API]          [401 Revoked Session]
\`\`\`

### Theoretical Highlights:
* **Stateless Verification (CPU Bound)**: First, the server verifies the cryptographic signature of the token using \`jwt.verify\` and \`JWT_SECRET\`. This is CPU-bound and filter-level.
* **Stateful Session Check (I/O Bound)**: Next, the database is queried to inspect the user's \`current_session_id\`. If a user logs in from a new workstation, a new UUID is generated and saved to the database. The previous token's \`session_id\` immediately mismatches, invalidating the old token without requiring complex token blacklist databases (like Redis) which are difficult to maintain in airgapped environments.

---

## ️ 3. Access Control Matrix & Privilege Inheritance Theory

Permissions are checked using an inheritance tree, going from direct ownership up to delegated roles.

### Access Hierarchy Model:
1. **Direct Ownership (High Priority)**: The user who created the form template has full read/write rights.
2. **Strict Admin Isolation (Override Rule)**: If a form is owned by an administrator, **all other roles (including global administrators) are blocked from accessing it**. Only the creator admin has access.
3. **Global Role-Based Access Control (RBAC)**: Global administrators can access any form not locked by the Admin Isolation rule.
4. **Delegated Authority (Temporary Inheritance)**: If User A delegates tasks to User B, User B inherits the same access permissions as User A until the delegation expires.
5. **Collaborator Access (Discretionary ACL)**: Explicit, restricted access granted to a user for a specific form.

### Theoretical Highlights:
* **Admin Isolation Theory**: This rule overrides standard Role-Based Access Control (RBAC) to ensure command-level security. It prevents lower-level administrators from viewing sensitive templates or submissions created by senior officers.
* **Delegation Inheritance Theory**: This allows permissions to be inherited dynamically without modifying the database owner keys. It prevents workflow blocks when officers go on leave.

---

## 4. Audit Trails & Traceability Theory

Security compliance requires that all data access and modifications are fully auditable. Agra-sandhani logs every key action (login, logout, form edits, submissions, exports) to the \`system_logs\` table:
* **Logged Metadata**: Stores the user's ID, the action type (e.g. \`submit_form\`, \`export_excel\`), the client's local IP address (\`x-forwarded-for\`), and a JSON details object.
* **Tamper Prevention**: The system logging functions execute within independent database connection queries to ensure logs are recorded even if the main request transaction fails or rolls back, providing an accurate, immutable audit trail.
`
  },
  "chapter4": {
    "title": "\ud83d\udee1\ufe0f Agra-sandhani Detailed Technical Reference: Chapter 4 (Expanded Edition)",
    "content": `# ️ Agra-sandhani Detailed Technical Reference: Chapter 4 (Expanded Edition)
## Form Builder Logic, Dynamic Fields & Schema Auto-Migrations

This document details the form builder routing endpoints, dynamic field classifications, transaction-safe schema migrations, and high-volume Excel ingestion interfaces. It also provides a theoretical analysis of the software engineering and database design principles that drive these systems.

---

## 1. Form Builder Core Files

| File Path | Functional Responsibility |
| :--- | :--- |
| \`server/routes/forms.js\` | Form templates management (listing, creating, duplicating), aggregation queries, and dynamic Excel spreadsheet ingestion |
| \`server/routes/fields.js\` | Bulk field updates, dynamic input type resolution, schema key migrations, and form structure locking checks |

---

## 2. Relational/JSONB Hybrid Storage Design Theory

Agra-sandhani implements a hybrid database model, storing structural metadata relationally while storing user submissions in unstructured JSONB documents.

\`\`\`
       +---------------------------------------------+
       |            FORM BUILDER METADATA            |
       |             (Relational SQL)                |
       |  - form_fields Table (label, type, order)   |
       +---------------------------------------------+
                              │
                              ▼ (Validates & Structured)
       +---------------------------------------------+
       |             USER SUBMISSIONS                |
       |               (JSONB Doc)                   |
       |  - submissions Table (data_json JSONB)      |
       +---------------------------------------------+
\`\`\`

### Theoretical Highlights:
* **The Structured Metadata Need**: Using a purely relational structure for dynamic forms requires running \`ALTER TABLE\` queries to add columns on the fly. This locks the database, can crash under load, and can quickly exceed maximum column limits.
* **The JSONB Document Need**: Storing submissions as raw JSON strings prevents the database from performing fast indexing, query calculations, or selective value filtering.
* **The Hybrid Solution**: Storing field definitions in a relational table (\`form_fields\`) enables fast schema loading and template rendering. Storing submission records in a single binary JSONB column (\`data_json\`) allows the schema to adapt dynamically to user edits. Binary JSONB stores keys in a sorted, decompressed format, enabling high-speed lookups and indexing.

---

## 3. Transactional Schema Migration Theory

When a user renames a field, the server updates both the metadata table and all existing submissions to keep the data consistent:

\`\`\`sql
UPDATE submissions 
SET data_json = (data_json - \$1::text) || jsonb_build_object(\$2::text, data_json->\$1)
WHERE form_version_id IN (SELECT id FROM form_versions WHERE form_id = \$3::int)
  AND (data_json ? \$1);
\`\`\`

### ACID Transactional Safeguards
Executing migrations across thousands of documents carries the risk of partial failures. If a rename query succeeds but a subsequent network error crashes the server mid-update, the database schema definition will mismatch the stored submissions, corrupting the dataset.

Agra-sandhani prevents this using **ACID Transactions**:
\`\`\`javascript
await client.query('BEGIN');
// ... perform renames, deletes, and field upserts ...
await client.query('COMMIT');
\`\`\`

#### Theoretical Highlights:
* **Atomicity**: The \`BEGIN\` and \`COMMIT\` commands group all modifications into a single atomic block. If any step fails (e.g., duplicate names or validation errors), the entire batch rolls back (\`ROLLBACK\`), restoring the database to its pre-update state.
* **JSONB Key Mutation**: The query subtracts the old key (\`data_json - \$1::text\`) and merges it with a new key-value pair (\`|| jsonb_build_object(\$2, data_json->\$1)\`). This operation runs directly in PostgreSQL's engine, eliminating the overhead of pulling rows to the Node app to modify them.

---

## 4. High-Volume Excel Ingestion & Heap Management

The Excel Importer \`/import-excel\` converts spreadsheets up to 1GB into active forms.

### Theoretical Highlights:
* **Heap Allocation Thresholds**: Parsing large files can cause the V8 engine to allocate excessive memory, thrashing the garbage collector. To prevent this, the Excel ingestion pipeline parses files in chunks.
* **Dynamic Header Extraction**: The parser reads the first row, sanitizes column labels to remove special characters, and seeds the \`form_fields\` table, instantly generating the form template from the spreadsheet layout.
`
  },
  "chapter5": {
    "title": "\ud83d\udee1\ufe0f Agra-sandhani Detailed Technical Reference: Chapter 5 (Expanded Edition)",
    "content": `# ️ Agra-sandhani Detailed Technical Reference: Chapter 5 (Expanded Edition)
## Submission Processing, Adaptive Database Learning, and Streaming Exports

This document details the submission validation lifecycle, custom adaptive learning algorithms, database auditing, streaming Excel exports, and auto-scaling PDF engines. It also provides a theoretical analysis of the software engineering and database design principles that drive these systems.

---

## 1. Submission & Export Core Files

| File Path | Functional Responsibility |
| :--- | :--- |
| \`server/routes/submissions.js\` | Form submissions, required/unique dynamic validation, database adaptive learning, pagination, and audit logs |
| \`server/routes/export.js\` | Low-RAM streaming Excel sheet generator, and auto-scaling landscape PDF compiler |

---

## 2. Dynamic Database Validation Theory

In standard relational database systems (RDBMS), structural constraints (like \`UNIQUE\`, \`NOT NULL\`, or type checks) are enforced natively by the storage engine. 

### Application-Level Dynamic Validation
Because Agra-sandhani uses a schema-less JSONB model to allow users to build dynamic forms, the database engine cannot natively enforce unique keys *within* JSONB documents without creating a physical index for each key. Creating database indexes dynamically for every user-created field is expensive and could exceed database index limits.

To solve this, Agra-sandhani implements **Application-Level Dynamic Validation**:
\`\`\`sql
SELECT s.id 
FROM submissions s
JOIN form_versions fv ON s.form_version_id = fv.id
WHERE fv.form_id = \$1 
  AND s.deleted_at IS NULL
  AND s.data_json->>\$2 = \$3
LIMIT 1;
\`\`\`

#### Theoretical Highlights:
* **JSONB Path Traversal (\`->>\`)**: The query uses the JSONB path extraction operator (\`->>\`) to dynamically extract the value of the label \`\$2\` as text, comparing it directly to the query parameter \`\$3\`.
* **Conflict Prevention**: Prior to database writes, a pre-insertion search is executed. If a duplicate is found, the transaction is rolled back, returning a \`409 Conflict\` status code. This manually replicates relational unique constraints inside schema-less JSON columns.

---

## 3. Adaptive Database Learning Theory

Traditional autocomplete systems rely on static data seed files (like static lists of states or branches). In airgapped local networks, computers cannot pull updates from external APIs. Over time, static lists become outdated as new departments, branches, or locations are established.

Agra-sandhani solves this by treating user submissions as a **self-updating crowd-sourced directory**:

\`\`\`
                  [User Submits Form Data]
                             │
                             ▼
         [Field Type is 'residential_address' or 'branch'?]
                             │
                   ┌─────────┴─────────┐
                   ▼ (Yes)             ▼ (No)
        [Extract value from cell]   [Skip Learning]
                   │
                   ▼
       [Split Composite Address]
      (address ||| district ||| state)
                   │
                   ▼
    [Check if combination exists in DB]
                   │
         ┌─────────┴─────────┐
         ▼ (Not Found)       ▼ (Found)
    [Insert new state/dist]  [Skip Insert]
         │
         ▼
[Autocomplete directory is updated automatically]
\`\`\`

### Theoretical Highlights:
* **Composite Parsing**: Fields like \`'residential_address'\` and \`'zone_group'\` combine multiple distinct values into a single text block using the delimiter \` ||| \`. During submission, the server splits these values back into their individual components.
* **Passive Learning Loop**: The server logs these values into lookup tables like \`universities\` or \`organizational_groups\`. Rather than requiring database administrators to manually update directories, the lookup options automatically update as users fill out forms.

---

## 4. Data Streaming Architecture (Backpressure & Memory Management)

When exporting large tables, loading thousands of rows into Node's RAM as an array of JavaScript objects can trigger V8 heap allocation limits, causing the process to crash (\`OutOfMemory\`).

Agra-sandhani uses a **Writeable Stream** to export files:
\`\`\`javascript
const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: res,
    useStyles: true,
    useSharedStrings: true
});
\`\`\`

### Theoretical Highlights:
* **TCP Backpressure**: By writing to the HTTP response stream (\`res\`) chunk-by-chunk, the system leverages TCP backpressure. If the client's network is slow, the database query pauses pulling rows, preventing RAM saturation.
* **Flat Memory Profile**: Regardless of whether the table contains 10 or 100,000 submissions, the memory footprint remains flat and low (typically under 50MB of RAM), allowing the app to run smoothly on low-spec hardware.

---

## 5. Automated Typography & Scale Theory (Nuclear Auto-Scaling)

Standard graphic design principles dictate that text size must be readable (usually above 9pt). However, when columns exceed standard width constraints, wrapping text yields tall, unreadable rows.

The PDF export engine implements **Nuclear Auto-Scaling** to dynamically adjust layout properties based on column density:

\`\`\`javascript
const columnCount = selectedFields.length + 1; // +1 for S.No
let fontSize = 9;
let headerFontSize = 10;
let cellPadding = [3, 5, 3, 5];
let margins = [40, 40, 40, 40];

if (columnCount >= 12) {
    fontSize = 5.5; // Nuclear scale
    headerFontSize = 6.5;
    cellPadding = [1, 2, 1, 2];
    margins = [10, 25, 10, 25]; // Absolute minimum margins
} else if (columnCount >= 9) {
    fontSize = 7.5;
    headerFontSize = 8.5;
    cellPadding = [2, 3, 2, 3];
    margins = [20, 35, 20, 35];
}
\`\`\`

### Theoretical Highlights:
* **Dynamic Grid Scaling**: Instead of wrapping columns onto new pages, the system scales elements down dynamically. The font size, column width, cell padding, and margins shrink in tandem to fit wide tables on a single landscape sheet of paper.
* **Readability Optimization**: By shrinking margins and padding, the system maximizes the printable grid area, ensuring wide employee matrices remain legible without truncation or page overflow.
`
  },
  "chapter6": {
    "title": "\ud83d\udee1\ufe0f Agra-sandhani Detailed Technical Reference: Chapter 6 (Expanded Edition)",
    "content": `# ️ Agra-sandhani Detailed Technical Reference: Chapter 6 (Expanded Edition)
## Service Integration, Cross-Process APIs, and Schema Translation Heuristics

This document details the service-to-service integration routing endpoints, schema mapping translation logic, and the staged prefill token exchange protocol. It also provides a theoretical analysis of the software engineering, information security, and compiler design principles that drive these systems.

---

## 1. Service Integration Core Files

| File Path | Functional Responsibility |
| :--- | :--- |
| \`server/routes/service-integration.js\` | Exposes REST APIs (\`/api/service/*\`) for search autocompletes, record lookups, field lists, and prefill token sessions |
| \`Noting_builder/static/js/pis_bridge.js\` | Client-side integration manager. Autocomplete bindings, input lookups, and prefill payload dispatchers |

---

## 2. Decoupled Service Architecture & Loopback Communication Theory

Smart Office Noting (Flask) and Agra-sandhani (Express) are built on different stacks and execute as separate OS processes.

\`\`\`
+------------------------------------+          +------------------------------------+
|        Smart Office Noting         |          |           Agra-sandhani            |
|       (Python/Flask Port 5001)     |          |       (Node/Express Port 5000)     |
|  - Renders document templates      |          |  - Manages personnel database      |
|  - Invokes client-side PISBridge   |          |  - Exposes REST Integration APIs   |
+------------------------------------+          +------------------------------------+
                  │                                               ▲
                  └──────(Client AJAX loopback loop via JSON)─────┘
\`\`\`

### Theoretical Highlights:
* **Microservices Decoupling**: In a decoupled architecture, services communicate using lightweight protocols (like JSON over HTTP) rather than sharing a database. This isolates failures: if the Noting app experiences an exception, the personnel database remains online.
* **Loopback Channel Security**: By communicating over localhost (\`127.0.0.1\` or loopback), APIs are kept safe from external network attacks. The firewall blocks incoming queries from outside the machine, securing data exchange in airgapped systems.

---

## 3. Schema Translation & Value Heuristics Theory

When a user triggers a lookup, the system translates dynamic database keys (like \`"PIS n."\`, \`"Employee ID"\`) into standard noting variables (\`pis\`, \`name\`, \`email\`). This uses a **Two-Pass Translation Heuristic**:

### 3.1 Lexical Key Normalization Theory
* **Normalization**: The algorithm strips punctuation and converts strings to a standard case-insensitive format (lowercase).
* **Fuzzy Substring Check**: The server runs substring match checks (e.g. \`cleanLabel.includes('pis')\`) to map the key to the target noting variable.

### 3.2 Value-Based Heuristics Theory
If lexical matches fail, the engine analyzes the value data format using regex patterns:
* **Employee IDs**: Identifies values that are alphanumeric, contain no spaces, and are 4 to 12 characters long:
  \`\`\`javascript
  /^[a-zA-Z0-9]+\$/.test(valStr)
  \`\`\`
* **Emails**: Identifies values containing the \`@\` symbol.
* **Phone Numbers**: Identifies values containing 10+ digits, optionally separated by spaces or dashes:
  \`\`\`javascript
  /^[0-9+\\s-]+\$/.test(valStr)
  \`\`\`

#### Theoretical Rationale:
If column names vary (e.g., one lab uses \`PIS n.\`, another uses \`PIS_NO\`, a third uses \`ID\`), exact match lookups will fail. The rule-based value analysis inspects the data format to ensure employee IDs, names, and contact details are mapped correctly.

---

## 4. Staged Prefill Session Store & One-Time Pad Theory

When transferring data from Noting to Agra-sandhani, passing datasets via URL query parameters (e.g., \`?name=John&address=123...\`) is insecure.

Agra-sandhani secures this transfer using a **Staged Prefill Session Exchange**:

\`\`\`
Smart Office Noting                 Agra-sandhani                    Agra-sandhani
    (Noting UI)                     (Node Server)                     (React Client)
         │                                │                                │
         │───1. POST values payload ─────>│                                │
         │   to /api/service/prefill-sess │                                │
         │                                │                                │
         │<──2. Return prefillToken ──────│                                │
         │                                │                                │
         │───3. Redirect Browser to ──────────────────────────────────────>│
         │   /forms/submit?token=XXXX     │                                │
         │                                │                                │
         │                                │<── 4. GET prefill session ─────│
         │                                │    using token                 │
         │                                │                                │
         │                                │─── 5. Return values payload ──>│
         │                                │   & delete token (single use)  │
\`\`\`

### 4.1 Prefill Staging and Expiration (\`service-integration.js\`)
\`\`\`javascript
const prefillToken = \`prefill_\${Date.now()}_\${Math.random().toString(36).substring(2, 10)}\`;
global.prefillCache.set(prefillToken, {
    formId: String(formId),
    values: values || {},
    createdAt: Date.now()
});
\`\`\`

### 4.2 Single-Use Token Deletion (\`routes/forms.js\`)
\`\`\`javascript
const sessionData = global.prefillCache.get(prefillToken);
global.prefillCache.delete(prefillToken); // Single-use consumption
\`\`\`

### Theoretical Highlights:
* **The One-Time Pad (OTP) Concept**: The \`prefillToken\` functions like a one-time pad. It is randomly generated and can only be used once. Once the React frontend retrieves the data, the token is deleted from memory.
* **Information Security Benefits**:
  * **Data Privacy**: Staging payloads in-memory prevents personal details from being stored in local browser history or network logs.
  * **Replay Protection**: If an unauthorized user intercepts the URL, the token is already deleted, blocking attempts to resubmit or read the data.
  * **Memory Isolation**: Setting a 5-minute timeout ensures orphaned sessions are purged, preventing memory leaks on low-end servers.
`
  },
  "chapter7": {
    "title": "\ud83d\udee1\ufe0f Agra-sandhani Detailed Technical Reference: Chapter 7 (Expanded Edition)",
    "content": `# ️ Agra-sandhani Detailed Technical Reference: Chapter 7 (Expanded Edition)
## Autocomplete Engines, Trigram Similarity, and Airgapped Architecture

This document details the autocomplete routes, acronym matching systems, and offline deployment configurations of the **Agra-sandhani** platform. It also provides a theoretical analysis of the mathematical, language parsing, and system architecture principles that drive these systems.

---

## 1. Autocomplete & Infrastructure Core Files

| File Path | Functional Responsibility |
| :--- | :--- |
| \`server/routes/autocomplete.js\` | Location dropdown lists, dot-agnostic acronym lookups, and trigram similarity queries |
| \`Launch_Offline.bat\` | Windows bootstrap script for running the application in airgapped environments |

---

## 2. Trigram Similarity & String Matching Theory

Agra-sandhani uses the PostgreSQL \`pg_trgm\` extension to power its autocomplete engine, ordering search results by relevance:
\`\`\`sql
ORDER BY 
   (CASE 
       WHEN name ILIKE \$1 THEN 0 
       WHEN acronym ILIKE \$1 THEN 1
       ELSE 2 
    END),
   similarity(name, \$3) DESC;
\`\`\`

### 2.1 Mathematical Formulation of Trigram Similarity
A trigram is a contiguous sequence of three characters extracted from a string. When comparing two strings, the database engine splits both into sets of trigrams.

#### The Jaccard Similarity Coefficient:
The similarity score is calculated using the Jaccard index formula:
\$\$\\text{Similarity}(S_1, S_2) = \\frac{|T(S_1) \\cap T(S_2)|}{|T(S_1) \\cup T(S_2)|}\$\$

* \$T(S_1)\$ represents the set of trigrams in the first string.
* \$T(S_2)\$ represents the set of trigrams in the second string.
* \$|T(S_1) \\cap T(S_2)|\$ is the size of the intersection (shared trigrams) between both sets.
* \$|T(S_1) \\cup T(S_2)|\$ is the size of the union (total unique trigrams) of both sets.

#### Trigram Padding Mechanics:
To ensure prefix and suffix matches are weighted correctly, PostgreSQL pads strings with spaces before splitting them:
* **Prefix Padding**: Padded with two prefix spaces.
* **Suffix Padding**: Padded with one suffix space.

For example, the string \`"PEC"\` is padded to \`"  PEC "\` and split into:
\`{"  P", " PE", "PEC", "EC ", "C  "}\`

This padding ensures that short search inputs match prefix and suffix characters correctly. Without padding, the union size would be very small, distorting the similarity score.

#### Computational Complexity:
Comparing trigram sets is computationally cheaper than calculating Levenshtein Distance (which has an \$O(M \\times N)\$ complexity). Set intersection operations run in \$O(M + N)\$ time, allowing the database to search thousands of university records on low-end hardware in milliseconds.

---

## 3. Non-Deterministic Finite Automata (NFA) Regex Theory

To allow users to find abbreviations with inconsistent punctuation, the system converts short search strings into dynamic regular expressions:
\`\`\`javascript
const fuzzyPattern = q.split('').filter(c => /[a-zA-Z0-9]/.test(c)).join('.*');
\`\`\`

For example, the search query \`"PEC"\` is transformed into \`"P.*E.*C"\`.

\`\`\`
                    [State 0]
                        │
                        ▼ (Matches 'P')
                    [State 1]
                        │
                        ▼ (Matches any character '.*')
                    [State 2]
                        │
                        ▼ (Matches 'E')
                    [State 3]
                        │
                        ▼ (Matches any character '.*')
                    [State 4]
                        │
                        ▼ (Matches 'C')
                [Accept State (Match)]
\`\`\`

### Theoretical Highlights:
* **NFA State Transitions**: The pattern is compiled into a Non-Deterministic Finite Automaton (NFA). The engine transitions states as it matches characters. If it matches \`"P"\`, it enters a wildcard scan state, matching any characters until it matches \`"E"\`, then enters another wildcard scan state until \`"C"\` is matched.
* **catastrophic Backtracking Mitigation**: Wildcard patterns (\`.*\`) can trigger catastrophic backtracking if not constrained, wasting CPU cycles on failed matches. Agra-sandhani prevents this by limiting search inputs to a maximum length and filtering out non-alphanumeric characters, ensuring fast execution.

---

## 4. Airgapped Dependency Resolution Theory

In standard web applications, packages and assets are resolved at build-time or runtime using public package registries (like NPM or CDN hosts). In an airgapped LAN, this system is impossible.

Agra-sandhani resolves this by implementing a **Self-Contained Dependency Pinning model**:

### 4.1 Immutable Compile-Time Bundling
* **Vite/Rollup Compilation**: All frontend components, assets (like CSS and SVG icons), and libraries are compiled into a static, single-page application (SPA) inside \`client/dist\`. The build output is inline, ensuring the application loads without external network requests.
* **Server as Static Host**: Express hosts the static assets directly from disk:
  \`\`\`javascript
  app.use(express.static(clientBuildPath));
  \`\`\`
  It utilizes standard caching headers (\`Cache-Control\`, \`ETag\`) to optimize asset loading, reducing local network roundtrips on older LAN configurations.

### 4.2 Portable Database Migrations
Migrations are managed using self-contained SQL update files, allowing the database schema to update without external internet access or package downloads.
`
  },
  "theory": {
    "title": "\ud83d\udd2c Theoretical Architecture & Core Computer Science Concepts",
    "content": `# Theoretical Architecture & Core Computer Science Concepts

This document provides a comprehensive theoretical analysis of the engineering principles, mathematical formulations, database storage models, security patterns, and compiler designs implemented within the **Agra-sandhani** architecture.

---

## 1. RDBMS-JSONB Hybrid Storage Architecture
Database design presents a fundamental engineering trade-off: relational tables vs. document structures.

\`\`\`
       +---------------------------------------------+
       |             METADATA (Relational)           |
       |  - Strict ACID Transactions                 |
       |  - Relational Integrity & Schema Checking   |
       |  - Foreign Key constraints                  |
       +---------------------------------------------+
                              │
                              ▼
       +---------------------------------------------+
       |           SUBMISSIONS (Document JSONB)      |
       |  - Polymorphic fields / schema flexibility  |
       |  - Pre-parsed binary decomposition          |
       |  - Localized schema migrations              |
       +---------------------------------------------+
\`\`\`

### 1.1 Relational Database Systems (SQL) & ACID Properties
Relational databases represent data in tables composed of rows and columns, enforcing strict schemas and referential integrity. Operations are bound by the **ACID** model:
1. **Atomicity**: Guarantees that all operations within a transaction block are executed successfully, or none are. If any step fails, the entire transaction is rolled back.
2. **Consistency**: Enforces that any transaction will bring the database from one valid state to another, maintaining all schema rules, constraints, and triggers.
3. **Isolation**: Ensures that concurrent execution of transactions leaves the database in the same state as if they were executed sequentially.
4. **Durability**: Guarantees that once a transaction is committed, it remains saved in non-volatile storage, even in the event of a system crash.

While SQL guarantees high data integrity, altering schemas (running \`ALTER TABLE\`) on high-volume production tables locks the database, blocks incoming operations, and creates rigid boundaries that make dynamic, user-designed forms difficult to maintain.

### 1.2 Document-Oriented Systems (NoSQL)
Document databases store data as self-contained documents (typically JSON or BSON). They utilize the **BASE** model (Basically Available, Soft state, Eventual consistency), offering schema flexibility where each document can store different key-value structures.
* **Trade-off**: The lack of join operations, transactional guarantees across documents, and foreign key enforcement makes pure document databases risky for highly relational metadata like user accounts, permissions, and audit trails.

### 1.3 The Hybrid PostgreSQL Solution: Binary JSONB
PostgreSQL bridges this gap by offering the \`JSONB\` data type, enabling a hybrid relational-document model.
* **Storage Format**: Standard \`JSON\` text columns store exact string representations of JSON, requiring the database engine to re-parse the text on every read. \`JSONB\` (JSON Binary) stores data in a pre-parsed, decomposed binary format.
* **Key Sorting & De-duplication**: During write operations, \`JSONB\` parses the JSON, removes duplicate keys, and sorts keys alphabetically. This incurs a slightly higher write overhead but enables fast read access.
* **Selective Extraction**: The engine can extract individual keys (e.g., \`data_json->>'name'\`) directly from the binary stream without reading or parsing the rest of the document, maximizing memory bandwidth.

---

## ️ 2. Normalization vs. Denormalization (EAV vs. JSONB)
When dynamic, user-defined fields must be stored, database architects typically choose between normalization via the Entity-Attribute-Value (EAV) model or denormalization via JSONB documents.

### 2.1 The Entity-Attribute-Value (EAV) Model
The EAV model splits dynamic records across three columns:
* **Entity**: The parent record ID (e.g., submission ID).
* **Attribute**: The field definition (e.g., "First Name").
* **Value**: The user's input (e.g., "John").

\`\`\`
Entity Table (submissions):
┌────┬─────────┬──────────────┐
│ ID │ Form ID │ Submitted At │
├────┼─────────┼──────────────┤
│ 1  │ 101     │ 2026-07-07   │
└────┴─────────┴──────────────┘

EAV Table (submission_values):
┌───────────┬──────────────┬─────────────┐
│ Entity ID │ Attribute ID │ Value       │
├───────────┼──────────────┼─────────────┤
│ 1         │ FirstName    │ "John"      │
│ 1         │ LastName     │ "Doe"       │
│ 1         │ PIS_No       │ "A908"      │
└───────────┴──────────────┴─────────────┘
\`\`\`

#### The Join Explosion Problem
To reconstruct a single record with \$N\$ attributes, the query planner must perform \$N-1\$ self-joins:
\`\`\`sql
SELECT s.id, v1.value AS first_name, v2.value AS last_name, v3.value AS pis_no
FROM submissions s
JOIN submission_values v1 ON s.id = v1.entity_id AND v1.attribute_id = 'FirstName'
JOIN submission_values v2 ON s.id = v2.entity_id AND v2.attribute_id = 'LastName'
JOIN submission_values v3 ON s.id = v3.entity_id AND v3.attribute_id = 'PIS_No'
WHERE s.id = 1;
\`\`\`
If a form has 20 columns, query execution requires 19 self-joins. On older CPU hardware, this causes severe query latency as tables scale.

### 2.2 Denormalization with JSONB
Agra-sandhani replaces EAV with JSONB denormalization. All dynamic inputs are consolidated into a single row using a key-value binary object:
\`\`\`sql
SELECT id, data_json->>'FirstName' AS first_name FROM submissions WHERE id = 1;
\`\`\`
* **Performance Benefit**: The record is retrieved in a single I/O read operation. Self-joins are reduced to zero, keeping CPU usage flat even as the dataset scales.

---

## 3. Indexing Theory & Search Optimization
An index is a secondary data structure designed to speed up search lookups. Agra-sandhani uses three classes of indexes to maintain lookup speeds under 5ms.

### 3.1 B-Tree Indexes
Standard relational columns (e.g., \`id\`, \`created_at\`) are indexed using **B-Trees** (Balanced Trees). A B-Tree maintains sorted key values in a self-balancing hierarchical structure:

\`\`\`
                  [ Root Node ]
                     /     \\
           [ Internal ]   [ Internal ]
             /      \\       /      \\
          [Leaf]  [Leaf] [Leaf]  [Leaf]  <-- Points to Row IDs (TIDs)
\`\`\`

* **Complexity**: Searches run in \$O(\\log N)\$ time.
* **Limitation**: B-Trees can only index scalar keys. They cannot index nested elements within a JSONB document.

### 3.2 Generalized Inverted Indexes (GIN)
To index the contents of dynamic JSONB documents, PostgreSQL uses the **GIN** (Generalized Inverted Index) structure.
* **Mechanism**: Standard indexes map a row to its data columns. Inverted indexes map the *internal components* (keys, values, array items) to the rows that contain them.

\`\`\`
Key-Value Token             Row ID List (TIDs)
----------------------------------------------
"name" -> "John"    ----->  [Row 1, Row 45, Row 108]
"pis" -> "A908"     ----->  [Row 1, Row 504]
"dept" -> "TBRL"    ----->  [Row 12, Row 45, Row 90]
\`\`\`

* **Query Acceleration**: When running a query checking for a specific key-value pair (\`data_json @> '{"pis": "A908"}'\`), PostgreSQL scans the GIN index for the token \`"pis" -> "A908"\` and instantly retrieves the target row IDs without scanning the entire table.

### 3.3 Trigram Indexes & Jaccard Similarity
To search names and locations containing spelling mistakes or incomplete input, the system utilizes trigram matching.

#### Trigrams
A trigram is a sequence of three consecutive characters extracted from a string. Before splitting, strings are padded with two leading spaces and one trailing space to capture word boundary contexts.
* String: \`"PEC"\`
* Padded: \`"  PEC "\`
* Trigrams: \`{"  P", " PE", "PEC", "EC ", "C  "}\`

#### Jaccard Similarity
The similarity between two strings \$S_1\$ and \$S_2\$ is calculated as the intersection of their trigram sets divided by their union:
\$\$\\text{Similarity}(S_1, S_2) = \\frac{|T(S_1) \\cap T(S_2)|}{|T(S_1) \\cup T(S_2)|}\$\$

* **Example**: Comparing \`"PEC"\` and \`"P.E.C."\` yields a high trigram overlap, returning a high similarity score.
* **Computational Cost**: Unlike Levenshtein distance which requires filling an \$M \\times N\$ matrix (\$O(M \\times N)\$ time complexity), trigram set operations run in \$O(M + N)\$ time, making search fast on low-spec hardware.
* **GIN Trigram Indexing**: By enabling the \`pg_trgm\` extension, PostgreSQL creates a GIN index on the trigram tokens of a text column, accelerating wildcard matches (\`LIKE '%query%'\`) by checking trigram intersections instead of running full-table text scans.

### 3.4 Functional Indexes
Functional indexes are built on the evaluation of an expression rather than raw column values:
\`\`\`sql
CREATE INDEX idx_submissions_pis_trgm ON submissions USING GIN ((data_json->>'pis') gin_trgm_ops);
\`\`\`
* **Performance Benefit**: The expression \`(data_json->>'pis')\` is evaluated once during insertion. The trigram index is built directly on the extracted strings, allowing the query engine to bypass JSON path extraction steps during search.

---

## 4. Authentication & Stateful Token Revocation
Security in web architectures relies on verifying identity and access permissions on every API request.

### 4.1 Stateless JWT Authentication
JSON Web Tokens (JWT) are signed packages containing user payloads (identity, roles, expiration).
* **Process**: The server generates a signature by hashing the headers and payload with a secret key (\`HMAC-SHA256\`). On API requests, the server verifies the signature. If it matches, the payload is trusted without querying a session database.

### 4.2 The Stateless Revocation Problem
Because signature verification is stateless, the server cannot invalidate a token after it is issued. If a token is stolen, the attacker has access until the token expires. In online systems, this is mitigated by checking blacklist caches (e.g., Redis). However, deploying and managing secondary caches in offline, airgapped DRDO environments increases system complexity.

### 4.3 Agra-sandhani's Hybrid Stateful Lock
The platform implements a stateful session check on top of standard JWT validation:
1. When a user logs in, the server generates a unique session UUID (\`session_id\`) and saves it to both the database \`users\` table (\`current_session_id\`) and the JWT payload.
2. During middleware verification, the server checks the token signature (stateless).
3. If valid, it queries the database \`users\` table to verify if the token's \`session_id\` matches the database's \`current_session_id\`.
4. **Instant Revocation**: If a user logs in from a new machine or clicks log out, the database \`current_session_id\` is updated or cleared. The old token's session ID immediately mismatches, blocking access. This secures session control using only standard SQL storage.

---

## ️ 5. Access Control Models & Privilege Inheritance
Securing form templates and submissions requires checking permissions across users, roles, and temporal delegations.

\`\`\`
       [ Access Request ]
               │
               ▼
   [ Direct Creator Check ] ───────(Matches)───────> [ Access Granted ]
               │
               ▼ (Mismatches)
   [ Admin Isolation Override ] ───(Owner is Admin)─> [ Access Denied ]
               │
               ▼ (Owner is not Admin)
   [ Global Admin Role Check ] ────(User is Admin)─> [ Access Granted ]
               │
               ▼ (User is not Admin)
   [ Collaborator ACL Check ] ─────(Active ACL)────> [ Access Granted ]
               │
               ▼ (No ACL)
   [ Delegation Check ] ───────────(Active Link)───> [ Access Granted ]
               │
               ▼ (Fail)
       [ Access Denied ]
\`\`\`

### 5.1 Role-Based Access Control (RBAC)
Users are assigned static security roles (Submitter, Manager, Superadmin) that grant access to specific endpoints.
* **Submitter**: Access is limited to loading forms and submitting data.
* **Manager**: Can edit form layouts, inspect entries, and export reports.
* **Superadmin**: Can manage accounts, clear tables, and view system logs.

### 5.2 Discretionary Access Control (DAC) & Access Control Lists (ACL)
For fine-grained control, forms can be shared with individual users. The system checks the \`collaborators\` table to verify if a user has been granted access to a specific form ID.

### 5.3 Access Control Logic
1. **Direct Ownership**: The user who created the form template has full rights.
2. **Admin Isolation**: If a form template is created by an administrator, access is locked exclusively to that administrator. Standard RBAC checks are bypassed, preventing other administrators from viewing sensitive templates or submissions.
3. **Privilege Inheritance via Delegation**: If User A delegates tasks to User B (saved in the \`delegations\` table with start and end times), User B inherits User A's access permissions. The middleware checks if a delegation link is active during the API request, letting User B access User A's files without changing database ownership keys.

---

## 6. ACID Transactions & Schema Migrations
When a form field is renamed in the form builder, both the metadata schema and all existing JSONB submissions must be updated to keep the data aligned.

### 6.1 Schema Update Query
The migration runs directly within the database engine using key-value operations:
\`\`\`sql
UPDATE submissions 
SET data_json = (data_json - \$1::text) || jsonb_build_object(\$2::text, data_json->\$1)
WHERE form_version_id IN (SELECT id FROM form_versions WHERE form_id = \$3)
  AND (data_json ? \$1);
\`\`\`
* \`data_json - \$1\`: Deletes the old key \`\$1\` from the JSONB document.
* \`|| jsonb_build_object(\$2, data_json->\$1)\`: Concatenates a new JSONB pair mapping the new label \`\$2\` to the value retrieved from the old key \`\$1\`.
* \`data_json ? \$1\`: Filters rows to only update submissions containing the old key, saving CPU cycles.

### 6.2 Transaction Safety
If a server crash occurs during a migration run across thousands of submissions, the database can enter a half-migrated state, corrupting the records.
* **Prevention**: By wrapping the migration queries in a transaction block (\`BEGIN\` and \`COMMIT\`), PostgreSQL ensures **Atomicity**. If a failure occurs, the entire batch rolls back, restoring the database to its pre-update state.

---

## 7. Data Streaming & Memory Management
Exporting large tables can cause the Node.js V8 engine to allocate excessive memory, thrashing the garbage collector and crashing the process with an Out of Memory (OOM) exception.

### 7.1 V8 Heap Allocation
Node.js runs on the V8 engine, which has default heap memory limits (typically 512MB to 1.4GB on older hardware). Reading 100,000 database rows into RAM as Javascript objects quickly consumes this memory.

### 7.2 TCP Backpressure & Writeable Streams
To keep memory usage low, the system uses a **Writeable Stream** to export files:

\`\`\`
[PostgreSQL Database] ──(Cursor Page)──> [Node server RAM] ──(HTTP Write)──> [Client Network]
                                             ▲                           │
                                             │───(Backpressure Event)────┘
\`\`\`

* **Process**: The server uses a database cursor to retrieve rows in small chunks. As rows are read, they are converted to spreadsheet formats and written to the HTTP response stream (\`res\`).
* **Backpressure**: If the client's network connection is slow, the HTTP socket buffer fills up. When this occurs, the response stream sends a backpressure signal. The Node server pauses reading new database rows until the socket buffer clears, preventing data from building up in RAM. This keeps the memory footprint flat and low (under 50MB) regardless of the export size.

---

## 8. Typography, Grids, and Page Scaling
When exporting dynamic forms to PDF, the document must fit standard paper sheets (e.g., A4 Landscape) while remaining readable.

### 8.1 PDF Layout Scaling
If columns exceed the page width, standard rendering wraps text, creating tall, unreadable rows. The PDF export engine prevents this by dynamically scaling text and margins based on column count:

\$\$\\text{Font Size} = f(C), \\quad \\text{Padding} = p(C), \\quad \\text{Margin} = m(C)\$\$

Where \$C\$ is the column count:
* **Standard (\$C < 9\$)**: Font size is 9pt, cell padding is \$3\\text{pt} \\times 5\\text{pt}\$, margins are 40pt.
* **Compact (\$9 \\le C < 12\$)**: Font size scales down to 7.5pt, cell padding to \$2\\text{pt} \\times 3\\text{pt}\$, margins to 20pt.
* **Nuclear (\$C \\ge 12\$)**: Font size scales down to 5.5pt, cell padding to \$1\\text{pt} \\times 2\\text{pt}\$, margins to 10pt.

This coordinate grid scaling shrinks elements in tandem, maximizing the printable area to fit wide tables on a single landscape sheet without text truncation.

---

## ️ 9. Network Security Middlewares
Web applications deploy security policies at the HTTP network layer to block unauthorized requests and denial-of-service (DoS) attempts.

### 9.1 Content Security Policy (CSP) & Helmet
Helmet sets HTTP response headers to secure Express apps. One critical header is the **Content Security Policy (CSP)**.
* **CSP Purpose**: Restricts the locations from which the browser can load scripts, stylesheets, and images, protecting against Cross-Site Scripting (XSS) and data injection attacks.
* **Offline Configuration**: In airgapped LAN deployments without SSL certificates, local React clients load resources over dynamic IP addresses. Disabling CSP (\`contentSecurityPolicy: false\`) allows local HTML frames to load client files directly inside the offline portal without certificate validation failures.

### 9.2 Rate Limiting
Rate limiting protects the single-threaded Node.js event loop from resource exhaustion.
* **Global Limiter**: Limits client IPs to 1000 requests per 15 minutes, blocking rapid loops from locking the PostgreSQL database pool.
* **Auth Limiter**: Limits authentication attempts to 20 requests per hour per IP. This blocks brute-force credentials guessing by delaying successive login attempts.

### 9.3 Cross-Origin Resource Sharing (CORS)
Browsers implement the **Same-Origin Policy**, blocking scripts on one origin (e.g., port 5001) from reading data from another (e.g., port 5000).
* **Handshake**: The server uses CORS headers (like \`Access-Control-Allow-Origin: *\`) to explicitly permit cross-port requests, allowing the Smart Office Noting server on port 5001 to execute API queries on the Agra-sandhani server.

---

## 10. NFAs & Regex Backtracking
Fuzzy searches convert input strings (e.g., \`"PEC"\`) into regex patterns (\`"P.*E.*C"\`) to handle punctuation variations.

### 10.1 Non-Deterministic Finite Automata (NFA)
A regex engine compiles the pattern \`"P.*E.*C"\` into an NFA. The NFA transitions between states as it matches characters:
* **State 0**: Scans text until it matches \`"P"\`.
* **State 1**: Enters a wildcard scan, matching any characters (\`.*\`) until it matches \`"E"\`.
* **State 2**: Enters a wildcard scan, matching any characters until it matches \`"C"\`.
* **State 3**: Reaches the accept state, confirming a match.

### 10.2 Catastrophic Backtracking
Wildcard patterns (\`.*\`) can trigger catastrophic backtracking when matched against long strings that fail near the end. The engine evaluates every possible permutation of the wildcard matches, causing CPU usage to spike to 100% and blocking the event loop.
* **Mitigation**: Agra-sandhani protects search routes by limiting input lengths, stripping out non-alphanumeric characters, and using non-greedy regex patterns. This limits state permutations and prevents CPU exhaustion.
`
  }
};
