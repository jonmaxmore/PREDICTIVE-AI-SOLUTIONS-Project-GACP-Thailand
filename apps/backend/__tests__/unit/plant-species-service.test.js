/**
 * F-G4-59 — ONE plant resolver.
 *
 * The wizard stores formData.plantId as the FE slug ('cannabis', 'kratom', ...;
 * apps/web-app/.../plant-selection-config.ts FALLBACK_PLANTS[].code) while the
 * master table plant_species keys plants by 'CAN', 'KRA', ... (prisma/seed-plants.js).
 * document-analysis-service.js:53 looked the slug up as a master code, so it never
 * found the plant.
 *
 * These tests state what the single resolver must do:
 *   - a slug resolves to the master row through config/plant-species-slugs.js;
 *   - a master code resolves as itself;
 *   - both are trimmed and case-insensitive (people type these down a phone);
 *   - an unknown ref answers null, never a throw;
 *   - a plant an admin has deactivated (isActive false) or soft-deleted (isDeleted true)
 *     answers null too: a retired plant is not a plant a certificate may name;
 *   - the display name is the Thai register name, nameEN only when nameTH is blank,
 *     and null when neither exists (a register never carries a placeholder).
 *
 * document-analysis-service.js itself was deleted on 2026-09-28 (document pre-check
 * Task 10).
 */
'use strict';

const mockPlantSpeciesFindUnique = jest.fn();

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        plantSpecies: { findUnique: (...args) => mockPlantSpeciesFindUnique(...args) },
        documentRequirement: { findMany: jest.fn(async () => []) },
    },
}));

const { PLANT_SLUG_TO_CODE } = require('../../config/plant-species-slugs');
const { resolvePlantSpecies, plantDisplayName } = require('../../services/plant-species-service');

// Rows as Prisma returns them: prisma/schema/trace.prisma declares isActive
// (default true) and isDeleted (default false) on every plant_species row.
const CANNABIS_ROW = Object.freeze({
    id: 'ps-can',
    code: 'CAN',
    nameTH: 'กัญชา',
    nameEN: 'Cannabis',
    scientificName: 'Cannabis sativa L.',
    group: 'HIGH_CONTROL',
    isActive: true,
    isDeleted: false,
});

const GALANGAL_ROW = Object.freeze({
    id: 'ps-gal',
    code: 'GAL',
    nameTH: 'กระชายดำ',
    nameEN: 'Black Galingale',
    scientificName: null,
    group: 'GENERAL',
    isActive: true,
    isDeleted: false,
});

// routes/api/admin/plants.js PATCH lets an admin set isActive:false on a live row.
const DEACTIVATED_KRATOM_ROW = Object.freeze({
    id: 'ps-kra',
    code: 'KRA',
    nameTH: 'กระท่อม',
    nameEN: 'Kratom',
    scientificName: 'Mitragyna speciosa',
    group: 'HIGH_CONTROL',
    isActive: false,
    isDeleted: false,
});

const SOFT_DELETED_TURMERIC_ROW = Object.freeze({
    id: 'ps-tur',
    code: 'TUR',
    nameTH: 'ขมิ้นชัน',
    nameEN: 'Turmeric',
    scientificName: 'Curcuma longa L.',
    group: 'GENERAL',
    isActive: true,
    isDeleted: true,
});

const ROWS_BY_CODE = {
    CAN: CANNABIS_ROW,
    GAL: GALANGAL_ROW,
    KRA: DEACTIVATED_KRATOM_ROW,
    TUR: SOFT_DELETED_TURMERIC_ROW,
};

beforeEach(() => {
    mockPlantSpeciesFindUnique.mockReset();
    mockPlantSpeciesFindUnique.mockImplementation(async ({ where }) => ROWS_BY_CODE[where.code] || null);
});

describe('PLANT_SLUG_TO_CODE', () => {
    it('is frozen so no caller can grow a second vocabulary at runtime', () => {
        expect(Object.isFrozen(PLANT_SLUG_TO_CODE)).toBe(true);
    });

    it('maps the wizard slug to the master code', () => {
        expect(PLANT_SLUG_TO_CODE.cannabis).toBe('CAN');
        expect(PLANT_SLUG_TO_CODE.black_galangal).toBe('GAL');
    });
});

