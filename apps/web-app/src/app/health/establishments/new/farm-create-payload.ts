/**
 * Farm-worker Wave A, Chunk 1 (2026-07-02).
 *
 * Maps the establishment-registration form onto the REAL backend contract:
 * POST /farms (apps/backend/routes/api/cultivation/farms.js:146 →
 * farm-service.createFarm). The form previously posted `/establishments`,
 * which has no backend mount, so every farm registration silently 404'd.
 *
 * Backend field names (do not rename — farms.js destructures exactly these):
 *   required: farmName, address, province, district, subDistrict
 *   optional: farmType, cultivationMethod, totalArea, cultivationArea,
 *             areaUnit, landDocuments (Json)
 *
 * Farm has NO licenseNumber column — a provided license number is persisted
 * inside the landDocuments Json blob so the input is not silently dropped.
 */

export interface EstablishmentFormState {
    name: string;
    address: string;
    province: string;
    district: string;
    subDistrict: string;
    /** Facility type from the form select: INDOOR | OUTDOOR | GREENHOUSE */
    type: string;
    /** Free-text area in rai, e.g. "2.5" */
    areaSize: string;
    licenseNumber: string;
}

export interface FarmCreatePayload {
    farmName: string;
    farmType: string;
    address: string;
    province: string;
    district: string;
    subDistrict: string;
    cultivationMethod: string;
    totalArea: number;
    cultivationArea: number;
    areaUnit: string;
    landDocuments?: { licenseNumber: string };
}

export function buildFarmCreatePayload(form: EstablishmentFormState): FarmCreatePayload {
    const parsedArea = Number.parseFloat(form.areaSize);
    const area = Number.isFinite(parsedArea) && parsedArea >= 0 ? parsedArea : 0;
    const licenseNumber = form.licenseNumber.trim();

    return {
        farmName: form.name.trim(),
        farmType: 'CULTIVATION',
        address: form.address.trim(),
        province: form.province.trim(),
        district: form.district.trim(),
        subDistrict: form.subDistrict.trim(),
        cultivationMethod: form.type,
        totalArea: area,
        cultivationArea: area,
        // Square metres. The form collects them; the backend stores them.
        areaUnit: 'sqm',
        ...(licenseNumber ? { landDocuments: { licenseNumber } } : {}),
    };
}
