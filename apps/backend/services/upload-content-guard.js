'use strict';

/**
 * The server-side half of the upload rules — the half that counts.
 *
 * F-G4-08: the document slots accepted anything. `storage-service.createUploader`
 * did check the browser-reported mimetype against the filename extension, but
 * both of those are written by the sender: `curl -F 'file=@photo.png;type=application/pdf'`
 * with the name `deed.pdf` satisfied every check the server made. And because the
 * uploader is built once per route with ONE allow-list, a slot whose label says
 * "รองรับ .pdf" was judged by the same union of types as a photo slot. A 70-byte
 * 1x1 PNG went into all three ภท. permit slots and the product took it.
 *
 * This module answers the question the old check could not: what is actually in
 * the file, and is it plausibly a document at all. The rules themselves are NOT
 * here — they are in `@gacp/validation/upload-rules`, which the browser wizard
 * imports too, so the instant answer a farmer gets while choosing a file and the
 * refusal a determined caller gets from the endpoint are the same decision made
 * by the same code.
 *
 * The check runs AFTER multer has written the file, because a fileFilter is
 * called with the part's headers only — no bytes exist yet at that point. The
 * write is already bounded by multer's own byte limit, and a refused file is
 * unlinked here before any application row or document record is created, so
 * nothing that fails this guard is ever referenced by anything.
 */

const fsPromises = require('fs/promises');
const {
    MAGIC_SNIFF_BYTES,
    UPLOAD_REJECTION,
    ACCEPTED_LABEL_TH,
    UPLOAD_KIND,
    validateUploadedFile,
    acceptedTypeForSlot,
    formatSizeTh,
    describeSubject,
} = require('@gacp/validation/upload-rules');
const storageService = require('./storage-service');
const logger = require('../shared/logger');

/**
 * Read the leading bytes of a multer-stored upload.
 *
 * Returns null when the bytes cannot be reached at all, which the caller must
 * treat as a refusal: a file we cannot read is a file we cannot vouch for.
 *
 * @param {object} file multer file object
 * @returns {Promise<Buffer|null>}
 */
async function readUploadHead(file) {
    if (file && Buffer.isBuffer(file.buffer)) {
        return file.buffer.subarray(0, MAGIC_SNIFF_BYTES);
    }
    const storedPath = String(file?.path || '').trim();
    if (!storedPath) {
        return null;
    }
    let handle = null;
    try {
        handle = await fsPromises.open(storedPath, 'r');
        const head = Buffer.alloc(MAGIC_SNIFF_BYTES);
        const { bytesRead } = await handle.read(head, 0, MAGIC_SNIFF_BYTES, 0);
        return head.subarray(0, bytesRead);
    } catch (err) {
        logger.warn(`[Upload Guard] Could not read the stored upload to inspect it: ${err?.message}`);
        return null;
    } finally {
        if (handle) {
            await handle.close().catch(() => undefined);
        }
    }
}

/**
 * Decide whether a stored upload may fill the slot it was posted to.
 *
 * Any spelling of the slot answers the same, because acceptedTypeForSlot folds
 * the id through the shared canonicaliser first. It did not always: while that
 * lookup was by exact key, `license_pt11` was an unknown slot to it and fell to
 * the loosest rule any slot uses, so this guard passed a PNG into ภท.11.
 *
 * @param {object} file multer file object (diskStorage: has `.path` and `.size`)
 * @param {string} slotId the slot the caller posted, in any spelling
 * @returns {Promise<{ok: true, kind: string} | {ok: false, code: string, message: string}>}
 */
async function inspectStoredUpload(file, slotId) {
    const head = await readUploadHead(file);
    return validateUploadedFile({
        fileName: String(file?.originalname || 'ไฟล์ที่เลือก'),
        size: Number(file?.size) || 0,
        // A null head reaches detectUploadKind as "no signature matched", which
        // is the correct fail-closed answer for a file we could not read.
        head,
        slotType: acceptedTypeForSlot(slotId),
    });
}

