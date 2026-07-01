const pool = require('./pool');

const upgrade = async () => {
  const client = await pool.connect();
  try {
    console.log('🚀 Starting AI-Ready Database Upgrade...');

    // 1. Add data_type to form_fields
    await client.query(`
      ALTER TABLE form_fields ADD COLUMN IF NOT EXISTS data_type TEXT DEFAULT 'text';
    `);
    console.log('  ✓ Added data_type to form_fields');

    // 2. Add data_json to submissions
    await client.query(`
      ALTER TABLE submissions ADD COLUMN IF NOT EXISTS data_json JSONB DEFAULT '{}';
    `);
    console.log('  ✓ Added data_json to submissions');

    // 3. Migrate existing EAV data to data_json
    console.log('  ⏳ Migrating existing data to JSONB (this may take a moment)...');
    await client.query(`
      WITH flattened_data AS (
        SELECT 
          sv.submission_id,
          jsonb_object_agg(ff.label, sv.value) as combined_data
        FROM submission_values sv
        JOIN form_fields ff ON sv.field_id = ff.id
        GROUP BY sv.submission_id
      )
      UPDATE submissions s
      SET data_json = fd.combined_data
      FROM flattened_data fd
      WHERE s.id = fd.submission_id;
    `);
    console.log('  ✓ Data migration complete');

    // 4. Update existing field types based on UI types
    await client.query(`
      UPDATE form_fields 
      SET data_type = 'number' 
      WHERE type IN ('number', 'rating', 'cgpa');
      
      UPDATE form_fields 
      SET data_type = 'date' 
      WHERE type IN ('date');
      
      UPDATE form_fields 
      SET data_type = 'boolean' 
      WHERE type IN ('checkbox');
    `);
    console.log('  ✓ Metadata layer initialized');

    console.log('\n✅ Database is now AI-Ready!');
  } catch (err) {
    console.error('❌ Upgrade failed:', err);
  } finally {
    client.release();
    process.exit();
  }
};

upgrade();
