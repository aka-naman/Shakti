require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.example') });
try {
    require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });
} catch (_) { }

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const logger = require('./services/logger');
const rateLimit = require('express-rate-limit');

// 🛡️ SECURITY: Global Rate Limiter (Prevent DoS)
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
});

// 🛡️ SECURITY: Auth Limiter (Prevent Brute Force)
const authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20, // 20 attempts per hour
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please try again in an hour.' }
});

const authRoutes = require('./routes/auth');
const formRoutes = require('./routes/forms');
const fieldRoutes = require('./routes/fields');
const submissionRoutes = require('./routes/submissions');
const exportRoutes = require('./routes/export');
const autocompleteRoutes = require('./routes/autocomplete');
const adminUserRoutes = require('./routes/admin-users');
const permissionRoutes = require('./routes/permissions');
const notificationRoutes = require('./routes/notifications');
const adminAnalyticsRoutes = require('./routes/admin-analytics');
const explorerRoutes = require('./routes/explorer');
const serviceRoutes = require('./routes/service-integration');

const app = express();

// API Routes
app.use('/api', globalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

const PORT = parseInt(process.env.PORT, 10) || 5000;

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());

// 🕒 Custom Morgan format: Excludes Morgan's hardcoded UTC timestamp
// Winston handles the local-time timestamping automatically.
const morganFormat = ':remote-addr - :remote-user ":method :url HTTP/:http-version" :status :res[content-length] - :response-time ms ":referrer" ":user-agent"';
app.use(morgan(morganFormat, { stream: logger.stream }));

app.use(express.json({ limit: '10mb' }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/forms', formRoutes); // Contains /:id/duplicate, /:id
app.use('/api/forms', submissionRoutes); // Contains /:formId/submissions
app.use('/api/forms', fieldRoutes);
app.use('/api/admin/users', adminUserRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/autocomplete', autocompleteRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin-analytics', adminAnalyticsRoutes);
app.use('/api/explorer', explorerRoutes);
app.use('/api/service', serviceRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static uploads
const uploadsPath = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(uploadsPath));

// Serve static frontend in production
const clientBuildPath = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientBuildPath));
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(clientBuildPath, 'index.html'));
    }
});

// Global error handler
app.use((err, req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    logger.error(`Unhandled Error: ${err.message}`, {
        ip,
        method: req.method,
        url: req.url,
        stack: err.stack,
        body: req.body
    });
    res.status(500).json({ error: 'Internal server error' });
});

const os = require('os');
const getLocalIP = () => {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '0.0.0.0';
};

app.listen(PORT, '0.0.0.0', () => {
    const localIP = getLocalIP();
    console.log(`\n🚀 अग्र-Sandhani API running at:`);
    console.log(`   Local:   http://localhost:${PORT}`);
    console.log(`   Network: http://${localIP}:${PORT}`);

    // Periodic background tasks (every 24 hours)
    setInterval(async () => {
        try {
            console.log('[CRON] Running automatic trash purge...');
            const pool = require('./db/pool');
            const interval = '30 days';
            
            const subResult = await pool.query('DELETE FROM submissions WHERE deleted_at < NOW() - INTERVAL \'30 days\'');
            const formResult = await pool.query('DELETE FROM forms WHERE deleted_at < NOW() - INTERVAL \'30 days\'');
            
            if (subResult.rowCount > 0 || formResult.rowCount > 0) {
                console.log(`[CRON] Purged ${subResult.rowCount} submissions and ${formResult.rowCount} forms older than 30 days`);
            }
        } catch (err) {
            console.error('[CRON] Trash purge failed:', err);
        }
    }, 24 * 60 * 60 * 1000);
});

module.exports = app;
