/**
 * Rows we corrected ourselves, and the evidence for each.
 *
 * The administrative facts in `thai-locations-data.json` are DOPA's. Facts are
 * not owned by anyone, but they are also not self-verifying: any transcription
 * of 7,452 tambon names carries mistakes, and the ones below were found by
 * comparing our dataset against more than one independent transcription and
 * keeping only the rows where the others agreed with each other and disagreed
 * with us. A single dissenting source was never enough to change anything.
 *
 * Two of the five are not spelling slips. บึงกาฬ was separated from หนองคาย in
 * 2554 and every code beneath it was reissued; in that renumbering two อำเภอ
 * names ended up sitting in ตำบล slots of a different อำเภอ. `ตำบลบึงโขงหลง`
 * inside อำเภอเมืองบึงกาฬ is not a misspelling of anything — บึงโขงหลง is
 * อำเภอ 3806. A farmer in โคกก่อง could not enter their real address, and an
 * inspector reading the application would be routed to a tambon that is not
 * there.
 *
 * Corrections live here as data rather than as edits to the JSON so that a
 * rebuild reapplies them and a reviewer can see, in one place, every row we
 * touched and why. `applyCorrections` refuses to be a silent no-op: if a target
 * row disappears or its "before" value stops matching, the build fails instead
 * of quietly leaving the old value in place.
 */

'use strict';

const LEVELS = ['provinces', 'districts', 'subDistricts'];

const corrections = {
    subDistricts: [
        {
            code: 380102,
            expectNameTh: 'บึงโขงหลง',
            nameTh: 'โคกก่อง',
            nameEn: 'Khok Kong',
            reason:
                'บึงโขงหลง is อำเภอ 3806, not a ตำบล of อำเภอเมืองบึงกาฬ. Two independent '
                + 'transcriptions both place โคกก่อง here; the อำเภอ name landed in this slot '
                + 'during the 2554 renumbering when บึงกาฬ was split from หนองคาย.',
        },
        {
            code: 380108,
            expectNameTh: 'โป่งเปื่อย',
            nameTh: 'โป่งเปือย',
            nameEn: 'Pong Pueai',
            reason: 'Spelling. Both other transcriptions read โป่งเปือย (สระเอือ), not โป่งเปื่อย.',
        },
        {
            code: 380705,
            expectNameTh: 'ศรีวิไล',
            nameTh: 'สมสนุก',
            nameEn: 'Som Sanuk',
            reason:
                'ศรีวิไล is อำเภอ 3805, not a ตำบล of อำเภอปากคาด. Both other transcriptions '
                + 'list สมสนุก as the sixth ตำบล of ปากคาด. Same 2554 renumbering fault as 380102.',
        },
        {
            code: 380803,
            expectNameTh: 'หนองเดิน',
            nameTh: 'หนองเดิ่น',
            nameEn: 'Nong Doen',
            reason: 'Spelling. Both other transcriptions carry ไม้เอก: หนองเดิ่น.',
        },
        {
            code: 840902,
            expectNameTh: 'พระแสง',
            nameTh: 'พะแสง',
            nameEn: 'Phasaeng',
            reason:
                'ตำบลพะแสง of อำเภอบ้านตาขุน. พระแสง is อำเภอ 8416 of the same province, which is '
                + 'where the extra ร came from. Both other transcriptions read พะแสง.',
        },
    ],
};

