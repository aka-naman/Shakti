const pool = require('./pool');

const addLoginLogoutTracking = async () => {
  const client = await pool.connect();
  try {
    console.log('🔄 Adding Login/Logout tracking columns to users...');

    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_logout TIMESTAMPTZ;
    `);

    console.log('  ✓ last_login and last_logout columns added');

    console.log('\n✅ Tracking migration completed!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
  } finally {
    client.release();
    process.exit();
  }
};

addLoginLogoutTracking();
