/**
 * application-document-view-editable.test.tsx
 *
 * Locks two contracts for the reviewer in-place edit feature (V1):
 *
 *  1. READ-ONLY INVARIANT (critical — the applicant preview just shipped to
 *     prod): rendering with `editable` omitted produces byte-for-byte the same
 *     markup as `editable={false}`, and that markup contains NONE of the edit
 *     affordances (no toolbar / no inputs). A regression here would change the
 *     applicant preview.
 *
 *  2. The edit affordance (the "แก้ไขข้อมูล" toolbar) appears only when
 *     `editable` is true. Edit MODE itself is interactive (useState) and is not
 *     exercised here — the repo's FE test convention is renderToStaticMarkup
 *     (no @testing-library/react), so we pin the static surface + the pure
 *     config/patch helpers below.
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';

import { ApplicationDocumentView } from '../application-document-view';
import {
  buildDraftFromFormData,
  buildChangesPatch,
  setDraftValue,
  getDraftValue,
} from '../application-document-edit-config';
import type { ApplicationData } from '../application-document-helpers';

const SAMPLE: ApplicationData = {
  id: 'app-1',
  applicationNumber: 'GACP-0001',
  status: 'ASSIGNED_FOR_REVIEW',
  createdAt: '2026-01-01T00:00:00.000Z',
  formData: {
    applicantData: { applicantType: 'INDIVIDUAL', firstName: 'สมชาย', lastName: 'ใจดี', phone: '0810000000' },
    farmData: { farmName: 'ฟาร์มสุขใจ', soilType: 'LOAM', waterSourceDetail: { sourceType: 'POND', filtrationTypes: ['RO'] } },
    productionData: {
      treeCount: 100,
      seedSources: [{ varietyName: 'พันธุ์ A' }],
      productionInputs: [{ name: 'ปุ๋ย X' }],
      plantParts: ['flower'],
    },
    harvestData: { dryingMethod: 'HANGING', hasCuringProcess: false },
  },
};

describe('ApplicationDocumentView — read-only invariant (default)', () => {
  // The document footer stamps the print time to the SECOND
  // ("พิมพ์เมื่อ 1/8/2569 17:04:56"). The byte-for-byte comparison below renders
  // the component twice, so whenever the clock ticked between the two renders
  // the strings differed by one digit and the test failed — an intermittent
  // red with nothing wrong in the component. Freeze the clock so the two
  // renders are identical by construction; the invariant under test is about
  // the `editable` prop, not about wall-clock time.
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-01T10:04:56.000Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('renders identical markup whether editable is omitted or false', () => {
    const omitted = renderToStaticMarkup(<ApplicationDocumentView application={SAMPLE} />);
    const explicitFalse = renderToStaticMarkup(<ApplicationDocumentView application={SAMPLE} editable={false} />);
    expect(omitted).toBe(explicitFalse);
  });

  it('exposes NO edit affordances in the default (read-only) render', () => {
    const markup = renderToStaticMarkup(<ApplicationDocumentView application={SAMPLE} />);
    expect(markup).not.toContain('reviewer-edit-toolbar');
    expect(markup).not.toContain('แก้ไขข้อมูล');
    expect(markup).not.toContain('<input');
    expect(markup).not.toContain('<select');
    // The seed/inputs tables (read-only) still render their data.
    expect(markup).toContain('พันธุ์ A');
  });
});

describe('ApplicationDocumentView — editable surface', () => {
  it('shows the "แก้ไขข้อมูล" toolbar when editable=true (edit mode not yet entered)', () => {
    const markup = renderToStaticMarkup(<ApplicationDocumentView application={SAMPLE} editable />);
    expect(markup).toContain('reviewer-edit-toolbar');
    expect(markup).toContain('แก้ไขข้อมูล');
    // Edit mode is OFF on first render → no inputs/savebar yet (useState false).
    expect(markup).not.toContain('reviewer-edit-savebar');
  });
});

describe('edit-config helpers', () => {
  it('buildDraftFromFormData deep-copies only the editable sections', () => {
    const draft = buildDraftFromFormData(SAMPLE.formData);
    expect(Object.keys(draft).sort()).toEqual(['applicantData', 'farmData', 'harvestData', 'productionData']);
    expect(getDraftValue(draft, 'applicantData', 'phone')).toBe('0810000000');
    // Nested one-level path resolves.
    expect(getDraftValue(draft, 'farmData', 'waterSourceDetail.sourceType')).toBe('POND');
  });

  it('draft edits do not mutate the source formData (deep copy)', () => {
    const draft = buildDraftFromFormData(SAMPLE.formData);
    const next = setDraftValue(draft, 'farmData', 'waterSourceDetail.sourceType', 'RIVER');
    expect(getDraftValue(next, 'farmData', 'waterSourceDetail.sourceType')).toBe('RIVER');
    // Original untouched.
    const water = SAMPLE.formData.farmData.waterSourceDetail as { sourceType: string };
    expect(water.sourceType).toBe('POND');
  });

  it('buildChangesPatch emits only scalar/enum leaves — never the arrays', () => {
    const draft = buildDraftFromFormData(SAMPLE.formData);
    const patch = buildChangesPatch(draft);
    // Scalars/enums present.
    expect(patch.applicantData?.phone).toBe('0810000000');
    expect(patch.productionData?.treeCount).toBe(100);
    expect((patch.farmData?.waterSourceDetail as { sourceType?: string })?.sourceType).toBe('POND');
    // Arrays are NOT part of the configured editable surface → absent from the patch.
    expect(patch.productionData).not.toHaveProperty('seedSources');
    expect(patch.productionData).not.toHaveProperty('productionInputs');
    expect(patch.productionData).not.toHaveProperty('plantParts');
    expect(patch.farmData).not.toHaveProperty('filtrationTypes');
  });
});
