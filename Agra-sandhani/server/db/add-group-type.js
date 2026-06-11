const pool = require('./pool');

const addGroupType = async () => {
  const client = await pool.connect();
  try {
    console.log('🔄 Adding Organizational Groups support...');

    // 1. Create organizational_groups table
    await client.query(`
      CREATE TABLE IF NOT EXISTS organizational_groups (
        id SERIAL PRIMARY KEY,
        zone TEXT NOT NULL,
        group_name TEXT NOT NULL,
        is_custom BOOLEAN DEFAULT false,
        UNIQUE(zone, group_name)
      );
    `);
    console.log('  ✓ organizational_groups table');

    // 2. Seed initial data
    const initialData = [
        { zone: 'Zone I', name: 'HRDD — Human Resource Development Division' },
        { zone: 'Zone I', name: 'BEHI — Ballistic Evaluation & Hypervelocity Impact' },
        { zone: 'Zone I', name: 'C4I — Computer Cyber Security & Infrastructure' },
        { zone: 'Zone I', name: 'PC — Prototype Centre' },
        { zone: 'Zone I', name: 'MMG — Material Management Group' },
        { zone: 'Zone I', name: 'SEED — Safety & Environmental Engineering Division' },
        { zone: 'Zone I', name: 'AFTD — Advanced Fused Technology Division' },
        { zone: 'Zone II', name: 'Stratox' },
        { zone: 'Zone III', name: 'BIDS — Blast Instrumentation & Damage Studies' },
        { zone: 'Zone IV', name: 'WHD — Warhead Design' },
        { zone: 'Zone V', name: 'S4D — Shock & Detonics' },
        { zone: 'Zone VI', name: 'DPB — Task – DPB' },
        { zone: 'Zone VII', name: 'RTRS — Rail Track Rocket Sled' },
        { zone: 'Zone VII', name: 'PPG — Pulse Power Group' },
        { zone: 'Zone VII', name: 'TLIC — Technologies for Low Intensity Conflict' }
    ];

    for (const item of initialData) {
        await client.query(
            'INSERT INTO organizational_groups (zone, group_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [item.zone, item.name]
        );
    }
    console.log('  ✓ initial data seeded');

    console.log('\n✅ Organizational Groups migration completed!');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
};

addGroupType();
