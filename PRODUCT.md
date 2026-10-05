# Product

## Register

product

## Users

Two distinct groups share the platform, with opposite contexts:

**Applicants — Thai herbal farmers, growers, and small producers.**
They apply for GACP (Good Agricultural and Collection Practices)
certification of Thai herbs. Context: often on an inexpensive phone over a
slow connection, sometimes from an internet cafe, frequently older and not
a confident computer user. The job to be done: register, submit an
application, pay fees, upload documents, fix what gets sent back, and — above
all — know where their application stands and what they must do next.

**DTAM staff — the officers who run the certification.** Document reviewers,
queue schedulers, accounting/finance (payment-slip verification), and farm
auditors who inspect sites and approve results. Context: desk work,
processing many applications under deadline, inside a regulated
conformity-assessment process (ISO/IEC 17065) where every decision must be
accountable and traceable. The job to be done: review, verify, schedule,
audit, approve, and issue a legally valid certificate — with a complete
audit trail and a clear separation of duties.

## Product Purpose

A government certification platform, operated under Thailand's Department of
Thai Traditional and Alternative Medicine (DTAM), that runs the entire GACP
certification lifecycle end to end: application → fee payment → document
review → scheduling → on-site farm audit → approval → issuance of a
legally valid digital certificate with public QR traceability.

It exists to replace a paper-and-counter process with one that is
transparent, faster, and trustworthy — for a regulated, multi-step,
multi-role workflow that ordinary citizens and government officers must
share. Success looks like: an applicant can self-serve and always knows
their status without phoning anyone; an officer can process work
accountably with a full audit trail and enforced separation of duties; a
certificate is instantly verifiable by the public; and the system holds up
to ISO/IEC 17065 scrutiny.

## Brand Personality

**Official · Trustworthy · Transparent** (ทางการ · น่าเชื่อถือ · โปร่งใส).

The voice is plain, calm, and factual Thai — the register of a good public
service, not a marketing site and not a startup. It should make a farmer
feel the system is legitimate and on their side rather than an intimidating
bureaucracy, and make an officer feel it is rigorous and accountable. The
feel to aim for is a *good* digital-government service: gov.uk, ThaID, and
the ทางรัฐ app — clean, clear, accessible, and credible.

## Anti-references

- **Generic AI / SaaS look.** Purple-blue gradients, glassmorphism, "hero
  metric" dashboards, decorative gradient text, and grids of identical
  cards — the template a generator reaches for by default. This is a
  government system of record, not a product-launch landing page.
- **Cluttered legacy Thai government sites** (ราชการเก่า รกหนา). Dense,
  cramped pages, tiny type, broken responsive layouts, no visual hierarchy,
  walls of links. Credible does not mean old and hard to read.
- **Dark fintech / crypto aesthetics.** Neon-on-black, dark mode as the
  default identity, flashy motion, "premium" sheen. Wrong trust signal
  entirely for a public herbal-certification authority.

## Design Principles

1. **Clarity is the whole job.** Every screen serves one regulated step. A
   farmer or an officer must always be able to see what just happened, what
   they must do next, and what is blocking them. Anything on the screen that
   does not carry meaning is removed.

2. **Look as accountable as we are.** The platform issues legally valid
   government certificates under ISO/IEC 17065. The interface must read as an
   official system of record: status is always truthful and never
   optimistic, actions are traceable, and nothing consequential hides inside
   decoration.

3. **Built for the person on the worst device.** Design for the farmer on a
   cheap phone over a slow connection, and for the older officer who is not a
   power user — not for the ideal viewport. If a flow does not work there, it
   does not work.

4. **Make the journey visible.** Certification is a long path across many
   hands: apply, pay, review, schedule, audit, approve, issue. The product's
   core value is making "where is my application, and why" obvious at every
   step — to the applicant and to every officer who touches it.

5. **Predictable beats clever.** The same action looks and behaves the same
   everywhere. For a government tool, consistency is precisely what turns
   "bureaucratic" into "trustworthy"; a user should never have to relearn the
   interface from one screen to the next.

## Accessibility & Inclusion

- **Target: WCAG 2.1 AA.** Text contrast at least 4.5:1, an always-visible
  focus indicator, full keyboard operation, and semantic structure for
  assistive technology.
- **Thai-first and plain.** Sarabun (the SIL OFL typeface adopted as the Thai
  government standard) for legible Thai glyphs; plain wording over jargon; no
  English-only labels on citizen-facing surfaces.
- **Older and low-digital-literacy users.** Large tap targets, generous text
  size, simple linear flows, and forgiving forms with clear, recoverable
  error messages.
- **Low-end devices and slow networks.** Fast first paint, no dependence on
  heavy visual effects or hover-only interactions, mobile-first layouts.
- **Reduced motion.** Honor `prefers-reduced-motion` (already wired into the
  global stylesheet); motion is always optional and never required to
  understand state.
- **Never color alone.** Application status and every other state-by-color
  signal must also carry an icon or text label, so color-blind users lose
  no information.
