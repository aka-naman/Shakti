const pool = require('./pool');

const migrateCollateral = async () => {
  const client = await pool.connect();
  try {
    console.log('Running collaborative features migrations...');

    // Form Permissions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS form_permissions (
        id SERIAL PRIMARY KEY,
        form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved'
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(form_id, user_id)
      );
    `);
    console.log('  ✓ form_permissions table');

    // Add updated_at and updated_by to submissions
    await client.query(`
      ALTER TABLE submissions 
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id);
    `);
    console.log('  ✓ submissions columns for tracking edits');

    // Create branches table for the "learning" feature
    await client.query(`
      CREATE TABLE IF NOT EXISTS branches (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE
      );
    `);
    console.log('  ✓ branches table');

    // Seed initial branches if table is empty
    const branchCount = await client.query('SELECT COUNT(*) FROM branches');
    if (parseInt(branchCount.rows[0].count) === 0) {
      const initialBranches = [
        'Chemical Engineering (CE)',
        'Aerospace/Aeronautical Engineering (AER)',
        'Computer Science Engineering (CSE)',
        'Electronics & Communication Engineering (ECE)',
        'Instrumentation Engineering (INE)',
        'Mechanical Engineering (MEE)',
        'Civil Engineering (CIE)',
        'Electrical Engineering (ELE)'
      ];
      for (const b of initialBranches) {
        await client.query('INSERT INTO branches (name) VALUES ($1) ON CONFLICT DO NOTHING', [b]);
      }
      console.log('  ✓ seeded initial branches');
    }

    console.log('\n✅ Collaborative migrations completed!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
};

migrateCollateral();
