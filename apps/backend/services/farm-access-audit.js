'use strict';

/**
 * T5 — เครื่องบันทึกการเข้าถึงข้อมูลฟาร์มโดยพนักงาน (PDPA ม.39)
 *
 * มติ 2026-09-05 เปิดให้พนักงานติดตามเห็น "ฟาร์มทุกแห่งทั้งประเทศ" ไม่ผูกกับการมอบหมาย
 * ขอบเขตที่กว้างขึ้นไม่ได้ทำให้หน้าที่เบาลง — ม.37(1) ให้ผู้ควบคุมข้อมูลต้องป้องกันการเข้าถึง
 * โดยมิชอบ และ ม.39 ให้บันทึก "การเข้าถึง" ไว้ · สิทธิ์กว้างที่ไม่มีเครื่องบันทึกจึงไม่ผ่าน
 * ทั้งสองข้อ และการบันทึกก็ไม่ได้จำกัดขอบเขตที่ operator เปิดไว้แม้แต่นิดเดียว
 *
 * สามข้อที่ตัดสินรูปร่างของไฟล์นี้:
 *
 * 1. **บันทึกจากสิ่งที่ส่งออกไปจริง ไม่ใช่สิ่งที่ถูกขอ** — คำขอที่ตอบ 404 หรือค้นแล้วไม่เจอใคร
 *    ไม่ได้เข้าถึงข้อมูลของใคร การบันทึกไว้คือการใส่ร้ายคนที่ยังไม่ได้เห็นอะไร และทำให้
 *    log เต็มไปด้วยแถวที่ไม่มีความหมายจนแถวที่มีความหมายหาไม่เจอ
 *
 * 2. **ติดที่ router ไม่ใช่เรียกทีละ handler** — เรียกทีละประตูแปลว่าประตูที่เพิ่มพรุ่งนี้
 *    จะเงียบโดยไม่มีใครรู้ตัว ซึ่งเป็นกับดักเดิมของโปรเจกต์นี้ (guard ที่จับรูปร่างแทน
 *    การประกาศ) · `router.use(recordFarmDataAccess(...))` ทำให้ทุกเส้นทางในไฟล์นั้น
 *    ได้ไปด้วยกันหมด รวมทั้งเส้นทางที่ยังไม่ได้เขียน
 *
 * 3. **log ไม่ใช่สำเนาที่สองของข้อมูล** — เก็บ id ของฟาร์ม จำนวน และคำค้นที่พนักงานพิมพ์
 *    ไม่เก็บชื่อฟาร์ม ไม่เก็บชื่อคน · คำค้นเก็บเพราะมันคือ *ตัวการเข้าถึง* เอง
 *    ("ใครค้นหาใคร") ซึ่งเป็นสิ่งที่ ม.39 ต้องการ ไม่ใช่ผลพลอยได้
 *
 * ถ้าเครื่องบันทึกล้ม พนักงานยังได้คำตอบ แต่ความล้มต้องดังตาม precedent ของ auditLogger
 * ในไฟล์อื่น (non-fatal) · การทำให้จอค้างเพราะตารางบันทึกล่ม คือการเปลี่ยนปัญหาหนึ่ง
 * ให้เป็นอีกปัญหาหนึ่ง — แต่การกลืนมันเงียบ ๆ คือการไม่มีบันทึกโดยไม่มีใครรู้
 */

const { auditLogger, AuditCategory, AuditSeverity, ResourceType } = require('../middleware/audit-logger');
const logger = require('../shared/logger');

const FARM_ACCESS_ACTION = 'FARM_DATA_VIEWED';

/** คำค้นที่บันทึก — จำกัดความยาวเพื่อไม่ให้ log กลายเป็นที่ทิ้ง query ยาว ๆ */
const QUERY_KEYS = Object.freeze(['q', 'status', 'farmId', 'province', 'page', 'limit']);
const MAX_QUERY_VALUE = 200;
const MAX_FARM_IDS = 500;

/**
 * id ของฟาร์มที่ปรากฏใน payload ที่กำลังจะถูกส่งออก
 *
 * นับจาก "ก้อนที่เป็นฟาร์ม" (มี farmName) กับคีย์ `farmId` ตรง ๆ เท่านั้น — ไม่ใช่ id
 * ทุกตัวที่เจอ เพราะ id ของแปลงและของรอบปลูกไม่ใช่ข้อมูลส่วนบุคคลของใคร
 */
function farmIdsIn(payload) {
    const found = new Set();
    const seen = new Set();

    const walk = (node) => {
        if (!node || typeof node !== 'object' || found.size >= MAX_FARM_IDS) { return; }
        if (seen.has(node)) { return; }
        seen.add(node);

        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        if (typeof node.farmId === 'string' && node.farmId) { found.add(node.farmId); }
        // a farm object identifies itself by carrying a farm's name, not by the key
        // it happens to hang off — `farm`, `farms[]` and `data` all reach here.
        if (typeof node.farmName === 'string' && typeof node.id === 'string' && node.id) {
            found.add(node.id);
        }
        for (const value of Object.values(node)) {
            if (value && typeof value === 'object') { walk(value); }
        }
    };

    walk(payload);
    return Array.from(found);
}

