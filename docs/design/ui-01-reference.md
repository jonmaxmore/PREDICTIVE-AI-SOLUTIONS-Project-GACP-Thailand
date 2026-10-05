# UI-01 — Landing + Login (OAuth-first) design reference

**Status:** design spec (not implemented) — operator approves the mockup before UI-01 is built
**Owner:** Senior + operator (design) · **Date:** 2026-08-05 · **Tier:** B (implement) — queued **after the Golden Path walk, before UAT**
**Source:** operator UI/AUTH brief 2026-08-05. DTAM Next (สธ. partner) OAuth is the **reference implementation** for the destination; current local login is **TRANSITIONAL** (per กฎกระทรวง).

> **This doc embeds NO real assets.** Per the operator's strict ASSET RULE: official
> crests (ตราครุฑ/ตรากรม) come only from official files supplied by the department;
> provider logos (Health ID / ThaID / Provider ID) come only from each provider's
> onboarding asset kit; generic icons use lucide/heroicons (open license); **agents
> never scrape assets from any site, including DTAM Next.** Everywhere an official
> asset belongs, this spec uses a clearly-marked **placeholder**.

---

## 0. Principles (from the brief — do not violate)

1. **Build once for the future.** UI-01 is designed for the OAuth destination, not a
   reskin of the old local login that gets torn out when OAuth lands. The OAuth-first
   layout + adapter seam ships now; buttons without credentials are disabled, not absent.
2. **GACP green stays.** Keep the GACP brand tone/colours — do **not** adopt DTAM Next's
   brand colours. (Design tokens: `apps/web-app` Tailwind theme; use the existing green.)
3. **Asset discipline** — §above.
4. **Transitional local login coexists** — same page, OAuth primary + local secondary,
   via the existing auth adapter seam.

## 1. Screen flow

```
(landing)  dual-card  ──►  (provider-select)  ──►  (OAuth handoff)
 ┌───────────────┐         choose IdP per side        redirect to
 │ ประชาชน (card) │         + per-side checklist        provider authorize
 │ เจ้าหน้าที่(card)│                                     endpoint
 └───────────────┘
        │ (local fallback link on each card)
        ▼
   local login (transitional) — same seam
```

This landing **replaces the temporary host-nginx redirect** (`staging.gacpth.com/` →
`/auth/health/login`, recorded in `docs/operations/domain-access.md`). Shipping UI-01
= retiring that nginx patch (closes that debt).

## 2. Landing — dual card

Two cards, side-by-side (stack on mobile — **เกษตรกรใช้มือถือเป็นหลัก**, mobile-first):

| card | audience | primary action | secondary |
|---|---|---|---|
| **ประชาชน / เกษตรกร** | health | "เข้าสู่ระบบด้วย Health ID" (OAuth) + "ThaID" | local login link ("เข้าสู่ระบบด้วยรหัสผ่าน (ชั่วคราว)") |
| **เจ้าหน้าที่** | provider | "เข้าสู่ระบบด้วย Provider ID" (OAuth) + "ThaID" | local login link |

Each card carries a short **checklist / คำอธิบายสิทธิ์** ("ฝั่งนี้สำหรับใคร / เตรียมอะไร")
so the user self-selects correctly (the two audiences are separate JWT audiences —
picking the wrong side must not silently cross portals).

## 3. Login page — OAuth-first, local secondary (one page per audience)

- **OAuth buttons first**, ordered per the audience (Health ID / ThaID for citizens;
  Provider ID / ThaID for staff).
- **Buttons without credentials = disabled**, labelled **"เร็วๆ นี้"**, driven by the
  existing adapter seam's `coming_soon` state — **no separate dead UI**. When B1-CRED
  lands the button flips enabled by config, no re-layout.
- **Local login** (identifier + password) is present but visually secondary, marked
  **ชั่วคราว/transitional**.
- Provider logos: **placeholder** until the provider's asset kit arrives.
- No brand-colour change; GACP green throughout.

## 4. Government footer

`policy / เงื่อนไขการใช้งาน / คำถามที่พบบ่อย / ติดต่อ / © กรม<...>` —
- policy/terms/FAQ/contact links point to **real pages**. **If a target page does not
  exist yet, that is a separate content task** — flag to the operator, do not invent
  copy or a dead link.
- © line + department name: text only until the official crest file arrives.

## 5. Crest / official marks

- ตราครุฑ / ตรากรม: **placeholder mark** clearly labelled **"รอไฟล์ตราทางการจากกรม"**
  until the operator supplies the official file. Never a scraped or look-alike crest.

## 6. Open items before implement (operator)

- [ ] operator approves this layout as a **mockup** before UI-01 is built (Tier B).
- [ ] official crest file(s) → replaces §5 placeholder.
- [ ] provider asset kits (Health ID / ThaID / Provider ID) → replaces §3 placeholders.
- [ ] confirm each footer policy/terms/FAQ/contact target page exists (else = content task).
- [ ] AUTH-01-RECON (companion doc) — the OAuth button endpoints/scopes this page will
      hand off to, once the operator sends the real OAuth URL.

## 7. Sequencing

recon + this design-ref = now (done) · **implement = after the Golden Path walk, before
UAT** (Tier B, operator-approved mockup) · shipping it retires the nginx redirect patch.
