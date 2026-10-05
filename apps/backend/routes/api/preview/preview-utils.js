const feeService = require('../../../services/fee-service');
const { AREA_UNIT } = require('../../../shared/area-utils');
const { storedCultivationScopeCount } = require('../../../shared/application-scope');

function parseJson(value, fallback) {
  if (value == null) {
    return fallback;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return fallback;
    }
  }
  return value;
}

function toDisplayValue(value) {
  if (value === null || value === undefined) {
    return '-';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '-';
  }
  if (typeof value === 'string') {
    return value.trim() || '-';
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? '[]' : JSON.stringify(value);
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    return keys.length === 0 ? '{}' : JSON.stringify(value);
  }
  return String(value);
}

function flattenFormEntries(value, prefix = '', out = []) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push({
        path: prefix || 'root',
        value: [],
        displayValue: '[]',
      });
      return out;
    }
    value.forEach((item, index) => {
      const nextPath = prefix ? `${prefix}[${index}]` : `[${index}]`;
      flattenFormEntries(item, nextPath, out);
    });
    return out;
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      out.push({
        path: prefix || 'root',
        value: {},
        displayValue: '{}',
      });
      return out;
    }

    keys.forEach((key) => {
      const nextPath = prefix ? `${prefix}.${key}` : key;
      flattenFormEntries(value[key], nextPath, out);
    });
    return out;
  }

  out.push({
    path: prefix || 'root',
    value,
    displayValue: toDisplayValue(value),
  });
  return out;
}

function buildFullFormSnapshot(application, formData) {
  const safeFormData = (formData && typeof formData === 'object') ? formData : {};
  const attachments = parseJson(application?.attachments, []);
  const supplementalSections = {
    formData: safeFormData,
    personnelHygiene: parseJson(application?.personnelHygiene, null),
    supplementaryCriteria: parseJson(application?.supplementaryCriteria, null),
    labResults: parseJson(application?.labResults, null),
    previewData: parseJson(application?.previewData, null),
    attachments: Array.isArray(attachments) ? attachments : [],
  };
  const flattenedFields = flattenFormEntries(supplementalSections);

  return {
    applicationMeta: {
      applicationId: application?.id,
      applicationNumber: application?.applicationNumber,
      standardCode: application?.standardCode,
      areaType: application?.areaType,
      serviceType: application?.serviceType,
      status: application?.status,
      createdAt: application?.createdAt,
      updatedAt: application?.updatedAt,
      areaTypeIndex: application?.areaTypeIndex,
      cultivationScopeCount: storedCultivationScopeCount(application),
      phase1Status: application?.phase1Status,
      phase2Status: application?.phase2Status,
    },
    rawFormData: supplementalSections,
    fieldCount: flattenedFields.length,
    fields: flattenedFields,
    attachments: Array.isArray(attachments) ? attachments : [],
  };
}

