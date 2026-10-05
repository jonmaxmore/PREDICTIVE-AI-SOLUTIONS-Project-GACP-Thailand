/**
 * Navigation Configuration SSOT (Single Source of Truth)
 *
 * Unified nav config for all roles: health (farmer) and provider-side roles
 * (auditor, document_reviewer, scheduler, account, admin).
 *
 * Each NavItem includes:
 * - key: unique identifier (used for testing, user preferences)
 * - path: URL path
 * - labelTH: Thai label (primary UI text)
 * - descTH: Thai description (one line, task-oriented)
 * - icon: LucideIcon component
 * - roles: which canonical roles can see this item
 * - tier: 'primary' (always shown in tile grid) | 'secondary' (collapsible/overflow) | 'system' (not in tile grid, used by bottom nav only)
 * - lock?: conditional visibility (e.g., active cert required)
 * - bottomNav?: set to true for items displayed in bottom nav (home, status, payments, certificates, planting only)
 * - shortTH?: short Thai text for bottom nav / tile (max ~4 chars)
 * - chipSource?: source for notification chips ('pendingActions' on status, 'unpaid' on payments)
 */

import {
  Award,
  CreditCard,
  FileText,
  Home,
  Sprout,
  Users,
  HelpCircle,
  ClipboardCheck,
  BarChart3,
  Banknote,
  Settings,
  Inbox,
  CheckCircle2,
  Leaf,
  Building2,
  Map as MapIcon,
  GraduationCap,
  Library,
  ClipboardList,
  FileSpreadsheet,
  Scale,
  Database,
  Image as ImageIcon,
  ShieldCheck,
  CalendarDays,
} from 'lucide-react';
import { CanonicalRole, normalizeRole } from '@/lib/constants/canonical-roles';

export interface NavItem {
  key: string;
  path: string;
  labelTH: string;
  descTH: string;
  icon: typeof Home; // LucideIcon type
  roles: CanonicalRole[];
  tier: 'primary' | 'secondary' | 'system';
  lock?: {
    condition: 'ACTIVE_CERT_REQUIRED';
    reasonTH: string;
  };
  bottomNav?: boolean;
  shortTH?: string;
  chipSource?: 'pendingActions' | 'unpaid';
}

/**
 * FARMER_NAV — health role navigation
 * System tier: home (new tile-home entry point, not rendered in tile grids)
 * Primary items: apply, status, payments, certificates, planting, help
 * Secondary items: workspaces, surveys, herbs
 *
 * bottomNav items (home, status, payments, certificates, planting) wire into
 * the bottom-nav or tile-home component for mobile/desktop access.
 */
