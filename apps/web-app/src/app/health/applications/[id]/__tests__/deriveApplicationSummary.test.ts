/**
 * deriveApplicationSummary — the "คำขอ" summary on the applicant detail page.
 *
 * Bug 2026-06-24: the current wizard's flat-save path stores the application
 * content in top-level formData fields (applicantData / farmData / plots) and
 * leaves formData.steps = {}. The "คำขอ" section read ONLY formData.steps, so it
 * rendered blank even though the data was present (and the provider review + edit
 * flows, which read flat formData, showed it). These tests pin the fallback:
 * prefer the step shape, fall back to the flat formData.
 */
import { deriveApplicationSummary, type ApplicationDetailPayload } from '../application-detail-page-config';

const base = (over: Partial<ApplicationDetailPayload>): ApplicationDetailPayload => ({
  id: 'a1', applicationId: 'a1', status: 'DOC_FEE_PAID',
  createdAt: '', updatedAt: '', ...over,
});

describe('deriveApplicationSummary', () => {
  it('reads the canonical step shape when formData.steps is populated', () => {
    const s = deriveApplicationSummary(base({
      steps: {
        '1': { operator_name: 'ACME', operator_type: 'นิติบุคคล' },
        '2': { plot_name: 'แปลง A', province: 'กรุงเทพมหานคร', area_rai: '5', area_ngan: '2', area_sq_wa: '10' },
        '3': { botanical_name: 'Cannabis sativa' },
      },
    }));
    expect(s.operatorName).toBe('ACME');
    expect(s.operatorType).toBe('นิติบุคคล');
    expect(s.plotName).toBe('แปลง A');
    expect(s.province).toBe('กรุงเทพมหานคร');
    expect(s.plantName).toBe('Cannabis sativa');
    // Was printed as three separate numbers. 5 rai + 2 ngan + 10 sq wa is
    // 8,000 + 800 + 40 square metres, and an application from before the
    // switch now reads the same way as one from after.
    expect(s.areaText).toBe('8,840 ตร.ม.');
  });

  it('FALLS BACK to flat formData when formData.steps is empty (the reported bug)', () => {
    const s = deriveApplicationSummary(base({
      steps: {},
      formData: {
        applicantData: { name: 'สมชาย เกษตรทอง', applicantType: 'INDIVIDUAL' },
        farmData: { farmName: 'ฟาร์มสมชาย', province: 'นนทบุรี', waterSourceDetail: 'ใกล้คลอง' },
        plots: [{ name: 'แปลงปลูก 1', areaSize: '2.5', areaUnit: 'ไร่' }],
        plantId: 'cannabis',
      },
    }));
    expect(s.operatorName).toBe('สมชาย เกษตรทอง');
    expect(s.operatorType).toBe('บุคคลธรรมดา'); // INDIVIDUAL → Thai
    expect(s.plotName).toBe('แปลงปลูก 1');
    expect(s.province).toBe('นนทบุรี');
    expect(s.surroundingEnvironment).toBe('ใกล้คลอง');
    expect(s.plantName).toBe('กัญชา'); // cannabis → Thai
    expect(s.areaText).toBe('4,000 ตร.ม.'); // 2.5 ไร่
  });

  it('localises codes to THAI by default (Thai UI)', () => {
    const s = deriveApplicationSummary(base({
      steps: {},
      formData: { applicantData: { name: 'X', applicantType: 'JURISTIC' }, plantId: 'kratom' },
    }));
    expect(s.operatorType).toBe('นิติบุคคล');
    expect(s.plantName).toBe('กระท่อม');
  });

  it('localises codes to ENGLISH when language="en" (English UI → English labels)', () => {
    const s = deriveApplicationSummary(base({
      steps: {},
      formData: { applicantData: { name: 'X', applicantType: 'JURISTIC' }, plantId: 'kratom' },
    }), 'en');
    expect(s.operatorType).toBe('Juristic Person');
    expect(s.plantName).toBe('Kratom');
  });

  it('lists ALL plot names and SUMS their area when there is more than one plot', () => {
    const s = deriveApplicationSummary(base({
      steps: {},
      formData: {
        plots: [
          { name: 'แปลงที่ 1', areaSize: '80000', areaUnit: 'Sqm' },
          { name: 'แปลงที่ 2', areaSize: '20000', areaUnit: 'Sqm' },
        ],
      },
    }));
    expect(s.plotName).toBe('แปลงที่ 1, แปลงที่ 2');
    expect(s.areaText).toBe('100,000 ตร.ม.');
  });

  it('composes operator name from firstName + lastName when no `name`', () => {
    const s = deriveApplicationSummary(base({
      steps: {},
      formData: { applicantData: { firstName: 'สมหญิง', lastName: 'ใจดี' } },
    }));
    expect(s.operatorName).toBe('สมหญิง ใจดี');
  });

  it('the step shape takes precedence over flat formData when both are present', () => {
    const s = deriveApplicationSummary(base({
      steps: { '1': { operator_name: 'STEP-NAME' } },
      formData: { applicantData: { name: 'FLAT-NAME' } },
    }));
    expect(s.operatorName).toBe('STEP-NAME');
  });

  it('returns "-" placeholders when neither steps nor flat data are present', () => {
    const s = deriveApplicationSummary(base({ steps: {}, formData: {} }));
    expect(s.operatorName).toBe('-');
    expect(s.plotName).toBe('-');
    expect(s.province).toBe('-');
    expect(s.plantName).toBe('-');
    expect(s.areaText).toBe('-');
  });

  it('handles a null detail safely', () => {
    const s = deriveApplicationSummary(null);
    expect(s.operatorName).toBe('-');
    expect(s.areaText).toBe('-');
  });
});
