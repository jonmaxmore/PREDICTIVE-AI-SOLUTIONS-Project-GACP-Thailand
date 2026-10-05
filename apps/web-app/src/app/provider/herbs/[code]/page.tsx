'use client';

/**
 * จัดการรายการองค์ความรู้รายสมุนไพร — สัญญา C05F680149 ต้นแบบที่ 5.
 * เพิ่มรายการทีละรายการ + นำเข้าจำนวนมาก (bulk import) สำหรับทีมวิจัย SSRU.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus, Upload } from 'lucide-react';

import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { notifications } from '@/lib/notifications';
import { apiClient } from '@/lib/api/api-client';
import ProviderLayout from '../../components/provider-layout';
import { ReferenceDataNotice } from '@/components/feature/reference-data-notice';

interface HerbEntry {
  id: string;
  category: string;
  title: string;
  content: string;
  valueNumber?: number | null;
  unit?: string | null;
  source?: string | null;
}

const CATEGORY_OPTIONS = [
  { value: 'VARIETY', label: 'พันธุ์' },
  { value: 'ACTIVE_COMPOUND', label: 'สารสำคัญ' },
  { value: 'CULTIVATION', label: 'การปลูก' },
  { value: 'HARVEST', label: 'การเก็บเกี่ยว' },
  { value: 'PROCESSING', label: 'การแปรรูป' },
  { value: 'DISEASE', label: 'โรค/ศัตรูพืช' },
  { value: 'LEGAL', label: 'กฎหมาย' },
  { value: 'GENERAL', label: 'ทั่วไป' },
];

const CATEGORY_LABEL = Object.fromEntries(CATEGORY_OPTIONS.map((c) => [c.value, c.label]));
const PAGE_SIZE = 50;

export default function ProviderHerbEntriesPage() {
  const params = useParams<{ code: string }>();
  const code = String(params.code || '').toUpperCase();

  const [entries, setEntries] = useState<HerbEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [herbName, setHerbName] = useState('');

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [category, setCategory] = useState('VARIETY');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [valueNumber, setValueNumber] = useState('');
  const [unit, setUnit] = useState('');
  const [source, setSource] = useState('');
  const [importText, setImportText] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (categoryFilter) {
        query.set('category', categoryFilter);
      }
      const [entriesRes, speciesRes] = await Promise.all([
        apiClient.get<{ total: number; entries: HerbEntry[] }>(`/api/herbs/${code}/entries?${query.toString()}`),
        apiClient.get<{ nameTH: string }>(`/api/herbs/${code}`),
      ]);
      if (entriesRes.success && entriesRes.data?.entries) {
        setEntries(entriesRes.data.entries);
        setTotal(entriesRes.data.total);
      }
      if (speciesRes.success && speciesRes.data?.nameTH) {
        setHerbName(speciesRes.data.nameTH);
      }
    } finally {
      setIsLoading(false);
    }
  }, [code, page, categoryFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  const resetAddForm = () => {
    setCategory('VARIETY');
    setTitle('');
    setContent('');
    setValueNumber('');
    setUnit('');
    setSource('');
  };

  const addEntry = async () => {
    setFormError(null);
    if (!title.trim() || !content.trim()) {
      setFormError('กรอกหัวข้อและเนื้อหา');
      return;
    }
    setIsSaving(true);
    try {
      const res = await apiClient.post(`/api/herbs/${code}/entries`, {
        category,
        title: title.trim(),
        content: content.trim(),
        valueNumber: valueNumber === '' ? undefined : Number(valueNumber),
        unit: unit.trim() || undefined,
        source: source.trim() || undefined,
      });
      if (res.success) {
        notifications.show({ title: 'สำเร็จ', message: 'เพิ่มรายการแล้ว', color: 'green' });
        setIsAddOpen(false);
        resetAddForm();
        void load();
      } else {
        setFormError('เพิ่มไม่สำเร็จ ตรวจสอบข้อมูล');
      }
    } catch {
      setFormError('เพิ่มไม่สำเร็จ ตรวจสอบสิทธิ์ (เฉพาะ ADMIN) และข้อมูล');
    } finally {
      setIsSaving(false);
    }
  };

  // Bulk import: one row per line, pipe-delimited:
  // category | title | content | valueNumber | unit | source
  const runImport = async () => {
    setFormError(null);
    const rows = importText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [cat, ttl, cnt, val, u, src] = line.split('|').map((s) => (s ?? '').trim());
        return {
          category: (cat || '').toUpperCase(),
          title: ttl || '',
          content: cnt || '',
          ...(val ? { valueNumber: Number(val) } : {}),
          ...(u ? { unit: u } : {}),
          ...(src ? { source: src } : {}),
        };
      });

    if (rows.length === 0) {
      setFormError('วางข้อมูลอย่างน้อย 1 บรรทัด');
      return;
    }

    setIsSaving(true);
    try {
      const res = await apiClient.post<{ imported: number; skipped: number }>(`/api/herbs/${code}/entries/import`, { rows });
      if (res.success && res.data) {
        notifications.show({
          title: 'นำเข้าเสร็จ',
          message: `นำเข้า ${res.data.imported} รายการ · ข้าม ${res.data.skipped} รายการ`,
          color: res.data.skipped > 0 ? 'yellow' : 'green',
        });
        setIsImportOpen(false);
        setImportText('');
        setPage(1);
        void load();
      } else {
        setFormError('นำเข้าไม่สำเร็จ');
      }
    } catch {
      setFormError('นำเข้าไม่สำเร็จ ตรวจสอบสิทธิ์ (เฉพาะ ADMIN) และรูปแบบข้อมูล');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ProviderLayout heading title={`ฐานข้อมูลสมุนไพร: ${herbName || code}`} subtitle="Herb Knowledge Entries · THRSP ต้นแบบที่ 5">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link href="/provider/herbs" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            <ArrowLeft className="size-4" /> กลับไปรายการฐานข้อมูลสมุนไพร
          </Link>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setIsImportOpen(true)}>
              <Upload className="mr-1 size-4" /> นำเข้าจำนวนมาก
            </Button>
            <Button onClick={() => setIsAddOpen(true)}>
              <Plus className="mr-1 size-4" /> เพิ่มรายการ
            </Button>
          </div>
        </div>

        <ReferenceDataNotice />

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="w-56">
            {/* Radix Select.Item ห้าม value ว่าง (โยน error กลางคอนโซล) — ใช้
                sentinel 'ALL' แทน แล้ว map กลับเป็น '' (= ไม่กรอง) ใน state */}
            <Select
              placeholder="ทุกหมวด"
              value={categoryFilter || 'ALL'}
              onChange={(value) => {
                setCategoryFilter(value === 'ALL' ? '' : value || '');
                setPage(1);
              }}
              data={[{ value: 'ALL', label: 'ทุกหมวด' }, ...CATEGORY_OPTIONS]}
            />
          </div>
          <span className="text-sm text-muted-foreground">ทั้งหมด {total.toLocaleString()} รายการ</span>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : (
          <>
            {/* Desktop: table (≥ md) */}
            <div className="hidden overflow-x-auto rounded-lg border border-border bg-card md:block">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left">
                    <th className="px-4 py-3 font-medium">หมวด</th>
                    <th className="px-4 py-3 font-medium">หัวข้อ</th>
                    <th className="px-4 py-3 font-medium">เนื้อหา</th>
                    <th className="px-4 py-3 font-medium">ค่า</th>
                    <th className="px-4 py-3 font-medium">แหล่งอ้างอิง</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        ยังไม่มีรายการ เพิ่มทีละรายการ หรือนำเข้าจำนวนมาก
                      </td>
                    </tr>
                  ) : (
                    entries.map((entry) => (
                      <tr key={entry.id}>
                        <td className="px-4 py-3 align-top">
                          <Badge tone="neutral">
                            {CATEGORY_LABEL[entry.category] ?? entry.category}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 align-top font-medium">{entry.title}</td>
                        <td className="px-4 py-3 align-top text-muted-foreground">{entry.content}</td>
                        <td className="px-4 py-3 align-top">
                          {entry.valueNumber != null ? `${entry.valueNumber}${entry.unit ? ` ${entry.unit}` : ''}` : '-'}
                        </td>
                        <td className="px-4 py-3 align-top text-muted-foreground">{entry.source ?? '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile: card stack (< md) — no horizontal scroll */}
            {entries.length === 0 ? (
              <div className="rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground md:hidden">
                ยังไม่มีรายการ เพิ่มทีละรายการ หรือนำเข้าจำนวนมาก
              </div>
            ) : (
              <ul className="space-y-3 md:hidden">
                {entries.map((entry) => (
                  <li key={entry.id} className="rounded-lg border border-border bg-card p-4">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <Badge tone="neutral">
                        {CATEGORY_LABEL[entry.category] ?? entry.category}
                      </Badge>
                      {entry.valueNumber != null ? (
                        <span className="shrink-0 text-sm font-medium">
                          {entry.valueNumber}{entry.unit ? ` ${entry.unit}` : ''}
                        </span>
                      ) : null}
                    </div>
                    <p className="font-medium">{entry.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{entry.content}</p>
                    {entry.source ? (
                      <p className="mt-2 text-xs text-muted-foreground">แหล่งอ้างอิง: {entry.source}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {totalPages > 1 ? (
              <div className="mt-4 flex items-center justify-center gap-3">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  ก่อนหน้า
                </Button>
                <span className="text-sm text-muted-foreground">หน้า {page} / {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  ถัดไป
                </Button>
              </div>
            ) : null}
          </>
        )}

        {/* Add entry dialog */}
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>เพิ่มรายการองค์ความรู้</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Select label="หมวด" value={category} onChange={(v) => setCategory(v || 'VARIETY')} data={CATEGORY_OPTIONS} />
              <label className="block" htmlFor="herb-title">
                <span className="mb-1 block text-sm font-medium">หัวข้อ *</span>
                <input id="herb-title" type="text" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="block" htmlFor="herb-content">
                <span className="mb-1 block text-sm font-medium">เนื้อหา *</span>
                <Textarea id="herb-content" value={content} onChange={(e) => setContent(e.target.value)} rows={3} />
              </label>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block" htmlFor="herb-value">
                  <span className="mb-1 block text-sm font-medium">ค่าตัวเลข (ถ้ามี)</span>
                  <input id="herb-value" type="number" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={valueNumber} onChange={(e) => setValueNumber(e.target.value)} />
                </label>
                <label className="block" htmlFor="herb-unit">
                  <span className="mb-1 block text-sm font-medium">หน่วยนับ</span>
                  <input id="herb-unit" type="text" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="% / มก. / เดือน" />
                </label>
              </div>
              <label className="block" htmlFor="herb-source">
                <span className="mb-1 block text-sm font-medium">แหล่งอ้างอิง</span>
                <input id="herb-source" type="text" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" value={source} onChange={(e) => setSource(e.target.value)} />
              </label>
              {formError ? <Alert variant="error">{formError}</Alert> : null}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsAddOpen(false)}>ยกเลิก</Button>
                <Button onClick={() => void addEntry()} disabled={isSaving}>{isSaving ? 'กำลังบันทึก…' : 'บันทึก'}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Bulk import dialog */}
        <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>นำเข้ารายการจำนวนมาก</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                หนึ่งบรรทัดต่อหนึ่งรายการ คั่นด้วยเครื่องหมาย <code className="rounded bg-muted px-1">|</code> ตามลำดับ:
                <br />
                <code className="text-xs">หมวด | หัวข้อ | เนื้อหา | ค่าตัวเลข | หน่วยนับ | แหล่งอ้างอิง</code>
                <br />
                หมวด = VARIETY / ACTIVE_COMPOUND / CULTIVATION / HARVEST / PROCESSING / DISEASE / LEGAL / GENERAL
                <br />
                รายการที่รูปแบบผิดจะถูกข้าม (ระบบรายงานจำนวนที่นำเข้า/ข้าม)
              </p>
              <Textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={10}
                placeholder={'ACTIVE_COMPOUND|Curcumin|สารเคอร์คูมิน|3.1|%|Thai Herbal Pharmacopoeia\nHARVEST|อายุเก็บเกี่ยว|9-11 เดือน|||'}
              />
              {formError ? <Alert variant="error">{formError}</Alert> : null}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsImportOpen(false)}>ยกเลิก</Button>
                <Button onClick={() => void runImport()} disabled={isSaving}>{isSaving ? 'กำลังนำเข้า…' : 'นำเข้า'}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </ProviderLayout>
  );
}
