// Using Prisma (PostgreSQL) instead of MongoDB
const AuthService = require('../services/prisma-auth-service');
const { auditLogger } = require('../middleware/audit-logger');
const jwtConfig = require('../config/jwt-security');
const logger = require('../shared/logger');
const { sendErrorResponse, sendSuccessResponse } = require('../shared/api-response');
const fs = require('fs');
const crypto = require('crypto');
const { getRequestIp } = require('../utils/client-ip');
const { isSecureCookie } = require('../utils/cookie-security');
const { consentManager, RequiredConsents } = require('../middleware/consent-manager');
const { createHealthAuthProfileHandlers } = require('./auth-controller/health-auth-profile-handlers');
const { createAuthSessionSecurityHandlers } = require('./auth-controller/auth-session-security-handlers');

// Shared Helpers

function setCsrfCookie(res, isSecure) {
    const csrfToken = crypto.randomBytes(32).toString('hex');
    res.cookie('csrf_token', csrfToken, {
        httpOnly: false,
        secure: isSecure,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        path: '/',
    });
    return csrfToken;
}

function resolveIsSecure() {
    // L-2 (audit 2026-06-11): production always uses Secure cookies; see
    // utils/cookie-security.js for the rationale + single source of truth.
    return isSecureCookie();
}

/**
 * Set auth & refresh cookies + CSRF cookie.
 * Centralised so login and refreshToken behave identically.
 */
function setAuthCookies(res, token, refreshToken) {
    const isSecure = resolveIsSecure();

    res.cookie('auth_token', token, {
        httpOnly: true,
        secure: isSecure,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
        path: '/',
    });

    if (refreshToken) {
        res.cookie('refresh_token', refreshToken, {
            httpOnly: true,
            secure: isSecure,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: '/',
        });
    }

    return setCsrfCookie(res, isSecure);
}

function sanitizeUserPayload(user) {
    if (!user || typeof user !== 'object') {
        return user;
    }

    const safeUser = { ...user };
    const sensitiveFields = [
        'password',
        'idCardHash',
        'healthIdHash',
        'providerIdHash',
        'taxIdHash',
        'communityRegistrationNoHash',
        'emailVerificationToken',
        'passwordResetToken',
        'twoFactorSecret',
        'twoFactorBackupCodes',
    ];

    for (const field of sensitiveFields) {
        if (Object.prototype.hasOwnProperty.call(safeUser, field)) {
            delete safeUser[field];
        }
    }

    return safeUser;
}

class AuthController {}

Object.assign(
    AuthController.prototype,
    createHealthAuthProfileHandlers({
        AuthService,
        auditLogger,
        logger,
        fs,
        getRequestIp,
        sendErrorResponse,
        sendSuccessResponse,
        setAuthCookies,
        sanitizeUserPayload,
        consentManager,
        requiredConsents: RequiredConsents,
    }),
    createAuthSessionSecurityHandlers({
        AuthService,
        auditLogger,
        jwtConfig,
        logger,
        getRequestIp,
        sendErrorResponse,
        sendSuccessResponse,
        setAuthCookies,
    }),
);

module.exports = new AuthController();