/**
 * What the handler SAID it disclosed — `res.locals.auditFarmIds`, a list of ids.
 *
 * Anything else is ignored rather than coerced: a bare string or an object here means the
 * handler and this file disagree about the contract, and guessing what was meant would put
 * an invented id in an access log that exists to be trusted.
 */
function declaredFarmIds(res) {
    const declared = res && res.locals && res.locals.auditFarmIds;
    if (!Array.isArray(declared)) { return []; }
    return declared.filter((id) => typeof id === 'string' && id);
}

/** One request is one access, so the same farm named twice is still one row. */
function mergeFarmIds(declared, fromBody) {
    const out = [];
    const seen = new Set();
    for (const id of [...declared, ...fromBody]) {
        if (seen.has(id) || out.length >= MAX_FARM_IDS) { continue; }
        seen.add(id);
        out.push(id);
    }
    return out;
}

function actorFrom(req) {
    const user = req && req.user;
    return {
        actorId: (user && user.id) || 'UNKNOWN',
        actorRole: (user && (user.canonicalRole || user.role)) || 'UNKNOWN',
        organizationId: (user && user.organizationId) || null,
    };
}

function queryFrom(req) {
    const out = {};
    const q = (req && req.query) || {};
    for (const key of QUERY_KEYS) {
        const value = q[key];
        if (value === undefined || value === null || value === '') { continue; }
        out[key] = String(value).slice(0, MAX_QUERY_VALUE);
    }
    return out;
}

/**
 * มิดเดิลแวร์: อ่าน body ที่กำลังจะถูกส่ง แล้วบันทึกว่าใครเห็นฟาร์มไหนบ้าง
 *
 * ชื่อฟังก์ชันที่คืนออกไปตั้งไว้ตายตัว (`farmDataAccessRecorder`) เพราะเทสอ่าน
 * stack ของ router เพื่อพิสูจน์ว่ามันถูกติดจริง — grep ไม่พิสูจน์ว่ามันเข้าเส้นทาง
 */
function recordFarmDataAccess({ surface }) {
    return function farmDataAccessRecorder(req, res, next) {
        const originalJson = res.json.bind(res);
        let recorded = false;

        res.json = function patchedJson(body) {
            const sent = originalJson(body);
            if (recorded) { return sent; }
            recorded = true;

            if (res.statusCode >= 400) { return sent; }
            // Two ways to learn which farm was disclosed, and the DECLARED one comes first.
            //
            // Walking the body finds a farm only when the payload happens to carry a
            // `farmId` or a `{id, farmName}` object. Two of the four provider planting
            // routes carry neither — the cultivation diary returns log rows with
            // `plot: {id, name}`, and the QR view returns plot codes — so mounting the
            // recorder on the router covered them in the middleware stack while recording
            // nothing at all. A guard that matches the shape a payload HAPPENS to have
            // protects only the payloads someone happened to check.
            //
            // So a handler may STATE which farm it just disclosed. That is a declaration:
            // it does not depend on the response shape, and a route added tomorrow whose
            // payload never names a farm can still be recorded.
            const farmIds = mergeFarmIds(declaredFarmIds(res), farmIdsIn(body));
            if (farmIds.length === 0) { return sent; }

            const row = {
                category: AuditCategory.DATA_ACCESS,
                action: FARM_ACCESS_ACTION,
                severity: AuditSeverity.INFO,
                actorType: 'USER',
                ...actorFrom(req),
                resourceType: ResourceType.FARM,
                // หนึ่งคำขอ = การเข้าถึงหนึ่งครั้ง ต่อให้เห็นหลายฟาร์ม · รายการอยู่ใน metadata
                resourceId: farmIds.length === 1 ? farmIds[0] : `${farmIds.length} farms`,
                ipAddress: req.ip || null,
                userAgent: req.get ? req.get('user-agent') : null,
                metadata: {
                    surface,
                    method: req.method,
                    path: req.originalUrl ? String(req.originalUrl).split('?')[0] : req.path,
                    farmIds,
                    farmCount: farmIds.length,
                    query: queryFrom(req),
                },
            };

            Promise.resolve()
                .then(() => auditLogger.log(row))
                .catch((err) => {
                    // ดังไว้: ไม่มีบันทึก = การเข้าถึงที่ไม่มีใครตรวจย้อนได้ ซึ่งคือสิ่งที่ ม.39 ห้าม
                    logger.error(`[farm-access-audit] ${FARM_ACCESS_ACTION} was NOT recorded`, {
                        surface,
                        actorId: row.actorId,
                        farmCount: row.metadata.farmCount,
                        reason: err && err.message,
                    });
                });

            return sent;
        };

        next();
    };
}

module.exports = { farmIdsIn, declaredFarmIds, recordFarmDataAccess, FARM_ACCESS_ACTION };
