const pool = require('./pool');

const industryUpgrade = async () => {
  const client = await pool.connect();
  try {
    console.log('🚀 Starting Industry-Level Architectural Upgrade...');

    // 1. Audit Trail Table (JSONB Snapshot Pattern)
    await client.query(`
      CREATE TABLE IF NOT EXISTS submission_audit (
        id SERIAL PRIMARY KEY,
        submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
        changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        changed_at TIMESTAMP DEFAULT NOW(),
        old_values_json JSONB NOT NULL, -- Snapshot of all values before the change
        change_type TEXT DEFAULT 'update' -- 'update', 'delete', 'restore'
      );
    `);
    console.log('  ✓ submission_audit table created');

    // 2. Soft Delete Support
    await client.query(`
      ALTER TABLE submissions 
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
    `);
    console.log('  ✓ soft delete column added to submissions');

    // 3. Performance Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_submissions_deleted_at ON submissions(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_submission_audit_submission_id ON submission_audit(submission_id);
    `);
    console.log('  ✓ performance indexes created');

    // 4. University/Location Improvements
    await client.query(`
      ALTER TABLE universities 
      ADD COLUMN IF NOT EXISTS is_custom BOOLEAN DEFAULT false;
    `);
    console.log('  ✓ is_custom column added to universities');

    console.log('\n✅ Industry Upgrade Database Foundation Complete!');
  } catch (err) {
    console.error('Upgrade failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
};

industryUpgrade();
