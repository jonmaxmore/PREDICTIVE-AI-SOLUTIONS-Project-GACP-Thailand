'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Save, ChevronDown, ChevronUp, Plus, Trash2,
  FileText, CheckCircle, AlertCircle, ArrowLeft, Download,
} from 'lucide-react';

import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { FeatureGate } from '@/components/feature/feature-gate';
import { apiClient as api } from '@/lib/api/api-client';
import { toast } from 'sonner';
import { useLanguage } from '@/lib/i18n/language-context';

import { buildSopSections, buildSopTypes, type SOPFormData } from './sop-config';

function SOPBuilderContent() {
  const searchParams = useSearchParams();
  const editId = searchParams.get('id');
  // W5-C: label/select association.
  const sopTypeId = useId();
  const { dict } = useLanguage();
  const sopCopy = dict.health.sop;

  // Y1-FIX-B — sections + types are now built from the dict.
  const SOP_SECTIONS = useMemo(() => buildSopSections(sopCopy.sections), [sopCopy.sections]);
  const SOP_TYPES = useMemo(() => buildSopTypes(sopCopy.types, sopCopy.referenceLabels), [sopCopy.types, sopCopy.referenceLabels]);

  const [sopType, setSopType] = useState('planting');
  const [formData, setFormData] = useState<SOPFormData>({});
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['objective'])
  );
  const [saving, setSaving] = useState(false);
  const [docId, setDocId] = useState<string | null>(editId);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Load existing draft if editing
  useEffect(() => {
    if (editId) {
      api.get<{ sopType: string; formData: SOPFormData }>(`/api/sop-documents/${editId}`).then((res) => {
        // apiClient unwraps one envelope level; backend returns single-level
        // `{ data: doc }` (sop-documents.js:53) — so `res.data` IS the doc.
        const doc = res.data;
        if (doc) {
          setSopType(doc.sopType);
          setFormData(doc.formData as SOPFormData);
        }
      }).catch(() => { /* ignore - new document */ });
    }
  }, [editId]);

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const updateField = (sectionId: string, fieldId: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [sectionId]: { ...prev[sectionId], [fieldId]: value },
    }));
  };

  const addListItem = (sectionId: string, fieldId: string) => {
    setFormData((prev) => {
      const section = prev[sectionId] || {};
      const list = (section[fieldId] as string[] | undefined) || [];
      return {
        ...prev,
        [sectionId]: { ...section, [fieldId]: [...list, ''] },
      };
    });
  };

  const updateListItem = (sectionId: string, fieldId: string, index: number, value: string) => {
    setFormData((prev) => {
      const section = prev[sectionId] || {};
      const list = [...((section[fieldId] as string[] | undefined) || [])];
      list[index] = value;
      return {
        ...prev,
        [sectionId]: { ...section, [fieldId]: list },
      };
    });
  };

  const removeListItem = (sectionId: string, fieldId: string, index: number) => {
    setFormData((prev) => {
      const section = prev[sectionId] || {};
      const list = [...((section[fieldId] as string[] | undefined) || [])];
      list.splice(index, 1);
      return {
        ...prev,
        [sectionId]: { ...section, [fieldId]: list },
      };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const selectedSop = SOP_TYPES.find((t) => t.id === sopType);
      const title = selectedSop?.label || 'SOP';

      if (docId) {
        // Update existing draft
        await api.put(`/api/sop-documents/${docId}`, { title, formData });
      } else {
        // Create new draft
        const res = await api.post<{ id: string }>('/api/sop-documents', { sopType, title, formData });
        // apiClient unwraps one envelope level; backend returns single-level
        // `{ data: doc }` (sop-documents.js:74) — so `res.data` IS the doc.
        const newId = res.data?.id;
        if (newId) setDocId(newId);
      }
      setSaveMessage(sopCopy.savedMessage);
      setTimeout(() => setSaveMessage(null), 3000);
    } catch {
      setSaveMessage(sopCopy.errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const completedSections = SOP_SECTIONS.filter((section) => {
    const sectionData = formData[section.id] || {};
    return section.fields
      .filter((f) => f.required)
      .every((f) => {
        const val = sectionData[f.id];
        if (Array.isArray(val)) return val.length > 0 && val.some((v) => v.trim());
        return typeof val === 'string' && val.trim().length > 0;
      });
  });

  const selectedSopType = SOP_TYPES.find((t) => t.id === sopType);

  return (
    <div className="animate-fade-in w-full space-y-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="h-8 w-8 rounded-full p-0">
              <Link href="/health/sop-templates">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <h1 className="text-base font-bold text-foreground sm:text-lg md:text-xl">
              {sopCopy.pageTitle}
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {sopCopy.pageSubtitle}
          </p>
        </div>
        <Badge className="rounded-full border-none bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">
          {sopCopy.betaBadge}
        </Badge>
      </div>

      {/* SOP Type Selector */}
      <div className="rounded-xl border border-border bg-card p-3 transition-shadow duration-200 hover:shadow-md sm:p-4">
        <label htmlFor={sopTypeId} className="text-xs font-bold text-muted-foreground">{sopCopy.typeLabel}</label>
        <select
          id={sopTypeId}
          value={sopType}
          title={sopCopy.typeLabel}
          aria-label={sopCopy.typeLabel}
          onChange={(e) => setSopType(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground"
        >
          {SOP_TYPES.map((type) => (
            <option key={type.id} value={type.id}>
              {type.label}
            </option>
          ))}
        </select>
        {selectedSopType && (
          <p className="mt-1 text-[10px] font-medium text-primary">
            {sopCopy.referenceLabel} {selectedSopType.ref}
          </p>
        )}
      </div>

      {/* Progress */}
      <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-foreground">{sopCopy.progressLabel}</span>
          <span className="text-sm font-bold text-primary">
            {sopCopy.progressUnit.replace('{done}', String(completedSections.length)).replace('{total}', String(SOP_SECTIONS.length))}
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={{ width: 0 }}
            animate={{
              width: `${(completedSections.length / SOP_SECTIONS.length) * 100}%`,
            }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-3">
        {SOP_SECTIONS.map((section, sIdx) => {
          const isExpanded = expandedSections.has(section.id);
          const isComplete = completedSections.includes(section);
          const Icon = section.icon;

          return (
            <motion.div
              key={section.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: sIdx * 0.04 }}
              className={`rounded-xl border ${
                isComplete ? 'border-leaf-300' : 'border-border'
              } bg-card`}
            >
              {/* Section header */}
              <button
                onClick={() => toggleSection(section.id)}
                className="flex w-full items-center gap-3 p-4 text-left"
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                    isComplete ? 'bg-leaf-soft text-leaf-onSoft' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {isComplete ? <CheckCircle className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-foreground">{section.title}</p>
                  <p className="text-xs text-muted-foreground">{section.description}</p>
                </div>
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>

              {/* Section content */}
              {isExpanded && (
                <div className="space-y-4 border-t border-border px-4 pb-4 pt-3">
                  {section.fields.map((field) => (
                    <div key={field.id}>
                      <label className="mb-1 flex items-center gap-1 text-xs font-bold text-foreground">
                        {field.label}
                        {field.required && (
                          <span className="text-red-500">*</span>
                        )}
                      </label>

                      {field.type === 'text' && (
                        <input
                          type="text"
                          title={field.label}
                          aria-label={field.label}
                          value={
                            (formData[section.id]?.[field.id] as string) || ''
                          }
                          onChange={(e) =>
                            updateField(section.id, field.id, e.target.value)
                          }
                          placeholder={field.placeholder}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50"
                        />
                      )}

                      {field.type === 'textarea' && (
                        <textarea
                          title={field.label}
                          aria-label={field.label}
                          value={
                            (formData[section.id]?.[field.id] as string) || ''
                          }
                          onChange={(e) =>
                            updateField(section.id, field.id, e.target.value)
                          }
                          placeholder={field.placeholder}
                          rows={3}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50"
                        />
                      )}

                      {field.type === 'list' && (
                        <div className="space-y-2">
                          {(
                            (formData[section.id]?.[field.id] as string[]) || []
                          ).map((item, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                                {idx + 1}
                              </span>
                              <input
                                type="text"
                                title={field.label}
                                aria-label={field.label}
                                placeholder={field.placeholder}
                                value={item}
                                onChange={(e) =>
                                  updateListItem(
                                    section.id,
                                    field.id,
                                    idx,
                                    e.target.value
                                  )
                                }
                                className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
                              />
                              <button
                                title={sopCopy.list.delete}
                                aria-label={sopCopy.list.delete}
                                onClick={() =>
                                  removeListItem(section.id, field.id, idx)
                                }
                                className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-red-500"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={() => addListItem(section.id, field.id)}
                            className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary"
                          >
                            <Plus className="h-3 w-3" />
                            {field.placeholder}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Save message */}
      {saveMessage && (
        <div className={`rounded-lg px-4 py-2 text-sm ${saveMessage === sopCopy.errorMessage ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-leaf-soft text-leaf-onSoft dark:bg-primary-900 dark:text-primary-300'}`}>
          {saveMessage}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          onClick={handleSave}
          disabled={saving}
          variant="outline"
          className="flex-1 gap-2 rounded-full"
        >
          {saving ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {sopCopy.saveCta}
        </Button>
        <Button
          disabled={completedSections.length < SOP_SECTIONS.length}
          className="flex-1 gap-2 rounded-full"
          onClick={() => {
            toast.info(sopCopy.pdfPlaceholder);
          }}
        >
          <Download className="h-4 w-4" />
          {sopCopy.pdfCta}
        </Button>
      </div>

      {/* Info */}
      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
        <div className="text-xs text-blue-700">
          <p className="font-bold">{sopCopy.infoTitle}</p>
          <p className="mt-1">
            {sopCopy.infoBody1}
          </p>
          <p className="mt-1">
            {sopCopy.infoBody2}
            <Link href="/health/sop-templates" className="ml-1 font-bold underline">
              {sopCopy.infoBody2Link}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function SOPBuilderPage() {
  return (
    <FeatureGate
      flag="feature.sop_library"
      fallback={<SOPBuilderGate />}
    >
      <SOPBuilderContent />
    </FeatureGate>
  );
}

function SOPBuilderGate() {
  const { dict } = useLanguage();
  const sopCopy = dict.health.sop;
  return (
    <div className="animate-fade-in mx-auto max-w-lg space-y-6 py-16 text-center">
      <FileText className="mx-auto h-12 w-12 text-muted-foreground/30" />
      <div>
        <h1 className="text-lg font-bold text-foreground">{sopCopy.gateTitle}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {sopCopy.gateBody}
        </p>
      </div>
      <Button asChild variant="outline" className="rounded-full">
        <Link href="/health/sop-templates">
          {sopCopy.gateCta}
        </Link>
      </Button>
    </div>
  );
}
