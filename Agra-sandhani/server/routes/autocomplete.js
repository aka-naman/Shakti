const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const fs = require('fs');
const path = require('path');

// Cache for locations data
let locationsData = null;

const getLocations = () => {
    if (locationsData) return locationsData;
    try {
        const filePath = path.join(__dirname, '..', 'data', 'india_states_districts.json');
        if (fs.existsSync(filePath)) {
            locationsData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return locationsData;
        }
    } catch (err) {
        console.error('Error loading locations data:', err);
    }
    return {};
};

// GET /api/autocomplete/locations
router.get('/locations', authenticate, async (req, res) => {
    try {
        // Deep copy static data
        const data = JSON.parse(JSON.stringify(getLocations()));
        
        // Fetch all learned locations from the universities table
        const customResult = await pool.query('SELECT DISTINCT state, district FROM universities WHERE state IS NOT NULL AND district IS NOT NULL');
        
        for (const row of customResult.rows) {
            const state = row.state.trim();
            const district = row.district.trim();
            
            if (!state || !district || state === '__other__' || district === '__other__') continue;
            
            if (!data[state]) {
                data[state] = [];
            }
            if (!data[state].includes(district)) {
                data[state].push(district);
            }
        }
        
        // Sort districts alphabetically
        for (const state in data) {
            data[state].sort();
        }

        // Return ordered state keys
        const sortedData = {};
        Object.keys(data).sort().forEach(key => {
            sortedData[key] = data[key];
        });

        res.json(sortedData);
    } catch (err) {
        console.error('Locations error:', err);
        res.status(500).json({ error: 'Failed to load locations' });
    }
});

// GET /api/autocomplete/university?q=
router.get('/university', authenticate, async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (q.length < 2) {
            return res.json({ results: [] });
        }

        // Advanced Search:
        // 1. Regular name search (ILIKE)
        // 2. Acronym search (if exists)
        // 3. Dot-agnostic search (e.g., "PEC" matches "P.E.C." or "P E C")
        
        // Transform "PEC" to "P.*E.*C" for fuzzy regex matching
        const fuzzyPattern = q.split('').filter(c => /[a-zA-Z0-9]/.test(c)).join('.*');

        const result = await pool.query(
            `SELECT name, state, district, is_custom, acronym
             FROM universities
             WHERE name ILIKE $1 
                OR acronym ILIKE $1 
                OR name ~* $2
                OR acronym ~* $2
             ORDER BY 
                (CASE 
                    WHEN name ILIKE $1 THEN 0 
                    WHEN acronym ILIKE $1 THEN 1
                    ELSE 2 
                 END),
                similarity(name, $3) DESC
             LIMIT 15`,
            [`%${q}%`, fuzzyPattern, q]
        );

        res.json({ results: result.rows });
    } catch (err) {
        console.error('Autocomplete error:', err);
        // Fallback to simple ILIKE if regex or similarity fails
        try {
           const fallback = await pool.query(
               'SELECT name, state, district FROM universities WHERE name ILIKE $1 LIMIT 10',
               [`%${q}%`]
           );
           return res.json({ results: fallback.rows });
        } catch (e) {
            res.status(500).json({ error: 'Autocomplete search failed' });
        }
    }
});

// POST /api/autocomplete/university/add
router.post('/university/add', authenticate, async (req, res) => {
    const { name, state, district } = req.body;
    if (!name || !state || !district) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Calculate acronym automatically (e.g., Punjab Engineering College -> PEC)
        const acronym = name.split(/\s+/).filter(w => w.length > 0).map(word => word[0]).join('').toUpperCase();
        
        // 1. Check if it already exists (to avoid index issues)
        const check = await pool.query('SELECT * FROM universities WHERE name = $1 LIMIT 1', [name]);
        if (check.rows.length > 0) {
            return res.json({ message: 'University already exists', university: check.rows[0] });
        }

        // 2. Insert new record
        const result = await pool.query(
            `INSERT INTO universities (name, state, district, is_custom, acronym)
             VALUES ($1, $2, $3, true, $4)
             RETURNING *`,
            [name, state, district, acronym]
        );
        res.json({ message: 'University added successfully', university: result.rows[0] });
    } catch (err) {
        console.error('Add university error:', err);
        res.status(500).json({ error: 'Failed to add university' });
    }
});

// GET /api/autocomplete/branches
router.get('/branches', authenticate, async (req, res) => {
    try {
        const result = await pool.query('SELECT name FROM branches ORDER BY name ASC');
        res.json({ results: result.rows.map(r => r.name) });
    } catch (err) {
        console.error('Branches fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch branches' });
    }
});

// GET /api/autocomplete/groups — Grouped by Zone
router.get('/groups', authenticate, async (req, res) => {
    try {
        const result = await pool.query('SELECT zone, group_name FROM organizational_groups ORDER BY zone ASC, group_name ASC');
        const data = {};
        
        result.rows.forEach(row => {
            if (!data[row.zone]) data[row.zone] = [];
            data[row.zone].push(row.group_name);
        });

        res.json(data);
    } catch (err) {
        console.error('Groups fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch groups' });
    }
});

// GET /api/autocomplete/banks
router.get('/banks', authenticate, async (req, res) => {
    try {
        const result = await pool.query('SELECT name FROM banks ORDER BY name ASC');
        res.json({ results: result.rows.map(r => r.name) });
    } catch (err) {
        console.error('Banks fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch banks' });
    }
});

// POST /api/autocomplete/banks/add
router.post('/banks/add', authenticate, async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Bank name is required' });
    try {
        await pool.query('INSERT INTO banks (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name.trim()]);
        res.json({ message: 'Bank added successfully', bank: name.trim() });
    } catch (err) {
        console.error('Add bank error:', err);
        res.status(500).json({ error: 'Failed to add bank' });
    }
});

module.exports = router;

