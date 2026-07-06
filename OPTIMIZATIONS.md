# Aeroform Suite: Optimization & Scalability Report

This document outlines the architectural improvements and performance optimizations implemented to ensure the Aeroform Suite (Portal, Agra-sandhani, and smart-office-noting) can scale effectively in a multi-user LAN environment.

## 1. Database Search Performance
**Cause:**
The PIS Bridge autocomplete feature relied on `ILIKE` (wildcard) searches across dynamic `JSONB` data. Standard GIN indexes only optimize exact key/value matches, forcing the database to perform slow "Sequential Scans" as the submission count increased.

**Effect:**
- Enabled the `pg_trgm` (Trigram) PostgreSQL extension.
- Created a GIN Trigram index on the text-cast of the `submissions.data_json` column.
- Added specific functional Trigram indexes for the most common search keys (`pis` and `name`).
- Updated `service-integration.js` search logic to leverage the `::text` cast for optimized wildcard matching.

**Outcome:**
Autocomplete searches now perform in **logarithmic time** (Index Scans) rather than linear time, maintaining high responsiveness even as the database grows to tens of thousands of records.

---

## 2. Automated Storage Management
**Cause:**
The Python backend (`smart-office-noting`) generated MS Word documents for every request but lacked a mechanism to remove them. This created a "Disk Exhaustion" risk where long-term use would eventually fill the server's storage.

**Effect:**
- Implemented a background `cleanup_task` in `app.py` using Python's `threading` and `time` modules.
- Added a `cleanup_days` configuration parameter in `config.json`.
- The task automatically scans the `generated_notices` folder every 24 hours.

**Outcome:**
Generated documents older than 30 days are automatically purged. The system maintains a **stable disk footprint**, ensuring long-term operational stability without manual maintenance.

---

## 3. Configuration & Deployment Resiliency
**Cause:**
Hardcoded `localhost` URLs in the configuration files made the system "brittle." Decoupling services or deploying them across a LAN required manual code edits, increasing the risk of broken links during scaling.

**Effect:**
- Introduced a `get_agra_api_url()` helper in the Python backend.
- Added support for the `AGRA_API_URL` environment variable to override local defaults.
- Updated `config.json` to use `127.0.0.1` and standardized the integration structure.

**Outcome:**
The suite is now **environment-aware**. Services can be moved to different servers or ports by simply setting an environment variable or updating a single config line, facilitating seamless LAN distribution.

---

## 4. PIS Bridge Data Integrity
**Cause:**
The frontend `pis_bridge.js` cached employee records in `sessionStorage` indefinitely for the duration of the browser session. This could lead to "Stale Data" if a user updated a record in Agra-sandhani but continued using an old browser tab.

**Effect:**
- Implemented a **10-minute Time-To-Live (TTL)** for cached records.
- Modified the fetching engine to store a timestamp with every cached entry.
- Updated the Manual Search Button (🔍) to explicitly bypass the cache and force a fresh API call.

**Outcome:**
Balanced performance and accuracy. Users still enjoy fast loading for repetitive tasks, but the system ensures **data freshness** through automatic expiration and manual refresh capabilities.
