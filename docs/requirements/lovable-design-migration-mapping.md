# Lovable Design Migration Mapping

Date: 2026-03-04
Updated: 2026-03-07

## Objective

Clone the visual language from the `easy-gov-track` prototype (Lovable) into this production repository while keeping all existing business logic, API contracts, and RBAC behavior in place.

> [!NOTE]
> The original `easy-gov-track-ref` reference folder has been archived. All design tokens, patterns, and techniques are documented here. The Lovable preview remains at: `https://preview--easy-gov-track.lovable.app/`

## Design Origin

- **Prototype Tool**: Lovable (AI-generated Vite + React SPA)
- **Tech Stack (Reference)**: Vite, React Router, Framer Motion, Tailwind CSS, Lucide icons, shadcn/ui
- **Tech Stack (Production)**: Next.js 15, Tailwind CSS, Prompt font, shadcn/ui
- **Design Language**: Government Green + Gold Accent — mobile-first card layout

## Design Tokens (Cloned 1:1)

```css
/* Both reference and production share identical CSS tokens */
:root {
  --primary:    153 100% 20%;  /* Government Green */
  --secondary:  43 45% 55%;    /* Gold Accent */
  --background: 40 20% 98%;    /* Warm off-white */
  --card:       0 0% 100%;     /* Pure white cards */
  --border:     140 15% 88%;   /* Soft green border */
  --success:    153 60% 40%;   /* Approved state */
  --warning:    38 92% 50%;    /* Pending state */
  --destructive: 0 72% 51%;   /* Error/rejected */
  --radius:     0.75rem;       /* Default corner radius */
}
```

### Gradients

- `.gov-gradient`: `linear-gradient(135deg, hsl(153 100% 20%), hsl(153 60% 28%))` — Header bars
- `.gold-gradient`: `linear-gradient(135deg, hsl(43 45% 55%), hsl(38 55% 62%))` — Accent panels

## Design Techniques

### 1. Mobile-First Bottom Navigation

- 4 tabs: หน้าหลัก | ยื่นเอกสาร | Trace | โปรไฟล์
- Fixed bottom, `z-40`, border-top separator
- Active state: primary green color + icon highlight
- Desktop: hidden (replaced by top nav in `gov-gradient` bar)

### 2. Framer Motion Page Transitions

```tsx
<motion.div
  key={location.pathname}
  initial={{ opacity: 0, y: 6 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.25 }}
/>
```

### 3. Mobile Overlay Navigation

- AnimatePresence + motion.div slide-down
- Positioned below header, covers content
- Auto-closes on link click

### 4. Dashboard Stats Cards (2×2 Grid)

- คำขอทั้งหมด (Primary green bg)
- รอตรวจสอบ (Amber accent)
- อนุมัติแล้ว (Soft green)
- ร่าง (Light gray)

### 5. Quick Action Cards (2×2 Grid with Icons)

- Lucide icons in colored circle badges
- Subtitle descriptions
- Rounded `xl` corners

### 6. Provider Dashboard (Dark Sidebar Layout)

- Dark green sidebar (`--sidebar-background: 153 40% 12%`)
- Gold accent active state
- Status cards: ตรวจวันนี้, SLA เกินกำหนด, รอตอบกลับ, คิวทั้งหมด
- Application queue with "เร่งด่วน" (urgent) red badges

## Source → Target Route Mapping

| Lovable route | Target route in this project | Status |
|---|---|---|
| `/login` | `/auth/health/login` | ✅ mapped |
| `/register` | `/register` | ✅ mapped |
| `/forgot-password` | — | ⛔ ถอดออก 2026-09-16: ไม่มีระบบลืมรหัสผ่านทางอีเมลหรือ SMS · 2026-09-17: ไม่มีการกู้บัญชีไม่ว่าช่องทางใด |
| `/dashboard` | `/health/dashboard` | ✅ mapped |
| `/submit` | `/health/applications` + `/health/applications/new` | ✅ mapped |
| `/planting` | `/health/planting` | ✅ mapped |
| `/certificates` | `/health/certificates` | ✅ mapped |
| `/track` | `/health/tracking` | ✅ mapped |
| `/profile` | `/health/profile` | ✅ mapped |
| `/application/:id` | `/health/applications/:id` | ✅ mapped |
| `/payment/:id` | `/health/applications/payment` | ✅ mapped |
| `/provider/login` | `/auth/provider/login` | ✅ mapped |
| `/provider/dashboard` | `/provider/dashboard` | ✅ mapped |
| `/provider/applications` | `/provider/applications` | ✅ mapped |
| `/provider/audits` | `/provider/audits` | ✅ mapped |
| `/provider/calendar` | `/provider/calendar` | ✅ mapped |
| `/provider/accounting` | `/provider/accounting` | ✅ mapped |
| `/provider/analytics` | `/provider/analytics` | ✅ mapped |
| `/provider/certificates` | `/provider/certificates` | ✅ mapped |
| `/provider/profile` | `/provider/profile` | ✅ mapped |

## Files Changed in This Migration

- `apps/web-app/src/lib/constants.ts`
- `apps/web-app/src/components/layout/app-shell.tsx`
- `apps/web-app/src/app/health/layout.tsx`
- `apps/web-app/src/app/provider/components/provider-layout.tsx`
- `apps/web-app/src/app/provider/dashboard/page.tsx`
- `apps/web-app/src/styles/globals.css`

## Integration Guarantee

- No backend endpoint path changed
- No role permission bypass introduced
- Provider route restrictions still enforced by canonical role checks
- Health and Provider pages continue to call the same APIs as before

## Validation Completed

- `next build` → passed
- E2E Smoke Tests → 82/82 passed
- Browser UAT → Login successful, dashboard rendered correctly
