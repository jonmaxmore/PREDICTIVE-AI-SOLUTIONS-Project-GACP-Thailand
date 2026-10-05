/**
 * F-G4-59 — the two plant vocabularies are pinned together until the slug retires.
 *
 * The wizard's plant list (apps/web-app/.../plant-selection-config.ts, FALLBACK_PLANTS)
 * speaks slugs; the master table seed (prisma/seed-plants.js) speaks codes. Neither
 * file imports the other, so nothing stopped them drifting apart. This test reads
 * both as TEXT (no TypeScript loader, no Prisma client, no database) and asserts:
 *   - every wizard slug has a map entry;
 *   - every map entry points at a code the seed declares;
 *   - the map has no entry the wizard does not know (no orphan slug);
 *   - the Thai register name agrees on both sides of the map.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { PLANT_SLUG_TO_CODE } = require('../../config/plant-species-slugs');

const WIZARD_CONFIG = path.resolve(
    __dirname,
    '../../../web-app/src/app/health/applications/new/_steps/steps/plant-selection-config.ts',
);
const SEED_PLANTS = path.resolve(__dirname, '../../prisma/seed-plants.js');

function readWizardPlants() {
    const text = fs.readFileSync(WIZARD_CONFIG, 'utf8');
    // FALLBACK_PLANTS entries are written  code: 'slug', nameTH: '...', nameEN: '...'
    const re = /code:\s*'([a-z_]+)',\s*nameTH:\s*'([^']+)'/g;
    const plants = [];
    let m;
    while ((m = re.exec(text)) !== null) {
        plants.push({ slug: m[1], nameTH: m[2] });
    }
    return plants;
}

function readSeedPlants() {
    const text = fs.readFileSync(SEED_PLANTS, 'utf8');
    // plantsData entries are written  code: 'CAN', nameEN: '...', nameTH: '...'
    const re = /\bcode:\s*'([A-Z]+)',\s*nameEN:\s*'[^']*',\s*nameTH:\s*'([^']+)'/g;
    const plants = [];
    let m;
    while ((m = re.exec(text)) !== null) {
        plants.push({ code: m[1], nameTH: m[2] });
    }
    return plants;
}

describe('PLANT_SLUG_TO_CODE covers the wizard', () => {
    const wizard = readWizardPlants();
    const seed = readSeedPlants();
    const seedByCode = new Map(seed.map((p) => [p.code, p]));

    it('read both vocabularies (the regexes still match the files)', () => {
        expect(wizard.length).toBeGreaterThan(0);
        expect(seed.length).toBeGreaterThan(0);
        expect(new Set(wizard.map((p) => p.slug)).size).toBe(wizard.length);
        expect(seedByCode.size).toBe(seed.length);
    });

    it.each(readWizardPlants().map((p) => [p.slug, p.nameTH]))(
        'wizard slug %s maps to a code the seed declares',
        (slug) => {
            const code = PLANT_SLUG_TO_CODE[slug];
            expect(code).toEqual(expect.any(String));
            expect(seedByCode.has(code)).toBe(true);
        },
    );

    it('has no entry the wizard does not know', () => {
        const wizardSlugs = new Set(wizard.map((p) => p.slug));
        const orphans = Object.keys(PLANT_SLUG_TO_CODE).filter((slug) => !wizardSlugs.has(slug));
        expect(orphans).toEqual([]);
    });

    it('agrees with both files on the Thai register name', () => {
        for (const plant of wizard) {
            const seedRow = seedByCode.get(PLANT_SLUG_TO_CODE[plant.slug]);
            expect({ slug: plant.slug, nameTH: seedRow && seedRow.nameTH })
                .toEqual({ slug: plant.slug, nameTH: plant.nameTH });
        }
    });

    /**
     * ชื่อไทยที่ไฟล์นี้ถืออยู่ (PLANT_SLUG_TO_NAME_TH) คือคำที่ **พิมพ์ลงหัวกระดาษ กทล.1**
     * ตั้งแต่ 2026-09-11 — แบบของแต่ละชนิดเรียกชื่อชนิดของตัวเอง (มติ operator: คนละใบ)
     *
     * ทะเบียนจริงคือ plant_species ที่ seed เขียน · ชื่อที่เพี้ยนที่นี่ไม่ทำให้อะไรพัง
     * มันแค่พิมพ์ชื่อผิดลงเอกสารราชการอย่างเงียบ ๆ ซึ่งแย่กว่าพัง
     */
    it('ชื่อไทยที่ใช้พิมพ์บนแบบ กทล.1 ตรงกับทะเบียนพืช', () => {
        // eslint-disable-next-line global-require
        const { PLANT_SLUG_TO_NAME_TH } = require('../../config/plant-species-slugs');

        expect(Object.keys(PLANT_SLUG_TO_NAME_TH).sort())
            .toEqual(Object.keys(PLANT_SLUG_TO_CODE).sort());

        for (const [slug, code] of Object.entries(PLANT_SLUG_TO_CODE)) {
            const seedRow = seedByCode.get(code);
            expect({ slug, nameTH: PLANT_SLUG_TO_NAME_TH[slug] })
                .toEqual({ slug, nameTH: seedRow && seedRow.nameTH });
        }
    });
});
