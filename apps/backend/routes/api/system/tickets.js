/**
 * Ticket Routes
 * Support ticket system — persisted via Prisma (Ticket + TicketMessage).
 * Replaces the prior in-memory array (tickets were lost on restart).
 * organizationId is injected by the tenant Prisma extension (ADR-014);
 * SEC-SYS-002 ownership (HEALTH callers may only touch their own tickets) is
 * enforced below with a 404-on-miss so existence is not leaked.
 */

const express = require('express');
const router = express.Router();
const { authenticateHealth, checkPermission } = require('../../../middleware/auth-middleware');
const { CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
const { prisma } = require('../../../services/prisma-database');
const { respondError } = require('../../../shared/api-response');

const MESSAGE_INCLUDE = { messages: { orderBy: { createdAt: 'asc' } } };

/**
 * Who is asking — expressed once, in the only two fields this file may use.
 *
 * `canonicalRole`, never `role`: the DB stores `"HEALTH"` (auth.prisma:104)
 * while the canonical vocabulary is lowercase (`CANONICAL_ROLES.HEALTH`).
 * auth-middleware normalises once at the boundary; comparing the raw column
 * here is what made the old gate dead code — `'HEALTH' !== 'health'` is true
 * for every caller, so every applicant passed the ownership check.
 *
 * `id`, never `userId`: the token payload carries `id`
 * (prisma-auth-service.js:481). `req.user.userId` is undefined, and an
 * undefined value in a Prisma `where` is DROPPED, not matched — so the list
 * endpoints returned every row instead of none.
 */
function callerIsApplicant(req) {
    return req.user?.canonicalRole === CANONICAL_ROLES.HEALTH;
}

/**
 * The `where` fragment that narrows a query to the caller's own tickets.
 *
 * Staff get `{}` (the tenant extension still scopes them to their org).
 * An applicant gets `{ creatorId: <their id> }`. An applicant whose identity
 * is missing gets `null`, and every caller MUST treat null as "deny" — failing
 * closed, because the failure mode of failing open here is handing one
 * applicant every other applicant's support history.
 */
function ownScopeOrDeny(req) {
    if (!callerIsApplicant(req)) { return {}; }
    const userId = req.user?.id;
    return userId ? { creatorId: userId } : null;
}

function denyUnidentified(res) {
    return res.status(401).json({
        success: false,
        error: 'Unauthorized',
        code: 'NO_IDENTITY',
        message: 'Authenticated request carries no user identity',
    });
}

// Fetch a ticket by :id and apply the SEC-SYS-002 ownership gate. Returns the
// ticket (with messages) or null (→ 404, no existence leak).
async function findOwnedTicket(req) {
    const scope = ownScopeOrDeny(req);
    if (scope === null) { return null; }
    const ticket = await prisma.ticket.findFirst({
        where: { id: req.params.id, isDeleted: false, ...scope },
        include: MESSAGE_INCLUDE,
    });
    return ticket || null;
}

const ticketController = {
    getTickets: async (req, res) => {
        try {
            const scope = ownScopeOrDeny(req);
            if (scope === null) { return denyUnidentified(res); }
            const data = await prisma.ticket.findMany({
                where: { isDeleted: false, ...scope },
                orderBy: { createdAt: 'desc' },
                include: MESSAGE_INCLUDE,
            });
            res.json({ success: true, data });
        } catch (error) {
            respondError(res, req, error, { label: '[tickets] list' });
        }
    },

    getApplicationTickets: async (req, res) => {
        try {
            // HEALTH callers only see their own tickets for the application (SEC-SYS-002).
            const scope = ownScopeOrDeny(req);
            if (scope === null) { return denyUnidentified(res); }
            const where = { relatedApplication: req.params.applicationId, isDeleted: false, ...scope };
            const data = await prisma.ticket.findMany({ where, orderBy: { createdAt: 'desc' }, include: MESSAGE_INCLUDE });
            res.json({ success: true, data });
        } catch (error) {
            respondError(res, req, error, { label: '[tickets] list-by-application' });
        }
    },

    getTicketById: async (req, res) => {
        try {
            const ticket = await findOwnedTicket(req);
            if (!ticket) { return res.status(404).json({ success: false, message: 'Ticket not found' }); }
            res.json({ success: true, data: ticket });
        } catch (error) {
            respondError(res, req, error, { label: '[tickets] get-by-id' });
        }
    },

    createTicket: async (req, res) => {
        try {
            const creatorId = req.user?.id;
            if (!creatorId) { return denyUnidentified(res); }
            const { title, description, category, priority, relatedApplication } = req.body;
            // organizationId is injected by the tenant extension from the bound context.
            const ticket = await prisma.ticket.create({
                data: {
                    title,
                    description,
                    category,
                    priority,
                    relatedApplication,
                    creatorId,
                    status: 'open',
                },
                include: MESSAGE_INCLUDE,
            });
            res.status(201).json({ success: true, data: ticket });
        } catch (error) {
            respondError(res, req, error, { label: '[tickets] create' });
        }
    },

    addMessage: async (req, res) => {
        try {
            const ticket = await findOwnedTicket(req);
            if (!ticket) { return res.status(404).json({ success: false, message: 'Ticket not found' }); }
            await prisma.ticketMessage.create({
                data: { ticketId: ticket.id, senderId: req.user.id, content: req.body.content },
            });
            const updated = await prisma.ticket.findFirst({ where: { id: ticket.id }, include: MESSAGE_INCLUDE });
            res.status(201).json({ success: true, data: updated });
        } catch (error) {
            respondError(res, req, error, { label: '[tickets] add-message' });
        }
    },

    resolveTicket: async (req, res) => {
        try {
            const ticket = await findOwnedTicket(req);
            if (!ticket) { return res.status(404).json({ success: false, message: 'Ticket not found' }); }
            const updated = await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'resolved' }, include: MESSAGE_INCLUDE });
            res.json({ success: true, data: updated });
        } catch (error) {
            respondError(res, req, error, { label: '[tickets] resolve' });
        }
    },

    closeTicket: async (req, res) => {
        try {
            const ticket = await findOwnedTicket(req);
            if (!ticket) { return res.status(404).json({ success: false, message: 'Ticket not found' }); }
            const updated = await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'closed' }, include: MESSAGE_INCLUDE });
            res.json({ success: true, data: updated });
        } catch (error) {
            respondError(res, req, error, { label: '[tickets] close' });
        }
    },
};

// All routes require authentication
router.use(authenticateHealth);

router.get('/', checkPermission('dashboard.view'), ticketController.getTickets);
router.get('/application/:applicationId', checkPermission('application.read'), ticketController.getApplicationTickets);
router.get('/:id', checkPermission('dashboard.view'), ticketController.getTicketById);
router.post('/', checkPermission('dashboard.view'), ticketController.createTicket);
router.post('/:id/messages', checkPermission('dashboard.view'), ticketController.addMessage);
router.put('/:id/resolve', checkPermission('dashboard.view'), ticketController.resolveTicket);
router.put('/:id/close', checkPermission('dashboard.view'), ticketController.closeTicket);

module.exports = router;