/**
 * Remove the bytes of an upload this guard refused.
 *
 * Confinement is the same one the draft-document delete uses: the path is proved
 * to live under the uploads root before anything is unlinked, so a multer object
 * with a poisoned `path` can never turn a refusal into an arbitrary file delete.
 * Never throws — a failed cleanup must not turn a 400 refusal into a 500.
 *
 * @param {object} file multer file object
 */
async function discardRejectedUpload(file) {
    const storedPath = String(file?.path || '').trim();
    if (!storedPath) {
        return;
    }
    const safePath = storageService.resolveWithinUploads(storedPath);
    if (!safePath) {
        logger.warn('[Upload Guard] Refusing to unlink a rejected upload stored outside the uploads root.');
        return;
    }
    try {
        await fsPromises.unlink(safePath);
    } catch (err) {
        if (err?.code !== 'ENOENT') {
            logger.warn(`[Upload Guard] Could not remove a rejected upload (non-fatal): ${err?.message}`);
        }
    }
}

/* ── The onsite audit photo door ──────────────────────────────────────────────
 *
 * POST /api/audit/onsite/:auditId/photo is not a document slot, and reusing the
 * document numbers there would be wrong in both directions.
 *
 * It is DIFFERENT IN WHAT IT ACCEPTS. A document slot may take a PDF because a
 * farmer scans a permit. This door receives what an auditor's camera produced
 * while they were standing in the field, and a PDF is not a photograph of a
 * site: nothing a camera emits is a PDF, and a PDF that arrives here is either a
 * document filed in the wrong place or a deliberate substitute for evidence that
 * was never captured. So the accepted set is the platform's existing IMAGE set —
 * JPEG, PNG, WebP — taken from ACCEPTED_KINDS_BY_SLOT_TYPE rather than spelled
 * out again here. All three stay in, not JPEG alone: a phone's camera intent is
 * the common path but not the only one, and PNG is a legitimate image whose
 * emptiness is caught by the floor below, not by its format.
 *
 * It is DIFFERENT IN ITS FLOOR. MIN_DOCUMENT_BYTES (1,835) was derived from the
 * document population; a camera photograph is a different population and needs
 * its own number, measured the same way. See MIN_ONSITE_PHOTO_BYTES.
 *
 * It is also DIFFERENT IN PLUMBING, and only in plumbing: the route uses multer
 * memoryStorage, so the bytes are in `file.buffer` and nothing is ever written
 * to disk. readUploadHead already reads a buffer, and there is deliberately no
 * discard step for a refused photo — there is no stored file to unlink, and
 * calling discardRejectedUpload on a memory upload would be a no-op that reads
 * like a cleanup that happened.
 */

/**
 * What this door accepts, by what the bytes say the file is.
 *
 * Named through the slot-type vocabulary so the accepted kinds cannot drift
 * apart from the IMAGE slots the wizard already has.
 */
const ONSITE_PHOTO_SLOT_TYPE = 'IMAGE';

/**
 * The floor, in bytes, under which a file cannot be a photograph of a farm.
 *
 * Derived the same way as MIN_DOCUMENT_BYTES — the geometric mean of the largest
 * measured content-free file and the smallest measured real one — but from THIS
 * door's two populations, measured 2026-08-26:
 *
 *   - CONTENT-FREE, at the size a byte count can actually catch: the 1-pixel
 *     image. apps/backend/public/uploads holds 101 of them (1x1 PNG, 67 to 70
 *     bytes, the F-G4-08 pixel). Re-encoding one pixel in each kind this door
 *     accepts measures the worst case across the set: PNG 90, WebP 44,
 *     JPEG 267. Upper bound taken: 267.
 *   - REAL onsite photographs: the five the G4 audit walk actually captured
 *     (evidence/g4-rebuild-2026-08-25/a07/photos, 1200x900 JPEG) measure 45,611
 *     to 51,326 bytes. Smallest measured: 45,611.
 *
 * sqrt(267 x 45611) = 3,489.7, so 3,490: 13.1x above the largest one-pixel file
 * and 13.1x below the smallest real onsite photo this platform has taken.
 *
 * Why not higher, when a raw phone photo is 2-5 MB (the ceiling comment on the
 * route cites GACP-PRD §6.5 for that)? Because the auditor is standing in a
 * field and cannot re-shoot at a resolution their phone does not have. Downscaling
 * one of the real a07 photos measures where a genuine photograph lands at low
 * settings: 640x480 at q60 is 9,359 bytes, 480 wide at q50 is 6,112. The floor
 * sits 2.7x below even the VGA case, so a low-resolution phone is not refused.
 *
 * What this number is NOT, and the measurement says so plainly: a blank frame is
 * not catchable by size at all. A solid black 1200x900 JPEG measures 6,678 bytes
 * — LARGER than a real 480-wide photo at 6,112 — so no byte threshold anywhere
 * separates a lens-cap shot from evidence. Raising this floor to chase blank
 * frames would refuse real photographs long before it caught one. Catching that
 * needs the pixels read, and is separate work.
 */
