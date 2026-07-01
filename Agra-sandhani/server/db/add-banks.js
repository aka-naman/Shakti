const pool = require('./pool');

const addBanksTable = async () => {
    const client = await pool.connect();
    try {
        console.log('🚀 Setting up dynamic Banks table...');
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS banks (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE
            );
        `);
        console.log('  ✓ Banks table created');

        // Seed initial data
        const defaultBanks = [
            'State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Punjab National Bank', 
            'Axis Bank', 'Canara Bank', 'Bank of Baroda', 'Union Bank of India'
        ];

        for (const bank of defaultBanks) {
            await client.query(`
                INSERT INTO banks (name) VALUES ($1) ON CONFLICT (name) DO NOTHING;
            `, [bank]);
        }
        console.log('  ✓ Initial banks seeded');

        console.log('\n✅ Bank migration completed successfully!');
    } catch (err) {
        console.error('❌ Migration failed:', err);
    } finally {
        client.release();
        process.exit();
    }
};

addBanksTable();