export const FARMER_NAV: NavItem[] = [
  {
    key: 'home',
    path: '/health/home',
    labelTH: 'หน้าหลัก',
    descTH: 'ศูนย์กลางการดำเนินการของคุณ',
    icon: Home,
    roles: ['health'],
    tier: 'system',
    bottomNav: true,
    shortTH: 'หน้าหลัก',
  },
  {
    key: 'apply',
    path: '/health/applications/new',
    labelTH: 'สมัครขอใบรับรอง',
    descTH: 'สร้างใบสมัครขอการรับรอง GACP',
    icon: FileText,
    roles: ['health'],
    tier: 'primary',
  },
  {
    key: 'status',
    path: '/health/status',
    labelTH: 'ตรวจสอบสถานะ',
    descTH: 'ตรวจสอบสถานะใบสมัครและการดำเนินการ',
    icon: CheckCircle2,
    roles: ['health'],
    tier: 'primary',
    bottomNav: true,
    shortTH: 'สถานะ',
    chipSource: 'pendingActions',
  },
  {
    key: 'payments',
    path: '/health/payments',
    labelTH: 'ชำระเงิน',
    descTH: 'ดูข้อมูลการชำระเงินและใบเสร็จ',
    icon: CreditCard,
    roles: ['health'],
    tier: 'primary',
    bottomNav: true,
    shortTH: 'ชำระเงิน',
    chipSource: 'unpaid',
  },
  {
    key: 'certificates',
    path: '/health/certificates',
    labelTH: 'ใบรับรองของฉัน',
    descTH: 'ดูและจัดการใบรับรอง GACP ของคุณ',
    icon: Award,
    roles: ['health'],
    tier: 'primary',
    bottomNav: true,
    shortTH: 'ใบรับรอง',
  },
  {
    key: 'planting',
    path: '/health/planting',
    labelTH: 'บันทึกการปลูก',
    descTH: 'บันทึกข้อมูลการปลูกพืชและติดตาม',
    icon: Sprout,
    roles: ['health'],
    tier: 'primary',
    lock: {
      condition: 'ACTIVE_CERT_REQUIRED',
      reasonTH: 'เปิดใช้เมื่อคุณได้รับใบรับรอง GACP',
    },
    bottomNav: true,
    shortTH: 'การปลูก',
  },
  {
    key: 'help',
    path: '/help',
    labelTH: 'ช่วยเหลือ',
    descTH: 'ติดต่อศูนย์บริการและดูคำถามที่พบบ่อย',
    icon: HelpCircle,
    roles: ['health'],
    tier: 'primary',
  },
  {
    key: 'workspaces',
    path: '/health/workspaces',
    // design-cleanup-2026-08-21 U1: "ทีมงาน" alone read as team-management
    // only, so this was the one door to switching/creating an applicant
    // identity (Entity — บุคคลธรรมดา/นิติบุคคล/วิสาหกิจชุมชน) and no farmer
    // looking for "apply as a company" would guess to click it. Key/href/
    // tier stay unchanged (N7 caps primary tiles; promoting tier is the
    // operator's call, not this fix's) — only the label/description change
    // to surface the applicant-identity purpose.
    labelTH: 'ผู้ยื่นคำขอ / ทีมงาน',
    descTH: 'ดูและเพิ่มผู้ยื่นคำขอที่เป็นนิติบุคคลหรือวิสาหกิจชุมชน และจัดการสมาชิกทีม',
    icon: Users,
    roles: ['health'],
    tier: 'secondary',
  },
  {
    key: 'surveys',
    path: '/health/surveys',
    labelTH: 'แบบสำรวจ',
    descTH: 'ตอบแบบสำรวจความต้องการจากศูนย์ระหว่าง 4 ภาค',
    icon: ClipboardCheck,
    roles: ['health'],
    tier: 'secondary',
  },
  {
    key: 'herbs',
    path: '/health/herbs',
    labelTH: 'ความรู้สมุนไพร',
    descTH: 'ศึกษาข้อมูลสมุนไพร 6 ชนิดและคุณสมบัติ',
    icon: Leaf,
    roles: ['health'],
    tier: 'secondary',
  },
  // W3-8 prep (Ruling 3, §3 table row 1) — these 6 tools were only reachable
  // via /health/more (an unlisted hub page). Moving them into FARMER_NAV's
  // secondary tier gives them the same "เมนูเพิ่มเติม" door every other
  // secondary item already has, without touching /health/more itself (its
  // retirement is W3-8, gated on this move landing first — see that page's
  // own header comment). Same icons as /health/more's TOOLS entries.
  {
    key: 'site-analysis',
    path: '/health/site-analysis',
    labelTH: 'การวิเคราะห์พื้นที่',
    descTH: 'บันทึกผลการวิเคราะห์ดิน น้ำ และสภาพแวดล้อมของแปลงปลูก',
    icon: MapIcon,
    roles: ['health'],
    tier: 'secondary',
  },
  {
    key: 'training',
    path: '/health/training',
    labelTH: 'บันทึกการอบรม',
    descTH: 'บันทึกการอบรม GACP ของผู้ปฏิบัติงาน ใช้ประกอบคำขอรับรอง',
    icon: GraduationCap,
    roles: ['health'],
    tier: 'secondary',
  },
  {
    key: 'sop-templates',
    path: '/health/sop-templates',
    labelTH: 'แม่แบบ SOP',
    descTH: 'เลือกแม่แบบ SOP มาตรฐาน เช่น การปลูก การเก็บเกี่ยว การตรวจสอบคุณภาพ',
    icon: Library,
    roles: ['health'],
    tier: 'secondary',
  },
  {
    key: 'sop-builder',
    path: '/health/sop-builder',
    labelTH: 'สร้าง SOP',
    descTH: 'กรอกฟอร์ม SOP รายแปลง บันทึกเป็น PDF เพื่อแนบใบสมัคร',
    icon: ClipboardList,
    roles: ['health'],
    tier: 'secondary',
  },
  {
    key: 'reports',
    path: '/health/reports',
    labelTH: 'รายงาน ภ.ท.27/28',
    descTH: 'ส่งรายงานรายเดือนตามเงื่อนไขใบรับรอง ภ.ท.27, ภ.ท.28, ภ.ท.29-32',
    icon: FileSpreadsheet,
    roles: ['health'],
    tier: 'secondary',
  },
  {
    key: 'documents',
    path: '/health/documents',
    labelTH: 'เอกสารแนบในระบบ',
    descTH: 'ค้นหาและดาวน์โหลดเอกสารที่อัปโหลดเข้าระบบ',
    icon: FileText,
    roles: ['health'],
    tier: 'secondary',
  },
];

