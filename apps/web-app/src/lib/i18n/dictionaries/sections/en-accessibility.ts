export const enAccessibility = {
accessibilityStatement: {
        draftTag: "Draft · v1 · 2026-04-28",
        title: "Website accessibility statement",
        subtitle: "GACP Certification Platform",

        draftNoticeLead: "This document is a",
        draftNoticeEmphasis: "working draft",
        draftNoticeRest: "pending official wording from {ministry}, or a reviewed translation of the gov.uk model accessibility statement. Treat what follows as provisional guidance.",

        scope: {
            heading: "1. Scope of this statement",
            body: "This statement covers the whole of {site}, including the application, payment, status-tracking and electronic certificate systems, operated under {ministry}, Ministry of Public Health.",
        },

        standard: {
            heading: "2. The standard this platform targets",
            leadIn: "This site is built to meet",
            standardName: "Web Content Accessibility Guidelines (WCAG) 2.2 level AA",
            asSetOutIn: "as set out in",
            w3cLinkText: "the W3C specification",
            // Sentence terminator rendered immediately after the link, outside
            // it. English closes with a full stop; Thai marks the break with a
            // space alone, so th-accessibility leaves this empty rather than
            // importing a punctuation mark formal Thai does not use.
            linkSuffix: ".",
            trailing: "Development is ongoing and not every page meets every criterion yet. The “Known limitations” section below will be updated as soon as an external assessment is complete.",
        },

        support: {
            heading: "3. What this platform provides",
            items: [
                "Pages use standard semantic HTML and work with screen readers",
                "Every page carries a “skip to main content” link that bypasses the header and navigation",
                "The page language is declared explicitly, so screen readers pronounce it correctly",
                "Thai and English can be switched from the control in the page header",
                "Text and background meet the WCAG AA contrast ratio (at least 4.5:1 for body text)",
                "Every button and link is reachable with Tab and Shift-Tab",
                "Meaningful images carry alt text; decorative images are marked aria-hidden",
            ],
        },

        limitations: {
            heading: "4. Known limitations",
            body: "(This section will be filled in after an external WCAG 2.2 AA assessment. No limitations have been formally recorded yet.)",
        },

        report: {
            heading: "5. Reporting an accessibility problem",
            intro: "If you have trouble using this site — content a screen reader cannot read, a control you cannot reach with the keyboard, or colours that are hard to distinguish — please tell us.",
            emailLabel: "Email",
            phoneLabel: "Telephone",
            addressLabel: "Address",
            sla: "We reply within 15 working days and fix limitations affecting core tasks within 60 days. Where a fix needs longer, we report progress every 30 days.",
        },

        escalation: {
            heading: "6. If our response is not satisfactory",
            body: "If you have reported a problem through the steps above and the outcome is still unsatisfactory, you may escalate it to the central government body responsible for digital government services for further consideration.",
        },

        provenance: {
            heading: "7. How this statement was prepared",
            body: "This statement was prepared on 28 April 2026 under the responsibility of {ministry}. It is reviewed every six months, or whenever the platform changes significantly.",
        },



        backTo: "Back to",
        home: "Home",
        sitemap: "Sitemap",
    },
};
