# 🛡️ Agra-sandhani Detailed Technical Reference: Chapter 7 (Expanded Edition)
## Autocomplete Engines, Trigram Similarity, and Airgapped Architecture

This document details the autocomplete routes, acronym matching systems, and offline deployment configurations of the **Agra-sandhani** platform. It also provides a theoretical analysis of the mathematical, language parsing, and system architecture principles that drive these systems.

---

## 📂 1. Autocomplete & Infrastructure Core Files

| File Path | Functional Responsibility |
| :--- | :--- |
| `server/routes/autocomplete.js` | Location dropdown lists, dot-agnostic acronym lookups, and trigram similarity queries |
| `Launch_Offline.bat` | Windows bootstrap script for running the application in airgapped environments |

---

## 🔬 2. Trigram Similarity & String Matching Theory

Agra-sandhani uses the PostgreSQL `pg_trgm` extension to power its autocomplete engine, ordering search results by relevance:
```sql
ORDER BY 
   (CASE 
       WHEN name ILIKE $1 THEN 0 
       WHEN acronym ILIKE $1 THEN 1
       ELSE 2 
    END),
   similarity(name, $3) DESC;
```

### 2.1 Mathematical Formulation of Trigram Similarity
A trigram is a contiguous sequence of three characters extracted from a string. When comparing two strings, the database engine splits both into sets of trigrams.

#### The Jaccard Similarity Coefficient:
The similarity score is calculated using the Jaccard index formula:
$$\text{Similarity}(S_1, S_2) = \frac{|T(S_1) \cap T(S_2)|}{|T(S_1) \cup T(S_2)|}$$

* $T(S_1)$ represents the set of trigrams in the first string.
* $T(S_2)$ represents the set of trigrams in the second string.
* $|T(S_1) \cap T(S_2)|$ is the size of the intersection (shared trigrams) between both sets.
* $|T(S_1) \cup T(S_2)|$ is the size of the union (total unique trigrams) of both sets.

#### Trigram Padding Mechanics:
To ensure prefix and suffix matches are weighted correctly, PostgreSQL pads strings with spaces before splitting them:
* **Prefix Padding**: Padded with two prefix spaces.
* **Suffix Padding**: Padded with one suffix space.

For example, the string `"PEC"` is padded to `"  PEC "` and split into:
`{"  P", " PE", "PEC", "EC ", "C  "}`

This padding ensures that short search inputs match prefix and suffix characters correctly. Without padding, the union size would be very small, distorting the similarity score.

#### Computational Complexity:
Comparing trigram sets is computationally cheaper than calculating Levenshtein Distance (which has an $O(M \times N)$ complexity). Set intersection operations run in $O(M + N)$ time, allowing the database to search thousands of university records on low-end hardware in milliseconds.

---

## 🧠 3. Non-Deterministic Finite Automata (NFA) Regex Theory

To allow users to find abbreviations with inconsistent punctuation, the system converts short search strings into dynamic regular expressions:
```javascript
const fuzzyPattern = q.split('').filter(c => /[a-zA-Z0-9]/.test(c)).join('.*');
```

For example, the search query `"PEC"` is transformed into `"P.*E.*C"`.

```
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
```

### Theoretical Highlights:
* **NFA State Transitions**: The pattern is compiled into a Non-Deterministic Finite Automaton (NFA). The engine transitions states as it matches characters. If it matches `"P"`, it enters a wildcard scan state, matching any characters until it matches `"E"`, then enters another wildcard scan state until `"C"` is matched.
* **catastrophic Backtracking Mitigation**: Wildcard patterns (`.*`) can trigger catastrophic backtracking if not constrained, wasting CPU cycles on failed matches. Agra-sandhani prevents this by limiting search inputs to a maximum length and filtering out non-alphanumeric characters, ensuring fast execution.

---

## 🌐 4. Airgapped Dependency Resolution Theory

In standard web applications, packages and assets are resolved at build-time or runtime using public package registries (like NPM or CDN hosts). In an airgapped LAN, this system is impossible.

Agra-sandhani resolves this by implementing a **Self-Contained Dependency Pinning model**:

### 4.1 Immutable Compile-Time Bundling
* **Vite/Rollup Compilation**: All frontend components, assets (like CSS and SVG icons), and libraries are compiled into a static, single-page application (SPA) inside `client/dist`. The build output is inline, ensuring the application loads without external network requests.
* **Server as Static Host**: Express hosts the static assets directly from disk:
  ```javascript
  app.use(express.static(clientBuildPath));
  ```
  It utilizes standard caching headers (`Cache-Control`, `ETag`) to optimize asset loading, reducing local network roundtrips on older LAN configurations.

### 4.2 Portable Database Migrations
Migrations are managed using self-contained SQL update files, allowing the database schema to update without external internet access or package downloads.