/**
 * AUDITOR_NAV — auditor role navigation
 * (dashboards replaced by tile-home; contains only task menus)
 *
 * Task 7 nav-integrity fix (2026-08-20): N7's design brief called for three
 * auditor tiles (งานตรวจแปลง / นัดหมายลงพื้นที่ / ประวัติผลตรวจ), but only
 * `/provider/audits` was ever built — no `/provider/appointments` or
 * `/provider/audit-history` route exists anywhere under src/app (confirmed
 * via the Step 1 integrity probe, which failed RED on both before this fix).
 * Pointing tiles at nonexistent pages recreates the exact dead-link bug this
 * whole redesign exists to kill (spec line 5). The two items are removed
 * here rather than pointed at a placeholder; building the real pages is
 * follow-up work (BACKLOG), not a rename-sweep change.
 */
export const AUDITOR_NAV: NavItem[] = [
  {
    key: 'audits',
    path: '/provider/audits',
    labelTH: 'งานตรวจแปลง',
    descTH: 'ดูรายการแปลงที่ต้องตรวจประเมินและสถานะงาน',
    icon: ClipboardCheck,
    roles: ['field_inspector'],
    tier: 'primary',
    bottomNav: true,
    shortTH: 'ตรวจแปลง',
  },
  // Ruling 3 (§3 table, reports/design-cleanup-2026-08-21/03-OPERATOR-
  // DELEGATED-RULINGS.md) — these pages exist and work but had no nav
  // entry after the tile-home redesign. Reference tools auditors use
  // during a plot audit; secondary tier keeps AUDITOR_NAV's primary tile
  // count at 1 (N7's cap is "no more than", not "exactly").
  {
    key: 'standards',
    path: '/provider/standards',
    labelTH: 'วิเคราะห์มาตรฐาน',
    descTH: 'เปรียบเทียบคำขอรับรองกับมาตรฐาน WHO, อย.ไทย และอาเซียน',
    icon: Scale,
    roles: ['field_inspector', 'document_reviewer'],
    tier: 'secondary',
  },
  {
    key: 'surveys',
    path: '/provider/surveys',
    labelTH: 'แบบสำรวจ',
    descTH: 'สร้างและจัดการแบบสำรวจความต้องการสำหรับเกษตรกร',
    icon: ClipboardCheck,
    roles: ['field_inspector', 'document_reviewer'],
    tier: 'secondary',
  },
  {
    key: 'herbs',
    path: '/provider/herbs',
    labelTH: 'ฐานข้อมูลสมุนไพร',
    descTH: 'ค้นข้อมูลสมุนไพรไทย 6 ฐานข้อมูลอ้างอิงระหว่างตรวจ',
    icon: Leaf,
    roles: ['field_inspector', 'document_reviewer'],
    tier: 'secondary',
  },
  {
    key: 'datasets',
    path: '/provider/datasets',
    labelTH: 'ชุดข้อมูลดิบ',
    descTH: 'ส่งออกชุดข้อมูลดิบสำหรับงานวิเคราะห์',
    icon: Database,
    roles: ['field_inspector', 'document_reviewer'],
    tier: 'secondary',
  },
  // T&T ชั้นพนักงานติดตาม — มติ operator 2026-09-05 (docs/design/
  // 2026-09-05-tnt-loop-and-farmer-updates.md §3.3): รอบการปลูกของฟาร์มทุกแห่ง
  // ทั่วประเทศ ไม่ผูกกับการมอบหมายงาน และไม่มีเรื่องเงินอยู่ในนั้น
  // secondary tier เพราะ N7 จำกัดจำนวนไทล์ primary ของ officer ไว้ และงานประจำวัน
  // ของทั้งสอง role ยังเป็นคิวงานของตัวเอง
  {
    key: 'tracking',
    path: '/provider/tracking',
    labelTH: 'ติดตามการปลูก',
    descTH: 'ดูรอบการปลูก บันทึกกิจกรรม และ QR ประจำแปลง ของฟาร์มทุกแห่งทั่วประเทศ',
    icon: Sprout,
    roles: ['field_inspector', 'document_reviewer'],
    tier: 'secondary',
  },
  {
    key: 'image-assessment',
    path: '/provider/image-assessment',
    labelTH: 'ตรวจสอบภาพประเมิน',
    descTH: 'ประเมินภาพเบื้องต้นประกอบการตรวจแปลง',
    icon: ImageIcon,
    roles: ['field_inspector'],
    tier: 'secondary',
  },
];

