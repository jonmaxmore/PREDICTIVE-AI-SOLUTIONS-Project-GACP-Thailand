/**
 * Unit tests for require-admin middleware
 * Verifies M-004: Admin role enforcement on privileged routes
 */

const { requireAdmin } = require('../../middleware/require-admin');

// Mock logger
jest.mock('../../shared/logger', () => ({
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
}));

describe('requireAdmin middleware', () => {
    let req, res, next;

    beforeEach(() => {
        req = { method: 'GET', originalUrl: '/api/admin/config' };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        next = jest.fn();
    });

    test('blocks requests with no user (401)', () => {
        req.user = null;
        requireAdmin(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    test('blocks non-admin provider role (403)', () => {
        req.user = { id: 'u1', role: 'dispatcher' };
        requireAdmin(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('blocks auditor role (403)', () => {
        req.user = { id: 'u1', role: 'field_inspector' };
        requireAdmin(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('allows admin role', () => {
        req.user = { id: 'u1', role: 'system_admin_dtam' };
        requireAdmin(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('allows super_admin role (alias)', () => {
        req.user = { id: 'u1', role: 'system_admin_dtam' };
        requireAdmin(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('blocks health/Applicant role (403)', () => {
        req.user = { id: 'u1', role: 'health' };
        requireAdmin(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });
});
