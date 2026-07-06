# 🕵️ Plausible Reasons for Timeouts & Login Failures in Air-Gap

This document lists all plausible technical reasons for the database timeouts, "Invalid Credentials" issues, and Flask loopback connection failures (`Read timedout(read timeout=5)`) in the air-gapped AeroForm Suite environment.

---

## 📋 Summary of Key Plausible Reasons

| Issue | Plausible Cause | Technical Details | Solution |
| :--- | :--- | :--- | :--- |
| **Timeout & Login Failure** | **1. DNS Resolution Hang on `localhost`** | In air-gapped systems, DNS servers are often offline. When Node attempts to connect to `DB_HOST=localhost`, it waits for a DNS timeout (usually **5 seconds**) before falling back. | Change `DB_HOST=localhost` to `DB_HOST=127.0.0.1` in `.env`. |
| **Timeout & Login Failure** | **2. Fresh Database Instance** | Since the air-gapped machine has a fresh PostgreSQL instance, credentials used on your development machine do not exist. | Create/register your user account on the new database. |
| **Timeout & Login Failure** | **3. Timezone / Clock Skew** | A mismatch between the host OS clock and the database session timezone causes the `last_activity > NOW() - INTERVAL '1 minute'` session lock to behave incorrectly. | Synchronize the OS and database clocks; verify `TIMESTAMPTZ` conversions. |
| **Flask `Read timedout`** | **1. Cascading API Latency** | Flask enforces a strict 5-second timeout on requests to Express. If Express takes 5 seconds to resolve `localhost` or fetch database connections, Flask times out instantly. | Bypassing DNS via IP (`127.0.0.1`) solves both timeouts. |
| **Flask `Read timedout`** | **2. Duplicate/Hung Python Processes** | Multiple Python processes (e.g., system Anaconda Python vs Virtual Environment Python) running the Noting server simultaneously can block socket pools. | Terminate duplicate python tasks using `taskkill`. |
| **Flask `Read timedout`** | **3. Proxy Environment Variables** | Python's `requests` library automatically routes traffic through environment variables like `HTTP_PROXY`/`NO_PROXY` if configured locally, intercepting loopback connections. | Verify environment variables and configure `no_proxy=127.0.0.1,localhost`. |

---

## 🔍 Detailed Diagnostics

### 1. DNS Resolution Hang on `localhost` (Critical Air-Gap Issue)
* **The Mechanism**: In `Agra-sandhani/.env`, the database host is configured as `DB_HOST=localhost`. 
* **The Bug**: Node's `pg` driver resolves `localhost` using the operating system's name resolution. If the machine is air-gapped and DNS is misconfigured or unreachable, the OS will query the DNS server and wait for a response. This query hangs for exactly **5 seconds** before timing out and falling back to the local `hosts` file.
* **The Effect**: Every new database connection takes 5 seconds to establish. This causes:
  * The login request to take 5+ seconds (feeling like a timeout).
  * Flask requests to time out immediately (since Flask's HTTP timeout is set to 5 seconds).
* **The Fix**: Changing `DB_HOST` to `127.0.0.1` bypasses DNS resolution entirely.

### 2. Timezone Clock Skew & Session Lock
* **The Mechanism**: The login route checks if the user has an active session:
  ```sql
  (last_activity > NOW() - INTERVAL '1 minute' AND current_session_id IS NOT NULL) as is_active
  ```
* **The Bug**: If the server timezone or system clock was adjusted recently, or if PostgreSQL's `NOW()` clock is out of sync with the Node process's local time, `is_active` can evaluate to `true` even if the user is offline. This locks the account and returns a `403` error.
* **The Fix**: Resetting the `current_session_id` to `NULL` for the user in the database overrides this lock.

### 3. Duplicate Python Server Processes
* **The Mechanism**: You may have running instances of both the virtual environment Python and the system Anaconda Python.
* **The Bug**: If one process is hung (e.g., trying to run `pip` without internet) and another is listening, connections can build up in the TCP backlog (CLOSE_WAIT / FIN_WAIT states), causing socket pools to refuse or delay connections.
* **The Fix**: Kill all running Python tasks and restart only one instance using the correct path.
