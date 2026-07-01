const pool = require('./pool');

const fixTimezones = async () => {
  const client = await pool.connect();
  try {
    console.log('🔄 Converting user timestamps to TIMESTAMPTZ for consistency...');

    await client.query(`
      ALTER TABLE users 
      ALTER COLUMN last_activity TYPE TIMESTAMPTZ,
      ALTER COLUMN created_at TYPE TIMESTAMPTZ;
    `);

    console.log('  ✓ users table updated to TIMESTAMPTZ');

    // Also update submissions for consistency if they exist
    await client.query(`
      ALTER TABLE submissions 
      ALTER COLUMN submitted_at TYPE TIMESTAMPTZ,
      ALTER COLUMN updated_at TYPE TIMESTAMPTZ;
    `);
    console.log('  ✓ submissions table updated to TIMESTAMPTZ');

    // Update Audit & System Logs
    await client.query(`
      ALTER TABLE system_logs 
      ALTER COLUMN timestamp TYPE TIMESTAMPTZ;
    `);
    console.log('  ✓ system_logs table updated to TIMESTAMPTZ');

    await client.query(`
      ALTER TABLE permission_logs 
      ALTER COLUMN timestamp TYPE TIMESTAMPTZ;
    `);
    console.log('  ✓ permission_logs table updated to TIMESTAMPTZ');

    console.log('\n✅ Timezone fix completed!');
  } catch (err) {
    console.error('❌ Timezone fix failed:', err);
  } finally {
    client.release();
    process.exit();
  }
};

fixTimezones();