/**
 * REVIEWER_NAV — document_reviewer role navigation
 * (dashboards replaced by tile-home; contains only task menus)
 */
export const REVIEWER_NAV: NavItem[] = [
  {
    key: 'review',
    // Task 7 nav-integrity fix: was '/provider/review' (no such route —
    // Step 1 probe failed RED). The reviewer's real launchpad is
    // /provider/reviewer (provider-role-config.ts's 'reviewer' area,
    // also this role's post-login landing).
    path: '/provider/reviewer',
    labelTH: 'ตรวจเอกสาร',
    descTH: 'ตรวจสอบและอนุมัติเอกสารใบสมัครขอการรับรอง',
    icon: FileText,
    roles: ['document_reviewer'],
    tier: 'primary',
    bottomNav: true,
    shortTH: 'ตรวจเอกสาร',
  },
  // Ruling 3 (§3 table) — same 4 reference tools as AUDITOR_NAV (reviewers
  // use them while checking documents); image-assessment stays
  // auditor-only (it's tied to the plot visit, not document review).
  {
    key: 'standards',
    path: '/provider/standards',
    labelTH: 'วิเคราะห์มาตรฐาน',
    descTH: 'เปรียบเทียบคำขอรับรองกับมาตรฐาน WHO, อย.ไทย และอาเซียน',
    icon: Scale,
    roles: ['field_inspector', 'document_reviewer'],
    tier: 'secondary',
  },
  {
    key: 'surveys',
    path: '/provider/surveys',
    labelTH: 'แบบสำรวจ',
    descTH: 'สร้างและจัดการแบบสำรวจความต้องการสำหรับเกษตรกร',
    icon: ClipboardCheck,
    roles: ['field_inspector', 'document_reviewer'],
    tier: 'secondary',
  },
  {
    key: 'herbs',
    path: '/provider/herbs',
    labelTH: 'ฐานข้อมูลสมุนไพร',
    descTH: 'ค้นข้อมูลสมุนไพรไทย 6 ฐานข้อมูลอ้างอิงระหว่างตรวจ',
    icon: Leaf,
    roles: ['field_inspector', 'document_reviewer'],
    tier: 'secondary',
  },
  {
    key: 'datasets',
    path: '/provider/datasets',
    labelTH: 'ชุดข้อมูลดิบ',
    descTH: 'ส่งออกชุดข้อมูลดิบสำหรับงานวิเคราะห์',
    icon: Database,
    roles: ['field_inspector', 'document_reviewer'],
    tier: 'secondary',
  },
  // T&T ชั้นพนักงานติดตาม — มติ operator 2026-09-05 (docs/design/
  // 2026-09-05-tnt-loop-and-farmer-updates.md §3.3): รอบการปลูกของฟาร์มทุกแห่ง
  // ทั่วประเทศ ไม่ผูกกับการมอบหมายงาน และไม่มีเรื่องเงินอยู่ในนั้น
  // secondary tier เพราะ N7 จำกัดจำนวนไทล์ primary ของ officer ไว้ และงานประจำวัน
  // ของทั้งสอง role ยังเป็นคิวงานของตัวเอง
  {
    key: 'tracking',
    path: '/provider/tracking',
    labelTH: 'ติดตามการปลูก',
    descTH: 'ดูรอบการปลูก บันทึกกิจกรรม และ QR ประจำแปลง ของฟาร์มทุกแห่งทั่วประเทศ',
    icon: Sprout,
    roles: ['field_inspector', 'document_reviewer'],
    tier: 'secondary',
  },
];

