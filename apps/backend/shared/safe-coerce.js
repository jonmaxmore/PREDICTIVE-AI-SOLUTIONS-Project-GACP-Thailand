// Defensive coercion helpers used by the service layer when consuming
// untrusted input (route bodies, JSON columns, third-party callbacks).
// Extracted from routes/api/provider/handlers/shared.js so the service
// layer doesn't have to import from the routes layer.

const safeInt = (v, fallback, min = 1, max = 200) => {
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, n));
};

const safeObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

const safeArray = (v) => (Array.isArray(v) ? v : []);

const safeDate = (v) => {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
};

module.exports = { safeInt, safeObject, safeArray, safeDate };
