const pool = require('./pool');

const adminUpgrade = async () => {
  const client = await pool.connect();
  try {
    console.log('🚀 Starting Admin Monitoring Suite Upgrade...');

    // 1. Unified System Logs Table (JSONB)
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_logs (
        id SERIAL PRIMARY KEY,
        action_type TEXT NOT NULL, -- 'export', 'edit_submission', 'delete_submission', 'restore_submission', 'form_edit'
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        timestamp TIMESTAMP DEFAULT NOW(),
        details JSONB DEFAULT '{}'
      );
    `);
    console.log('  ✓ system_logs table created');

    // 2. GIN Index for fast JSONB querying
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_system_logs_details ON system_logs USING GIN (details);
    `);
    console.log('  ✓ GIN index on system_logs.details');

    // 3. Action type index for fast filtering
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_system_logs_action_type ON system_logs(action_type);
    `);
    console.log('  ✓ index on system_logs.action_type');

    // 4. Soft Delete support for Forms
    await client.query(`
      ALTER TABLE forms ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP DEFAULT NULL;
    `);
    console.log('  ✓ soft-delete support added to forms');

    console.log('\n✅ Admin Monitoring Database Foundation Complete!');
  } catch (err) {
    console.error('Upgrade failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
};

adminUpgrade();