const MIN_ONSITE_PHOTO_BYTES = 3490;

/**
 * The ceiling for one photo, in bytes.
 *
 * Owned here rather than in the route so the number multer aborts on and the
 * number the Thai refusal quotes are one constant. It is deliberately lower than
 * the document MAX_UPLOAD_BYTES: an auditor uploads many photos per audit over a
 * rural connection, not one scan.
 */
const MAX_ONSITE_PHOTO_BYTES = 10 * 1024 * 1024;

/**
 * Layer 3's refusal for this door, usable when the size is not known.
 *
 * Multer aborts an oversize upload mid-write and reports neither the original
 * filename nor the real size, so the route that catches that abort needs a
 * refusal that can be built without either.
 *
 * @param {string} [fileName]
 * @param {number} [size] omit when unknown
 * @returns {{ok: false, code: string, message: string}}
 */
function onsitePhotoTooLargeRefusal(fileName, size) {
    const measured = Number(size) > 0 ? ` มีขนาด ${formatSizeTh(size)} ซึ่ง` : ' ';
    return {
        ok: false,
        code: UPLOAD_REJECTION.TOO_LARGE,
        message: `${describeSubject(fileName)}${measured}เกินขีดจำกัด ${formatSizeTh(MAX_ONSITE_PHOTO_BYTES)} ต่อภาพ คุณสามารถตั้งค่ากล้องให้ความละเอียดต่ำลง แล้วถ่ายภาพใหม่เพื่ออัปโหลดอีกครั้ง`,
    };
}

/** Layer 2's refusal for this door, worded for a photograph rather than a document. */
function onsitePhotoTooSmallRefusal(fileName, size) {
    return {
        ok: false,
        code: UPLOAD_REJECTION.TOO_SMALL,
        message: `${describeSubject(fileName)} มีขนาด ${formatSizeTh(size)} เล็กเกินกว่าจะเป็นภาพถ่ายจากหน้างานจริง (ต้องไม่น้อยกว่า ${formatSizeTh(MIN_ONSITE_PHOTO_BYTES)}) คุณสามารถถ่ายภาพใหม่ด้วยกล้องของเครื่อง โดยไม่ย่อขนาดไฟล์ แล้วอัปโหลดอีกครั้ง`,
    };
}

/** The refusal for a part whose declared type is not an image at all. */
function onsitePhotoWrongDeclaredTypeRefusal() {
    return {
        ok: false,
        code: UPLOAD_REJECTION.WRONG_TYPE,
        // "ช่อง" is the document wizard's word for a slot; this door takes a
        // photograph an auditor just captured, so it says so.
        message: `การบันทึกภาพถ่ายหน้างานรับเฉพาะ${ACCEPTED_LABEL_TH[ONSITE_PHOTO_SLOT_TYPE]} คุณสามารถถ่ายภาพใหม่ด้วยกล้องของเครื่อง แล้วอัปโหลดอีกครั้ง`,
    };
}

