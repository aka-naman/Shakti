const pool = require('./pool');

const upgradeProduction = async () => {
  const client = await pool.connect();
  try {
    console.log('🚀 Starting Production-Grade Feature Upgrade...');

    // 1. User Session & Activity Tracking
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS last_activity TIMESTAMP DEFAULT '1970-01-01',
      ADD COLUMN IF NOT EXISTS current_session_id TEXT;
    `);
    console.log('  ✓ Session tracking columns added to users');

    // 2. Submission Ownership (Submitted By)
    await client.query(`
      ALTER TABLE submissions 
      ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
    `);
    
    // Backfill user_id from updated_by for existing submissions
    await client.query(`
      UPDATE submissions SET user_id = updated_by WHERE user_id IS NULL AND updated_by IS NOT NULL;
    `);
    console.log('  ✓ user_id column added to submissions and backfilled');

    // 3. Performance Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_last_activity ON users(last_activity);
      CREATE INDEX IF NOT EXISTS idx_submissions_user_id ON submissions(user_id);
    `);
    console.log('  ✓ Performance indexes created');

    console.log('\n✅ Database Upgrade Complete!');
  } catch (err) {
    console.error('Upgrade failed:', err);
  } finally {
    client.release();
    process.exit();
  }
};

upgradeProduction();
