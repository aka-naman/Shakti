const pool = require('./pool');

const addScalingIndexes = async () => {
  const client = await pool.connect();
  try {
    console.log('🚀 Implementing Scaling Optimizations (Indexes)...');

    // 1. GIN Index on submissions data_json
    // This speeds up existence (?) and containment (@>) queries in JSONB
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_submissions_data_json_gin 
      ON submissions USING gin (data_json);
    `);
    console.log('  ✓ GIN index on submissions.data_json');

    // 2. Performance Index on form_id for permissions
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_form_permissions_user_form 
      ON form_permissions(user_id, form_id, status);
    `);
    console.log('  ✓ Composite index on form_permissions');

    console.log('\n✅ Scaling indexes applied!');
  } catch (err) {
    console.error('❌ Index creation failed:', err);
  } finally {
    client.release();
    process.exit();
  }
};

addScalingIndexes();
