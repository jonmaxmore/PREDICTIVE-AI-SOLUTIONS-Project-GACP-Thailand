/**
 * GACP Platform - Enhanced Error Handling System
 * Provides consistent error handling across the application
 */

/**
 * Base application error class
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = null, details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    this.timestamp = new Date().toISOString();

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error class
 */
class ValidationError extends AppError {
  constructor(message, field = null, value = null) {
    super(message, 400, 'VALIDATION_ERROR', { field, value });
    this.name = 'ValidationError';
  }
}

/**
 * Authentication error class
 */
class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401, 'AUTH_ERROR');
    this.name = 'AuthenticationError';
  }
}

/**
 * Authorization error class
 */
class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
    this.name = 'AuthorizationError';
  }
}

/**
 * Not found error class
 */
class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

/**
 * Conflict error class
 */
class ConflictError extends AppError {
  constructor(message, resource = null) {
    super(message, 409, 'CONFLICT_ERROR');
    this.name = 'ConflictError';
    this.resource = resource;
  }
}

/**
 * Database error class
 */
class DatabaseError extends AppError {
  constructor(message, operation = null) {
    super(message, 500, 'DATABASE_ERROR', { operation });
    this.name = 'DatabaseError';
  }
}

/**
 * Business logic error class
 */
class BusinessLogicError extends AppError {
  constructor(message, rule = null) {
    super(message, 422, 'BUSINESS_LOGIC_ERROR', { rule });
    this.name = 'BusinessLogicError';
  }
}

/**
 * Error handler middleware
 */
function errorHandler(err, req, res) {
  // Default error properties
  const error = {
    success: false,
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method,
  };

  // Handle operational errors
  if (err.isOperational) {
    error.error = {
      message: err.message,
      code: err.code,
      details: err.details,
    };

    return res.status(err.statusCode).json(error);
  }

  // Handle specific error types
  if (err.name === 'ValidationError') {
    error.error = {
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: err.errors,
    };
    return res.status(400).json(error);
  }

  if (err.name === 'MongoError' || err.name === 'MongooseError') {
    error.error = {
      message: 'Database operation failed',
      code: 'DATABASE_ERROR',
    };
    return res.status(500).json(error);
  }

  if (err.name === 'JsonWebTokenError') {
    error.error = {
      message: 'Invalid token',
      code: 'INVALID_TOKEN',
    };
    return res.status(401).json(error);
  }

  if (err.name === 'TokenExpiredError') {
    error.error = {
      message: 'Token expired',
      code: 'TOKEN_EXPIRED',
    };
    return res.status(401).json(error);
  }

  // Handle unexpected errors
  error.error = {
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    code: 'INTERNAL_ERROR',
  };

  // Log unexpected errors with proper logger
  const { logger } = require('./logger');
  const errorLogger = logger.createLogger('error-handler');

  errorLogger.error('Unexpected error occurred', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.user?.id,
    timestamp: error.timestamp,
  });

  return res.status(500).json(error);
}

/**
 * Not found handler middleware
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: {
      message: `Route ${req.originalUrl} not found`,
      code: 'ROUTE_NOT_FOUND',
    },
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method,
  });
}

/**
 * Async error wrapper
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Create error response helper
 */
function createErrorResponse(message, code = null, details = null) {
  return {
    success: false,
    error: {
      message,
      code,
      details,
    },
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  // Error classes
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  DatabaseError,
  BusinessLogicError,

  // Middleware
  errorHandler,
  notFoundHandler,
  asyncHandler,

  // Utilities
  createErrorResponse,
};

