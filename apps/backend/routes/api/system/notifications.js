/**
 * Notification Routes 
 * In-app notification system using PostgreSQL
 */

const express = require('express');
const router = express.Router();
const prismaDatabase = require('../../../services/prisma-database');
const { authenticateAny, checkPermission } = require('../../../middleware/auth-middleware');
const logger = require('../../../shared/logger');
const notificationService = require('../../../services/notification-service');
const { respondError } = require('../../../shared/api-response');
const { toNotificationView } = require('../../../shared/notification-view');

/** The most rows one page may carry, however large `?limit` asks. */
const MAX_PAGE = 50;

/**
 * `?before=<ISO>` as a Date, or null when it is absent or unusable.
 *
 * Returning null on junk is deliberate: `createdAt: { lt: Invalid Date }` makes Prisma
 * throw, the outer catch turns that into an empty list, and the inbox renders EMPTY
 * rather than broken — the exact failure mode the inner `.catch(()=>[])` was deleted
 * for. A bad cursor should serve the newest page, not an empty one.
 */
function parseBefore(raw) {
    if (typeof raw !== 'string' || !raw.trim()) { return null; }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `?limit`, clamped to [1, MAX_PAGE]; anything unusable falls back to MAX_PAGE. */
function parseLimit(raw) {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) { return MAX_PAGE; }
    return Math.min(n, MAX_PAGE);
}

// Prisma-based notification controller
const notificationController = {
    getNotifications: async (req, res) => {
        try {
            const prisma = prismaDatabase.getClient();
            const userId = req.user.id;
            
            if (!userId) {
                return res.status(400).json({ success: false, message: 'User ID not found' });
            }

            // Paging by TIMESTAMP, not by offset. An offset re-reads a list that shifts
            // under it: a notification arriving between two pages pushes one row across
            // the boundary and the reader never sees it. `?before=<ISO>` asks for rows
            // strictly older than a fixed instant, so a new arrival displaces nothing.
            //
            // `lt`, not `lte` — `lte` re-serves the row the cursor came from, so a client
            // paging by "the oldest row I hold" loops on it forever.
            const before = parseBefore(req.query.before);

            // No inner `.catch(()=>[])` — it silently swallowed a real query
            // failure so a broken inbox looked empty (and diverged from
            // getUnreadCount, which 500s). Let the outer catch log + degrade.
            const notifications = await prisma.notification.findMany({
                where: {
                    userId,
                    ...(before ? { createdAt: { lt: before } } : {}),
                },
                orderBy: { createdAt: 'desc' },
                take: parseLimit(req.query.limit),
            });

            // actionUrl lives inside metadata (notification-service.js:325-326) because
            // the model has no column for it, while both inboxes read it at the top
            // level — so every call-to-action button was dead until this lift.
            // shared/notification-view.js carries the reasoning and the selftest.
            res.json({ success: true, data: (notifications || []).map(toNotificationView) });
        } catch (error) {
            logger.error('[Notifications] Error fetching notifications:', error.message);
            // Return empty array instead of 500 when table might not exist
            res.json({ success: true, data: [], total: 0 });
        }
    },

    getUnreadCount: async (req, res) => {
        try {
            const prisma = prismaDatabase.getClient();
            const userId = req.user.id;
            const count = await prisma.notification.count({
                where: {
                    userId,
                    isRead: false,
                },
            });
            res.json({ success: true, count });
        } catch (error) {
            respondError(res, req, error, { label: '[notifications] unread-count' });
        }
    },

    markAsRead: async (req, res) => {
        try {
            const prisma = prismaDatabase.getClient();
            const userId = req.user.id;
            const notification = await prisma.notification.updateMany({
                where: {
                    id: req.params.id,
                    userId,
                },
                data: {
                    isRead: true,
                    readAt: new Date(),
                },
            });

            if (notification.count === 0) {
                return res.status(404).json({ success: false, message: 'Notification not found' });
            }

            res.json({ success: true });
        } catch (error) {
            respondError(res, req, error, { label: '[notifications] mark-read' });
        }
    },

    markAllAsRead: async (req, res) => {
        try {
            const prisma = prismaDatabase.getClient();
            const userId = req.user.id;
            await prisma.notification.updateMany({
                where: {
                    userId,
                    isRead: false,
                },
                data: {
                    isRead: true,
                    readAt: new Date(),
                },
            });
            res.json({ success: true });
        } catch (error) {
            respondError(res, req, error, { label: '[notifications] mark-all-read' });
        }
    },

    createNotification: async (req, res) => {
        try {
            const { recipient, title, message, type, data } = req.body;

            const notification = await notificationService.createNotification({
                userId: recipient,
                title,
                message,
                type: type || 'INFO',
                data: data || {},
            });

            if (!notification) {
                return res.status(404).json({ success: false, message: 'Recipient not found or unable to deliver' });
            }
            res.status(201).json({ success: true, data: notification });
        } catch (error) {
            respondError(res, req, error, { label: '[notifications] create' });
        }
    },
};

// All routes require authentication (health or provider)
router.use(authenticateAny);

// GET /api/notifications - All authenticated users can get their notifications
router.get('/', notificationController.getNotifications);

// GET /api/notifications/unread-count
router.get('/unread-count', notificationController.getUnreadCount);

// PUT /api/notifications/:id/read
router.put('/:id/read', checkPermission('dashboard.view'), notificationController.markAsRead);

// PUT /api/notifications/mark-all-read
router.put('/mark-all-read', checkPermission('dashboard.view'), notificationController.markAllAsRead);

// POST /api/notifications (Admin/Provider only)
router.post('/', checkPermission('system.admin'), notificationController.createNotification);

module.exports = router;
