const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'jsonb_distillation_dataset.jsonl');
// Using the 7B model as the "Teacher" for highest quality
const MODEL_PATH = path.join(__dirname, '..', 'models', 'qwen2.5-coder-7b-instruct-q3_k_m.gguf');

const NUM_WORKERS = 1;         
const CONTEXT_SIZE = 2048;
const TOTAL_GOAL = 5000;
const COOLDOWN_MS = 100;      

const FIELDS = [
    { label: "Roll number", type: "NUMERIC" },
    { label: "university", type: "TEXT" },
    { label: "CGPA", type: "NUMERIC" },
    { label: "Age", type: "NUMERIC" },
    { label: "City", type: "TEXT" },
    { label: "Joining Date", type: "DATE" },
    { label: "District", type: "TEXT" },
    { label: "Score", type: "NUMERIC" }
];

const FORMS = ["university filter testing", "Student Admissions", "Employee Records", "Course Registration"];

const systemPrompt = `You are a Senior PostgreSQL JSONB Specialist.
TASK: Generate a training pair for a Text-to-JSONB-SQL model.

RULES:
1. Table "submissions" alias "s", "form_versions" alias "fv", "forms" alias "f".
2. Use data_json->>'Field Name' for all data access.
3. Numeric: (s.data_json->>'Field Name')::NUMERIC
4. Date: (s.data_json->>'Field Name')::DATE
5. ALWAYS filter by f.name and s.deleted_at IS NULL.
6. Return EXACTLY this format:
QUESTION: [Natural language]
SCHEMA: [The virtual schema string]
SQL: [Clean SQL]

EXAMPLE:
QUESTION: Find students in 'Testing' with Age > 20
SCHEMA: VIRTUAL SCHEMA FOR "Testing": - "Age" (NUMERIC)
SQL: SELECT s.id, s.submitted_at, f.name as "Form Name", s.data_json as "Data" FROM submissions s JOIN form_versions fv ON s.form_version_id = fv.id JOIN forms f ON fv.form_id = f.id WHERE f.name = 'Testing' AND (s.data_json->>'Age')::NUMERIC > 20 AND s.deleted_at IS NULL;`;

function validateSQL(sql, formName) {
    const lower = sql.toLowerCase();
    const hasJsonb = lower.includes('->>');
    const hasForm = lower.includes(formName.toLowerCase());
    const hasNoEav = !lower.includes('submission_values');
    return hasJsonb && hasForm && hasNoEav;
}

async function runDistillation() {
    const { getLlama, LlamaChatSession } = await import('node-llama-cpp');

    console.log(`🚀 Starting JSONB Distillation (Goal: ${TOTAL_GOAL})...`);

    const llama = await getLlama();
    const model = await llama.loadModel({ modelPath: MODEL_PATH, gpuLayers: 16 });
    const context = await model.createContext({ contextSize: CONTEXT_SIZE });
    const stream = fs.createWriteStream(OUTPUT_FILE, { flags: 'a' });

    let successCount = 0;

    const session = new LlamaChatSession({ 
        contextSequence: context.getSequence(), 
        systemPrompt 
    });

    while (successCount < TOTAL_GOAL) {
        const formName = FORMS[Math.floor(Math.random() * FORMS.length)];
        const f1 = FIELDS[Math.floor(Math.random() * FIELDS.length)];
        const prompt = `Form: "${formName}". Field: "${f1.label}" (${f1.type}). Create a varied question.`;

        try {
            let response = await session.prompt(prompt, { maxTokens: 512, temperature: 0.8 });
            response = response.replace(/<think>[\s\S]*?<\/think>/g, '');

            const qMatch = response.match(/QUESTION:\s*(.*)/i);
            const scMatch = response.match(/SCHEMA:\s*(.*)/i);
            const sMatch = response.match(/SQL:\s*([\s\S]*)/i);

            if (qMatch && scMatch && sMatch) {
                const question = qMatch[1].trim();
                const schema = scMatch[1].trim();
                let sql = sMatch[1].trim().replace(/```sql|```/gi, '').trim();

                if (validateSQL(sql, formName)) {
                    const trainingEntry = {
                        instruction: `Translate to JSONB SQL: ${question}`,
                        input: schema,
                        output: sql
                    };
                    stream.write(JSON.stringify(trainingEntry) + "\n");
                    successCount++;
                    if (successCount % 10 === 0) console.log(`✅ Generated ${successCount}/${TOTAL_GOAL}`);
                }
            }
        } catch (err) {
            console.error(`Error: ${err.message}`);
        }
    }
    stream.end();
}

runDistillation().catch(console.error);
