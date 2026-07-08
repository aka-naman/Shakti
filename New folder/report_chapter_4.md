# 🛡️ Agra-sandhani Detailed Technical Reference: Chapter 4 (Expanded Edition)
## Form Builder Logic, Dynamic Fields & Schema Auto-Migrations

This document details the form builder routing endpoints, dynamic field classifications, transaction-safe schema migrations, and high-volume Excel ingestion interfaces. It also provides a theoretical analysis of the software engineering and database design principles that drive these systems.

---

## 📂 1. Form Builder Core Files

| File Path | Functional Responsibility |
| :--- | :--- |
| `server/routes/forms.js` | Form templates management (listing, creating, duplicating), aggregation queries, and dynamic Excel spreadsheet ingestion |
| `server/routes/fields.js` | Bulk field updates, dynamic input type resolution, schema key migrations, and form structure locking checks |

---

## 🔬 2. Relational/JSONB Hybrid Storage Design Theory

Agra-sandhani implements a hybrid database model, storing structural metadata relationally while storing user submissions in unstructured JSONB documents.

```
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
```

### Theoretical Highlights:
* **The Structured Metadata Need**: Using a purely relational structure for dynamic forms requires running `ALTER TABLE` queries to add columns on the fly. This locks the database, can crash under load, and can quickly exceed maximum column limits.
* **The JSONB Document Need**: Storing submissions as raw JSON strings prevents the database from performing fast indexing, query calculations, or selective value filtering.
* **The Hybrid Solution**: Storing field definitions in a relational table (`form_fields`) enables fast schema loading and template rendering. Storing submission records in a single binary JSONB column (`data_json`) allows the schema to adapt dynamically to user edits. Binary JSONB stores keys in a sorted, decompressed format, enabling high-speed lookups and indexing.

---

## ⚡ 3. Transactional Schema Migration Theory

When a user renames a field, the server updates both the metadata table and all existing submissions to keep the data consistent:

```sql
UPDATE submissions 
SET data_json = (data_json - $1::text) || jsonb_build_object($2::text, data_json->$1)
WHERE form_version_id IN (SELECT id FROM form_versions WHERE form_id = $3::int)
  AND (data_json ? $1);
```

### ACID Transactional Safeguards
Executing migrations across thousands of documents carries the risk of partial failures. If a rename query succeeds but a subsequent network error crashes the server mid-update, the database schema definition will mismatch the stored submissions, corrupting the dataset.

Agra-sandhani prevents this using **ACID Transactions**:
```javascript
await client.query('BEGIN');
// ... perform renames, deletes, and field upserts ...
await client.query('COMMIT');
```

#### Theoretical Highlights:
* **Atomicity**: The `BEGIN` and `COMMIT` commands group all modifications into a single atomic block. If any step fails (e.g., duplicate names or validation errors), the entire batch rolls back (`ROLLBACK`), restoring the database to its pre-update state.
* **JSONB Key Mutation**: The query subtracts the old key (`data_json - $1::text`) and merges it with a new key-value pair (`|| jsonb_build_object($2, data_json->$1)`). This operation runs directly in PostgreSQL's engine, eliminating the overhead of pulling rows to the Node app to modify them.

---

## 📥 4. High-Volume Excel Ingestion & Heap Management

The Excel Importer `/import-excel` converts spreadsheets up to 1GB into active forms.

### Theoretical Highlights:
* **Heap Allocation Thresholds**: Parsing large files can cause the V8 engine to allocate excessive memory, thrashing the garbage collector. To prevent this, the Excel ingestion pipeline parses files in chunks.
* **Dynamic Header Extraction**: The parser reads the first row, sanitizes column labels to remove special characters, and seeds the `form_fields` table, instantly generating the form template from the spreadsheet layout.
