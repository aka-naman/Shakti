const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, '..', 'data', 'bespoke_dataset.jsonl');
const CLEAN_FILE_PATH = path.join(__dirname, '..', 'data', 'bespoke_dataset_clean.jsonl');

if (!fs.existsSync(FILE_PATH)) {
    console.error('File not found!');
    process.exit(1);
}

const lines = fs.readFileSync(FILE_PATH, 'utf8').split('\n').filter(l => l.trim());
const uniqueInstructions = new Set();
const cleanedLines = [];

console.log(`Processing ${lines.length} lines...`);

lines.forEach((line, index) => {
    try {
        const data = JSON.parse(line);
        
        // 1. Clean instruction (remove markdown bolding)
        data.instruction = data.instruction.replace(/\*\*/g, '').replace(/\"/g, "'").trim();
        
        // 2. Filter out duplicates
        if (uniqueInstructions.has(data.instruction)) return;
        
        // 3. Basic Quality Check on SQL
        const sql = data.output.toLowerCase();
        
        // Skip if it doesn't look like valid SQL or mentions non-existent columns
        if (!sql.includes('select') || !sql.includes('from')) return;
        if (sql.includes('s.university') || sql.includes('s.phone') || sql.includes('experience_value')) return;
        
        // 4. Heuristic for EAV quality: Should have submission_values or s.id IN
        const isEAV = sql.includes('submission_values') || sql.includes('s.id in');
        if (!isEAV) return;

        uniqueInstructions.add(data.instruction);
        cleanedLines.push(JSON.stringify(data));
    } catch (e) {
        console.error(`Error parsing line ${index}: ${e.message}`);
    }
});

fs.writeFileSync(CLEAN_FILE_PATH, cleanedLines.join('\n') + '\n');
console.log(`Cleaned dataset saved. Reduced from ${lines.length} to ${cleanedLines.length} entries.`);
