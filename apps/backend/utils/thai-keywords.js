'use strict';

/**
 * Thai keyword extraction — text-mining ระดับ pilot สำหรับ สัญญา C05F680149
 * ต้นแบบที่ 3.1 (วิเคราะห์ความต้องการเกษตรกรจากคำตอบปลายเปิด).
 *
 * Uses the Node stdlib `Intl.Segmenter('th', { granularity: 'word' })` — no new
 * dependency (Node ≥16 ships full ICU). Falls back to whitespace splitting when
 * Segmenter is unavailable so the stats endpoint never crashes.
 *
 * Deliberately simple: word segmentation → stopword filter → frequency count.
 * NOT sentiment analysis / clustering — those are reported honestly as future
 * work in the final report.
 */

// คำหยุดไทย/อังกฤษที่พบบ่อยในคำตอบแบบสอบถาม (บอกโครงประโยค ไม่ใช่สาระ)
const THAI_STOPWORDS = new Set([
    'และ', 'หรือ', 'แต่', 'ที่', 'ซึ่ง', 'อัน', 'ใน', 'บน', 'ของ', 'จาก', 'ถึง', 'ให้',
    'ได้', 'ไป', 'มา', 'มี', 'เป็น', 'คือ', 'อยู่', 'ไม่', 'ก็', 'ว่า', 'จะ', 'ยัง',
    'ต้อง', 'ควร', 'อยาก', 'ขึ้น', 'ลง', 'กับ', 'แล้ว', 'ด้วย', 'เพื่อ', 'เพราะ',
    'ครับ', 'ค่ะ', 'คะ', 'นะ', 'จ้า', 'ๆ', 'ฯ', 'เช่น', 'อื่น', 'บ้าง', 'มาก', 'น้อย',
    'ดี', 'การ', 'ความ', 'ผู้', 'คน', 'ทำ', 'ใช้', 'อีก', 'ทั้ง', 'ตาม', 'เมื่อ', 'ถ้า',
    'หาก', 'จึง', 'โดย', 'ต่อ', 'กว่า', 'แน่นอน',
    'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'are',
]);

const MIN_WORD_LENGTH = 2;

function segmentWords(text) {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
        const words = [];
        for (const segment of segmenter.segment(text)) {
            if (segment.isWordLike) { words.push(segment.segment); }
        }
        return words;
    }
    // Fallback: whitespace split (degraded but never crashes)
    return text.split(/\s+/);
}

/**
 * @param {Array<string|null|undefined>} texts — free-text answers
 * @param {{top?: number}} options
 * @returns {Array<{word: string, count: number}>} sorted by count desc
 */
function extractThaiKeywords(texts, { top = 15 } = {}) {
    const counts = new Map();

    for (const text of texts || []) {
        if (typeof text !== 'string' || text.trim() === '') { continue; }
        for (const raw of segmentWords(text)) {
            const word = raw.trim().toLowerCase();
            if (word.length < MIN_WORD_LENGTH) { continue; }
            if (THAI_STOPWORDS.has(word)) { continue; }
            if (/^[\d\s\p{P}]+$/u.test(word)) { continue; } // numbers/punctuation
            counts.set(word, (counts.get(word) || 0) + 1);
        }
    }

    return [...counts.entries()]
        .map(([word, count]) => ({ word, count }))
        .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, 'th'))
        .slice(0, top);
}

module.exports = { extractThaiKeywords };