/**
 * แขวง that exist by ประกาศกรุงเทพมหานคร but were missing here.
 *
 * กรุงเทพมหานคร has redrawn แขวง boundaries twice in living memory and the
 * dataset had not caught up, so an applicant in พระโขนงใต้ or บางนาใต้ — both
 * created in 2560 — had no way to state where they actually are. Twelve of the
 * fifteen come from the seven ประกาศ dated 26 กรกฎาคม 2560, which together
 * changed five แขวง, dissolved two, and created thirteen (รัชดาภิเษก, the
 * thirteenth, was already present). The other three come from the ประกาศ
 * effective 21 กันยายน 2552 that split เขตวังทองหลาง.
 *
 * How far the evidence goes, precisely:
 *
 *   - name, parent เขต and effective date — confirmed against the ประกาศ
 *   - the เขต prefix of each code — structural, and asserted by applyCorrections
 *   - the last two digits — from a single transcription. They are consistent
 *     across all seven เขต (บางนา dissolved 104701 then took 104702–104703;
 *     บางบอน dissolved 105001 then took 105002–105005), which is why they are
 *     trusted, but no second source confirmed them.
 *
 * That last point is the reason นวมินทร์ and นวลจันทร์ (เขตบึงกุ่ม, same 2552
 * round) are NOT here: sources disagree on whether they are 102702/102703 or
 * 102704/102705, and this dataset still carries สะพานสูง and คันนายาว at
 * 102702/102703 from before those became เขต of their own. Guessing there would
 * overwrite a real แขวง. See PROVENANCE.md.
 */
const REASON_2560 = 'ตั้งขึ้นตามประกาศกรุงเทพมหานคร ลงวันที่ 26 กรกฎาคม 2560';
const REASON_2552 = 'ตั้งขึ้นตามประกาศกรุงเทพมหานคร มีผล 21 กันยายน 2552 (แบ่งพื้นที่เขตวังทองหลาง)';

corrections.additions = {
    subDistricts: [
        { code: 100910, districtCode: 1009, postalCode: '10260', nameTh: 'พระโขนงใต้', nameEn: 'Phra Khanong Tai', reason: `${REASON_2560} (แบ่งจากแขวงบางจาก)` },
        { code: 101406, districtCode: 1014, postalCode: '10400', nameTh: 'พญาไท', nameEn: 'Phaya Thai', reason: REASON_2560 },
        { code: 103402, districtCode: 1034, postalCode: '10250', nameTh: 'พัฒนาการ', nameEn: 'Phatthanakan', reason: `${REASON_2560} (แบ่งจากแขวงสวนหลวง)` },
        { code: 103403, districtCode: 1034, postalCode: '10250', nameTh: 'อ่อนนุช', nameEn: 'On Nut', reason: `${REASON_2560} (แบ่งจากแขวงสวนหลวง)` },
        { code: 104402, districtCode: 1044, postalCode: '10240', nameTh: 'ราษฎร์พัฒนา', nameEn: 'Rat Phatthana', reason: REASON_2560 },
        { code: 104403, districtCode: 1044, postalCode: '10240', nameTh: 'ทับช้าง', nameEn: 'Thap Chang', reason: REASON_2560 },
        { code: 104502, districtCode: 1045, postalCode: '10310', nameTh: 'สะพานสอง', nameEn: 'Saphan Song', reason: REASON_2552 },
        { code: 104503, districtCode: 1045, postalCode: '10310', nameTh: 'คลองเจ้าคุณสิงห์', nameEn: 'Khlong Chao Khun Sing', reason: REASON_2552 },
        { code: 104504, districtCode: 1045, postalCode: '10310', nameTh: 'พลับพลา', nameEn: 'Phlapphla', reason: REASON_2552 },
        { code: 104702, districtCode: 1047, postalCode: '10260', nameTh: 'บางนาเหนือ', nameEn: 'Bang Na Nuea', reason: `${REASON_2560} (ยุบแขวงบางนา แล้วตั้งบางนาเหนือ/บางนาใต้)` },
        { code: 104703, districtCode: 1047, postalCode: '10260', nameTh: 'บางนาใต้', nameEn: 'Bang Na Tai', reason: `${REASON_2560} (ยุบแขวงบางนา แล้วตั้งบางนาเหนือ/บางนาใต้)` },
        { code: 105002, districtCode: 1050, postalCode: '10150', nameTh: 'บางบอนเหนือ', nameEn: 'Bang Bon Nuea', reason: `${REASON_2560} (ยุบแขวงบางบอน แล้วตั้งสี่แขวงแทน)` },
        { code: 105003, districtCode: 1050, postalCode: '10150', nameTh: 'บางบอนใต้', nameEn: 'Bang Bon Tai', reason: `${REASON_2560} (ยุบแขวงบางบอน แล้วตั้งสี่แขวงแทน)` },
        { code: 105004, districtCode: 1050, postalCode: '10150', nameTh: 'คลองบางพราน', nameEn: 'Khlong Bang Phran', reason: `${REASON_2560} (ยุบแขวงบางบอน แล้วตั้งสี่แขวงแทน)` },
        { code: 105005, districtCode: 1050, postalCode: '10150', nameTh: 'คลองบางบอน', nameEn: 'Khlong Bang Bon', reason: `${REASON_2560} (ยุบแขวงบางบอน แล้วตั้งสี่แขวงแทน)` },
    ],
};