describe('resolvePlantSpecies', () => {
    it('resolves the wizard slug to the master row', async () => {
        const row = await resolvePlantSpecies('cannabis');
        expect(row).toEqual(CANNABIS_ROW);
        expect(mockPlantSpeciesFindUnique).toHaveBeenCalledTimes(1);
        expect(mockPlantSpeciesFindUnique).toHaveBeenCalledWith({ where: { code: 'CAN' } });
    });

    it('resolves a master code as itself', async () => {
        const row = await resolvePlantSpecies('GAL');
        expect(row).toEqual(GALANGAL_ROW);
        expect(mockPlantSpeciesFindUnique).toHaveBeenCalledWith({ where: { code: 'GAL' } });
    });

    it('trims and ignores case for a slug and for a code', async () => {
        await expect(resolvePlantSpecies('  Cannabis ')).resolves.toEqual(CANNABIS_ROW);
        await expect(resolvePlantSpecies('Black_Galangal')).resolves.toEqual(GALANGAL_ROW);
        await expect(resolvePlantSpecies(' can\n')).resolves.toEqual(CANNABIS_ROW);
        await expect(resolvePlantSpecies('gal')).resolves.toEqual(GALANGAL_ROW);
        expect(mockPlantSpeciesFindUnique.mock.calls.map(([arg]) => arg.where.code)).toEqual([
            'CAN', 'GAL', 'CAN', 'GAL',
        ]);
    });

    it('answers null for an unknown ref without throwing', async () => {
        await expect(resolvePlantSpecies('lavender')).resolves.toBeNull();
        await expect(resolvePlantSpecies('')).resolves.toBeNull();
        await expect(resolvePlantSpecies('   ')).resolves.toBeNull();
        await expect(resolvePlantSpecies(null)).resolves.toBeNull();
        await expect(resolvePlantSpecies(undefined)).resolves.toBeNull();
        await expect(resolvePlantSpecies(42)).resolves.toBeNull();
        await expect(resolvePlantSpecies({ code: 'CAN' })).resolves.toBeNull();
    });

    it('a deactivated plant answers null, by slug and by code', async () => {
        await expect(resolvePlantSpecies('kratom')).resolves.toBeNull();
        await expect(resolvePlantSpecies('KRA')).resolves.toBeNull();
        expect(mockPlantSpeciesFindUnique.mock.calls.map(([arg]) => arg.where.code)).toEqual(['KRA', 'KRA']);
    });

    it('a soft-deleted plant answers null, even while its isActive flag still reads true', async () => {
        await expect(resolvePlantSpecies('turmeric')).resolves.toBeNull();
        await expect(resolvePlantSpecies('TUR')).resolves.toBeNull();
        expect(mockPlantSpeciesFindUnique.mock.calls.map(([arg]) => arg.where.code)).toEqual(['TUR', 'TUR']);
    });

    it('a retired plant answers null through an injected client too', async () => {
        const client = {
            plantSpecies: { findUnique: jest.fn(async () => DEACTIVATED_KRATOM_ROW) },
        };
        await expect(resolvePlantSpecies('kratom', { client })).resolves.toBeNull();
        expect(client.plantSpecies.findUnique).toHaveBeenCalledWith({ where: { code: 'KRA' } });
    });

    it('never asks the database for a ref that is not text', async () => {
        await resolvePlantSpecies(null);
        await resolvePlantSpecies(undefined);
        await resolvePlantSpecies('');
        await resolvePlantSpecies({ code: 'CAN' });
        expect(mockPlantSpeciesFindUnique).not.toHaveBeenCalled();
    });

    it('uses the injected client when one is given', async () => {
        const client = {
            plantSpecies: { findUnique: jest.fn(async () => GALANGAL_ROW) },
        };
        const row = await resolvePlantSpecies('black_galangal', { client });
        expect(row).toEqual(GALANGAL_ROW);
        expect(client.plantSpecies.findUnique).toHaveBeenCalledWith({ where: { code: 'GAL' } });
        expect(mockPlantSpeciesFindUnique).not.toHaveBeenCalled();
    });
});

describe('plantDisplayName', () => {
    it('is the Thai register name first', () => {
        expect(plantDisplayName(CANNABIS_ROW)).toBe('กัญชา');
        expect(plantDisplayName(GALANGAL_ROW)).toBe('กระชายดำ');
    });

    it('falls back to nameEN only when nameTH is blank', () => {
        expect(plantDisplayName({ code: 'X', nameTH: '', nameEN: 'Cannabis' })).toBe('Cannabis');
        expect(plantDisplayName({ code: 'X', nameTH: '   ', nameEN: 'Cannabis' })).toBe('Cannabis');
        expect(plantDisplayName({ code: 'X', nameTH: null, nameEN: ' Cannabis ' })).toBe('Cannabis');
    });

    it('refuses with null rather than a placeholder when neither name exists', () => {
        expect(plantDisplayName({ code: 'X', nameTH: '', nameEN: '' })).toBeNull();
        expect(plantDisplayName({ code: 'X' })).toBeNull();
        expect(plantDisplayName(null)).toBeNull();
        expect(plantDisplayName(undefined)).toBeNull();
    });
});
