/**
 * System Config Service — canonical read path for `SystemConfig` rows.
 *
 * Created for tech-debt batch 11 (Finance cluster) to retire direct
 * `prisma.systemConfig.findUnique` calls from `routes/api/finance/pricing.js`.
 *
 * The table is used as a key/value store for runtime-tunable defaults
 * (pricing, feature flags, etc.). Reads are deliberately lenient: when the
 * row is missing or the table itself does not exist (early in a fresh
 * environment) the service returns `null` and lets the caller fall back
 * to its hard-coded defaults. This matches the historical behaviour of
 * the route handlers and avoids 5xx-ing the public pricing page when the
 * database schema is bootstrap-stage.
 */

const { prisma } = require('./prisma-database');

class SystemConfigService {
    /**
     * Read a single config row by key. Returns the raw row (with `value`)
     * or `null` if the key is missing / table is unavailable.
     */
    async getByKey(key) {
        try {
            return await prisma.systemConfig.findUnique({ where: { key } });
        } catch (_error) {
            // Table may not exist yet in a freshly-migrated environment.
            return null;
        }
    }

    /**
     * Read a config row's `value` field, parsing it as JSON when it is
     * stored as a string. Returns `null` when the row is absent.
     */
    async getValue(key) {
        const row = await this.getByKey(key);
        if (!row || row.value == null) {
            return null;
        }
        if (typeof row.value === 'string') {
            try {
                return JSON.parse(row.value);
            } catch (_error) {
                return row.value;
            }
        }
        return row.value;
    }
}

module.exports = new SystemConfigService();
