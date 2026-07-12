# 🛡️ Agra-sandhani Detailed Technical Reference: Chapter 2 (Expanded Edition)
## Database Schema, Pool Configurations, and Search Optimizations

This document details the PostgreSQL database architecture, relational/JSONB hybrid schemas, migration lifecycle, and performance indexing patterns of the **Agra-sandhani** database. It also provides a theoretical analysis of the database indexing and storage design principles that drive these systems.

---

## 📂 1. Database Connectivity & Pool Configuration (`server/db/pool.js`)

Agra-sandhani uses the `pg.Pool` constructor from the `pg` driver to manage query pooling. The configuration optimizes performance in resource-constrained LAN servers:

```javascript
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
```

* **Theoretical Rationale**: The pool acts as a gatekeeper to prevent database resource starvation. Setting `max: 50` allows the server to handle up to 50 parallel queries. Connections that remain idle for 30 seconds (`idleTimeoutMillis`) are closed to free up system memory, ensuring the application remains lightweight on older hardware.

---

## 🔬 2. RDBMS-JSONB Hybrid Storage Theory

Database design frequently presents a trade-off between **Relational Integrity** (SQL) and **Document Flexibility** (NoSQL).

* **Relational Systems (SQL)**: Guarantee strong data integrity, foreign key constraints, and transactional safety (ACID). However, schemas are rigid and difficult to alter dynamically in production.
* **Document Systems (NoSQL)**: Offer flexible schemas and dynamic document nesting. However, NoSQL engines lack relational constraints, transaction guarantees, and local join support.

### The Hybrid Storage Solution
Agra-sandhani resolves this trade-off by implementing a hybrid design in PostgreSQL. The system uses relational tables for structured metadata (like users, permissions, and field configurations) while utilizing `JSONB` document columns to store dynamic user submissions.

#### Binary JSONB Storage Advantages:
* **Pre-parsed Binary Format**: Unlike standard text columns, `JSONB` stores data in a pre-parsed, decompressed binary format. The database doesn't need to re-parse the JSON string during query execution, allowing fast read and write operations.
* **Key Sorting**: JSONB automatically keys are sorted and duplicate properties are removed. This optimization enables high-speed lookups and path extraction operations.

---

## 🔄 3. Normalization vs. Denormalization (EAV to JSONB Theory)

Originally, Agra-sandhani used an **Entity-Attribute-Value (EAV)** model storing field inputs in separate relational rows in `submission_values`. EAV is a highly normalized design, but it suffers from severe performance degradation as datasets grow:

```
            NORMALIZE (EAV)                             DENORMALIZE (JSONB)
   Table: submission_values                      Table: submissions
   ┌────┬──────────┬─────────────┐               ┌────┬────────────────────────────────────┐
   │ ID │ Field ID │ Value       │               │ ID │ data_json                          │
   ├────┼──────────┼─────────────┤               ├────┼────────────────────────────────────┤
   │ 1  │ Name_ID  │ "John Doe"  │  ──Migrate──> │ 1  │ {"name": "John Doe", "pis": "101"} │
   │ 1  │ PIS_ID   │ "101"       │               └────┴────────────────────────────────────┘
   └────┴──────────┴─────────────┘
```

### Theoretical Highlights:
* **The EAV Performance Problem**: Rebuilding a single submission containing 20 fields required joining the `submission_values` table 20 times. This CPU-heavy operation caused severe lag on low-end hardware.
* **The JSONB Solution**: Aggregating fields into a single `JSONB` column (`data_json`) denormalizes the database structure. A submission is loaded in a single read operation without table join overhead. The database migration script converted legacy EAV tables using `jsonb_object_agg` to migrate historical data without loss.

---

## ⚡ 4. Database Indexing Theory

Standard B-Tree indexes excel at indexing scalar values, but they cannot index the dynamic, nested pathways inside JSON documents. To ensure lookup speeds under 5ms, Agra-sandhani builds specialized indices:

### 4.1 Inverted GIN Indexing
```sql
CREATE INDEX idx_submissions_data_json_gin ON submissions USING GIN (data_json);
```
* **Theory**: A **Generalized Inverted Index (GIN)** maps key-value components inside a JSONB document directly to the rows containing them. This allows PostgreSQL to quickly resolve key check queries (such as `data_json ? 'pis'`) without scanning the entire table.

### 4.2 Trigram Indexing (`pg_trgm`)
```sql
CREATE INDEX idx_submissions_data_json_trgm ON submissions USING GIN ((data_json::text) gin_trgm_ops);
```
* **Theory**: A trigram is a contiguous sequence of three characters. For example, the string `"John"` splits into trigrams: `[" Jo", "Joh", "ohn", "hn "]`.
* **Search Acceleration**: The `pg_trgm` extension indexes these trigram sets. When a user runs a wildcard search (like `ILIKE '%query%'`), PostgreSQL matches the search query's trigrams against the index, instantly identifying matching records without scanning the text of every document.

### 4.3 Functional Trigram Indexes
```sql
CREATE INDEX idx_submissions_pis_trgm ON submissions USING GIN ((data_json->>'pis') gin_trgm_ops);
```
* **Theory**: This builds a functional trigram index specifically on the text extracted from the `'pis'` key in the JSONB document. By indexing the specific search target directly, lookup engines bypass generic JSONB path extraction overhead during autocompletes, executing queries in milliseconds.
