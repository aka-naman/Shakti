const pool = require('./pool');

const upgrade = async () => {
  const client = await pool.connect();
  try {
    console.log('🚀 Optimizing JSONB search with Trigram indexes...');

    // 1. Enable pg_trgm extension if not already enabled
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    console.log('  ✓ Enabled pg_trgm extension');

    // 2. Create a GIN Trigram index on the text representation of data_json
    // This accelerates the "EXISTS (SELECT 1 FROM jsonb_each_text(data_json) WHERE value ILIKE $1)" fallback
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_submissions_data_json_trgm 
      ON submissions USING GIN ((data_json::text) gin_trgm_ops);
    `);
    console.log('  ✓ Created Trigram index on data_json (textual fallback)');

    // 3. Create specific trigram indexes for high-traffic fields to ensure maximum speed
    // Note: These are functional indexes on common keys
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_submissions_pis_trgm 
      ON submissions USING GIN ((data_json->>'pis') gin_trgm_ops);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_submissions_name_trgm 
      ON submissions USING GIN ((data_json->>'name') gin_trgm_ops);
    `);
    console.log('  ✓ Created specific functional Trigram indexes for "pis" and "name"');

    console.log('\n✅ Search performance optimization complete!');
  } catch (err) {
    console.error('❌ Optimization failed:', err);
  } finally {
    client.release();
    process.exit();
  }
};

upgrade();
