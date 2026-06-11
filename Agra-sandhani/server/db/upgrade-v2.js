const pool = require('./pool');

const upgradeV2 = async () => {
  const client = await pool.connect();
  try {
    console.log('🚀 Starting Industry-Level Upgrade (V2)...');

    // 1. Permission Logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS permission_logs (
        id SERIAL PRIMARY KEY,
        permission_id INTEGER REFERENCES form_permissions(id) ON DELETE SET NULL,
        form_id INTEGER REFERENCES forms(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, -- Requester
        action TEXT NOT NULL, -- 'requested', 'approved', 'rejected', 'ignored'
        performed_by INTEGER REFERENCES users(id) ON DELETE SET NULL, -- Admin/Owner
        timestamp TIMESTAMP DEFAULT NOW(),
        details JSONB DEFAULT '{}'
      );
    `);
    console.log('  ✓ permission_logs table');

    // 2. Update form_permissions statuses (Add rejected/ignored)
    // No SQL change needed as it's a TEXT column, but we'll note it for the API.

    // 3. Update universities table
    await client.query(`
      ALTER TABLE universities 
      ADD COLUMN IF NOT EXISTS is_custom BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS acronym TEXT;
    `);
    console.log('  ✓ universities table updated (is_custom, acronym)');

    // 4. Create trigram index on acronym for fast searching
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_universities_acronym_trgm
      ON universities USING gin (acronym gin_trgm_ops);
    `);
    console.log('  ✓ trigram index on acronym');

    console.log('\n✅ Database Upgrade V2 completed successfully!');
  } catch (err) {
    console.error('Upgrade failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
};

upgradeV2();
