# 🛡️ Agra-sandhani Detailed Technical Reference: Chapter 6 (Expanded Edition)
## Service Integration, Cross-Process APIs, and Schema Translation Heuristics

This document details the service-to-service integration routing endpoints, schema mapping translation logic, and the staged prefill token exchange protocol. It also provides a theoretical analysis of the software engineering, information security, and compiler design principles that drive these systems.

---

## 📂 1. Service Integration Core Files

| File Path | Functional Responsibility |
| :--- | :--- |
| `server/routes/service-integration.js` | Exposes REST APIs (`/api/service/*`) for search autocompletes, record lookups, field lists, and prefill token sessions |
| `Noting_builder/static/js/pis_bridge.js` | Client-side integration manager. Autocomplete bindings, input lookups, and prefill payload dispatchers |

---

## 🔬 2. Decoupled Service Architecture & Loopback Communication Theory

Noting Builder (Flask) and Agra-sandhani (Express) are built on different stacks and execute as separate OS processes.

```
+------------------------------------+          +------------------------------------+
|        Smart Office Noting         |          |           Agra-sandhani            |
|       (Python/Flask Port 5001)     |          |       (Node/Express Port 5000)     |
|  - Renders document templates      |          |  - Manages personnel database      |
|  - Invokes client-side PISBridge   |          |  - Exposes REST Integration APIs   |
+------------------------------------+          +------------------------------------+
                  │                                               ▲
                  └──────(Client AJAX loopback loop via JSON)─────┘
```

### Theoretical Highlights:
* **Microservices Decoupling**: In a decoupled architecture, services communicate using lightweight protocols (like JSON over HTTP) rather than sharing a database. This isolates failures: if the Noting app experiences an exception, the personnel database remains online.
* **Loopback Channel Security**: By communicating over localhost (`127.0.0.1` or loopback), APIs are kept safe from external network attacks. The firewall blocks incoming queries from outside the machine, securing data exchange in airgapped systems.

---

## 🧠 3. Schema Translation & Value Heuristics Theory

When a user triggers a lookup, the system translates dynamic database keys (like `"PIS n."`, `"Employee ID"`) into standard noting variables (`pis`, `name`, `email`). This uses a **Two-Pass Translation Heuristic**:

### 3.1 Lexical Key Normalization Theory
* **Normalization**: The algorithm strips punctuation and converts strings to a standard case-insensitive format (lowercase).
* **Fuzzy Substring Check**: The server runs substring match checks (e.g. `cleanLabel.includes('pis')`) to map the key to the target noting variable.

### 3.2 Value-Based Heuristics Theory
If lexical matches fail, the engine analyzes the value data format using regex patterns:
* **Employee IDs**: Identifies values that are alphanumeric, contain no spaces, and are 4 to 12 characters long:
  ```javascript
  /^[a-zA-Z0-9]+$/.test(valStr)
  ```
* **Emails**: Identifies values containing the `@` symbol.
* **Phone Numbers**: Identifies values containing 10+ digits, optionally separated by spaces or dashes:
  ```javascript
  /^[0-9+\s-]+$/.test(valStr)
  ```

#### Theoretical Rationale:
If column names vary (e.g., one lab uses `PIS n.`, another uses `PIS_NO`, a third uses `ID`), exact match lookups will fail. The rule-based value analysis inspects the data format to ensure employee IDs, names, and contact details are mapped correctly.

---

## 🔒 4. Staged Prefill Session Store & One-Time Pad Theory

When transferring data from Noting to Agra-sandhani, passing datasets via URL query parameters (e.g., `?name=John&address=123...`) is insecure.

Agra-sandhani secures this transfer using a **Staged Prefill Session Exchange**:

```
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
```

### 4.1 Prefill Staging and Expiration (`service-integration.js`)
```javascript
const prefillToken = `prefill_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
global.prefillCache.set(prefillToken, {
    formId: String(formId),
    values: values || {},
    createdAt: Date.now()
});
```

### 4.2 Single-Use Token Deletion (`routes/forms.js`)
```javascript
const sessionData = global.prefillCache.get(prefillToken);
global.prefillCache.delete(prefillToken); // Single-use consumption
```

### Theoretical Highlights:
* **The One-Time Pad (OTP) Concept**: The `prefillToken` functions like a one-time pad. It is randomly generated and can only be used once. Once the React frontend retrieves the data, the token is deleted from memory.
* **Information Security Benefits**:
  * **Data Privacy**: Staging payloads in-memory prevents personal details from being stored in local browser history or network logs.
  * **Replay Protection**: If an unauthorized user intercepts the URL, the token is already deleted, blocking attempts to resubmit or read the data.
  * **Memory Isolation**: Setting a 5-minute timeout ensures orphaned sessions are purged, preventing memory leaks on low-end servers.
