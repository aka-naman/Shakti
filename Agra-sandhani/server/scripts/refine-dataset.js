const fs = require('fs');
const path = require('path');

const INPUT_FILE = path.join(__dirname, '..', 'data', 'bespoke_dataset_unfiltered.jsonl');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'bespoke_dataset_clean.jsonl');

if (!fs.existsSync(INPUT_FILE)) {
    console.error('Input file not found:', INPUT_FILE);
    process.exit(1);
}

const lines = fs.readFileSync(INPUT_FILE, 'utf8').split('\n').filter(Boolean);
const cleanedData = [];
const seenInstructions = new Set();

console.log(`🔍 Refining ${lines.length} entries...`);

let stats = {
    duplicates: 0,
    hallucinationsFixed: 0,
    invalidLogicRemoved: 0,
    invalidSchemaRemoved: 0,
    auditFixed: 0
};

lines.forEach((line, index) => {
    try {
        const entry = JSON.parse(line);
        let { instruction, output } = entry;

        // 1. Normalize Instruction & Check Duplicates
        const normInst = instruction.trim().toLowerCase();
        if (seenInstructions.has(normInst)) {
            stats.duplicates++;
            return;
        }

        // 2. Remove Hallucinated Form Names (e.g., 'harv')
        const mentionsHarvInInstruction = instruction.toLowerCase().includes('harv');
        if (!mentionsHarvInInstruction && output.toLowerCase().includes('harv')) {
            // Remove f.name filter for 'harv' if not asked for
            output = output.replace(/\n\s*AND f\.name ILIKE '%harv%'/gi, '');
            output = output.replace(/AND f\.name ILIKE '%harv%'/gi, '');
            output = output.replace(/f\.name ILIKE '%harv%'\s*AND/gi, '');
            stats.hallucinationsFixed++;
        }

        // 3. Structural Validation: Multiple Fields Check
        // If the instruction mentions two different fields, we expect two subqueries or a complex JOIN
        // Common fields to look for in instruction
        const commonFields = ["MCQ", "Phone", "Age", "Uni", "University", "Duration", "Name", "Email", "City", "District", "State", "Pincode", "CGPA"];
        const foundFields = commonFields.filter(f => 
            new RegExp(`\\b${f}\\b`, 'i').test(instruction)
        );

        if (foundFields.length >= 2) {
            // Check if SQL has multiple subqueries or specific field labels
            const subqueryCount = (output.toLowerCase().match(/s\.id in/g) || []).length;
            const labelCount = (output.toLowerCase().match(/ff\.label ilike/g) || []).length;
            
            // If it's a "Filter X by A and B" but only has one subquery/label block, it's likely a hallucinated OR
            if (subqueryCount < 2 && labelCount < 2 && !output.toLowerCase().includes('union')) {
                stats.invalidLogicRemoved++;
                return; 
            }
        }

        // 4. Schema Integrity
        const lowerSQL = output.toLowerCase();
        // SUBMISSIONS table only has: id, form_version_id, submitted_at, deleted_at
        // USERS table only has: id, username, password_hash, role, created_at
        const bannedColumns = [
            's.university', 's.phone', 's.age', 's.experience', 's.gender', 's.city',
            's.updated_at', 's.updated_by' // These don't exist in migrations!
        ];
        if (bannedColumns.some(col => lowerSQL.includes(col))) {
            stats.invalidSchemaRemoved++;
            return;
        }

        // 5. Audit Log Logic
        if (instruction.toLowerCase().includes('audit') || instruction.toLowerCase().includes('change')) {
            if (!lowerSQL.includes('submission_audit')) {
                // Try to fix simple "Who edited" or "audit" queries that forgot the audit table
                if (instruction.toLowerCase().includes('who edited')) {
                   // Keep it if it uses updated_by, but true audit needs the table
                } else {
                   stats.invalidSchemaRemoved++;
                   return;
                }
            }
        }

        // 6. Final cleanup
        output = output.replace(/-- Replace with actual form name/g, '');
        output = output.replace(/--.*$/gm, ''); // Remove all comments
        
        entry.output = output.trim();
        seenInstructions.add(normInst);
        cleanedData.push(entry);

    } catch (e) {
        console.error(`Error processing line ${index}:`, e.message);
    }
});

// Write the high-quality dataset
const outputContent = cleanedData.map(d => JSON.stringify(d)).join('\n') + '\n';
fs.writeFileSync(OUTPUT_FILE, outputContent);

console.log(`\n✨ Refinement Complete!`);
console.log(`- Total Input: ${lines.length}`);
统计结果 = {
    "Duplicates Removed": stats.duplicates,
    "Hallucinations Fixed": stats.hallucinationsFixed,
    "Invalid Logic Removed": stats.invalidLogicRemoved,
    "Invalid Schema Removed": stats.invalidSchemaRemoved,
    "Final Dataset Size": cleanedData.length
};
console.table(统计结果);