/* ── Layer 4: the file has to DECODE ──────────────────────────────────────────
 *
 * Layers 1 to 3 ask what the leading bytes SAY the file is, and how big it is.
 * The adversarial review of 2026-08-26 showed that is a sentence, not a fact:
 * five buffers of FFD8FFE0 followed by 4,000 random bytes each passed this door
 * as kind=jpeg, hashed to five distinct SHA-256s, and the evidence gate answered
 * MINT ALLOWED with photoCount=5. sharp().metadata() throws on every one of
 * them. A certificate rested on noise wearing a four-byte hat.
 *
 * Only this door decodes, and that is a decision rather than an omission:
 *
 *   - WHY HERE. What this door produces is COUNTED BY A MACHINE. No human sees
 *     an onsite photo between the upload and the mint, so nothing downstream can
 *     notice that the "photograph" cannot be opened. A document slot's output is
 *     opened and read by a reviewing officer before it decides anything, and an
 *     unopenable file fails that review the moment they click it.
 *   - WHY NOT THE DOCUMENT DOORS. Their accepted set is led by PDF, which is not
 *     a sharp input at all, so a decode there could only ever apply to the image
 *     half of a BOTH slot. A sender who wanted to skip it would put a '%PDF-'
 *     header on the same noise and be back where they started: the check would
 *     cost every scanned JPEG a decode and stop nobody who was trying. Decoding
 *     a document slot's image is worth revisiting the day a PDF text-layer check
 *     lands beside it, so that both halves of a BOTH slot are actually read.
 *   - WHY NOT IN @gacp/validation. sharp is a native libvips binding with no
 *     browser build, and that module is required by the browser wizard. See "the
 *     layer that is not here" in upload-rules.js.
 *
 * What this layer does NOT do: judge what the photograph shows. A lens-cap frame
 * decodes perfectly. That needs the pixels looked at, and is separate work.
 */

/**
 * sharp, loaded once, on the first photo rather than at boot.
 *
 * Lazy because this module is also required by the wizard, application and
 * payment-slip doors, and none of them decodes anything: they must not pay
 * libvips' load on a route that will never call it.
 *
 * A failure to load is remembered as null and answered by refusing photos, NOT
 * by skipping the layer. sharp is a declared dependency of this app
 * (apps/backend/package.json) and two other services require it at module load,
 * so its absence means the deployment is broken, and a broken deployment must
 * not quietly go back to accepting noise as certificate evidence.
 *
 * @returns {object|null}
 */
let sharpModule;
function loadImageDecoder() {
    if (sharpModule !== undefined) {
        return sharpModule;
    }
    try {
        sharpModule = require('sharp');
    } catch (err) {
        sharpModule = null;
        logger.error(`[Upload Guard] Image decoder unavailable, onsite photos will be refused: ${err?.message}`);
    }
    return sharpModule;
}

/**
 * The smallest edge, in pixels, a real onsite photograph can have.
 *
 * A byte floor cannot tell a 1x1 pixel padded to 4 KB from a photograph, and
 * MIN_ONSITE_PHOTO_BYTES says so in its own comment. Decoding hands us the two
 * numbers that can: width and height.
 *
 * 360 is the SHORTER edge of the smallest genuine photograph this door has
 * measured. That is the same 480x360 downscale (480 wide at q50, 6,112 bytes)
 * that MIN_ONSITE_PHOTO_BYTES was checked against, so the two floors are drawn
 * from one population and cannot disagree about which real photos they admit.
 *
 * It is deliberately BELOW anything a camera emits rather than at it: the lowest
 * still resolution a phone camera has ever produced is VGA, 640x480, shorter
 * edge 480, and the field app uploads the camera's own file with no client-side
 * resize (audit-service.ts uploadPhoto appends the File as it came). So a real
 * capture clears this floor by 1.33x at worst, while the 1x1 pixel, an 8x8 icon
 * and a 320x240 thumbnail, none of which any camera on the farm produced, do
 * not. Choosing a rounder, higher number would start refusing real auditors to
 * catch files the decode already catches.
 */
const MIN_ONSITE_PHOTO_EDGE_PX = 360;

/**
 * The most pixels this door will decode.
 *
 * This is NOT a rule about photography, it is the bound on what decoding an
 * attacker-supplied file may cost. Deciding to decode is deciding to run a
 * decompression bomb's expansion on our own CPU and heap: a 10 MB PNG of flat
 * colour can declare hundreds of megapixels and cost gigabytes to expand, and
 * the size ceiling above cannot see that because the file really is under 10 MB.
 *
 * 50 megapixels covers every phone: flagships bin their 200 MP sensors down to
 * 12 to 24 MP in the default mode an auditor shoots in, and the highest
 * full-resolution mode that fits under this door's 10 MB ceiling at all is 48 MP.
 * A frame above this is refused with its own sentence telling the auditor to
 * lower the camera resolution, because that is advice they can act on standing
 * in a field, unlike "the file is not a usable image".
 */
