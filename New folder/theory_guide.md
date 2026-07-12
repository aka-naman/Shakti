# 🔬 Theoretical Architecture & Core Computer Science Concepts

This document provides a comprehensive theoretical analysis of the engineering principles, mathematical formulations, database storage models, security patterns, and compiler designs implemented within the **Agra-sandhani** architecture.

---

## 📂 1. RDBMS-JSONB Hybrid Storage Architecture
Database design presents a fundamental engineering trade-off: relational tables vs. document structures.

```
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
```

### 1.1 Relational Database Systems (SQL) & ACID Properties
Relational databases represent data in tables composed of rows and columns, enforcing strict schemas and referential integrity. Operations are bound by the **ACID** model:
1. **Atomicity**: Guarantees that all operations within a transaction block are executed successfully, or none are. If any step fails, the entire transaction is rolled back.
2. **Consistency**: Enforces that any transaction will bring the database from one valid state to another, maintaining all schema rules, constraints, and triggers.
3. **Isolation**: Ensures that concurrent execution of transactions leaves the database in the same state as if they were executed sequentially.
4. **Durability**: Guarantees that once a transaction is committed, it remains saved in non-volatile storage, even in the event of a system crash.

While SQL guarantees high data integrity, altering schemas (running `ALTER TABLE`) on high-volume production tables locks the database, blocks incoming operations, and creates rigid boundaries that make dynamic, user-designed forms difficult to maintain.

### 1.2 Document-Oriented Systems (NoSQL)
Document databases store data as self-contained documents (typically JSON or BSON). They utilize the **BASE** model (Basically Available, Soft state, Eventual consistency), offering schema flexibility where each document can store different key-value structures.
* **Trade-off**: The lack of join operations, transactional guarantees across documents, and foreign key enforcement makes pure document databases risky for highly relational metadata like user accounts, permissions, and audit trails.

### 1.3 The Hybrid PostgreSQL Solution: Binary JSONB
PostgreSQL bridges this gap by offering the `JSONB` data type, enabling a hybrid relational-document model.
* **Storage Format**: Standard `JSON` text columns store exact string representations of JSON, requiring the database engine to re-parse the text on every read. `JSONB` (JSON Binary) stores data in a pre-parsed, decomposed binary format.
* **Key Sorting & De-duplication**: During write operations, `JSONB` parses the JSON, removes duplicate keys, and sorts keys alphabetically. This incurs a slightly higher write overhead but enables fast read access.
* **Selective Extraction**: The engine can extract individual keys (e.g., `data_json->>'name'`) directly from the binary stream without reading or parsing the rest of the document, maximizing memory bandwidth.

---

## 🗄️ 2. Normalization vs. Denormalization (EAV vs. JSONB)
When dynamic, user-defined fields must be stored, database architects typically choose between normalization via the Entity-Attribute-Value (EAV) model or denormalization via JSONB documents.

### 2.1 The Entity-Attribute-Value (EAV) Model
The EAV model splits dynamic records across three columns:
* **Entity**: The parent record ID (e.g., submission ID).
* **Attribute**: The field definition (e.g., "First Name").
* **Value**: The user's input (e.g., "John").

```
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
```

#### The Join Explosion Problem
To reconstruct a single record with $N$ attributes, the query planner must perform $N-1$ self-joins:
```sql
SELECT s.id, v1.value AS first_name, v2.value AS last_name, v3.value AS pis_no
FROM submissions s
JOIN submission_values v1 ON s.id = v1.entity_id AND v1.attribute_id = 'FirstName'
JOIN submission_values v2 ON s.id = v2.entity_id AND v2.attribute_id = 'LastName'
JOIN submission_values v3 ON s.id = v3.entity_id AND v3.attribute_id = 'PIS_No'
WHERE s.id = 1;
```
If a form has 20 columns, query execution requires 19 self-joins. On older CPU hardware, this causes severe query latency as tables scale.

### 2.2 Denormalization with JSONB
Agra-sandhani replaces EAV with JSONB denormalization. All dynamic inputs are consolidated into a single row using a key-value binary object:
```sql
SELECT id, data_json->>'FirstName' AS first_name FROM submissions WHERE id = 1;
```
* **Performance Benefit**: The record is retrieved in a single I/O read operation. Self-joins are reduced to zero, keeping CPU usage flat even as the dataset scales.

