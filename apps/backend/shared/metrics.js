/**
 * Metrics and Monitoring System
 *
 * Provides application-level metrics, telemetry, and health checks
 * for observability and performance monitoring.
 */
const os = require('os');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');
const metricsLogger = logger.createLogger('metrics');

// In-memory metrics store (in production, would use a proper time-series DB)
let metrics = {
  startTime: new Date(),
  requests: {
    total: 0,
    byEndpoint: {},
    byStatusCode: {},
    byMethod: {},
  },
  responseTimes: {
    byEndpoint: {},
  },
  errors: {
    count: 0,
    byType: {},
  },
  system: {
    lastCheck: null,
    cpuUsage: [],
    memoryUsage: [],
    activeConnections: 0,
  },
  socketIO: {
    connections: 0,
    messagesSent: 0,
    messagesReceived: 0,
  },
  database: {
    operations: 0,
    errors: 0,
    slowQueries: 0,
  },
};

// Initialize request tracking middleware
function initRequestTracking(app) {
  app.use((req, res, next) => {
    // Generate request ID if not present
    req.id = req.headers['x-request-id'] || uuidv4();
    res.setHeader('X-Request-ID', req.id);

    // Track request
    metrics.requests.total++;
    next();
  });

  // Start periodic system metrics collection
  collectSystemMetrics();
}

// Record response time by endpoint
function recordResponseTime(path, method, statusCode, duration) {
  // Normalize path to handle dynamic routes
  const normalizedPath = normalizePath(path);

  // Track by endpoint
  if (!metrics.responseTimes.byEndpoint[normalizedPath]) {
    metrics.responseTimes.byEndpoint[normalizedPath] = {
      count: 0,
      totalTime: 0,
      average: 0,
      min: Number.MAX_SAFE_INTEGER,
      max: 0,
    };
  }

  const stats = metrics.responseTimes.byEndpoint[normalizedPath];
  stats.count++;
  stats.totalTime += duration;
  stats.average = stats.totalTime / stats.count;
  stats.min = Math.min(stats.min, duration);
  stats.max = Math.max(stats.max, duration);

  // Track by status code
  const statusCodeCategory = `${Math.floor(statusCode / 100)}xx`;
  metrics.requests.byStatusCode[statusCodeCategory] =
    (metrics.requests.byStatusCode[statusCodeCategory] || 0) + 1;

  // Track by method
  metrics.requests.byMethod[method] = (metrics.requests.byMethod[method] || 0) + 1;

  // Track by endpoint
  if (!metrics.requests.byEndpoint[normalizedPath]) {
    metrics.requests.byEndpoint[normalizedPath] = 0;
  }
  metrics.requests.byEndpoint[normalizedPath]++;
}

// Record error
function recordError(type, error) {
  metrics.errors.count++;

  if (!metrics.errors.byType[type]) {
    metrics.errors.byType[type] = 0;
  }
  metrics.errors.byType[type]++;

  // Log error for analysis
  metricsLogger.error(`Error - ${type}: ${error.message}`, {
    type,
    stack: error.stack,
    code: error.code,
  });
}

// Record server start
function recordServerStart(healthy = true) {
  metrics.startTime = new Date();
  metricsLogger.info(`Server started - Status: ${healthy ? 'healthy' : 'degraded'}`);
}

// Record socket.io event
function recordSocketEvent(eventType, _data = {}) {
  switch (eventType) {
    case 'connection':
      metrics.socketIO.connections++;
      break;
    case 'disconnect':
      metrics.socketIO.connections = Math.max(0, metrics.socketIO.connections - 1);
      break;
    case 'message_sent':
      metrics.socketIO.messagesSent++;
      break;
    case 'message_received':
      metrics.socketIO.messagesReceived++;
      break;
  }
}

// Record database operation
function recordDatabaseOperation(type, duration) {
  metrics.database.operations++;

  if (duration > 100) {
    // threshold for slow query in ms
    metrics.database.slowQueries++;
    metricsLogger.warn(`Slow database operation: ${type} - ${duration}ms`);
  }
}

// Record database error
function recordDatabaseError(operation, error) {
  metrics.database.errors++;
  metricsLogger.error(`Database error during ${operation}: ${error.message}`, {
    operation,
    errorCode: error.code,
    stack: error.stack,
  });
}

