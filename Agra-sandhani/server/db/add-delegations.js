const pool = require('./pool');

const addDelegations = async () => {
  const client = await pool.connect();
  try {
    console.log('🚀 Adding User Delegations feature...');

    // 1. Create user_delegations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_delegations (
        id SERIAL PRIMARY KEY,
        grantor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        grantee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(grantor_id, grantee_id)
      );
    `);
    console.log('  ✓ Created user_delegations table');

    // 2. Add expiration support to form_permissions as well (for per-form temporary access)
    await client.query(`
      ALTER TABLE form_permissions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
    `);
    console.log('  ✓ Added expires_at to form_permissions');

    // 3. Create indexes for performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_delegations_grantee ON user_delegations(grantee_id);
      CREATE INDEX IF NOT EXISTS idx_delegations_expires ON user_delegations(expires_at);
    `);
    console.log('  ✓ Created indexes');

    console.log('\n✅ User Delegations setup completed!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
  } finally {
    client.release();
    process.exit();
  }
};

addDelegations();
