import { Shield, Users, ClipboardList, Target, BookOpen, FileText } from 'lucide-react';

/* ── Types ── */
export interface SOPSection {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string | undefined }>;
  description: string;
  fields: SOPField[];
}

export interface SOPField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'list';
  placeholder: string;
  required: boolean;
}

export interface SOPFormData {
  [sectionId: string]: {
    [fieldId: string]: string | string[];
  };
}

/**
 * Y1-FIX-B — dict-driven SOP sections + types.
 *
 * The previous module exported flat `SOP_SECTIONS` and `SOP_TYPES`
 * arrays with hard-coded Thai labels. Y1 introduces builder functions
 * that take the relevant dict slice and return localized arrays so
 * EN users see English copy. The icons + structure stay constant.
 */
export interface SOPSectionsDictSlice {
    objectiveTitle: string;
    objectiveDescription: string;
    objectivePurposeLabel: string;
    objectivePurposePlaceholder: string;
    scopeTitle: string;
    scopeDescription: string;
    scopeCoverageLabel: string;
    scopeCoveragePlaceholder: string;
    scopeApplicableLabel: string;
    scopeApplicablePlaceholder: string;
    responsibleTitle: string;
    responsibleDescription: string;
    responsibleOwnerLabel: string;
    responsibleOwnerPlaceholder: string;
    responsibleApproverLabel: string;
    responsibleApproverPlaceholder: string;
    responsibleOperatorsLabel: string;
    responsibleOperatorsPlaceholder: string;
    procedureTitle: string;
    procedureDescription: string;
    procedureStepsLabel: string;
    procedureStepsPlaceholder: string;
    procedureEquipmentLabel: string;
    procedureEquipmentPlaceholder: string;
    procedurePrecautionsLabel: string;
    procedurePrecautionsPlaceholder: string;
    controlPointsTitle: string;
    controlPointsDescription: string;
    controlPointsCriticalLabel: string;
    controlPointsCriticalPlaceholder: string;
    controlPointsCriteriaLabel: string;
    controlPointsCriteriaPlaceholder: string;
    recordsTitle: string;
    recordsDescription: string;
    recordsFormsLabel: string;
    recordsFormsPlaceholder: string;
    recordsRetentionLabel: string;
    recordsRetentionPlaceholder: string;
}

export interface SOPTypesDictSlice {
    planting: string;
    harvest: string;
    drying: string;
    hygiene: string;
    storage: string;
    quality: string;
    record: string;
}

export interface SOPReferenceDictSlice {
    planting: string;
    harvest: string;
    drying: string;
    hygiene: string;
    storage: string;
    quality: string;
    record: string;
}

export function buildSopSections(dict: SOPSectionsDictSlice): SOPSection[] {
    return [
        {
            id: 'objective',
            title: dict.objectiveTitle,
            icon: Target,
            description: dict.objectiveDescription,
            fields: [
                {
                    id: 'purpose',
                    label: dict.objectivePurposeLabel,
                    type: 'textarea',
                    placeholder: dict.objectivePurposePlaceholder,
                    required: true,
                },
            ],
        },
        {
            id: 'scope',
            title: dict.scopeTitle,
            icon: BookOpen,
            description: dict.scopeDescription,
            fields: [
                {
                    id: 'coverage',
                    label: dict.scopeCoverageLabel,
                    type: 'textarea',
                    placeholder: dict.scopeCoveragePlaceholder,
                    required: true,
                },
                {
                    id: 'applicable_to',
                    label: dict.scopeApplicableLabel,
                    type: 'text',
                    placeholder: dict.scopeApplicablePlaceholder,
                    required: true,
                },
            ],
        },
        {
            id: 'responsible',
            title: dict.responsibleTitle,
            icon: Users,
            description: dict.responsibleDescription,
            fields: [
                {
                    id: 'owner',
                    label: dict.responsibleOwnerLabel,
                    type: 'text',
                    placeholder: dict.responsibleOwnerPlaceholder,
                    required: true,
                },
                {
                    id: 'certificate_approver',
                    label: dict.responsibleApproverLabel,
                    type: 'text',
                    placeholder: dict.responsibleApproverPlaceholder,
                    required: false,
                },
                {
                    id: 'operators',
                    label: dict.responsibleOperatorsLabel,
                    type: 'list',
                    placeholder: dict.responsibleOperatorsPlaceholder,
                    required: true,
                },
            ],
        },
        {
            id: 'procedure',
            title: dict.procedureTitle,
            icon: ClipboardList,
            description: dict.procedureDescription,
            fields: [
                {
                    id: 'steps',
                    label: dict.procedureStepsLabel,
                    type: 'list',
                    placeholder: dict.procedureStepsPlaceholder,
                    required: true,
                },
                {
                    id: 'equipment',
                    label: dict.procedureEquipmentLabel,
                    type: 'textarea',
                    placeholder: dict.procedureEquipmentPlaceholder,
                    required: false,
                },
                {
                    id: 'precautions',
                    label: dict.procedurePrecautionsLabel,
                    type: 'textarea',
                    placeholder: dict.procedurePrecautionsPlaceholder,
                    required: false,
                },
            ],
        },
        {
            id: 'control_points',
            title: dict.controlPointsTitle,
            icon: Shield,
            description: dict.controlPointsDescription,
            fields: [
                {
                    id: 'critical_points',
                    label: dict.controlPointsCriticalLabel,
                    type: 'list',
                    placeholder: dict.controlPointsCriticalPlaceholder,
                    required: true,
                },
                {
                    id: 'acceptance_criteria',
                    label: dict.controlPointsCriteriaLabel,
                    type: 'textarea',
                    placeholder: dict.controlPointsCriteriaPlaceholder,
                    required: true,
                },
            ],
        },
        {
            id: 'records',
            title: dict.recordsTitle,
            icon: FileText,
            description: dict.recordsDescription,
            fields: [
                {
                    id: 'forms',
                    label: dict.recordsFormsLabel,
                    type: 'list',
                    placeholder: dict.recordsFormsPlaceholder,
                    required: true,
                },
                {
                    id: 'retention_period',
                    label: dict.recordsRetentionLabel,
                    type: 'text',
                    placeholder: dict.recordsRetentionPlaceholder,
                    required: false,
                },
            ],
        },
    ];
}

export interface SopTypeEntry {
    id: string;
    label: string;
    ref: string;
}

export function buildSopTypes(
    types: SOPTypesDictSlice,
    refs: SOPReferenceDictSlice,
): SopTypeEntry[] {
    return [
        { id: 'planting', label: types.planting, ref: refs.planting },
        { id: 'harvest', label: types.harvest, ref: refs.harvest },
        { id: 'drying', label: types.drying, ref: refs.drying },
        { id: 'hygiene', label: types.hygiene, ref: refs.hygiene },
        { id: 'storage', label: types.storage, ref: refs.storage },
        { id: 'quality', label: types.quality, ref: refs.quality },
        { id: 'record', label: types.record, ref: refs.record },
    ];
}
