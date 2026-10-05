import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog';
import { Input } from '@/components/ui/primitives/input';
import { Select } from '@/components/ui/select';
import { DateInput } from '@/components/ui/date-input';
import { Button } from '@/components/ui/primitives/button';
import type { SchedulerQueueItem } from './calendar-types';
import { ONLINE_MEET_WARNING_TH } from './schedule-evidence';

export interface ScheduleModalProps {
    opened: boolean;
    setOpened: (o: boolean) => void;
    selectedItem: SchedulerQueueItem | null;
    scheduleDate: Date | null;
    setScheduleDate: (d: Date | null) => void;
    scheduleTime: string;
    setScheduleTime: (t: string) => void;
    auditorId: string | null;
    setAuditorId: (id: string | null) => void;
    auditorOptions: { value: string; label: string }[];
    inspectionMode: "ONLINE_MEET" | "ONSITE";
    setInspectionMode: (m: "ONLINE_MEET" | "ONSITE") => void;
    meetingLink: string;
    setMeetingLink: (l: string) => void;
    mapLink: string;
    setMapLink: (l: string) => void;
    location: string;
    setLocation: (l: string) => void;
    notes: string;
    setNotes: (n: string) => void;
    estimatedDuration: number;
    setEstimatedDuration: (d: number) => void;
    submitSchedule: () => void;
    isSubmitting: boolean;
}

