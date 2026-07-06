const pool = require('./pool');

const upgrade = async () => {
  const client = await pool.connect();
  try {
    console.log('🚀 Adding GIN indexes for fast JSONB querying...');

    // 1. GIN Index for fast JSONB searching in submissions
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_submissions_data_json_gin ON submissions USING GIN (data_json);
    `);
    console.log('  ✓ Created GIN index on submissions.data_json');

    // 2. Add GIN index for keys if necessary (optional, but GIN handles it)
    
    console.log('\n✅ Performance indexes added!');
  } catch (err) {
    console.error('❌ Upgrade failed:', err);
  } finally {
    client.release();
    process.exit();
  }
};

upgrade();