/**
 * Apply corrections to a normalised dataset.
 *
 * Renames only: code, parent and postal code are never touched, because moving
 * a row between parents is a different kind of claim and needs different
 * evidence than fixing a name.
 */
function applyCorrections(data, set) {
    const applied = [];
    const out = { ...data };

    for (const level of LEVELS) {
        const list = (set && set[level]) || [];
        if (list.length === 0) {continue;}

        const rows = (data[level] || []).map((row) => ({ ...row }));
        const byCode = new Map(rows.map((row) => [row.code, row]));

        for (const correction of list) {
            if (!correction.reason || !String(correction.reason).trim()) {
                throw new Error(
                    `correction for ${level} ${correction.code} has no reason — an unexplained edit `
                    + 'to government reference data cannot be reviewed',
                );
            }

            const row = byCode.get(correction.code);
            if (!row) {
                throw new Error(
                    `correction targets ${level} ${correction.code}, which is not in the dataset — `
                    + 'the correction is stale and would otherwise be silently skipped',
                );
            }

            // Already corrected. Applying twice has to be safe, otherwise a
            // clean repo fails its own check on the second run.
            if (row.nameTh === correction.nameTh) {continue;}

            if (row.nameTh !== correction.expectNameTh) {
                throw new Error(
                    `correction for ${level} ${correction.code} expected "${correction.expectNameTh}" `
                    + `but found "${row.nameTh}" — the row changed, so re-check the evidence before `
                    + 'reapplying',
                );
            }

            applied.push(`${level} ${correction.code}: "${row.nameTh}" -> "${correction.nameTh}" (${correction.reason})`);
            row.nameTh = correction.nameTh;
            if (correction.nameEn) {row.nameEn = correction.nameEn;}
        }

        out[level] = rows;
    }

    for (const level of LEVELS) {
        const list = (set && set.additions && set.additions[level]) || [];
        if (list.length === 0) {continue;}

        const rows = (out[level] || data[level] || []).map((row) => ({ ...row }));
        const byCode = new Map(rows.map((row) => [row.code, row]));
        const parents = new Map((out.districts || data.districts || []).map((d) => [d.code, d]));

        for (const addition of list) {
            if (!addition.reason || !String(addition.reason).trim()) {
                throw new Error(`addition for ${level} ${addition.code} has no reason`);
            }

            const existing = byCode.get(addition.code);
            if (existing) {
                // Already added. Anything else sharing the code means one of the
                // two is wrong, and overwriting would replace a real แขวง with a
                // guess.
                if (existing.nameTh === addition.nameTh) {continue;}
                throw new Error(
                    `addition ${level} ${addition.code} ("${addition.nameTh}") collides with existing `
                    + `"${existing.nameTh}" — one of them is wrong, resolve it rather than overwriting`,
                );
            }

            if (level === 'subDistricts') {
                if (!parents.has(addition.districtCode)) {
                    throw new Error(
                        `addition ${addition.code} names parent district ${addition.districtCode}, `
                        + 'which is not in the dataset',
                    );
                }
                if (!String(addition.code).startsWith(String(addition.districtCode))) {
                    throw new Error(
                        `addition ${addition.code} does not sit under district ${addition.districtCode} `
                        + '(code prefix mismatch)',
                    );
                }
            }

            const { reason, ...row } = addition;
            rows.push(row);
            applied.push(`${level} +${addition.code} "${addition.nameTh}" (${reason})`);
        }

        rows.sort((a, b) => a.code - b.code);
        out[level] = rows;
    }

    return { data: out, applied };
}

module.exports = { corrections, applyCorrections };
