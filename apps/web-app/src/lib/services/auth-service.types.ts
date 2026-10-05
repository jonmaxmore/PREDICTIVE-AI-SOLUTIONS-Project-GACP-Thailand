export const STORAGE_KEYS = {
    ACCESS_TOKEN: 'accessToken',
    REFRESH_TOKEN: 'refreshToken',
    USER: 'user',
    REMEMBER_LOGIN: 'remember_login',
    LAST_ACTIVITY: 'lastActivity',
} as const;

export type AuthEventType = 'login' | 'logout' | 'token_refresh' | 'session_expired' | 'tab_sync';

export type AuthEventCallback = (event: AuthEventType, data?: unknown) => void;

export interface AuthUser {
    id: string;
    uuid?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    accountType?: string;
    userType?: string;
    role?: string;
    status?: string;
    verificationStatus?: string;
    verificationNote?: string;
    verificationSubmittedAt?: string;
    taxId?: string;
    laserCode?: string;
    idCard?: string;
    healthId?: string;
    providerId?: string;
    authType?: 'HEALTH_ID' | 'PROVIDER_ID' | 'EMAIL_LEGACY';
    accountTier?: 'NORMAL' | 'PRO';
    ministryVerified?: boolean;
    ministryVerifiedAt?: string;
    address?: string;
    province?: string;
    createdAt?: string;
    lastLogin?: string;
    identifier?: string;
    companyName?: string;
    phone?: string;
    phoneNumber?: string;
    applicantType?: string;
    [key: string]: unknown;
}

export interface JWTPayload {
    exp?: number;
    iat?: number;
    userId?: string;
    email?: string;
    role?: string;
    [key: string]: unknown;
}

export interface SessionData {
    token?: string;
    accessToken?: string;
    refreshToken?: string;
    user?: AuthUser;
    tokens?: {
        accessToken?: string;
        refreshToken?: string;
    };
}

export interface AuthConfig {
    sessionTimeoutMinutes: number;
    tokenRefreshBufferMinutes: number;
    enableCrossTabSync: boolean;
    enableSessionTimeout: boolean;
    onAuthEvent?: AuthEventCallback;
}

export const DEFAULT_CONFIG: AuthConfig = {
    sessionTimeoutMinutes: 30,
    tokenRefreshBufferMinutes: 5,
    enableCrossTabSync: true,
    enableSessionTimeout: true,
};
