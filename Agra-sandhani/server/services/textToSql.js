const path = require('path');
const pool = require('../db/pool');

let llama = null;
let model = null;
let context = null;
let session = null;

// MODEL SELECTION
// Using the "Balanced" 3B model for speed and accuracy
const MODEL_PATH = path.join(__dirname, '..', 'models', 'Qwen-2.5-Coder-3B-SQL-Writer.Q4_K_M.gguf');

async function initModel() {
    if (session) return;
    try {
        console.log(`🚀 Initializing AI Data Explorer (3B Balanced Mode)...`);
        const { getLlama, LlamaChatSession } = await import('node-llama-cpp');
        
        llama = await getLlama();
        model = await llama.loadModel({ 
            modelPath: MODEL_PATH, 
            gpuLayers: 32 // 3B fits entirely in VRAM easily
        });
        
        context = await model.createContext({ contextSize: 2048 });
        
        const systemPrompt = `You are a Senior PostgreSQL Analyst. 
Your goal is to write SQL queries for a "submissions" table that uses a JSONB column for data.

TABLE STRUCTURE:
- submissions:
  - id (INTEGER)
  - form_version_id (INTEGER)
  - submitted_at (TIMESTAMP)
  - data_json (JSONB) -- THIS CONTAINS ALL FORM DATA
  - deleted_at (TIMESTAMP)

JSONB QUERY RULES:
1. All form fields are keys in "data_json".
2. TEXT: data_json->>'Field Name'
3. NUMERIC: (data_json->>'Field Name')::NUMERIC -- ONLY if the field is a pure number.
4. COMPOSITE FIELDS (e.g., CGPA): Use ILIKE for search, Regex for math.
   - Format: "Percentage% (CGPA: X, Scale: Y, Factor: Z)"
   - To get Numeric Percentage: NULLIF(regexp_replace(data_json->>'CGPA', '% .*', ''), '')::NUMERIC
   - To get Numeric CGPA: NULLIF(regexp_replace(data_json->>'CGPA', '.*CGPA: ([\\d.]+).*', '\\1'), '')::NUMERIC
5. OTHER COMPOSITE FIELDS (Pipe Separated " ||| "):
   - Bank: "Bank: Name ||| A/c: Number ||| IFSC: Code"
     - Extraction: regexp_replace(data_json->>'Bank Details', 'Bank: (.*?) \\|\\|\\| .*', '\\1')
   - Address: "House ||| District ||| State ||| Pincode"
     - Extraction (State): regexp_replace(data_json->>'Address', '.* \\|\\|\\| (.*?) \\|\\|\\| .*', '\\1')
   - Zone Group: "Zone ||| Group"
     - Extraction (Zone): regexp_replace(data_json->>'Zone Group', ' (.*?) \\|\\|\\| .*', '\\1')

ANALYTICAL OPERATIONS:
- Use AVG(), SUM(), COUNT(), MIN(), MAX().
- When doing math or numeric comparison on composite fields (like CGPA), ALWAYS use the Regex extraction provided above.
- Example "Average CGPA Percentage": AVG(NULLIF(regexp_replace(data_json->>'CGPA', '% .*', ''), '')::NUMERIC)
- ALWAYS SELECT f.name as "Form Name" when grouping.

CRITICAL RULES:
- CASE INSENSITIVITY: ALWAYS use "ILIKE" instead of "=" for text-based user searches (e.g., Names, Universities, Cities).
- NO DIRECT CASTING OF COMPOSITE FIELDS: NEVER use ::NUMERIC directly on fields like CGPA. Use regexp_replace first.
- CASE SENSITIVITY (KEYS): PostgreSQL JSONB keys are CASE SENSITIVE. Use EXACT casing from VIRTUAL SCHEMA for the keys themselves (e.g. data_json->>'Name').
- ALWAYS select s.id (if not aggregating), f.name as "Form Name", s.data_json as "Data" (if not aggregating).
- USE s.data_json as "Data" to return form fields.
- CROSS-FORM SEARCH: Always search across ALL provided forms unless the user explicitly asks for one specific form by name.
- ALWAYS include "s.deleted_at IS NULL".

EXAMPLE (Analytics & Filtering):
Prompt: "Find all entries for naman"
SQL:
SELECT f.name as "Form Name", s.data_json as "Data"
FROM submissions s
JOIN form_versions fv ON s.form_version_id = fv.id
JOIN forms f ON fv.form_id = f.id
WHERE s.deleted_at IS NULL
  AND s.data_json->>'Name' ILIKE 'naman';

EXAMPLE (CGPA Filtering):
`;

        session = new LlamaChatSession({
            contextSequence: context.getSequence(),
            systemPrompt: systemPrompt
        });
        console.log('✅ 3B AI Explorer Ready.');
    } catch (err) {
        console.error('❌ Failed to initialize AI model:', err);
        throw err;
    }
}

async function generateSql(userQuery, schemaContext = null) {
    await initModel();
    
    try {
        let prompt = userQuery;
        
        if (schemaContext) {
            // DYNAMIC CONTEXT INJECTION (The Metadata Layer)
            // Explicitly tell the model these are JSONB keys
            const formNamesStr = schemaContext.formNames ? schemaContext.formNames.join('", "') : schemaContext.formName;
            
            const ddl = `
JSONB FIELDS for "${formNamesStr}" (Keys in data_json):
${schemaContext.fields.map(f => `- "${f.label}" (${f.data_type === 'cgpa_converter' ? 'COMPOSITE: Use Regex for Numeric' : f.data_type.toUpperCase()})`).join('\n')}

RULES:
1. USE data_json->>'Key' for all fields listed above.
2. ALWAYS include "s.deleted_at IS NULL".
`;
            prompt = `${ddl}\n\nUSER REQUEST: ${userQuery}`;
        }

        console.log(`🤖 Prompt Sent to 3B:\n${prompt}\n`);
        const startTime = Date.now();
        
        let response = await session.prompt(`${prompt}\nSQL:`, {
            maxTokens: 1024,
            temperature: 0.1,
        });

        const duration = Date.now() - startTime;
        
        let sql = response.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        const sqlBlockMatch = sql.match(/```sql\s*([\s\S]*?)\s*```/i);
        if (sqlBlockMatch) sql = sqlBlockMatch[1];
        
        sql = sql.trim().replace(/;$/, '').trim();

        console.log(`⏱️ Generated in ${duration}ms`);
        return sql;
    } catch (err) {
        console.error('Error generating SQL:', err);
        return null;
    }
}

module.exports = { generateSql };
