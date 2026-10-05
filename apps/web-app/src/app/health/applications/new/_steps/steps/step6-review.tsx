'use client';

/**
 * Step 6 — the one review page, and it reads the SERVER.
 *
 * The page this replaces built the filing out of the wizard's zustand store and its own
 * copy of the document catalogue. When the two disagreed the browser won, and the
 * applicant believed the browser: a filing could look complete on the last screen and be
 * refused at the door, with no way for the person to see why. So this component takes
 * everything as props — the requirements the engine answered, the กทล.1 the server
 * assembled, the fee the server calculated — and derives nothing about the filing itself.
 *
 * The wrapper below it reads exactly one thing from the store, `applicationId`, because a
 * page has to know which filing it is looking at. That is an identifier, not a claim about
 * the filing, and every claim on this screen comes back over the wire.
 *
 * ส่วนที่ ๔ is six separate statements. The server takes ONE boolean and stamps the time
 * itself (services/application-declarations-gate.js), so the only job left here is making
 * sure a person actually saw the six before that boolean is sent.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApplicationFlowStore } from '../hooks/use-application-flow-store';
import { apiClient } from '@/lib/api/api-client';
import { fetchApplicationRequirements } from '@/lib/services/application-requirements';
import { submitAndHandOver } from '@/lib/services/submit-and-hand-over';
import {
    PLATFORM_CONSENT_COPY_TH, grantPlatformConsents, platformConsentDocumentUrl,
    readPlatformConsents, type PlatformConsentCategory,
} from '@/lib/services/platform-consent';
import {
    DECLARATION_ROWS, allDeclarationsTicked, canSubmit, missingItems,
    readKatorlor1Html,
} from './step6-review-state';
import type { RequirementsPayload } from '@/lib/services/application-requirements';

export interface Step6FeeSummary {
    phase1Total: number;
    grandTotal: number;
}

export interface Step6ReviewProps {
    requirements: RequirementsPayload | null;
    /** The form the SERVER assembled. Null when it could not be built — say so, never a blank frame. */
    katorlor1Html: string | null;
    ticked: Record<string, boolean>;
    onTick: (id: string, value: boolean) => void;
    onSubmit: () => void;
    /** ความยินยอมของแพลตฟอร์มที่ยังขาด — undefined ระหว่างอ่าน */
    missingConsents: readonly PlatformConsentCategory[] | undefined;
    /** ให้ไว้แล้ว หรือเพิ่งติ๊กครบ — undefined ระหว่างอ่าน */
    consentsAgreed: boolean | undefined;
    onConsentTick: (category: PlatformConsentCategory, value: boolean) => void;
    consentTicked: Record<string, boolean>;
    submitting: boolean;
    error: string | null;
    /** A resubmit stands on the acceptance the server already recorded. */
    alreadyAccepted: boolean;
    feeSummary: Step6FeeSummary | null;
    /** ผู้ยื่นเลือกลักษณะพื้นที่แล้วหรือยัง — false = ยังคำนวณค่าบริการไม่ได้ */
    scopeDeclared: boolean;
    /**
     * Whether the page knows what state the filing is in.
     *
     * Found by pressing the real door: the preview endpoint refuses an application already
     * in review, so a failed read left the status empty — and an empty status is neither
     * "first submit" nor "resubmit", which made the hand-over rail skip the submit door and
     * route to the payments page anyway. The applicant would have been told they filed when
     * nothing was filed. A page that does not know must not offer the button.
     */
    statusKnown: boolean;
}

const baht = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 0 });

