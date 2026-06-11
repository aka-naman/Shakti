//  1. Deletes Every User: It clears the users table completely.
//    2. Resets IDs: It resets the auto-increment counter, so your first new user will have ID 1.
//    3. Restores Admin Privilege: Because the register route is designed to make the first registered user an admin, the
//       very next person who signs up through your website will automatically get admin rights.


const pool = require('./pool');

const resetUsers = async () => {
    const client = await pool.connect();
    try {
        console.log('--- Database Reset: Users ---');
        
        // 1. Check if users exist
        const countRes = await client.query('SELECT COUNT(*) FROM users');
        const count = parseInt(countRes.rows[0].count);
        
        if (count === 0) {
            console.log('No users found. Database is already fresh.');
            return;
        }

        console.log(`Found ${count} users. Deleting...`);

        // 2. Delete all users
        // Note: If you have foreign keys that don't ON DELETE CASCADE, 
        // you might need to handle those tables first. 
        // Based on migrate.js, only 'submissions' and 'form_versions' exist 
        // but they don't seem to link to 'users' directly in the current schema.
        await client.query('TRUNCATE TABLE users RESTART IDENTITY CASCADE');
        
        console.log('✅ All users have been deleted.');
        console.log('✅ User IDs (Auto-increment) have been reset.');
        console.log('\nNext Step:');
        console.log('Go to the registration page in your browser. The first user you create will automatically become the ADMIN.');

    } catch (err) {
        console.error('❌ Reset failed:', err);
    } finally {
        client.release();
        await pool.end();
    }
};

resetUsers();
