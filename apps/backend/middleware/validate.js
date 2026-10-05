/**
 * Zod Request Validation Middleware
 * ─────────────────────────────────
 * ใช้สำหรับ validate req.body, req.query, req.params ก่อนเข้า controller
 *
 * Usage ใน route file:
 *   const { validate } = require('../../middleware/validate');
 *   const { loginSchema } = require('../../shared/schemas/auth-schemas');
 *   router.post('/login', validate(loginSchema), controller.login);
 *
 * Schema ต้องเป็น Zod schema (import จาก shared/schemas/)
 */

const { sendErrorResponse } = require('../shared/api-response');

/**
 * สร้าง Express middleware ที่ validate request body ด้วย Zod schema
 * @param {import('zod').ZodSchema} schema - Zod schema to validate against
 * @param {'body'|'query'|'params'} source - Which part of the request to validate (default: 'body')
 * @returns {import('express').RequestHandler}
 */
function validate(schema, source = 'body') {
    return (req, res, next) => {
        const result = schema.safeParse(req[source]);

        if (!result.success) {
            const errors = result.error.issues.map((issue) => ({
                field: issue.path.join('.'),
                message: issue.message,
                code: issue.code,
            }));

            return sendErrorResponse(res, req, {
                status: 400,
                code: 'VALIDATION_ERROR',
                message: `Validation failed: ${errors.map((e) => e.message).join(', ')}`,
                messageTh: 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
                details: errors,
            });
        }

        // Replace req[source] with parsed (cleaned) data
        req[source] = result.data;
        next();
    };
}

module.exports = { validate };
