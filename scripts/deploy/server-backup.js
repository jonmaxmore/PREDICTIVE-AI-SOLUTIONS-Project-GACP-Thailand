/**
 * GACP Platform - Production Server
 * Entry point for the backend application
 * Database: PostgreSQL (Prisma)
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const logger = require('./shared/logger');
const prismaDatabase = require('./services/prisma-database'); // PostgreSQL
const redisService = require('./services/redis-service');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');

// Import Modules
const AuthHealthRoutes = require('./routes/api/auth-health-routes');
const AuthProviderRoutes = require('./routes/api/auth-provider');
const v2Routes = require('./routes/v2');
const EstablishmentRoutes = require('./modules/Establishment');
const ApplicationRoutes = require('./routes/api/application-routes');
const InvoiceRoutes = require('./routes/api/invoice-routes');
const ProviderRoutes = require('./routes/api/provider-routes');
const AuditRoutes = require('./routes/api/audit-routes');

const app = express();
const port = process.env.PORT || 3000; // Backend API port

const path = require('path');

// CORS Configuration - Environment Based
const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, PowerShell, etc.)
        if (!origin) return callback(null, true);

        // Always allow production server origin
        const productionOrigins = [
            'https://gacpth.com',
            'http://localhost:3001',
            'http://localhost:3000',
        ];

        if (productionOrigins.includes(origin)) {
            return callback(null, true);
        }

        // In development, allow all origins
        if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
            return callback(null, true);
        }

        // In production, also check environment-configured origins
        const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        logger.warn(`[CORS] Blocked request from: ${origin}`);
        return callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

// Trust proxy for AWS/Cloud deployment (required for HTTPS behind load balancer)
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

// Security & Performance Middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
    hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
}));
app.use(cors(corsOptions));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// CDN/Cache Middleware (temporarily disabled)
// const { staticCacheMiddleware } = require('./middleware/CacheControlMiddleware');

// Serve Static Files (Uploads)
app.use('/uploads',
    express.static(path.join(__dirname, 'uploads'), {
        maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
        etag: true,
        lastModified: true,
    })
);

// Body Parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// NOTE: Database and Redis connection moved to after app.listen() for graceful degradation

// Mount Routes
app.use('/api/auth/health', AuthHealthRoutes);
app.use('/api/auth/provider', AuthProviderRoutes); // Provider authentication
app.use('/api/v2', v2Routes);
app.use('/api/establishments', EstablishmentRoutes);
app.use('/api/v2/establishments', EstablishmentRoutes);
app.use('/api/applications', ApplicationRoutes);  // Application workflow routes
app.use('/api/v2/invoices', InvoiceRoutes);        // Invoice/accounting routes
app.use('/api/v2/provider', ProviderRoutes);          // Provider management routes
app.use('/api/v2/audits', AuditRoutes);            // Audit scheduling routes
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Health Check - Both /health and /api/health for compatibility
app.get(['/health', '/api/health'], async (req, res) => {
    try {
        const dbHealth = await prismaDatabase.healthCheck();
        res.json({
            status: 'OK',
            timestamp: new Date(),
            environment: process.env.NODE_ENV,
            database: dbHealth,
            redis: {
                connected: redisService.isAvailable(),
            }
        });
    } catch (error) {
        res.status(503).json({
            status: 'ERROR',
            timestamp: new Date(),
            error: error.message
        });
    }
});

// Global Error Handler
app.use((err, req, res, next) => {
    logger.error(err.stack);
    res.status(500).json({
        success: false,
        message: 'Internal Server Error',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Start Server
if (require.main === module) {
    app.listen(port, '0.0.0.0', () => {
        logger.info(`GACP Backend running on port ${port}`);
        logger.info(`Server accepting requests...`);

        // Connect to database AFTER server is already listening
        if (process.env.NODE_ENV !== 'test') {
            setImmediate(async () => {
                // Connect to PostgreSQL (Prisma)
                prismaDatabase.connect()
                    .then(() => logger.info('PostgreSQL connected'))
                    .catch(err => {
                        logger.error('PostgreSQL error:', err.message);
                    });

                // Connect to Redis (Cache)
                redisService.connect().catch(err => {
                    logger.warn('Redis unavailable - running without cache:', err.message);
                });
            });
        }
    });
}

module.exports = app;