---

## ⚡ 3. Indexing Theory & Search Optimization
An index is a secondary data structure designed to speed up search lookups. Agra-sandhani uses three classes of indexes to maintain lookup speeds under 5ms.

### 3.1 B-Tree Indexes
Standard relational columns (e.g., `id`, `created_at`) are indexed using **B-Trees** (Balanced Trees). A B-Tree maintains sorted key values in a self-balancing hierarchical structure:

```
                  [ Root Node ]
                     /     \
           [ Internal ]   [ Internal ]
             /      \       /      \
          [Leaf]  [Leaf] [Leaf]  [Leaf]  <-- Points to Row IDs (TIDs)
```

* **Complexity**: Searches run in $O(\log N)$ time.
* **Limitation**: B-Trees can only index scalar keys. They cannot index nested elements within a JSONB document.

### 3.2 Generalized Inverted Indexes (GIN)
To index the contents of dynamic JSONB documents, PostgreSQL uses the **GIN** (Generalized Inverted Index) structure.
* **Mechanism**: Standard indexes map a row to its data columns. Inverted indexes map the *internal components* (keys, values, array items) to the rows that contain them.

```
Key-Value Token             Row ID List (TIDs)
----------------------------------------------
"name" -> "John"    ----->  [Row 1, Row 45, Row 108]
"pis" -> "A908"     ----->  [Row 1, Row 504]
"dept" -> "TBRL"    ----->  [Row 12, Row 45, Row 90]
```

* **Query Acceleration**: When running a query checking for a specific key-value pair (`data_json @> '{"pis": "A908"}'`), PostgreSQL scans the GIN index for the token `"pis" -> "A908"` and instantly retrieves the target row IDs without scanning the entire table.

### 3.3 Trigram Indexes & Jaccard Similarity
To search names and locations containing spelling mistakes or incomplete input, the system utilizes trigram matching.

#### Trigrams
A trigram is a sequence of three consecutive characters extracted from a string. Before splitting, strings are padded with two leading spaces and one trailing space to capture word boundary contexts.
* String: `"PEC"`
* Padded: `"  PEC "`
* Trigrams: `{"  P", " PE", "PEC", "EC ", "C  "}`

#### Jaccard Similarity
The similarity between two strings $S_1$ and $S_2$ is calculated as the intersection of their trigram sets divided by their union:
$$\text{Similarity}(S_1, S_2) = \frac{|T(S_1) \cap T(S_2)|}{|T(S_1) \cup T(S_2)|}$$

* **Example**: Comparing `"PEC"` and `"P.E.C."` yields a high trigram overlap, returning a high similarity score.
* **Computational Cost**: Unlike Levenshtein distance which requires filling an $M \times N$ matrix ($O(M \times N)$ time complexity), trigram set operations run in $O(M + N)$ time, making search fast on low-spec hardware.
* **GIN Trigram Indexing**: By enabling the `pg_trgm` extension, PostgreSQL creates a GIN index on the trigram tokens of a text column, accelerating wildcard matches (`LIKE '%query%'`) by checking trigram intersections instead of running full-table text scans.

### 3.4 Functional Indexes
Functional indexes are built on the evaluation of an expression rather than raw column values:
```sql
CREATE INDEX idx_submissions_pis_trgm ON submissions USING GIN ((data_json->>'pis') gin_trgm_ops);
```
* **Performance Benefit**: The expression `(data_json->>'pis')` is evaluated once during insertion. The trigram index is built directly on the extracted strings, allowing the query engine to bypass JSON path extraction steps during search.

---

## 🔑 4. Authentication & Stateful Token Revocation
Security in web architectures relies on verifying identity and access permissions on every API request.

### 4.1 Stateless JWT Authentication
JSON Web Tokens (JWT) are signed packages containing user payloads (identity, roles, expiration).
* **Process**: The server generates a signature by hashing the headers and payload with a secret key (`HMAC-SHA256`). On API requests, the server verifies the signature. If it matches, the payload is trusted without querying a session database.