/**
 * SCHEDULER_NAV — scheduler role navigation
 * (dashboards replaced by tile-home; contains only task menus)
 */
export const SCHEDULER_NAV: NavItem[] = [
  {
    // งานที่จ่ายค่าตรวจเอกสารแล้วและรอมอบหมายผู้ตรวจ อยู่ที่หน้านี้ (queues.readyForReview)
    // เดิมไม่มีเมนูใดพาไปถึง: เมนูของผู้จัดตารางมีรายการเดียวคือคิว "นัดลงพื้นที่" ซึ่งอ่าน
    // /audit/scheduling/queue และแสดงเฉพาะคำขอที่จ่ายค่าตรวจพื้นที่แล้ว ⇒ คำขอที่เพิ่งจ่าย
    // งวดแรกไปนั่งรอในที่ที่ไม่มีใครถูกพาไปเห็น และหน้าจอพนักงานดูเหมือน "เปล่า"
    // (วัดจริง 2026-09-07: ฐานข้อมูล 4 ใบ · ประตูตอบ 4 · หน้าแสดง 4 · เมนูไม่มี)
    key: 'coordinator',
    path: '/provider/coordinator',
    labelTH: 'จ่ายงานตรวจเอกสาร',
    descTH: 'คำขอที่ชำระงวดที่ 1 แล้ว รอมอบหมายผู้ตรวจเอกสาร',
    icon: Inbox,
    roles: ['dispatcher'],
    tier: 'primary',
    bottomNav: true,
    shortTH: 'จ่ายงาน',
  },
  {
    key: 'scheduler-queue',
    path: '/provider/scheduler/queue',
    labelTH: 'จัดคิวแบ่งงาน',
    descTH: 'แบ่งงานตรวจประเมินและจัดตารางการลงพื้นที่',
    icon: Inbox,
    roles: ['dispatcher'],
    tier: 'primary',
    bottomNav: true,
    shortTH: 'จัดคิว',
  },
  {
    // ปฏิทินนัดตรวจ — ที่ผู้จัดตารางเลื่อนนัดที่ตั้งไว้แล้ว (เส้นทางเปิดให้ dispatcher อยู่แล้วใน
    // provider-role-config) · เดิมเข้าได้จากลิงก์ในหน้าอื่นเท่านั้น ไม่มีไทล์ที่หน้าแรก
    key: 'scheduler-calendar',
    path: '/provider/calendar',
    labelTH: 'ปฏิทินนัดตรวจ',
    descTH: 'ดูนัดตรวจทั้งหมด และเลื่อนนัดที่ตั้งไว้แล้ว',
    icon: CalendarDays,
    roles: ['dispatcher'],
    tier: 'primary',
  },
];

/**
 * CERT_APPROVER_NAV — ผู้อนุมัติใบรับรอง (ISO/IEC 17065 §7.6 · F-CERT-SOD 2026-09-10)
 *
 * บทบาทนี้มีงานเดียวและมีหน้าจอเดียว · ถ้าไม่มีบล็อกนี้ getNavForRole จะคืน [] แล้ว
 * ผู้อนุมัติที่ล็อกอินเข้ามาจะเห็นเมนูว่างเปล่า — คิวที่รอเขาอยู่จะไม่มีทางเข้าถึงเลย
 */
export const CERT_APPROVER_NAV: NavItem[] = [
  {
    key: 'certification-decisions',
    path: '/provider/certification-decisions',
    labelTH: 'ตัดสินให้การรับรอง',
    descTH: 'คำขอที่ผ่านการตรวจประเมินแล้ว รอการตัดสินให้การรับรอง',
    icon: ShieldCheck,
    roles: ['certificate_approver'],
    tier: 'primary',
    bottomNav: true,
    shortTH: 'ตัดสิน',
  },
];