const MAX_ONSITE_PHOTO_PIXELS = 50 * 1000 * 1000;

/**
 * The decode probe's output size.
 *
 * The probe exists to make the decoder read the WHOLE datastream, not to produce
 * an image, so the result is thrown away and the target is small: a truncated or
 * noise-bodied file fails during that read. Resizing rather than decoding at full
 * size lets libvips use JPEG and WebP shrink-on-load, which is why the probe
 * measures ~4 ms on the 1200x900 photographs the G4 walk captured.
 */
const DECODE_PROBE_EDGE_PX = 64;

/** What the decoder calls each kind this door's layer 1 can report. */
const DECODER_FORMAT_BY_KIND = Object.freeze({
    [UPLOAD_KIND.JPEG]: 'jpeg',
    [UPLOAD_KIND.PNG]: 'png',
    [UPLOAD_KIND.WEBP]: 'webp',
});

/** The refusal for a file that is not an image at all, whatever its first bytes claim. */
function onsitePhotoNotDecodableRefusal(fileName) {
    return {
        ok: false,
        code: UPLOAD_REJECTION.NOT_DECODABLE,
        message: `ระบบเปิด${describeSubject(fileName)} เป็นรูปภาพไม่ได้ ไฟล์อาจเสียหายหรือไม่ใช่ภาพถ่ายจริง คุณสามารถถ่ายภาพใหม่ด้วยกล้องของเครื่อง แล้วอัปโหลดอีกครั้ง`,
    };
}

/** The refusal for an image too small to be anything a camera on the farm took. */
function onsitePhotoDimensionsTooSmallRefusal(fileName, width, height) {
    return {
        ok: false,
        code: UPLOAD_REJECTION.DIMENSIONS_TOO_SMALL,
        message: `${describeSubject(fileName)} มีขนาดภาพ ${width} x ${height} พิกเซล เล็กเกินกว่าจะเป็นภาพถ่ายจากหน้างานจริง (ด้านสั้นต้องไม่น้อยกว่า ${MIN_ONSITE_PHOTO_EDGE_PX} พิกเซล) คุณสามารถถ่ายภาพใหม่ด้วยกล้องของเครื่อง โดยไม่ย่อขนาดภาพ แล้วอัปโหลดอีกครั้ง`,
    };
}

/** The refusal for an image whose declared resolution is more than this door will decode. */
function onsitePhotoDimensionsTooLargeRefusal(fileName, width, height) {
    const megapixels = Math.round(MAX_ONSITE_PHOTO_PIXELS / 1000000);
    return {
        ok: false,
        code: UPLOAD_REJECTION.DIMENSIONS_TOO_LARGE,
        message: `${describeSubject(fileName)} มีความละเอียด ${width} x ${height} พิกเซล สูงเกินกว่าที่ระบบตรวจสอบได้ (ไม่เกิน ${megapixels} ล้านพิกเซล) คุณสามารถตั้งค่ากล้องให้ความละเอียดต่ำลง แล้วถ่ายภาพใหม่เพื่ออัปโหลดอีกครั้ง`,
    };
}

/**
 * The refusal when the server cannot inspect the photo at all.
 *
 * Fail closed, and say so honestly: the auditor did nothing wrong, so the next
 * action is not "re-shoot" but "tell the people who can fix the server".
 */
function onsitePhotoInspectionUnavailableRefusal() {
    return {
        ok: false,
        code: UPLOAD_REJECTION.INSPECTION_UNAVAILABLE,
        message: 'ระบบตรวจสอบภาพถ่ายไม่พร้อมใช้งาน จึงยังรับภาพนี้เป็นหลักฐานไม่ได้ คุณสามารถแจ้งผู้ดูแลระบบ แล้วอัปโหลดอีกครั้งภายหลัง',
    };
}