export function ScheduleModal({
    opened,
    setOpened,
    selectedItem,
    scheduleDate,
    setScheduleDate,
    scheduleTime,
    setScheduleTime,
    auditorId,
    setAuditorId,
    auditorOptions,
    inspectionMode,
    setInspectionMode,
    meetingLink,
    setMeetingLink,
    mapLink,
    setMapLink,
    location,
    setLocation,
    notes,
    setNotes,
    estimatedDuration,
    setEstimatedDuration,
    submitSchedule,
    isSubmitting,
}: ScheduleModalProps) {
    // W5-C: stable id pairs for WCAG 1.3.1 + 3.3.2 (label-has-associated-control).
    // Each field gets a useId-derived id; matching <label htmlFor> + control id keeps
    // screen-reader label/input pair while preserving custom Tailwind label styling.
    const scheduleDateId = React.useId();
    const scheduleTimeId = React.useId();
    const auditorSelectId = React.useId();
    const inspectionModeId = React.useId();
    const meetingLinkId = React.useId();
    const mapLinkId = React.useId();
    const locationId = React.useId();
    const estimatedDurationId = React.useId();
    const notesId = React.useId();

    return (
        <Dialog open={opened} onOpenChange={(o) => o === false && setOpened(false)}>
            {/* Minimal-redesign pass: the dialog led with a solid deep-green
                banner. It is now a plain header separated by a hairline rule —
                the title alone identifies the dialog. */}
            <DialogContent className="max-w-2xl overflow-hidden p-0">
                <DialogHeader className="border-b border-border p-6">
                    <DialogTitle className="text-lg font-semibold text-foreground">
                        {selectedItem?.scheduledDate ? "เลื่อนนัดหมายการตรวจ" : "กำหนดวันนัดหมายตรวจประเมิน"}
                    </DialogTitle>
                </DialogHeader>

                {selectedItem && (
                    <div className="space-y-6 p-6">
                        <div className="rounded-lg border border-border p-4">
                            <p className="text-[11px] text-muted-foreground">คำขอที่</p>
                            <p className="text-lg font-semibold text-foreground">{selectedItem.applicationNumber}</p>
                            <p className="text-sm font-medium text-muted-foreground">{selectedItem.applicantName}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label htmlFor={scheduleDateId} className="text-sm font-bold text-foreground">วันที่นัดหมาย</label>
                                <DateInput
                                    id={scheduleDateId}
                                    value={scheduleDate}
                                    onChange={setScheduleDate}
                                    minDate={new Date()}
                                    required
                                    // X3-FIX-C H-11: focus first field on open so keyboard users
                                    // do not need to tab past the dialog title. DateInput forwards
                                    // unknown props to the underlying <input>.
                                    // eslint-disable-next-line jsx-a11y/no-autofocus -- reason: modal dialog focus per WAI-ARIA APG (see X2-FIX-A M-13).
                                    autoFocus
                                />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor={scheduleTimeId} className="text-sm font-bold text-foreground">เวลา</label>
                                <Input
                                    id={scheduleTimeId}
                                    type="time"
                                    value={scheduleTime}
                                    onChange={(event) => setScheduleTime(event.currentTarget.value)}
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor={auditorSelectId} className="text-sm font-bold text-foreground">ผู้ตรวจประเมิน</label>
                            <Select
                                id={auditorSelectId}
                                placeholder="เลือกผู้ตรวจ..."
                                value={auditorId}
                                onChange={setAuditorId}
                                data={auditorOptions}
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <label htmlFor={inspectionModeId} className="text-sm font-bold text-foreground">รูปแบบการตรวจ</label>
                            <Select
                                id={inspectionModeId}
                                value={inspectionMode}
                                onChange={(value) => setInspectionMode((value as "ONLINE_MEET" | "ONSITE") || "ONLINE_MEET")}
                                data={[
                                    { value: "ONSITE", label: "ตรวจที่ฟาร์ม" },
                                    { value: "ONLINE_MEET", label: "ตรวจออนไลน์ (ออกใบรับรองไม่ได้)" },
                                ]}
                                required
                            />
                            {inspectionMode === "ONLINE_MEET" && (
                                <p
                                    role="alert"
                                    data-testid="online-meet-warning"
                                    className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm font-semibold text-destructive"
                                >
                                    {ONLINE_MEET_WARNING_TH}
                                </p>
                            )}
                        </div>

                        {inspectionMode === "ONLINE_MEET" ? (
                            <div className="space-y-2">
                                <label htmlFor={meetingLinkId} className="text-sm font-bold text-foreground">ลิงก์การประชุม</label>
                                <Input
                                    id={meetingLinkId}
                                    placeholder="https://meet.google.com/..."
                                    value={meetingLink}
                                    onChange={(event) => setMeetingLink(event.currentTarget.value)}
                                    required
                                />
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label htmlFor={mapLinkId} className="text-sm font-bold text-foreground">ลิงก์แผนที่</label>
                                    <Input
                                        id={mapLinkId}
                                        placeholder="วางลิงก์ Google Maps"
                                        value={mapLink}
                                        onChange={(event) => setMapLink(event.currentTarget.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label htmlFor={locationId} className="text-sm font-bold text-foreground">สถานที่</label>
                                    <Input
                                        id={locationId}
                                        placeholder="ระบุสถานที่"
                                        value={location}
                                        onChange={(event) => setLocation(event.currentTarget.value)}
                                    />
                                </div>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label htmlFor={estimatedDurationId} className="text-sm font-bold text-foreground">ระยะเวลาโดยประมาณ (นาที)</label>
                                <Input
                                    id={estimatedDurationId}
                                    type="number"
                                    value={estimatedDuration}
                                    min={15}
                                    max={600}
                                    step={15}
                                    onChange={(e) => setEstimatedDuration(Number(e.target.value) || 120)}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label htmlFor={notesId} className="text-sm font-bold text-foreground">หมายเหตุ (ถ้ามี)</label>
                            <Input
                                id={notesId}
                                value={notes}
                                onChange={(event) => setNotes(event.currentTarget.value)}
                                placeholder="ระบุหมายเหตุเพิ่มเติม..."
                            />
                        </div>

                        <div className="flex justify-end gap-3 pt-4">
                            <Button variant="ghost" onClick={() => setOpened(false)}>
                                ยกเลิก
                            </Button>
                            <Button
                                className="bg-primary px-8 hover:bg-primary/90"
                                loading={isSubmitting}
                                onClick={submitSchedule}
                            >
                                บันทึกนัดหมาย
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