/**
 * ACCOUNT_NAV — account roles (account_dtam, account_platform, account) navigation
 * (dashboards replaced by tile-home; contains only task menus)
 */
export const ACCOUNT_NAV: NavItem[] = [
  {
    key: 'transactions',
    // Task 7 nav-integrity fix: was '/provider/transactions' (no such
    // route — Step 1 probe failed RED). N12's full bank-statement-style
    // transaction ledger is future work (Plan 2+); the real existing hub
    // for this role today is the accounting page, which admits both finance
    // roles (provider-role-config.ts's 'accounting' area) and is also where
    // both of them land after login — one view (operator 2026-09-11).
    path: '/provider/accounting',
    labelTH: 'ธุรกรรมการเงิน',
    descTH: 'ตรวจสอบและจัดการธุรกรรมการชำระเงิน',
    icon: Banknote,
    roles: ['finance_officer_platform', 'finance_officer_dtam'],
    tier: 'primary',
    bottomNav: true,
    shortTH: 'ธุรกรรม',
  },
];

/**
 * ADMIN_NAV — admin role navigation
 * (dashboard replaced by tile-home; contains only task menus)
 */
export const ADMIN_NAV: NavItem[] = [
  {
    // งานที่จ่ายค่าตรวจเอกสารแล้วและรอมอบหมายผู้ตรวจ อยู่ที่หน้านี้ (queues.readyForReview)
    // เดิมไม่มีเมนูใดพาไปถึง: เมนูของผู้จัดตารางมีรายการเดียวคือคิว "นัดลงพื้นที่" ซึ่งอ่าน
    // /audit/scheduling/queue และแสดงเฉพาะคำขอที่จ่ายค่าตรวจพื้นที่แล้ว ⇒ คำขอที่เพิ่งจ่าย
    // งวดแรกไปนั่งรอในที่ที่ไม่มีใครถูกพาไปเห็น และหน้าจอพนักงานดูเหมือน "เปล่า"
    // (วัดจริง 2026-09-07: ฐานข้อมูล 4 ใบ · ประตูตอบ 4 · หน้าแสดง 4 · เมนูไม่มี)
    key: 'coordinator',
    path: '/provider/coordinator',
    labelTH: 'จ่ายงานตรวจเอกสาร',
    descTH: 'คำขอที่ชำระงวดที่ 1 แล้ว รอมอบหมายผู้ตรวจเอกสาร',
    icon: Inbox,
    roles: ['system_admin_dtam'],
    tier: 'primary',
    bottomNav: true,
    shortTH: 'จ่ายงาน',
  },
  {
    key: 'users',
    path: '/admin/users',
    labelTH: 'จัดการผู้ใช้',
    descTH: 'สร้าง แก้ไข และยกเลิกบัญชีผู้ใช้ทั้งระบบ',
    icon: Users,
    roles: ['system_admin_dtam'],
    tier: 'primary',
    bottomNav: true,
    shortTH: 'ผู้ใช้',
  },
  {
    key: 'reports',
    // Task 7 nav-integrity fix: was '/admin/reports' (no such route —
    // Step 1 probe failed RED). /admin/dashboard is the real KPI/stats
    // page (คำขอทั้งหมด / ออกใบรับรองแล้ว / อยู่ระหว่างตรวจ / SLA เกินกำหนด)
    // that matches this tile's description exactly.
    path: '/admin/dashboard',
    labelTH: 'รายงาน',
    descTH: 'ดูรายงานการดำเนินการและสถิติระบบ',
    icon: BarChart3,
    roles: ['system_admin_dtam'],
    tier: 'primary',
    bottomNav: true,
    shortTH: 'รายงาน',
  },
  {
    key: 'settings',
    path: '/admin/settings',
    labelTH: 'ตั้งค่าระบบ',
    descTH: 'ตั้งค่าพารามิเตอร์ระบบและการอนุญาต',
    icon: Settings,
    roles: ['system_admin_dtam'],
    tier: 'primary',
    bottomNav: true,
    shortTH: 'ตั้งค่า',
  },
];

