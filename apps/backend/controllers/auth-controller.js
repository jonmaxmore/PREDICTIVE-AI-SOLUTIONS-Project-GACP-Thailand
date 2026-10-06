const AuthService = require('../services/prisma-auth-service');
const { auditLogger } = require('../middleware/audit-logger');
const jwtConfig = require('../config/jwt-security');
const logger = require('../shared/logger');
const { sendErrorResponse, sendSuccessResponse } = require('../shared/api-response');
const fs = require('fs');
const crypto = require('crypto');
const { getRequestIp } = require('../utils/client-ip');
const { isSecureCookie } = require('../utils/cookie-security');
const { maskThaiId } = require('../utils/field-encryption');
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

// What a health client gets of its own account: the fields the web and mobile read,
// nothing else. National-ID-class values go out masked (as the provider doors mask
// providerId); the laser code, tax/registration numbers, lookup hashes, the canonical
// id and account-lock or retention state stay on the server. The PDPA data export
// (/me/export) is the door for the full record.
const CLIENT_USER_FIELDS = Object.freeze([
    'id', 'uuid', 'email', 'firstName', 'lastName', 'phoneNumber', 'role', 'accountType',
    'authType', 'status', 'accountTier', 'ministryVerified', 'ministryVerifiedAt',
    'address', 'province', 'district', 'subdistrict', 'zipCode',
    'companyName', 'representativeName', 'representativePosition', 'communityName',
    'isEmailVerified', 'twoFactorEnabled', 'twoFactorMethod', 'privacySettings', 'notificationSettings',
    'createdAt', 'lastLoginAt',
]);
const MASKED_USER_FIELDS = Object.freeze(['healthId', 'idCard']);

function sanitizeUserPayload(user) {
    if (!user || typeof user !== 'object') {
        return user;
    }
    const safeUser = {};
    for (const field of CLIENT_USER_FIELDS) {
        if (user[field] !== undefined) { safeUser[field] = user[field]; }
    }
    for (const field of MASKED_USER_FIELDS) {
        if (user[field] !== undefined) { safeUser[field] = maskThaiId(user[field]); }
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
