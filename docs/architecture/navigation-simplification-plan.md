# Navigation Simplification Plan — GACP Platform

> Reducing cognitive load by consolidating navigation from 14+ items to 6.

## Current State (Health-side)
14+ navigation items spread across 7 component files.

### Top Nav (app-shell.tsx): 5 items
Dashboard, Applications, Payments, Certificates, Profile

### Sidebar (sidebar.tsx): 8 items
Dashboard, Applications, Certificates, Payments, Notifications, Profile, Settings

### Sidebar-nav (sidebar-nav.tsx): 11+ items with sub-menus
Dashboard, Applications (3 sub), Certificates, Official Documents, Invoices,
Reports, SOP Templates, Resources, Notifications, Profile, Settings

### Bottom nav (mobile): 4-5 items (varies by component)

## Target State: 6 Primary Items

| # | Label | Path | Icon | Visibility |
|---|-------|------|------|-----------|
| 1 | แดชบอร์ด | /health/dashboard | Home | All users |
| 2 | คำขอรับรอง | /health/applications | FileText | All users |
| 3 | การชำระเงิน | /health/payments | CreditCard | All users |
| 4 | ใบรับรอง | /health/certificates | Award | Certified users only |
| 5 | การปลูก | /health/planting | Sprout | Certified users only |
| 6 | โปรไฟล์ | /health/profile | User | All users |

## Items Relocated (not deleted)

| Old Item | New Location | Reason |
|----------|-------------|--------|
| Notifications | Top bar bell icon | Already exists, no nav needed |
| Settings | Profile sub-page | Low-frequency use |
| SOP Builder | Certified resources | Post-certification tool |
| SOP Templates | Certified resources | Post-certification |
| Training | Certified resources | Post-certification |
| Resources | Dashboard links | Reference material |
| Tracking | Applications detail | Per-application feature |
| Establishments | Profile sub-page | Rarely changed |
| Official Documents | Certificates sub-page | Post-certification |
| Export Documents | Certificates sub-page | Post-certification |
| Site Analysis | Applications detail | Per-application feature |
| Reports | Dashboard section | Admin feature |
| Start | Dashboard | Onboarding = dashboard |

## Implementation: nav-config.ts

Single configuration file that all navigation components consume.
Each component (sidebar, top-nav, bottom-nav, mobile) renders its
appropriate subset from this shared source.

## Mobile Bottom Nav (5 items)
Dashboard, Applications, + New (primary CTA), Certificates, Profile

## Provider-side: 6 Primary Items

| # | Label | Path | Icon |
|---|-------|------|------|
| 1 | แดชบอร์ด | /provider/dashboard | LayoutDashboard |
| 2 | คำขอ | /provider/applications | FileText |
| 3 | ตรวจสอบ | /provider/audits | ClipboardCheck |
| 4 | การเงิน | /provider/accounting | Banknote |
| 5 | ใบรับรอง | /provider/certificates | Award |
| 6 | ตั้งค่า | /provider/settings | Settings |