/**
 * Whether a decoded image's own dimensions can belong to an onsite photograph.
 *
 * Split out from the decode so the rule can be exercised at the numbers that
 * matter (1x1, 8x8, VGA, a bomb's declared size) without building a file of that
 * size for each one — a test for the pixel ceiling would otherwise have to
 * allocate the very bomb the ceiling exists to refuse.
 *
 * The shorter edge is what is measured, so a portrait capture and the same
 * capture with EXIF orientation applied answer the same.
 *
 * @param {{width: number, height: number, fileName?: string}} args
 * @returns {{ok: true} | {ok: false, code: string, message: string}}
 */
function onsitePhotoDimensionVerdict(args) {
    const width = Number(args?.width) || 0;
    const height = Number(args?.height) || 0;
    const fileName = args?.fileName;

    // A decoder that reports no dimensions has not told us it is an image.
    if (width <= 0 || height <= 0) {
        return onsitePhotoNotDecodableRefusal(fileName);
    }
    if (width * height > MAX_ONSITE_PHOTO_PIXELS) {
        return onsitePhotoDimensionsTooLargeRefusal(fileName, width, height);
    }
    if (Math.min(width, height) < MIN_ONSITE_PHOTO_EDGE_PX) {
        return onsitePhotoDimensionsTooSmallRefusal(fileName, width, height);
    }
    return { ok: true };
}

/**
 * Prove a buffer really is the photograph its first bytes claim to be.
 *
 * Two reads, in this order, because they catch different lies:
 *
 *   1. metadata() parses the header only. It decodes no pixels, which is why it
 *      is safe to run with the pixel limit OFF: reading a bomb's DECLARED size
 *      costs nothing, and is exactly what lets the refusal below name the
 *      resolution instead of failing with a decoder error nobody can act on.
 *   2. The probe decode reads the whole datastream. It is not redundant: a
 *      header lifted from a real photograph with a random body passes
 *      metadata() reporting 1200x900, and only fails when something tries to
 *      read the pixels. Measured 2026-08-26, both halves.
 *
 * failOn is 'warning', libvips' strictest setting, because that is what
 * separates the two: at 'error' the real-header-plus-noise file still decoded.
 * The cost of that strictness is an auditor occasionally re-shooting a frame
 * their phone wrote badly, which they can do because they are standing there;
 * the cost of the looser setting is a certificate resting on a file nobody can
 * open. A real photograph with junk appended after its end marker still passes,
 * so this is not strictness that refuses ordinary camera output.
 *
 * @param {Buffer} buffer the whole file
 * @param {string} fileName name as the auditor sees it
 * @param {string} sniffedKind what layer 1 said the bytes were
 * @returns {Promise<{ok: true, kind: string, width: number, height: number} | {ok: false, code: string, message: string}>}
 */
async function decodeOnsitePhotoEvidence(buffer, fileName, sniffedKind) {
    const sharp = loadImageDecoder();
    if (!sharp) {
        return onsitePhotoInspectionUnavailableRefusal();
    }

    let metadata;
    try {
        metadata = await sharp(buffer, { limitInputPixels: false }).metadata();
    } catch (err) {
        logger.warn(`[Upload Guard] Onsite photo header would not parse: ${err?.message?.split('\n')[0]}`);
        return onsitePhotoNotDecodableRefusal(fileName);
    }

    const dimensions = onsitePhotoDimensionVerdict({
        width: metadata?.width,
        height: metadata?.height,
        fileName,
    });
    if (!dimensions.ok) {
        return dimensions;
    }

    // Written out rather than compared string-to-string: the two vocabularies
    // happen to spell these kinds the same today, and a table is what keeps that
    // a fact instead of a coincidence that a rename could turn into a check that
    // silently always passes. A disagreement means the byte signature and the
    // decoder chose different formats for one file. Nothing legitimate does
    // that, and a file that is two formats at once is precisely the shape used
    // to smuggle one past a check that only read the front.
    if (metadata.format !== DECODER_FORMAT_BY_KIND[sniffedKind]) {
        logger.warn(`[Upload Guard] Onsite photo sniffed as ${sniffedKind} but decoded as ${metadata.format}.`);
        return onsitePhotoNotDecodableRefusal(fileName);
    }

    try {
        await sharp(buffer, { limitInputPixels: MAX_ONSITE_PHOTO_PIXELS, failOn: 'warning' })
            .resize(DECODE_PROBE_EDGE_PX, DECODE_PROBE_EDGE_PX, { fit: 'inside', withoutEnlargement: true })
            .toBuffer();
    } catch (err) {
        logger.warn(`[Upload Guard] Onsite photo would not decode: ${err?.message?.split('\n')[0]}`);
        return onsitePhotoNotDecodableRefusal(fileName);
    }

    return { ok: true, kind: sniffedKind, width: metadata.width, height: metadata.height };
}