### 4.2 The Stateless Revocation Problem
Because signature verification is stateless, the server cannot invalidate a token after it is issued. If a token is stolen, the attacker has access until the token expires. In online systems, this is mitigated by checking blacklist caches (e.g., Redis). However, deploying and managing secondary caches in offline, airgapped DRDO environments increases system complexity.

### 4.3 Agra-sandhani's Hybrid Stateful Lock
The platform implements a stateful session check on top of standard JWT validation:
1. When a user logs in, the server generates a unique session UUID (`session_id`) and saves it to both the database `users` table (`current_session_id`) and the JWT payload.
2. During middleware verification, the server checks the token signature (stateless).
3. If valid, it queries the database `users` table to verify if the token's `session_id` matches the database's `current_session_id`.
4. **Instant Revocation**: If a user logs in from a new machine or clicks log out, the database `current_session_id` is updated or cleared. The old token's session ID immediately mismatches, blocking access. This secures session control using only standard SQL storage.

---

## 🛡️ 5. Access Control Models & Privilege Inheritance
Securing form templates and submissions requires checking permissions across users, roles, and temporal delegations.

```
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
```

### 5.1 Role-Based Access Control (RBAC)
Users are assigned static security roles (Submitter, Manager, Superadmin) that grant access to specific endpoints.
* **Submitter**: Access is limited to loading forms and submitting data.
* **Manager**: Can edit form layouts, inspect entries, and export reports.
* **Superadmin**: Can manage accounts, clear tables, and view system logs.

### 5.2 Discretionary Access Control (DAC) & Access Control Lists (ACL)
For fine-grained control, forms can be shared with individual users. The system checks the `collaborators` table to verify if a user has been granted access to a specific form ID.

### 5.3 Access Control Logic
1. **Direct Ownership**: The user who created the form template has full rights.
2. **Admin Isolation**: If a form template is created by an administrator, access is locked exclusively to that administrator. Standard RBAC checks are bypassed, preventing other administrators from viewing sensitive templates or submissions.
3. **Privilege Inheritance via Delegation**: If User A delegates tasks to User B (saved in the `delegations` table with start and end times), User B inherits User A's access permissions. The middleware checks if a delegation link is active during the API request, letting User B access User A's files without changing database ownership keys.

---

## 🔄 6. ACID Transactions & Schema Migrations
When a form field is renamed in the form builder, both the metadata schema and all existing JSONB submissions must be updated to keep the data aligned.

### 6.1 Schema Update Query
The migration runs directly within the database engine using key-value operations:
```sql
UPDATE submissions 
SET data_json = (data_json - $1::text) || jsonb_build_object($2::text, data_json->$1)
WHERE form_version_id IN (SELECT id FROM form_versions WHERE form_id = $3)
  AND (data_json ? $1);
```
* `data_json - $1`: Deletes the old key `$1` from the JSONB document.
* `|| jsonb_build_object($2, data_json->$1)`: Concatenates a new JSONB pair mapping the new label `$2` to the value retrieved from the old key `$1`.
* `data_json ? $1`: Filters rows to only update submissions containing the old key, saving CPU cycles.

### 6.2 Transaction Safety
If a server crash occurs during a migration run across thousands of submissions, the database can enter a half-migrated state, corrupting the records.
* **Prevention**: By wrapping the migration queries in a transaction block (`BEGIN` and `COMMIT`), PostgreSQL ensures **Atomicity**. If a failure occurs, the entire batch rolls back, restoring the database to its pre-update state.

---

## 📈 7. Data Streaming & Memory Management
Exporting large tables can cause the Node.js V8 engine to allocate excessive memory, thrashing the garbage collector and crashing the process with an Out of Memory (OOM) exception.

### 7.1 V8 Heap Allocation
Node.js runs on the V8 engine, which has default heap memory limits (typically 512MB to 1.4GB on older hardware). Reading 100,000 database rows into RAM as Javascript objects quickly consumes this memory.

### 7.2 TCP Backpressure & Writeable Streams
To keep memory usage low, the system uses a **Writeable Stream** to export files:

```
[PostgreSQL Database] ──(Cursor Page)──> [Node server RAM] ──(HTTP Write)──> [Client Network]
                                             ▲                           │
                                             │───(Backpressure Event)────┘
```

