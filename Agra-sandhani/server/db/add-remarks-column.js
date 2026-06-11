const pool = require('./pool');

const addRemarksColumn = async () => {
  const client = await pool.connect();
  try {
    console.log('🔄 Adding Remarks support to submissions...');

    // 1. Add remarks column if not exists
    await client.query(`
      ALTER TABLE submissions 
      ADD COLUMN IF NOT EXISTS remarks TEXT;
    `);
    console.log('  ✓ remarks column ensured');

    console.log('\n✅ Remarks migration completed!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
};

addRemarksColumn();
