const pool = require('./pool');

const addNotifications = async () => {
  const client = await pool.connect();
  try {
    console.log('🚀 Creating Notifications Table...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Recipient
        actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL, -- Performer
        form_id INTEGER REFERENCES forms(id) ON DELETE CASCADE,
        type TEXT NOT NULL, -- 'access_request', 'request_approved', 'request_rejected', 'request_ignored'
        status TEXT DEFAULT 'unread', -- 'unread', 'read', 'cleared'
        created_at TIMESTAMP DEFAULT NOW(),
        message TEXT,
        permission_id INTEGER REFERENCES form_permissions(id) ON DELETE CASCADE
      );
    `);
    
    // Index for fast fetching of unread/uncleared notifications
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user_status 
      ON notifications(user_id, status);
    `);

    console.log('  ✓ notifications table created');
    console.log('\n✅ Database Upgrade Complete!');
  } catch (err) {
    console.error('Upgrade failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
};

addNotifications();