/**
 * PLATFORM_ADMIN_NAV — platform_admin role navigation
 *
 * platform_admin is cross-tenant governance, NOT the same entitlement
 * surface as admin: provider-role-config.ts's `admin-area` (PROVIDER_AREAS,
 * around line 65-84) gates platform_admin to ONLY `/admin/organizations`
 * (`{ prefix: '/admin/organizations', roles: [R.ADMIN, R.PLATFORM_ADMIN] }`)
 * — the bare `/admin` prefix right after it is `[R.ADMIN]`-only, and no
 * other PROVIDER_AREAS entry lists R.PLATFORM_ADMIN anywhere. Its own
 * post-login `landing` in that same area also points at
 * `/admin/organizations`. ADMIN_NAV's three tiles (`/admin/users`,
 * `/admin/dashboard`, `/admin/settings`) are therefore all dead ends for
 * platform_admin — reusing ADMIN_NAV for it (as getNavForRole did before
 * this array existed) would render live dead-end tiles on /provider/home.
 * This array's single item points ONLY at the route platform_admin can
 * actually enter.
 */
export const PLATFORM_ADMIN_NAV: NavItem[] = [
  {
    key: 'organizations',
    path: '/admin/organizations',
    labelTH: 'จัดการหน่วยงาน',
    descTH: 'สร้างและจัดการหน่วยงาน/องค์กรทั้งแพลตฟอร์ม',
    icon: Building2,
    roles: ['system_admin_platform'],
    tier: 'primary',
    bottomNav: true,
    shortTH: 'หน่วยงาน',
  },
];

/**
 * getNavForRole — lookup function to get navigation items for a given role
 * Returns the appropriate nav array based on the canonical role.
 * Uses normalizeRole() from canonical-roles.ts to handle aliases and uppercase variants.
 */
export function getNavForRole(role: string | null | undefined): NavItem[] {
  const canonical = normalizeRole(role);

  if (canonical === 'health') {
    return FARMER_NAV;
  }
  if (canonical === 'field_inspector') {
    return AUDITOR_NAV;
  }
  if (canonical === 'document_reviewer') {
    return REVIEWER_NAV;
  }
  if (canonical === 'dispatcher') {
    return SCHEDULER_NAV;
  }
  if (canonical === 'certificate_approver') {
    return CERT_APPROVER_NAV;
  }
  if (canonical === 'finance_officer_platform' || canonical === 'finance_officer_dtam') {
    return ACCOUNT_NAV;
  }
  if (canonical === 'system_admin_dtam') {
    return ADMIN_NAV;
  }
  if (canonical === 'system_admin_platform') {
    return PLATFORM_ADMIN_NAV;
  }

  return [];
}

/**
 * ALL_NAV_ARRAYS — every role's nav array in one place. Used by
 * `findNavLabelForPath` (BackHomeCrumb's auto label, task 1/D1-D2) and by
 * the route-integrity jest test (task 4) that checks every {key, path}
 * across every role resolves to a real page.
 */
export const ALL_NAV_ARRAYS: NavItem[][] = [
  FARMER_NAV,
  AUDITOR_NAV,
  REVIEWER_NAV,
  SCHEDULER_NAV,
  CERT_APPROVER_NAV,
  ACCOUNT_NAV,
  ADMIN_NAV,
  PLATFORM_ADMIN_NAV,
];

/**
 * findNavLabelForPath — look up a nav item's Thai label for a given
 * pathname, used by DashboardLayout to auto-fill BackHomeCrumb's `current`
 * text (task 1, D1/D2) without every page having to pass its own label.
 *
 * Exact match first (covers the vast majority of nav targets, which are
 * top-level pages); falls back to the longest path that is a proper
 * prefix of pathname (covers nested/detail routes under a nav target,
 * e.g. `/health/planting/abc123` under the `/health/planting` tile).
 * Returns undefined when nothing matches — BackHomeCrumb renders fine
 * with no `current` text in that case.
 */
export function findNavLabelForPath(pathname: string): string | undefined {
  const allItems = ALL_NAV_ARRAYS.flat();

  const exact = allItems.find((item) => item.path === pathname);
  if (exact) return exact.labelTH;

  let best: NavItem | undefined;
  for (const item of allItems) {
    if (item.path === '/') continue;
    if (pathname.startsWith(`${item.path}/`)) {
      if (!best || item.path.length > best.path.length) best = item;
    }
  }
  return best?.labelTH;
}
