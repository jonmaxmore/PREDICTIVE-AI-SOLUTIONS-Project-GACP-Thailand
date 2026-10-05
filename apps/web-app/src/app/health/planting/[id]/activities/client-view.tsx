'use client';


import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Table } from '@/components/ui/primitives/table';
import { Icons } from '@/components/ui/icons';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import {
  formatActivityScope,
  formatActivityType,
} from '@/lib/planting-labels';
import { NO_PERMISSION_TOOLTIP_TH } from '@/lib/services/use-entity-permissions';
import {
  WEATHER_SUGGESTIONS,
  METHOD_SUGGESTIONS,
  UNIT_SUGGESTIONS,
  PRODUCT_RELEVANT_TYPES,
  ACTIVITY_TYPE_OPTIONS,
  SCOPE_OPTIONS,
  fromDateInputValue,
  toDateInputValue,
  type ActivityForm,
} from './planting-activities-page-config';
import { usePlantingActivitiesPage } from './use-planting-activities-page';

export default function PlantingActivitiesPage() {
  const params = useParams();
  const router = useRouter();
  const cycleId = String(params?.id || '');

  const {
    loading,
    saving,
    error,
    cycle,
    activities,
    showAdvanced,
    setShowAdvanced,
    uploadedAttachments,
    uploadingAttachment,
    form,
    setForm,
    attachmentInputRef,
    plotOptions,
    uploadAttachment,
    removeAttachment,
    submitActivity,
    canLogSelectedActivity,
    requiredActivityPermission,
  } = usePlantingActivitiesPage(cycleId);
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-lg bg-card p-4 shadow-sm">
          <CardContent className="flex min-h-[220px] flex-col items-center justify-center gap-4 text-center">
            <Spinner size="lg" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">กำลังโหลดกิจกรรมรอบปลูก...</p>
          </CardContent>
        </div>
      </div>
    );
  }

  if (error || !cycle) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
        <Alert variant="error" title="ไม่สามารถแสดงข้อมูลได้">
          {error || 'ไม่พบข้อมูลรอบปลูก'}
        </Alert>
        <div className="mt-4">
          <Button asChild variant="default">
            <Link href="/health/planting">กลับหน้ารอบปลูก</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <div className="space-y-6">
        <div className="rounded-lg bg-card p-4 shadow-sm">
          <CardContent className="flex flex-col gap-4 p-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <Button
                variant="subtle"
                size="sm"
                onClick={() => router.push(`/health/planting/${cycle.id}`)}
                className="h-8 px-2"
              >
                <Icons.ArrowLeft size={14} className="mr-1" />
                กลับหน้ารอบ
              </Button>
              <h1 className="text-xl font-semibold text-foreground">บันทึกกิจกรรมรายวัน</h1>
              <p className="text-sm text-muted-foreground">
                {cycle.cycleName} · เลือกขอบเขตกิจกรรมและบันทึกแบบรวดเร็ว
              </p>
            </div>
            <Badge tone="info">{activities.length} กิจกรรม</Badge>
          </CardContent>
        </div>

        <div className="rounded-lg bg-card p-4 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle>ฟอร์มบันทึกแบบเร็ว (โหมดแปลง)</CardTitle>
            <CardDescription>
              บันทึกที่ระดับแปลงเป็นหลัก หากเป็นเหตุของทั้งรอบปลูกให้เปิดโหมดขั้นสูงเพื่อเปลี่ยนขอบเขต
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Select
                label="เลือกแปลง"
                options={plotOptions}
                value={form.plotId}
                onValueChange={(value) => setForm((prev) => ({ ...prev, plotId: value || '' }))}
                placeholder="เลือกแปลงปลูก"
              />
              <Input
                label="วันที่ทำกิจกรรม"
                type="date"
                value={toDateInputValue(form.activityDate)}
                onChange={(event) => {
                  const nextDate = fromDateInputValue(event.currentTarget.value);
                  setForm((prev) => ({ ...prev, activityDate: nextDate }));
                }}
              />
              <Input
                label="สภาพอากาศ"
                placeholder="เลือกหรือพิมพ์ เช่น แดดจัด"
                list="weather-options"
                value={form.weather}
                onChange={(event) => {
                  // Read BEFORE the updater: React nulls currentTarget when the handler
                  // returns, and a functional updater may run after that (basicStateReducer).
                  const value = event.currentTarget.value;
                  setForm((prev) => ({ ...prev, weather: value }));
                }}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {ACTIVITY_TYPE_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  size="sm"
                  variant={form.activityType === option.value ? 'primary' : 'light'}
                  onClick={() => setForm((prev) => ({ ...prev, activityType: option.value }))}
                >
                  {option.label}
                </Button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Input
                label="วิธีดำเนินการ"
                placeholder="เลือกหรือพิมพ์ เช่น ฉีดพ่น"
                list="method-options"
                value={form.method}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setForm((prev) => ({ ...prev, method: value }));
                }}
              />
              <Input
                label="ปริมาณ"
                type="number"
                min={0}
                value={form.quantity ?? ''}
                onChange={(event) => {
                  const rawValue = event.currentTarget.value;
                  if (!rawValue) {
                    setForm((prev) => ({ ...prev, quantity: undefined }));
                    return;
                  }
                  const parsed = Number(rawValue);
                  setForm((prev) => ({ ...prev, quantity: Number.isFinite(parsed) ? parsed : undefined }));
                }}
              />
              <Input
                label="หน่วย"
                placeholder="เลือกหรือพิมพ์ เช่น ลิตร"
                list="unit-options"
                value={form.unit}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setForm((prev) => ({ ...prev, unit: value }));
                }}
              />
            </div>

            <Input
              label="ผู้ปฏิบัติงาน (ถ้ามี)"
              placeholder="ชื่อคนที่ลงมือทำงานนี้ เช่น นายสมชาย ใจดี"
              value={form.performedBy}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setForm((prev) => ({ ...prev, performedBy: value }));
              }}
            />
            <p className="-mt-2 text-xs text-muted-foreground">
              กรอกเมื่อคนที่ลงมือทำไม่ใช่คนที่กำลังบันทึก — ผู้ตรวจถามถึงคนที่สัมผัสผลผลิตจริง
              ข้อมูลนี้ไม่แสดงบนหน้าตรวจสอบย้อนกลับสาธารณะ
            </p>

            {PRODUCT_RELEVANT_TYPES.has(form.activityType) ? (
              <Input
                label="ชื่อปุ๋ย/สารที่ใช้"
                placeholder="เช่น ปุ๋ยคอกหมัก / น้ำส้มควันไม้"
                value={form.productName}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setForm((prev) => ({ ...prev, productName: value }));
                }}
              />
            ) : null}

            {/* ชุดตัวเลือกของช่องที่เคยกรอกอิสระล้วน — เลือกก็ได้ พิมพ์เองก็ได้ */}
            <datalist id="weather-options">
              {WEATHER_SUGGESTIONS.map((w) => (<option key={w} value={w} />))}
            </datalist>
            <datalist id="method-options">
              {METHOD_SUGGESTIONS.map((m) => (<option key={m} value={m} />))}
            </datalist>
            <datalist id="unit-options">
              {UNIT_SUGGESTIONS.map((u) => (<option key={u} value={u} />))}
            </datalist>

            <Textarea
              label="หมายเหตุ"
              rows={3}
              value={form.note}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setForm((prev) => ({ ...prev, note: value }));
              }}
            />

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Input
                ref={attachmentInputRef}
                label="ไฟล์แนบกิจกรรม"
                type="file"
                accept="image/*,.pdf"
                onChange={(event) => uploadAttachment(event.currentTarget.files?.[0] || null)}
                disabled={uploadingAttachment}
              />
              <div className="rounded-2xl border border-border/60 p-3">
                <p className="text-sm font-semibold text-foreground">ไฟล์แนบที่เลือกแล้ว</p>
                <div className="mt-2 space-y-2">
                  {uploadedAttachments.length === 0 ? (
                    <p className="text-xs text-muted-foreground">ยังไม่มีไฟล์แนบ</p>
                  ) : uploadedAttachments.map((item) => (
                    <div key={item.documentId} className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs text-foreground">{item.fileName}</p>
                      <Button size="sm" variant="subtle" className="h-7 min-h-[44px] px-2 text-red-600 sm:min-h-0" onClick={() => removeAttachment(item.documentId)}>
                        ลบ
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <Button
              size="sm"
              variant="subtle"
              onClick={() => setShowAdvanced((prev) => !prev)}
            >
              {showAdvanced ? 'ซ่อนโหมดขั้นสูง' : 'ดูขั้นสูง (ขอบเขตพิเศษ)'}
            </Button>

            {showAdvanced ? (
              <div className="rounded-2xl border border-border/60 p-4">
                {/* R8 (design note 2026-08-20-planting-tnt-design)
                    retired per-plant tracking permanently, so this block no
                    longer offers a PLANT_UNIT scope, a plant search or a plant
                    picker. The only choice left is whether the activity belongs
                    to one plot or to the whole cycle. */}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <Select
                    label="ขอบเขตขั้นสูง"
                    options={SCOPE_OPTIONS}
                    value={form.scope}
                    onValueChange={(value) => setForm((prev) => ({
                      ...prev,
                      scope: (value as ActivityForm['scope']) || 'PLOT',
                    }))}
                  />
                  <div />
                  <div />
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              {/* Wave C chunk 3 — per-type permission gate: the SELECTED
                  activity type needs ACTIVITY_<TYPE> in workspace context
                  (personal/solo always allowed; BE stays authoritative). */}
              {!canLogSelectedActivity && (
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  {NO_PERMISSION_TOOLTIP_TH} ({requiredActivityPermission})
                </span>
              )}
              <Button variant="default" onClick={() => router.push(`/health/planting/${cycle.id}`)}>
                กลับหน้ารอบ
              </Button>
              <Button
                variant="primary"
                onClick={submitActivity}
                disabled={saving || !canLogSelectedActivity}
                title={!canLogSelectedActivity ? NO_PERMISSION_TOOLTIP_TH : undefined}
              >
                {saving ? (
                  <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/50 border-t-primary-foreground" aria-hidden="true" />
                ) : (
                  <Icons.CheckCircle size={16} className="mr-2" />
                )}
                บันทึกกิจกรรม
              </Button>
            </div>
          </CardContent>
        </div>

        <div className="rounded-lg bg-card p-4 shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <CardTitle>Timeline กิจกรรม</CardTitle>
              <p className="text-sm text-muted-foreground">แสดงล่าสุด {activities.length} รายการ</p>
            </div>
          </CardHeader>
          <CardContent>
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">ยังไม่มีกิจกรรมในรอบนี้</p>
            ) : (
              <Table.ScrollContainer>
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.Head>วันที่</Table.Head>
                      <Table.Head>ประเภท</Table.Head>
                      <Table.Head>ขอบเขต</Table.Head>
                      <Table.Head>แปลง</Table.Head>
                      <Table.Head>รายละเอียด</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {activities.map((activity, index) => (
                      <Table.Row key={activity.id} className={cn(index % 2 === 1 && 'bg-muted/20')}>
                        <Table.Cell>{new Date(activity.activityDate).toLocaleString('th-TH')}</Table.Cell>
                        <Table.Cell>
                          <Badge tone="success">{formatActivityType(activity.activityType)}</Badge>
                        </Table.Cell>
                        <Table.Cell>
                          <Badge tone="neutral">{formatActivityScope(activity.scope)}</Badge>
                        </Table.Cell>
                        {/* Plot is the only scope this column can name now:
                            R8 retired per-plant tracking, so a row is either
                            the whole cycle or one plot. Rows logged before the
                            retirement carry a PLANT_UNIT scope and still show
                            the plot they happened on. */}
                        <Table.Cell>
                          {activity.scope === 'CYCLE' ? 'ทั้งรอบ' : activity.plot?.name || '-'}
                        </Table.Cell>
                        <Table.Cell>
                          <div className="space-y-1">
                            <p className="text-sm text-foreground">{activity.note || '-'}</p>
                            {activity.productName ? (
                              <p className="text-xs text-muted-foreground">สารที่ใช้: {activity.productName}</p>
                            ) : null}
                            {/* ผู้ปฏิบัติงานจริง — ที่เดียวที่เกษตรกรเปิดดูย้อนหลังได้ว่าใครลงมือทำ
                                และที่ที่ผู้ตรวจถามถึง · ถ้าไม่ได้กรอกก็ไม่แสดงอะไร ไม่ใช่ขีด '-'
                                ซึ่งจะอ่านเหมือน "บันทึกไว้ว่าไม่มีคนทำ" */}
                            {activity.performedBy ? (
                              <p className="text-xs text-muted-foreground">ผู้ปฏิบัติงาน: {activity.performedBy}</p>
                            ) : null}
                            {(activity.quantity != null || activity.unit) ? (
                              <p className="text-xs text-muted-foreground">ปริมาณ: {activity.quantity ?? '-'} {activity.unit || ''}</p>
                            ) : null}
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </Table.ScrollContainer>
            )}
          </CardContent>
        </div>
      </div>
    </div>
  );
}

