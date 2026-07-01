const pool = require('./pool');
const path = require('path');
const fs = require('fs');

const seed = async () => {
    const client = await pool.connect();
    try {
        console.log('Seeding universities...');

        const xlsxPath = path.join(__dirname, '..', 'data', 'universities.xlsx');

        let rows = [];

        if (fs.existsSync(xlsxPath)) {
            // Parse Excel file
            const XLSX = require('xlsx');
            const workbook = XLSX.readFile(xlsxPath);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

            // Skip header row
            for (let i = 1; i < rawData.length; i++) {
                const row = rawData[i];
                if (!row || !row[0]) continue;

                const name = String(row[0]).trim();
                const state = String(row[1] || '').trim();
                const district = String(row[2] || '').trim();

                if (name) {
                    rows.push({ name, state, district });
                }
            }
            console.log(`  Parsed ${rows.length} rows from Excel`);
        } else {
            console.log('  ⚠ universities.xlsx not found at', xlsxPath);
            console.log('  Using sample development data...');

            rows = [
                { name: 'Indian Institute of Technology Delhi', state: 'Delhi', district: 'New Delhi' },
                { name: 'Indian Institute of Technology Bombay', state: 'Maharashtra', district: 'Mumbai' },
                { name: 'Indian Institute of Technology Madras', state: 'Tamil Nadu', district: 'Chennai' },
                { name: 'Indian Institute of Technology Kanpur', state: 'Uttar Pradesh', district: 'Kanpur' },
                { name: 'Indian Institute of Technology Kharagpur', state: 'West Bengal', district: 'Paschim Medinipur' },
                { name: 'Indian Institute of Technology Roorkee', state: 'Uttarakhand', district: 'Haridwar' },
                { name: 'Indian Institute of Technology Guwahati', state: 'Assam', district: 'Kamrup' },
                { name: 'Indian Institute of Technology Hyderabad', state: 'Telangana', district: 'Sangareddy' },
                { name: 'Indian Institute of Science Bangalore', state: 'Karnataka', district: 'Bangalore' },
                { name: 'University of Delhi', state: 'Delhi', district: 'New Delhi' },
                { name: 'Jawaharlal Nehru University', state: 'Delhi', district: 'New Delhi' },
                { name: 'Banaras Hindu University', state: 'Uttar Pradesh', district: 'Varanasi' },
                { name: 'University of Mumbai', state: 'Maharashtra', district: 'Mumbai' },
                { name: 'University of Calcutta', state: 'West Bengal', district: 'Kolkata' },
                { name: 'University of Madras', state: 'Tamil Nadu', district: 'Chennai' },
                { name: 'Savitribai Phule Pune University', state: 'Maharashtra', district: 'Pune' },
                { name: 'Anna University', state: 'Tamil Nadu', district: 'Chennai' },
                { name: 'Osmania University', state: 'Telangana', district: 'Hyderabad' },
                { name: 'Jadavpur University', state: 'West Bengal', district: 'Kolkata' },
                { name: 'Aligarh Muslim University', state: 'Uttar Pradesh', district: 'Aligarh' },
                { name: 'Amity University', state: 'Uttar Pradesh', district: 'Gautam Buddha Nagar' },
                { name: 'Manipal Academy of Higher Education', state: 'Karnataka', district: 'Udupi' },
                { name: 'Vellore Institute of Technology', state: 'Tamil Nadu', district: 'Vellore' },
                { name: 'Birla Institute of Technology and Science Pilani', state: 'Rajasthan', district: 'Jhunjhunu' },
                { name: 'National Institute of Technology Trichy', state: 'Tamil Nadu', district: 'Tiruchirappalli' },
            ];
        }

        // Deduplicate by name (case-insensitive)
        const seen = new Set();
        const uniqueRows = [];
        for (const row of rows) {
            const key = row.name.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                uniqueRows.push(row);
            }
        }
        console.log(`  ${uniqueRows.length} unique universities after dedup`);

        // Clear existing data
        await client.query('DELETE FROM universities');

        // Bulk insert in batches of 100
        const batchSize = 100;
        for (let i = 0; i < uniqueRows.length; i += batchSize) {
            const batch = uniqueRows.slice(i, i + batchSize);
            const values = [];
            const params = [];
            batch.forEach((row, idx) => {
                const offset = idx * 3;
                values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
                params.push(row.name, row.state, row.district);
            });

            await client.query(
                `INSERT INTO universities (name, state, district) VALUES ${values.join(', ')}`,
                params
            );
        }

        console.log(`\n✅ Seeded ${uniqueRows.length} universities successfully!`);
    } catch (err) {
        console.error('Seed failed:', err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
};

seed();