export function Step6Review({
    requirements, katorlor1Html, ticked, onTick, onSubmit,
    missingConsents, consentsAgreed, onConsentTick, consentTicked,
    submitting, error, alreadyAccepted, feeSummary, scopeDeclared, statusKnown,
}: Step6ReviewProps) {
    const missing = missingItems(requirements);
    const ready = statusKnown && canSubmit({ requirements, ticked, alreadyAccepted, consentsAgreed });
    const answered = Boolean(requirements);

    return (
        <div className="space-y-6">
            {/* Dark mode (round 5b view-pack): the dark `--destructive` (0 62% 30%) is a fill
                shade, and as text on the dark card it measured ~1.7:1. A dark red surface with
                light red text, the same shape as the wizard's amber notice. In light mode the
                `text-destructive` text measured ~4.4:1 on its tint (under AA 4.5), so red-700. */}
            {error && (
                <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-red-700 dark:border-red-400/40 dark:bg-red-950/40 dark:text-red-200">
                    {error}
                </p>
            )}

            {/* What is still owed, and where each one is fixed. A refusal that does not say
                where to go is half a refusal — the applicant is told "incomplete" and left
                to guess which of six screens holds the missing paper. */}
            {missing.length > 0 && (
                <section role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 dark:border-red-400/40 dark:bg-red-950/40">
                    <h3 className="text-sm font-semibold text-red-700 dark:text-red-200">ยังยื่นไม่ได้ — ขาดเอกสารที่ต้องแนบ</h3>
                    <ul className="mt-3 space-y-2">
                        {missing.map((item) => (
                            <li key={item.slotId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                <span className="text-foreground">{item.labelTH}</span>
                                <a
                                    href={`/health/applications/new/step/${item.step}`}
                                    className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-muted"
                                >
                                    ไปแก้ที่ขั้น {item.step}
                                </a>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {!statusKnown && (
                <p role="status" className="rounded-xl border border-amber-300/50 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    ระบบยังอ่านสถานะปัจจุบันของคำขอนี้ไม่ได้ จึงยังกดยื่นไม่ได้ —
                    การกดโดยไม่รู้สถานะอาจพาไปหน้าชำระเงินทั้งที่ยังไม่ได้ยื่น กรุณารีเฟรชหน้านี้อีกครั้ง
                </p>
            )}

            {!answered && (
                <p role="status" className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                    กำลังอ่านรายการเอกสารของคำขอนี้จากระบบ — ยังยื่นไม่ได้จนกว่าระบบจะตอบ
                </p>
            )}

            {/* The official form, as the server assembled it. */}
            <section className="rounded-xl border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">แบบคำขอ กทล ๑ ที่ระบบประกอบให้</h3>
                {katorlor1Html
                    ? (
                        <div
                            className="max-h-[28rem] overflow-auto rounded-lg border border-border bg-background p-4 text-sm"
                            // The server owns this document; the browser only places it.
                            dangerouslySetInnerHTML={{ __html: katorlor1Html }}
                        />
                    )
                    : (
                        <p className="text-sm text-muted-foreground">
                            ระบบยังประกอบแบบ กทล ๑ ของคำขอนี้ไม่ได้ · ข้อมูลที่กรอกไว้ไม่ได้หายไป
                            และยังยื่นได้ตามปกติเมื่อเอกสารครบ
                        </p>
                    )}
            </section>

            {!scopeDeclared && (
                <section className="rounded-xl border border-border bg-card p-4 text-sm">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">ค่าบริการ</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                        ยังคำนวณค่าบริการไม่ได้ เพราะค่าบริการคิดตาม
                        <span className="font-medium text-foreground">ลักษณะพื้นที่ปลูก</span>
                        ที่คุณเลือก — กลับไปที่ขั้น
                        <span className="font-medium text-foreground">&nbsp;สถานที่และที่ดิน&nbsp;</span>
                        เพื่อเลือกก่อน แล้วยอดจะขึ้นให้เห็นที่นี่
                    </p>
                </section>
            )}

            {feeSummary && (
                <section className="rounded-xl border border-border bg-card p-4 text-sm">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">ค่าบริการ</h3>
                    <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">งวดที่ 1 (ชำระเมื่อยื่น)</span>
                        <span className="font-medium tabular-nums text-foreground">{baht(feeSummary.phase1Total)} บาท</span>
                    </div>
                    <div className="mt-1 flex justify-between gap-3">
                        <span className="text-muted-foreground">รวมทั้งสองงวด</span>
                        <span className="font-medium tabular-nums text-foreground">{baht(feeSummary.grandTotal)} บาท</span>
                    </div>
                    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                        คิดตามลักษณะพื้นที่ปลูกที่เลือกไว้ · เลือกเพิ่มหรือลด ยอดจะเปลี่ยนตาม
                    </p>
                </section>
            )}

            {/* ส่วนที่ ๔ — six statements, six boxes. */}
            <section className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-sm font-semibold text-foreground">คำรับรองและการยินยอม (ส่วนที่ ๔)</h3>
                {alreadyAccepted
                    ? (
                        <p className="mt-2 text-sm text-muted-foreground">
                            คำขอนี้ได้ให้คำรับรองไว้แล้วเมื่อยื่นครั้งแรก การแก้ไขและส่งกลับใช้คำรับรองเดิม
                        </p>
                    )
                    : (
                        <ul className="mt-3 space-y-3">
                            {DECLARATION_ROWS.map((row) => (
                                <li key={row.id} className="flex gap-3">
                                    <input
                                        id={`decl-${row.id}`}
                                        type="checkbox"
                                        className="mt-1 h-4 w-4 shrink-0"
                                        checked={ticked[row.id] === true}
                                        onChange={(e) => onTick(row.id, e.target.checked)}
                                    />
                                    <label htmlFor={`decl-${row.id}`} className="text-sm leading-relaxed text-foreground">
                                        {row.ordinal ? <span className="font-semibold">({row.ordinal}) </span> : null}
                                        {row.text}
                                    </label>
                                </li>
                            ))}
                        </ul>
                    )}
            </section>

            {/* ความยินยอมของแพลตฟอร์ม — คนละอย่างกับคำรับรอง ส่วนที่ ๔ ด้านบน
                ด้านบนคือคำรับรองต่อกรมฯ เกี่ยวกับตัวคำขอ · ส่วนนี้คือฐานทางกฎหมายของ
                แพลตฟอร์มในการประมวลผลข้อมูลส่วนบุคคล และประตูยื่นบังคับให้มีบันทึกไว้จริง
                (403 CONSENT_REQUIRED) · แยกสองใบเพราะหลังบ้านบันทึกคนละหมวด และ PDPA
                ต้องการความยินยอมที่เฉพาะเจาะจง */}
            {missingConsents === undefined ? (
                <section className="rounded-2xl border border-border bg-card p-5">
                    <p role="status" className="text-sm text-muted-foreground">
                        กำลังตรวจสอบสถานะความยินยอม
                    </p>
                </section>
            ) : missingConsents.length > 0 ? (
                <section className="rounded-2xl border border-border bg-card p-5">
                    <h3 className="text-base font-bold text-foreground">ข้อตกลงและความยินยอมของระบบ</h3>
                    <ul className="mt-3 space-y-3">
                        {missingConsents.map((category) => (
                            <li key={category} className="flex gap-3">
                                <input
                                    id={`consent-${category}`}
                                    type="checkbox"
                                    className="mt-1 h-4 w-4 shrink-0"
                                    checked={consentTicked[category] === true}
                                    onChange={(e) => onConsentTick(category, e.target.checked)}
                                />
                                <label htmlFor={`consent-${category}`} className="text-sm leading-relaxed text-foreground">
                                    {PLATFORM_CONSENT_COPY_TH[category]}{' '}
                                    <a
                                        href={platformConsentDocumentUrl(category)}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="font-semibold text-primary underline"
                                    >
                                        อ่านฉบับเต็ม
                                    </a>
                                </label>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}

            <button
                type="button"
                data-testid="step6-submit"
                onClick={onSubmit}
                {...(ready && !submitting ? {} : { disabled: true })}
                className={`w-full rounded-xl px-4 py-3 text-sm font-semibold text-white ${
                    ready && !submitting ? 'bg-leaf-600 hover:bg-leaf-700' : 'bg-leaf-300'
                }`}
            >
                {submitting ? 'กำลังยื่นคำขอ…' : 'ยื่นคำขอ'}
            </button>
        </div>
    );
}

/**
 * The wrapper: fetches the three server answers and owns the page's state.
 *
 * Deliberately three separate reads rather than one fattened preview payload — the doors
 * already exist with the same auth (`/applications/:id/requirements` and
 * `/applications/:id/katorlor1`), and growing the preview door to duplicate them would
 * have created a second place where the same answer is computed.
 */
export function Step6ReviewStep() {
    const router = useRouter();
    const { state } = useApplicationFlowStore();
    const appId = state.applicationId ?? '';

    const [requirements, setRequirements] = useState<RequirementsPayload | null>(null);
    const [katorlor1Html, setKatorlor1Html] = useState<string | null>(null);
    const [ticked, setTicked] = useState<Record<string, boolean>>({});
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [alreadyAccepted, setAlreadyAccepted] = useState(false);
    const [feeSummary, setFeeSummary] = useState<Step6FeeSummary | null>(null);
    const [scopeDeclared, setScopeDeclared] = useState(true);
    // undefined = ยังอ่านไม่เสร็จ · [] = ให้ครบแล้ว · มีสมาชิก = ยังขาดใบนั้น
    const [missingConsents, setMissingConsents] = useState<PlatformConsentCategory[] | undefined>(undefined);
    const [consentTicked, setConsentTicked] = useState<Record<string, boolean>>({});

    const load = useCallback(async () => {
        if (!appId) { return; }
        try {
            setRequirements(await fetchApplicationRequirements(appId));
            setError(null);
        } catch (err) {
            // Never fall back to an empty payload: an empty slot list on THIS screen reads
            // as "nothing is missing", which is the one thing a failed read must not say.
            setRequirements(null);
            setError(err instanceof Error ? err.message : 'ระบบอ่านรายการเอกสารของคำขอนี้ไม่สำเร็จ');
        }

        setMissingConsents(await readPlatformConsents());

        const form = await apiClient.get<{ html?: string }>(`/applications/${appId}/katorlor1`);
        setKatorlor1Html(readKatorlor1Html(form));

        const preview = await apiClient.get<{ preview?: Record<string, unknown> }>(
            `/preview/applications/${appId}/preview`,
        );
        if (preview.success && preview.data?.preview) {
            const p = preview.data.preview as {
                status?: string;
                formData?: { declarationsAcceptedAt?: string };
                payment?: {
                    scopeDeclared?: boolean;
                    breakdown?: { phase1?: { phaseTotal?: number }; totals?: { grandTotal?: number } };
                };
            };
            setStatus(String(p.status ?? '').toUpperCase());
            setAlreadyAccepted(Boolean(p.formData?.declarationsAcceptedAt));
            const phase1Total = p.payment?.breakdown?.phase1?.phaseTotal;
            const grandTotal = p.payment?.breakdown?.totals?.grandTotal;
            // ราคาที่ยังไม่จริง แย่กว่าไม่มีราคา
            //
            // ค่าธรรมเนียมคิดจาก "ลักษณะพื้นที่" ที่ผู้ยื่นเลือกในขั้นที่ 3 · ร่างที่ยังไม่เลือก
            // ทำให้เซิร์ฟเวอร์คิดให้ 1 รูปแบบไปก่อน แล้วหน้านี้เคยพิมพ์ตัวเลขนั้นออกไป
            // เหมือนเป็นราคาจริง — ผู้ยื่นตกใจตอนยอดขึ้นเป็นสามเท่าที่ขั้นยื่นจริง
            // (operator 2026-09-10) · เซิร์ฟเวอร์บอกมาแล้วว่าเลือกหรือยัง ผ่าน scopeDeclared
            setScopeDeclared(p.payment?.scopeDeclared !== false);
            // Only a fee the server actually calculated. A zero invented here would be
            // printed to an applicant as the price of their filing.
            if (typeof phase1Total === 'number' && typeof grandTotal === 'number'
                && p.payment?.scopeDeclared !== false) {
                setFeeSummary({ phase1Total, grandTotal });
            }
        }
    }, [appId]);

    useEffect(() => { void load(); }, [load]);

    // null means the read failed or has not happened — not "some other status".
    const statusKnown = status !== null;
    const isResubmit = status === 'REVISION_REQUESTED' || status === 'CAR_PENDING';
    const isInitialSubmit = status === 'REGISTERED' || status === 'DRAFT';

    /** ติ๊กครบทุกใบที่ยังขาด — ถ้าไม่ขาดเลย ข้อนี้เป็นจริงโดยปริยาย */
    const consentsAgreed = useMemo(
        () => missingConsents !== undefined && missingConsents.every((c) => consentTicked[c] === true),
        [missingConsents, consentTicked],
    );

    const ready = useMemo(
        () => statusKnown && canSubmit({ requirements, ticked, alreadyAccepted, consentsAgreed }),
        [statusKnown, requirements, ticked, alreadyAccepted, consentsAgreed],
    );

    const handleSubmit = useCallback(async () => {
        if (!appId || !ready) { return; }
        setSubmitting(true);
        setError(null);
        try {
            // บันทึกความยินยอมก่อน แล้วค่อยยื่น · ประตูยื่นอ่านจากบันทึกนี้ ไม่ได้อ่านจากติ๊กบนจอ
            if (missingConsents && missingConsents.length > 0) {
                const failed = await grantPlatformConsents(missingConsents);
                if (failed.length > 0) {
                    setError('ระบบบันทึกความยินยอมไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
                    return;
                }
                setMissingConsents([]);
            }

            const outcome = await submitAndHandOver({
                applicationId: appId,
                isInitialSubmit,
                isResubmit,
                // Say "accepted" only when this person just ticked all six. A resubmit
                // stands on the stamp the server already wrote.
                ...(allDeclarationsTicked(ticked) ? { declarationsAccepted: true } : {}),
            });
            if (outcome.kind === 'REFUSED') { setError(outcome.message); return; }
            if (outcome.kind === 'REFUSED_BUT_FILED') { setError(outcome.message); router.push(outcome.href); return; }
            router.push(outcome.href);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการยื่นคำขอ');
        } finally {
            setSubmitting(false);
        }
    }, [appId, ready, isInitialSubmit, isResubmit, ticked, missingConsents, router]);

    return (
        <Step6Review
            requirements={requirements}
            katorlor1Html={katorlor1Html}
            ticked={ticked}
            onTick={(id, value) => setTicked((prev) => ({ ...prev, [id]: value }))}
            onSubmit={() => { void handleSubmit(); }}
            missingConsents={missingConsents}
            consentsAgreed={consentsAgreed}
            consentTicked={consentTicked}
            onConsentTick={(category, value) => setConsentTicked((prev) => ({ ...prev, [category]: value }))}
            submitting={submitting}
            error={error}
            alreadyAccepted={alreadyAccepted}
            feeSummary={feeSummary}
            scopeDeclared={scopeDeclared}
            statusKnown={statusKnown}
        />
    );
}