* **Process**: The server uses a database cursor to retrieve rows in small chunks. As rows are read, they are converted to spreadsheet formats and written to the HTTP response stream (`res`).
* **Backpressure**: If the client's network connection is slow, the HTTP socket buffer fills up. When this occurs, the response stream sends a backpressure signal. The Node server pauses reading new database rows until the socket buffer clears, preventing data from building up in RAM. This keeps the memory footprint flat and low (under 50MB) regardless of the export size.

---

## 📐 8. Typography, Grids, and Page Scaling
When exporting dynamic forms to PDF, the document must fit standard paper sheets (e.g., A4 Landscape) while remaining readable.

### 8.1 PDF Layout Scaling
If columns exceed the page width, standard rendering wraps text, creating tall, unreadable rows. The PDF export engine prevents this by dynamically scaling text and margins based on column count:

$$\text{Font Size} = f(C), \quad \text{Padding} = p(C), \quad \text{Margin} = m(C)$$

Where $C$ is the column count:
* **Standard ($C < 9$)**: Font size is 9pt, cell padding is $3\text{pt} \times 5\text{pt}$, margins are 40pt.
* **Compact ($9 \le C < 12$)**: Font size scales down to 7.5pt, cell padding to $2\text{pt} \times 3\text{pt}$, margins to 20pt.
* **Nuclear ($C \ge 12$)**: Font size scales down to 5.5pt, cell padding to $1\text{pt} \times 2\text{pt}$, margins to 10pt.

This coordinate grid scaling shrinks elements in tandem, maximizing the printable area to fit wide tables on a single landscape sheet without text truncation.

---

## 🛡️ 9. Network Security Middlewares
Web applications deploy security policies at the HTTP network layer to block unauthorized requests and denial-of-service (DoS) attempts.

### 9.1 Content Security Policy (CSP) & Helmet
Helmet sets HTTP response headers to secure Express apps. One critical header is the **Content Security Policy (CSP)**.
* **CSP Purpose**: Restricts the locations from which the browser can load scripts, stylesheets, and images, protecting against Cross-Site Scripting (XSS) and data injection attacks.
* **Offline Configuration**: In airgapped LAN deployments without SSL certificates, local React clients load resources over dynamic IP addresses. Disabling CSP (`contentSecurityPolicy: false`) allows local HTML frames to load client files directly inside the offline portal without certificate validation failures.

### 9.2 Rate Limiting
Rate limiting protects the single-threaded Node.js event loop from resource exhaustion.
* **Global Limiter**: Limits client IPs to 1000 requests per 15 minutes, blocking rapid loops from locking the PostgreSQL database pool.
* **Auth Limiter**: Limits authentication attempts to 20 requests per hour per IP. This blocks brute-force credentials guessing by delaying successive login attempts.

### 9.3 Cross-Origin Resource Sharing (CORS)
Browsers implement the **Same-Origin Policy**, blocking scripts on one origin (e.g., port 5001) from reading data from another (e.g., port 5000).
* **Handshake**: The server uses CORS headers (like `Access-Control-Allow-Origin: *`) to explicitly permit cross-port requests, allowing the Smart Office Noting server on port 5001 to execute API queries on the Agra-sandhani server.

---

## 🧠 10. NFAs & Regex Backtracking
Fuzzy searches convert input strings (e.g., `"PEC"`) into regex patterns (`"P.*E.*C"`) to handle punctuation variations.

### 10.1 Non-Deterministic Finite Automata (NFA)
A regex engine compiles the pattern `"P.*E.*C"` into an NFA. The NFA transitions between states as it matches characters:
* **State 0**: Scans text until it matches `"P"`.
* **State 1**: Enters a wildcard scan, matching any characters (`.*`) until it matches `"E"`.
* **State 2**: Enters a wildcard scan, matching any characters until it matches `"C"`.
* **State 3**: Reaches the accept state, confirming a match.

### 10.2 Catastrophic Backtracking
Wildcard patterns (`.*`) can trigger catastrophic backtracking when matched against long strings that fail near the end. The engine evaluates every possible permutation of the wildcard matches, causing CPU usage to spike to 100% and blocking the event loop.
* **Mitigation**: Agra-sandhani protects search routes by limiting input lengths, stripping out non-alphanumeric characters, and using non-greedy regex patterns. This limits state permutations and prevents CPU exhaustion.
