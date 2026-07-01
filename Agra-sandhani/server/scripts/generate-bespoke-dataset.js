const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'bespoke_dataset.jsonl');
const MODEL_PATH = path.join(__dirname, '..', 'models', 'Qwen-2.5-Coder-3B-SQL-Writer.Q4_K_M.gguf');

// --- HARDWARE SAFETY & RELIABILITY CONFIG ---
const NUM_WORKERS = 1;         
const CONTEXT_SIZE = 1024;      // Increased for complex prompting
const TOTAL_GOAL = 7500;
const COOLDOWN_MS = 1000;      

const FIELDS = ["name", "Email", "Phone", "MCQ", "Branch", "Duration", "University", "Residential address", "CGPA", "Score", "Age", "DOB", "Payment_Status", "Status", "Zone", "City", "District", "State", "Pincode", "Experience", "Skills", "Gender", "Category"];

const systemPrompt = `You are a Senior PostgreSQL EAV-SQL Expert.
TASK: Generate a complex query for the given fields.

GOLDEN RULE: Every field filter MUST use the subquery pattern: 
s.id IN (SELECT submission_id FROM submission_values sv JOIN form_fields ff ON sv.field_id = ff.id WHERE ff.label ILIKE 'FieldName' AND sv.value...)

CHECKLIST:
- Table "submissions" alias is "s".
- Table "submission_values" alias is "sv".
- Table "form_fields" alias is "ff".
- Filter deleted: s.deleted_at IS NULL.
- NO columns like s.phone or s.age. Use subqueries for these.
- Numeric: Use CAST(sv.value AS NUMERIC).

EXAMPLE:
QUESTION: Find users where Age > 20 and City is London.
SQL: SELECT s.id FROM submissions s 
WHERE s.id IN (SELECT submission_id FROM submission_values sv JOIN form_fields ff ON sv.field_id = ff.id WHERE ff.label ILIKE 'Age' AND CAST(sv.value AS NUMERIC) > 20)
AND s.id IN (SELECT submission_id FROM submission_values sv JOIN form_fields ff ON sv.field_id = ff.id WHERE ff.label ILIKE 'City' AND sv.value = 'London')
AND s.deleted_at IS NULL;

FORMAT:
QUESTION: [Natural language]
SQL: [Clean SQL]`;

function validateSQL(sql) {
    const lower = sql.toLowerCase();
    // Strict EAV requirement: Must use s.id IN (SELECT ... FROM submission_values)
    const hasEAVSubquery = lower.includes('s.id in') && lower.includes('submission_values');
    const hasSoftDelete = lower.includes('s.deleted_at is null');
    const noHallucinations = !lower.includes('s.phone') && !lower.includes('s.age') && !lower.includes('s.university');
    return hasEAVSubquery && hasSoftDelete && noHallucinations;
}

async function runSafeDistillation() {
    const { getLlama, LlamaChatSession } = await import('node-llama-cpp');

    let seenQueries = new Set();
    if (fs.existsSync(OUTPUT_FILE)) {
        fs.readFileSync(OUTPUT_FILE, 'utf8').split('\n').filter(Boolean).forEach(line => {
            try { seenQueries.add(JSON.parse(line).instruction); } catch(e) {}
        });
    }

    console.log(`🚀 Resuming with Senior Prompt (${seenQueries.size}/${TOTAL_GOAL})...`);

    const llama = await getLlama();
    const model = await llama.loadModel({ modelPath: MODEL_PATH, gpuLayers: 'max' });
    const context = await model.createContext({ contextSize: CONTEXT_SIZE, sequences: NUM_WORKERS });
    const stream = fs.createWriteStream(OUTPUT_FILE, { flags: 'a' });

    let successCount = seenQueries.size;
    let totalAttempts = 0;

    const worker = async () => {
        const session = new LlamaChatSession({ 
            contextSequence: context.getSequence(), 
            systemPrompt 
        });

        while (successCount < TOTAL_GOAL) {
            totalAttempts++;
            const f1 = FIELDS[Math.floor(Math.random() * FIELDS.length)];
            const f2 = FIELDS[Math.floor(Math.random() * FIELDS.length)];
            const prompt = `Fields: "${f1}" and "${f2}". Requirement: One subquery per field.`;

            try {
                process.stdout.write(`[Att ${totalAttempts}] `);
                let response = await session.prompt(prompt, { maxTokens: 450, temperature: 0.7 });
                response = response.replace(/<think>[\s\S]*?<\/think>/g, '');

                const qMatch = response.match(/QUESTION:\s*(.*)/i);
                const sMatch = response.match(/SQL:\s*([\s\S]*)/i);

                if (qMatch && sMatch) {
                    const question = qMatch[1].trim().replace(/\*\*/g, '');
                    let sql = sMatch[1].trim().replace(/```sql|```/gi, '').trim();
                    if (sql.includes(';')) sql = sql.substring(0, sql.lastIndexOf(';') + 1);

                    const inst = `Convert this natural language query to PostgreSQL EAV SQL: ${question}`;

                    if (!seenQueries.has(inst) && validateSQL(sql)) {
                        stream.write(JSON.stringify({ instruction: inst, input: "", output: sql }) + "\n");
                        seenQueries.add(inst);
                        successCount++;
                        console.log(`✅ ${successCount}`);
                    } else {
                        process.stdout.write(`❌ `);
                    }
                } else {
                    process.stdout.write(`⚠️ `);
                }
                
                await new Promise(r => setTimeout(r, COOLDOWN_MS));
            } catch (err) {
                console.log(`\n❌ ERROR: ${err.message}`);
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    };

    await worker();
    stream.end();
}

runSafeDistillation().catch(console.error);