// Get current metrics
function getMetrics() {
  const now = new Date();
  const uptime = now - metrics.startTime;

  return {
    uptime: uptime,
    uptimeFormatted: formatUptime(uptime),
    startTime: metrics.startTime,
    requests: metrics.requests,
    errors: metrics.errors,
    responseTimes: metrics.responseTimes,
    system: metrics.system,
    socketIO: metrics.socketIO,
    database: metrics.database,
    timestamp: now,
  };
}

// Get system health status
async function getSystemHealth() {
  try {
    const cpuUsage = process.cpuUsage();
    const memUsage = process.memoryUsage();
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    const memUsagePercent = ((totalMem - freeMem) / totalMem) * 100;

    // Calculate CPU usage percentage
    const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds

    // Store in metrics
    metrics.system.lastCheck = new Date();
    metrics.system.cpuUsage.push({
      timestamp: new Date(),
      value: cpuPercent,
    });

    // Keep only the last 60 readings
    if (metrics.system.cpuUsage.length > 60) {
      metrics.system.cpuUsage.shift();
    }

    metrics.system.memoryUsage.push({
      timestamp: new Date(),
      value: memUsagePercent,
    });

    if (metrics.system.memoryUsage.length > 60) {
      metrics.system.memoryUsage.shift();
    }

    // Check if system is healthy
    const isHealthy = memUsagePercent < 90; // Memory usage below 90%

    return {
      status: isHealthy ? 'healthy' : 'warning',
      cpu: {
        usage: cpuPercent,
        cores: os.cpus().length,
      },
      memory: {
        usage: memUsagePercent,
        usedBytes: totalMem - freeMem,
        totalBytes: totalMem,
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
      },
      os: {
        platform: os.platform(),
        release: os.release(),
        hostname: os.hostname(),
        uptime: os.uptime(),
      },
      process: {
        pid: process.pid,
        uptime: process.uptime(),
        version: process.version,
      },
    };
  } catch (error) {
    metricsLogger.error('Failed to check system health:', error);
    return {
      status: 'error',
      error: error.message,
    };
  }
}

// Check storage health
async function checkStorageHealth() {
  const probes = [process.cwd(), os.tmpdir()];
  let writableTargets = 0;

  for (const target of probes) {
    try {
      await fs.promises.access(target, fs.constants.R_OK | fs.constants.W_OK);
      writableTargets += 1;
    } catch (error) {
      metricsLogger.warn('Storage health probe failed', { target, error: error.message });
    }
  }

  return writableTargets === probes.length ? 'operational' : 'degraded';
}

// Normalize paths to group similar routes
function normalizePath(path) {
  // Replace numeric IDs with placeholders to group similar routes
  // E.g. /api/users/123 becomes /api/users/:id
  return path.replace(/\/\d+/g, '/:id');
}

// Format uptime into human-readable string
function formatUptime(uptime) {
  const seconds = Math.floor(uptime / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
}

// Metrics collection interval reference
let metricsInterval = null;

// Start periodic system metrics collection
function startMetricsCollection() {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  if (!metricsInterval) {
    metricsInterval = setInterval(async () => {
      await getSystemHealth();
    }, 60000); // Every minute
  }
}

// Stop metrics collection
function stopMetricsCollection() {
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
  }
}

// Legacy function for backwards compatibility
function collectSystemMetrics() {
  startMetricsCollection();
}

// Reset metrics (e.g., after reporting to external system)
function resetMetrics() {
  const startTime = metrics.startTime;
  metrics = {
    startTime,
    requests: {
      total: 0,
      byEndpoint: {},
      byStatusCode: {},
      byMethod: {},
    },
    responseTimes: {
      byEndpoint: {},
    },
    errors: {
      count: 0,
      byType: {},
    },
    system: {
      lastCheck: null,
      cpuUsage: [],
      memoryUsage: [],
      activeConnections: 0,
    },
    socketIO: {
      connections: 0,
      messagesSent: 0,
      messagesReceived: 0,
    },
    database: {
      operations: 0,
      errors: 0,
      slowQueries: 0,
    },
  };
}

module.exports = {
  initRequestTracking,
  recordResponseTime,
  recordError,
  recordServerStart,
  recordSocketEvent,
  recordDatabaseOperation,
  recordDatabaseError,
  getMetrics,
  getSystemHealth,
  checkStorageHealth,
  resetMetrics,
  startMetricsCollection,
  stopMetricsCollection,
};


