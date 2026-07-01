const pool = require('./pool');

const backfillLoginTimestamps = async () => {
  try {
    console.log('🔄 Backfilling missing login timestamps for active users...');
    
    // Set last_login = last_activity for anyone whose last_login is NULL but has interacted with system
    const res = await pool.query(`
      UPDATE users 
      SET last_login = last_activity 
      WHERE last_login IS NULL 
        AND last_activity > '1970-01-01T00:00:00.000Z'
    `);
    
    console.log(`  ✓ Updated ${res.rowCount} users`);
    console.log('\n✅ Backfill completed!');
  } catch (err) {
    console.error('❌ Backfill failed:', err);
  } finally {
    process.exit();
  }
};

backfillLoginTimestamps();