function toNumberOrUndefined(value) {
  if (value == null || value === '') {
    return undefined;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function normalizeFarmInfo(formData, application) {
  const farmData = formData?.farmData || {};
  const farmInfo = formData?.farmInfo || {};

  const locationParts = [
    farmData.address || farmInfo.address,
    farmData.subdistrict || farmInfo.subdistrict,
    farmData.district || farmInfo.district,
    farmData.province || farmInfo.province,
    farmData.postalCode || farmInfo.postalCode,
  ].filter(Boolean);

  return {
    areaType: application.areaType,
    standardCode: application.standardCode,
    areaSize: farmData.totalAreaSize || farmInfo.areaSize,
    areaUnit: farmData.totalAreaUnit || farmInfo.areaUnit,
    plantType: farmInfo.plantType || formData.plantId,
    location: locationParts.join(', '),
    farmName: farmData.farmName || farmInfo.farmName,
  };
}

function normalizeSelectionInfo(formData, application) {
  const selectedServiceType = formData?.serviceType || application?.serviceType || null;
  // Backward-compat: handle both old single purpose and new array
  const selectedPurpose = formData?.purpose || formData?.certificationPurpose || null;
  const selectedPurposes = Array.isArray(formData?.certificationPurposes)
    ? formData.certificationPurposes
    : selectedPurpose ? [selectedPurpose] : [];
  const selectedPlantId = formData?.plantId || formData?.farmInfo?.plantType || null;
  const selectedCultivationMethods = Array.isArray(formData?.cultivationMethods)
    ? formData.cultivationMethods
    : [];

  return {
    plantId: selectedPlantId,
    serviceType: selectedServiceType,
    purpose: selectedPurpose,            // Legacy: single purpose
    purposes: selectedPurposes,          // New: array of purposes
    cultivationMethods: selectedCultivationMethods,
  };
}

function normalizeProductionInfo(formData) {
  const productionData = formData?.productionData || formData?.productionInfo || {};
  const cultivationDetails = formData?.cultivationDetails || {};

  return {
    plantingDate: productionData.plantingDate || cultivationDetails.plantingDate,
    harvestDate:
      productionData.plannedHarvestDate ||
      productionData.harvestDate ||
      cultivationDetails.estimatedHarvestDate,
    estimatedYield:
      toNumberOrUndefined(productionData.estimatedYield) ||
      toNumberOrUndefined(cultivationDetails.estimatedYieldPerCycle),
  };
}

function normalizeDocuments(formData, application) {
  const rawDocuments = Array.isArray(formData?.documents) ? formData.documents : [];
  const attachments = parseJson(application?.attachments, []);
  const attachmentList = Array.isArray(attachments) ? attachments : [];

  const attachmentMap = new Map();
  for (const attachment of attachmentList) {
    if (!attachment || typeof attachment !== 'object') {
      continue;
    }
    const keys = [attachment.type, attachment.id, attachment.name].filter(Boolean);
    for (const key of keys) {
      const normalizedKey = String(key).trim();
      if (!attachmentMap.has(normalizedKey)) {
        attachmentMap.set(normalizedKey, attachment);
      }
    }
  }

  if (rawDocuments.length === 0 && attachmentList.length > 0) {
    return attachmentList.map((attachment, index) => ({
      type: attachment.type || attachment.id || `ATTACHMENT_${index + 1}`,
      name: attachment.name || attachment.type || `Document ${index + 1}`,
      uploaded: true,
      url: attachment.url,
      metadata: null,
    }));
  }

  return rawDocuments.map((doc, index) => {
    const keyCandidates = [doc.type, doc.id, doc.name].filter(Boolean).map((value) => String(value).trim());
    const linkedAttachment = keyCandidates
      .map((key) => attachmentMap.get(key))
      .find(Boolean);

    const url = doc.url || linkedAttachment?.url;
    const uploaded = Boolean(doc.uploaded || doc.url || doc.fileName || linkedAttachment?.url);

    return {
      type: doc.type || doc.id || `DOC_${index + 1}`,
      name: doc.name || doc.label || doc.type || `Document ${index + 1}`,
      uploaded,
      url,
      metadata: doc.metadata || null,
    };
  });
}

function hasRequiredDocuments(documents) {
  if (!Array.isArray(documents) || documents.length === 0) {
    return false;
  }
  const requiredDocs = documents.filter((doc) => doc?.metadata?.required === true);
  if (requiredDocs.length > 0) {
    return requiredDocs.every((doc) => doc.uploaded);
  }
  return documents.some((doc) => doc.uploaded);
}

function summarizeCompletion(formData, documents) {
  const applicantData = formData?.applicantData || {};
  const hasGeneralInfo = Boolean(
    applicantData.fullName ||
    applicantData.firstName ||
    applicantData.communityName ||
    applicantData.companyName,
  );
  const hasFarmInfo = Boolean(
    formData?.farmData?.farmName ||
    formData?.farmData?.address ||
    formData?.farmInfo?.address,
  );
  const hasProductionInfo = Boolean(
    formData?.productionData ||
    formData?.productionInfo ||
    formData?.harvestData,
  );
  const hasDocumentSet = hasRequiredDocuments(documents);

  const checks = [
    { ok: Boolean(formData?.plantId), label: 'Plant information' },
    { ok: hasGeneralInfo, label: 'Applicant information' },
    { ok: hasFarmInfo, label: 'Farm information' },
    { ok: hasProductionInfo, label: 'Production information' },
    { ok: hasDocumentSet, label: 'Supporting documents' },
  ];

  return {
    completedSteps: checks.filter((item) => item.ok).length,
    isComplete: checks.every((item) => item.ok),
    missingFields: checks.filter((item) => !item.ok).map((item) => item.label),
  };
}

function _getMissingFields(formData) {
  const normalizedDocuments = normalizeDocuments(formData, {});
  return summarizeCompletion(formData, normalizedDocuments).missingFields;
}

function _countCompletedSteps(formData) {
  const normalizedDocuments = normalizeDocuments(formData, {});
  return summarizeCompletion(formData, normalizedDocuments).completedSteps;
}

function _isFormComplete(formData) {
  const normalizedDocuments = normalizeDocuments(formData, {});
  return summarizeCompletion(formData, normalizedDocuments).isComplete;
}

function getNestedValue(obj, path) {
  return path.split('.').reduce((acc, part) => acc?.[part], obj);
}

function validateFormData(formData) {
  const normalizedDocuments = normalizeDocuments(formData, {});
  const summary = summarizeCompletion(formData, normalizedDocuments);
  const missingFields = [...summary.missingFields];

  const required = [
    { path: 'farmData.totalAreaSize', fallbackPath: 'farmInfo.areaSize', label: 'Farm area size' },
    { path: 'farmData.address', fallbackPath: 'farmInfo.address', label: 'Farm location' },
    { path: 'productionData.estimatedYield', fallbackPath: 'productionInfo.estimatedYield', label: 'Estimated yield' },
  ];

  for (const field of required) {
    const primaryValue = getNestedValue(formData, field.path);
    const fallbackValue = field.fallbackPath ? getNestedValue(formData, field.fallbackPath) : undefined;
    if (!primaryValue && !fallbackValue && !missingFields.includes(field.label)) {
      missingFields.push(field.label);
    }
  }

  return {
    valid: missingFields.length === 0,
    missingFields,
  };
}

function buildPreviewData(application, formData) {
  const farmSummary = normalizeFarmInfo(formData, application);
  const productionSummary = normalizeProductionInfo(formData);
  const documents = normalizeDocuments(formData, application);
  const fees = feeService.calculateApplicationFees({
    ...(typeof formData === 'object' && formData ? formData : {}),
    // Inert: nothing in modules/billing reads this key off the payload — a
    // stored scope count only takes effect through `options.scopeCount`.
    // Renamed with the column rather than made live, because making it live
    // would change what applicants are charged (L3: an agent flags a money
    // path, it does not mutate one). Open finding: reports/sku/design-event.md.
    cultivationScopeCount: storedCultivationScopeCount(application),
  });

  return {
    generatedAt: new Date().toISOString(),
    applicationType: application.serviceType,
    areaType: application.areaType,
    standard: application.standardCode,

    farmSummary: {
      areaSize: farmSummary.areaSize,
      areaUnit: AREA_UNIT,
      plantType: farmSummary.plantType,
      location: farmSummary.location,
    },

    productionSummary: {
      plantingDate: productionSummary.plantingDate,
      harvestDate: productionSummary.harvestDate,
      estimatedYield: productionSummary.estimatedYield,
    },

    documents: documents.map((doc) => ({
      type: doc.type,
      name: doc.name,
      uploaded: doc.uploaded,
    })),

    fees: {
      // ค่าบริการต่องวด ก่อน VAT — เดิมช่องนี้ตอบยอดส่วนรัฐอย่างเดียว (operator 2026-09-11
      // เลิกแยกส่วน) · ยอดที่ผู้ยื่นจ่ายจริงคือ grandTotal
      phase1: fees.phase1.serviceFeeAmount,
      phase2: fees.phase2.serviceFeeAmount,
      scopeCount: fees.scopeCount,
      total: fees.total,
      serviceFeeTotal: fees.serviceFeeTotal,
      vatTotal: fees.vatTotal,
      grandTotal: fees.grandTotal,
    },
  };
}

module.exports = {
  parseJson,
  buildFullFormSnapshot,
  normalizeFarmInfo,
  normalizeSelectionInfo,
  normalizeProductionInfo,
  normalizeDocuments,
  summarizeCompletion,
  validateFormData,
  buildPreviewData,
};
