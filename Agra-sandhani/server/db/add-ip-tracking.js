const pool = require('./pool');

const addIPTracking = async () => {
  const client = await pool.connect();
  try {
    console.log('🔄 Adding IP Tracking columns to users...');

    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS registration_ip TEXT,
      ADD COLUMN IF NOT EXISTS last_login_ip TEXT;
    `);

    console.log('  ✓ registration_ip and last_login_ip columns added');

    console.log('\n✅ IP tracking migration completed!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
  } finally {
    client.release();
    process.exit();
  }
};

addIPTracking();
