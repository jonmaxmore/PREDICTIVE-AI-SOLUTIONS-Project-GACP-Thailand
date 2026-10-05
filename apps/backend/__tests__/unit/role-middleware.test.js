const { requireRole } = require('../../middleware/role-middleware');
const { AuthorizationError } = require('../../shared/errors');

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('role-middleware requireRole', () => {
  it('allows canonical alias role mapping', () => {
    const middleware = requireRole(['document_reviewer']);
    const req = { user: { id: 'u1', role: 'document_reviewer' }, path: '/api/test' };
    const res = createRes();
    const next = jest.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('blocks unauthorized role', () => {
    const middleware = requireRole(['dispatcher']);
    const req = { user: { id: 'u2', role: 'finance_officer_platform' }, path: '/api/test' };
    const res = createRes();
    const next = jest.fn();

    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthorizationError);
  });
});