/**
 * Decide whether an in-memory upload may count as onsite photo evidence.
 *
 * The same three cheap layers in the same order as the document doors, because
 * they come from the same module — only the thresholds and the accepted set are
 * this door's own — and then layer 4, which is this door's alone. The size is
 * read from the buffer's own length when there is a buffer: for memory storage
 * the buffer IS the file, so its length is the one number that cannot disagree
 * with the bytes that were inspected.
 *
 * @param {object} file multer file object (memoryStorage: has `.buffer`)
 * @returns {Promise<{ok: true, kind: string, width?: number, height?: number} | {ok: false, code: string, message: string}>}
 */
async function inspectOnsitePhotoUpload(file) {
    const fileName = String(file?.originalname || '');
    const size = Buffer.isBuffer(file?.buffer)
        ? file.buffer.length
        : Number(file?.size) || 0;

    // Checked here as well as by multer's limit, because multer is optional in
    // this deployment (the route degrades to a passthrough when it is absent)
    // and a guard that only holds when another component is present is not a
    // guard.
    if (size > MAX_ONSITE_PHOTO_BYTES) {
        return onsitePhotoTooLargeRefusal(fileName, size);
    }

    const head = await readUploadHead(file);
    const verdict = validateUploadedFile({
        fileName,
        size,
        head,
        slotType: ONSITE_PHOTO_SLOT_TYPE,
    });

    if (!verdict.ok) {
        // The shared layer answers with the document floor and the word
        // "เอกสาร"; on this door the same refusal has to name the photo floor
        // and speak about a photograph. Every other refusal it can give (empty,
        // unreadable, wrong kind) is already the right sentence.
        return verdict.code === UPLOAD_REJECTION.TOO_SMALL
            ? onsitePhotoTooSmallRefusal(fileName, size)
            : verdict;
    }

    if (size < MIN_ONSITE_PHOTO_BYTES) {
        return onsitePhotoTooSmallRefusal(fileName, size);
    }

    // Layer 4 runs LAST because it is the only expensive one: every file the
    // cheap layers can refuse is already gone before a decoder is handed
    // anything, so the work is spent only on files that look right.
    if (!Buffer.isBuffer(file?.buffer)) {
        // This door is memoryStorage, so the buffer IS the file (see the plumbing
        // note above). Reaching here means the upload arrived some other way and
        // the bytes we inspected are not the bytes we could decode. That is a
        // file we cannot vouch for, which is a refusal, never a skipped layer.
        logger.error('[Upload Guard] Onsite photo arrived without its bytes in memory, so it could not be decoded.');
        return onsitePhotoInspectionUnavailableRefusal();
    }

    return decodeOnsitePhotoEvidence(file.buffer, fileName, verdict.kind);
}

module.exports = {
    readUploadHead,
    inspectStoredUpload,
    discardRejectedUpload,
    ONSITE_PHOTO_SLOT_TYPE,
    MIN_ONSITE_PHOTO_BYTES,
    MAX_ONSITE_PHOTO_BYTES,
    MIN_ONSITE_PHOTO_EDGE_PX,
    MAX_ONSITE_PHOTO_PIXELS,
    onsitePhotoTooLargeRefusal,
    onsitePhotoWrongDeclaredTypeRefusal,
    onsitePhotoDimensionVerdict,
    decodeOnsitePhotoEvidence,
    inspectOnsitePhotoUpload,
};
