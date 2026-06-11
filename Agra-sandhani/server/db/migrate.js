const pool = require('./pool');

const migrate = async () => {
  const client = await pool.connect();
  try {
    console.log('Running migrations...');

    // Enable extensions
    await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
    console.log('  ✓ pg_trgm extension enabled');

    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✓ users table');

    // Forms table
    await client.query(`
      CREATE TABLE IF NOT EXISTS forms (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        is_locked BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // Migration: add description column to existing forms table
    await client.query(`
      ALTER TABLE forms ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
    `);
    console.log('  ✓ forms table');

    // Form versions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS form_versions (
        id SERIAL PRIMARY KEY,
        form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✓ form_versions table');

    // Form fields table
    await client.query(`
      CREATE TABLE IF NOT EXISTS form_fields (
        id SERIAL PRIMARY KEY,
        form_version_id INTEGER NOT NULL REFERENCES form_versions(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        type TEXT NOT NULL,
        options_json JSONB DEFAULT '[]',
        field_order INTEGER NOT NULL DEFAULT 0,
        validation_rules JSONB DEFAULT '{}',
        data_type TEXT DEFAULT 'text',
        is_unique BOOLEAN DEFAULT false
      );
    `);
    // Migration: add data_type and is_unique columns to existing form_fields table
    await client.query(`
      ALTER TABLE form_fields ADD COLUMN IF NOT EXISTS data_type TEXT DEFAULT 'text';
      ALTER TABLE form_fields ADD COLUMN IF NOT EXISTS is_unique BOOLEAN DEFAULT false;
    `);

    // GIN Index for fast JSONB searching in submissions
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_submissions_data_json_gin ON submissions USING GIN (data_json);
    `);
    
    console.log('  ✓ form_fields table');

    // Submissions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS submissions (
        id SERIAL PRIMARY KEY,
        form_version_id INTEGER NOT NULL REFERENCES form_versions(id) ON DELETE CASCADE,
        submitted_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('  ✓ submissions table');

    // Submission values table
    await client.query(`
      CREATE TABLE IF NOT EXISTS submission_values (
        id SERIAL PRIMARY KEY,
        submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
        field_id INTEGER NOT NULL REFERENCES form_fields(id) ON DELETE CASCADE,
        value TEXT
      );
    `);
    console.log('  ✓ submission_values table');

    // Universities table
    await client.query(`
      CREATE TABLE IF NOT EXISTS universities (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        state TEXT NOT NULL,
        district TEXT NOT NULL
      );
    `);
    console.log('  ✓ universities table');

    // Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_universities_name_trgm
      ON universities USING gin (name gin_trgm_ops);
    `);
    console.log('  ✓ trigram index on universities.name');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_form_versions_form_id
      ON form_versions(form_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_form_fields_version_id
      ON form_fields(form_version_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_submissions_version_id
      ON submissions(form_version_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_submission_values_submission_id
      ON submission_values(submission_id);
    `);
    console.log('  ✓ additional indexes');

    console.log('\n✅ All migrations completed successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

migrate();
