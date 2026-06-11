const pool = require('./pool');

const addUserIsolation = async () => {
  const client = await pool.connect();
  try {
    console.log('\n🔄 Adding user isolation to forms...\n');

    // Step 1: Add user_id column if not exists
    console.log('1️⃣  Checking for user_id column...');
    const checkColumn = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='forms' AND column_name='user_id'
    `);

    if (checkColumn.rows.length === 0) {
      await client.query(`
        ALTER TABLE forms 
        ADD COLUMN user_id INTEGER;
      `);
      console.log('   ✓ Added user_id column');
    } else {
      console.log('   ✓ user_id column already exists');
    }

    // Step 2: Check existing forms and assign them to first user (admin)
    console.log('2️⃣  Assigning existing forms to first admin user...');
    const nullCheck = await client.query('SELECT COUNT(*) as count FROM forms WHERE user_id IS NULL');
    if (parseInt(nullCheck.rows[0].count) > 0) {
      const adminUser = await client.query('SELECT id FROM users WHERE role = $1 ORDER BY id LIMIT 1', ['admin']);
      if (adminUser.rows.length > 0) {
        await client.query('UPDATE forms SET user_id = $1 WHERE user_id IS NULL', [adminUser.rows[0].id]);
        console.log(`   ✓ Assigned ${nullCheck.rows[0].count} forms to admin user`);
      } else {
        console.warn('   ⚠️  No admin user found. Please create an admin user first.');
        throw new Error('No admin user found. Create a user first.');
      }
    } else {
      console.log('   ✓ No forms with NULL user_id');
    }

    // Step 3: Add NOT NULL constraint
    console.log('3️⃣  Adding NOT NULL constraint...');
    try {
      await client.query(`
        ALTER TABLE forms 
        ALTER COLUMN user_id SET NOT NULL;
      `);
      console.log('   ✓ user_id column is now NOT NULL');
    } catch (err) {
      if (err.code === '23502') {
        console.log('   ⚠️  Cannot add NOT NULL - some forms still have NULL user_id');
        throw err;
      }
      throw err;
    }

    // Step 4: Add foreign key constraint if not exists
    console.log('4️⃣  Adding foreign key constraint...');
    const checkFK = await client.query(`
      SELECT constraint_name 
      FROM information_schema.table_constraints 
      WHERE table_name='forms' AND constraint_name='fk_forms_user_id'
    `);

    if (checkFK.rows.length === 0) {
      await client.query(`
        ALTER TABLE forms 
        ADD CONSTRAINT fk_forms_user_id 
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
      `);
      console.log('   ✓ Added foreign key constraint');
    } else {
      console.log('   ✓ Foreign key constraint already exists');
    }

    // Step 5: Create index for performance
    console.log('5️⃣  Creating index on user_id...');
    const checkIndex = await client.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename='forms' AND indexname='idx_forms_user_id'
    `);

    if (checkIndex.rows.length === 0) {
      await client.query(`
        CREATE INDEX idx_forms_user_id
        ON forms(user_id);
      `);
      console.log('   ✓ Created index on user_id');
    } else {
      console.log('   ✓ Index already exists');
    }

    console.log('\n✅ User isolation setup completed successfully!\n');
    console.log('📝 Summary:');
    const stats = await client.query(`
      SELECT COUNT(*) as total_forms,
        COUNT(DISTINCT user_id) as unique_users
      FROM forms
    `);
    console.log(`   Total forms: ${stats.rows[0].total_forms}`);
    console.log(`   Forms by users: ${stats.rows[0].unique_users}\n`);

  } catch (err) {
    console.error('\n❌ Migration failed:\n', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

addUserIsolation();
