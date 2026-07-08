# 🛡️ Agra-sandhani Detailed Technical Reference: Chapter 3 (Expanded Edition)
## Authentication, Session Security, and Dynamic Access Control

This document details the security model, token-based authentication mechanics, concurrent session locking, and relational permissions architecture of the **Agra-sandhani** platform. It also provides a theoretical analysis of the security and identity management design principles that drive these systems.

---

## 📂 1. Security Infrastructure Files

| File Path | Functional Responsibility |
| :--- | :--- |
| `server/middleware/auth.js` | Verification of JWT tokens, single-session checks, access control lists (ACL) |
| `server/routes/auth.js` | Credentials validation, hash verification, login/logout session generation |
| `server/routes/permissions.js` | Collaborator request submissions, delegation mappings, and expiration tracking |

---

## 🔬 2. Stateful JWT Session Locking Theory

JSON Web Tokens (JWT) are traditionally designed to be stateless: the server verifies the cryptographic signature without looking up the token in a database. However, this model suffers from a major security vulnerability: **tokens cannot be invalidated before they expire**. If an operator's credentials are stolen or their session is intercepted, the attacker gains access until the token naturally expires.

Agra-sandhani solves this by implementing a **Hybrid Stateful JWT Session Lock**:

```
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
```

### Theoretical Highlights:
* **Stateless Verification (CPU Bound)**: First, the server verifies the cryptographic signature of the token using `jwt.verify` and `JWT_SECRET`. This is CPU-bound and filter-level.
* **Stateful Session Check (I/O Bound)**: Next, the database is queried to inspect the user's `current_session_id`. If a user logs in from a new workstation, a new UUID is generated and saved to the database. The previous token's `session_id` immediately mismatches, invalidating the old token without requiring complex token blacklist databases (like Redis) which are difficult to maintain in airgapped environments.

---

## 🛡️ 3. Access Control Matrix & Privilege Inheritance Theory

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

## 📝 4. Audit Trails & Traceability Theory

Security compliance requires that all data access and modifications are fully auditable. Agra-sandhani logs every key action (login, logout, form edits, submissions, exports) to the `system_logs` table:
* **Logged Metadata**: Stores the user's ID, the action type (e.g. `submit_form`, `export_excel`), the client's local IP address (`x-forwarded-for`), and a JSON details object.
* **Tamper Prevention**: The system logging functions execute within independent database connection queries to ensure logs are recorded even if the main request transaction fails or rolls back, providing an accurate, immutable audit trail.
