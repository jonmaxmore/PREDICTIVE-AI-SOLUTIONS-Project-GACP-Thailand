/**
 * Error class hierarchy contract — shared/errors.js.
 *
 * The codebase throws AppError subclasses to communicate intent (status
 * code + machine-readable code + structured details) to the global
 * errorHandler middleware. Frontend api-client.ts maps `error.code`
 * to localized messages; a regression that drops a class field or
 * changes a code silently breaks the i18n surface.
 */

const {
    AppError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    ConflictError,
    DatabaseError,
    BusinessLogicError,
    asyncHandler,
    createErrorResponse,
} = require('../../shared/errors');

describe('errors module', () => {
    describe('AppError (base class)', () => {
        it('captures message, status code, code, and details', () => {
            const err = new AppError('something broke', 500, 'INTERNAL', { extra: 1 });
            expect(err.message).toBe('something broke');
            expect(err.statusCode).toBe(500);
            expect(err.code).toBe('INTERNAL');
            expect(err.details).toEqual({ extra: 1 });
        });

        it('marks errors as operational (separates expected from bugs)', () => {
            // errorHandler middleware uses err.isOperational to decide
            // whether to expose the message vs hide it as "Internal server
            // error" in production. Dropping this flag would leak stack
            // traces to clients.
            const err = new AppError('boom');
            expect(err.isOperational).toBe(true);
        });

        it('records an ISO timestamp at construction', () => {
            const err = new AppError('x');
            expect(typeof err.timestamp).toBe('string');
            expect(() => new Date(err.timestamp).toISOString()).not.toThrow();
        });

        it('defaults statusCode to 500 and code to null', () => {
            const err = new AppError('m');
            expect(err.statusCode).toBe(500);
            expect(err.code).toBeNull();
        });

        it('is throwable + catchable as Error', () => {
            expect(() => { throw new AppError('x'); }).toThrow(Error);
            expect(() => { throw new AppError('x'); }).toThrow(AppError);
        });
    });

    describe('ValidationError → 400 + VALIDATION_ERROR', () => {
        it('encodes field + value into details', () => {
            const err = new ValidationError('Field is required', 'email', null);
            expect(err.statusCode).toBe(400);
            expect(err.code).toBe('VALIDATION_ERROR');
            expect(err.details).toEqual({ field: 'email', value: null });
            expect(err.name).toBe('ValidationError');
        });
    });

    describe('AuthenticationError → 401 + AUTH_ERROR', () => {
        it('uses default message when none provided', () => {
            const err = new AuthenticationError();
            expect(err.statusCode).toBe(401);
            expect(err.code).toBe('AUTH_ERROR');
            expect(err.message).toBe('Authentication failed');
        });

        it('overrides message when provided', () => {
            const err = new AuthenticationError('Invalid token');
            expect(err.message).toBe('Invalid token');
            expect(err.statusCode).toBe(401);
        });
    });

    describe('AuthorizationError → 403 + AUTHORIZATION_ERROR', () => {
        it('uses default message + code', () => {
            const err = new AuthorizationError();
            expect(err.statusCode).toBe(403);
            expect(err.code).toBe('AUTHORIZATION_ERROR');
            expect(err.message).toBe('Insufficient permissions');
        });
    });

    describe('NotFoundError → 404 + NOT_FOUND', () => {
        it('formats message with the resource label', () => {
            const err = new NotFoundError('User');
            expect(err.statusCode).toBe(404);
            expect(err.code).toBe('NOT_FOUND');
            expect(err.message).toBe('User not found');
        });

        it('defaults resource to "Resource"', () => {
            const err = new NotFoundError();
            expect(err.message).toBe('Resource not found');
        });
    });

    describe('ConflictError → 409 + CONFLICT_ERROR', () => {
        it('exposes resource on the instance', () => {
            const err = new ConflictError('Email already in use', 'User');
            expect(err.statusCode).toBe(409);
            expect(err.code).toBe('CONFLICT_ERROR');
            expect(err.resource).toBe('User');
        });
    });

    describe('DatabaseError → 500 + DATABASE_ERROR', () => {
        it('encodes the failing operation in details', () => {
            const err = new DatabaseError('query timeout', 'findUnique');
            expect(err.statusCode).toBe(500);
            expect(err.code).toBe('DATABASE_ERROR');
            expect(err.details).toEqual({ operation: 'findUnique' });
        });
    });

    describe('BusinessLogicError → 422 + BUSINESS_LOGIC_ERROR', () => {
        it('encodes the violated rule in details', () => {
            const err = new BusinessLogicError(
                'Cannot submit revision for application with status: APPROVED',
                'REVISION_AFTER_APPROVAL',
            );
            expect(err.statusCode).toBe(422);
            expect(err.code).toBe('BUSINESS_LOGIC_ERROR');
            expect(err.details).toEqual({ rule: 'REVISION_AFTER_APPROVAL' });
        });
    });

    describe('asyncHandler wrapper', () => {
        it('forwards thrown errors to next() instead of unhandled-rejection', async () => {
            const handler = asyncHandler(async () => {
                throw new ValidationError('bad input');
            });
            const next = jest.fn();
            await handler({}, {}, next);
            expect(next).toHaveBeenCalledTimes(1);
            const passed = next.mock.calls[0][0];
            expect(passed).toBeInstanceOf(ValidationError);
            expect(passed.message).toBe('bad input');
        });

        it('does not call next() on success', async () => {
            const handler = asyncHandler(async () => 'ok');
            const next = jest.fn();
            await handler({}, {}, next);
            expect(next).not.toHaveBeenCalled();
        });

        it('does NOT catch sync throws — Promise.resolve(fn()) sees the throw before resolving', () => {
            // The asyncHandler implementation is `Promise.resolve(fn(...)).catch(next)`.
            // If `fn` throws synchronously, the throw happens BEFORE
            // Promise.resolve is invoked — so the catch chain never engages.
            // Pin this gotcha: handlers passed to asyncHandler must be
            // declared `async` (or themselves return a Promise) to gain
            // the catch-to-next behavior.
            const handler = asyncHandler(() => {
                throw new Error('sync fail');
            });
            const next = jest.fn();
            expect(() => handler({}, {}, next)).toThrow('sync fail');
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('createErrorResponse', () => {
        it('produces the documented response envelope', () => {
            const out = createErrorResponse('some message', 'SOME_CODE', { field: 'x' });
            expect(out.success).toBe(false);
            expect(out.error).toEqual({
                message: 'some message',
                code: 'SOME_CODE',
                details: { field: 'x' },
            });
            expect(typeof out.timestamp).toBe('string');
        });

        it('defaults code + details to null', () => {
            const out = createErrorResponse('plain');
            expect(out.error.code).toBeNull();
            expect(out.error.details).toBeNull();
        });
    });
});
