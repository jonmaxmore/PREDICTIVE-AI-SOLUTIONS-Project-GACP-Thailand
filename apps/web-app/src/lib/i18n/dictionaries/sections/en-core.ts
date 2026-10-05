import { SUPPORT_EMAIL } from '@/constants/contact-emails';

export const enCore = {
common: {
        ministryName: "Department of Thai Traditional and Alternative Medicine",
        ministryAddress: "88/23 Moo 4, Talat Khwan, Mueang Nonthaburi, Nonthaburi 11000, Thailand",
        skipToContent: "Skip to main content",
        mainLandmark: "Main content",
        loading: "Loading...",
        error: "Error occurred",
        save: "Save",
        cancel: "Cancel",
        edit: "Edit",
        delete: "Delete",
        back: "Back",
        confirm: "Confirm",
        leave: "Leave",
        success: "Success",
        retry: "Try again",
        close: "Close",
        unsavedChanges: {
            title: "Leave without saving?",
            description: "You have unsaved changes on this page. If you leave now, those changes will be lost.",
        },
        viewAll: "View All",
        startNow: "Start Now",
        newApplication: "New Application",
        verified: "Verified",
        pendingVerification: "Pending Verification",
        logout: "Log out",
        certificationSystem: "Certification System",
        all: "All",
        inProgress: "In Progress",
        draft: "Draft",
        submitDocument: "Submit Documents",
        submitDate: "Submitted on",
        viewDetails: "View Details",
        startFirstApp: "Start your first application",
        startFirstAppDesc: "The system will guide you through each step of the GACP certification process",
        startApplication: "Start Application",
        herb: "Herb",
        Applicant: "Applicant",
        menuShortcuts: "MENU / SHORTCUTS",
        processingStatus: "Processing Status",
        fetchError: {
            title: "Unable to load data",
            hint: "We couldn't reach the server. Please check your internet connection and try again.",
            retry: "Try again"
        },
        help: "Help",
        /* Y1-FIX-A — language toggle keys.
           Button label shows the OTHER language (i.e. when current is TH
           the label is "EN", inviting the click).

           The aria-label used to be written in the DESTINATION language's
           script ("เปลี่ยนภาษาเป็นภาษาไทย" here, "Switch language to English"
           in th-core), on the reasoning that it announces where the click
           leads. That put Thai codepoints in the English dictionary — the one
           thing the EN mode must never contain — and it does not help the
           user it was meant to help: a screen reader running in English
           reaches Thai glyphs it has no voice for and reads noise. The
           announcement now stays in the language the page is actually in;
           the destination is named, not transliterated. */
        languageToggle: "TH",
        languageToggleAria: "Switch language to Thai",
        /* Y1-FIX-A — cross-cutting action panel labels.
           Used by action panels in HEALTH detail pages, provider review
           modals, and wizard surfaces. Living under `common.actionPanel`
           keeps them globally accessible without polluting per-role
           namespaces. */
        actionPanel: {
            actionRequired: "Action required",
            pendingDecision: "Pending decision"
        },
        /* Y1-FIX-A — universal timeline labels for HEALTH/provider
           history surfaces (activity-timeline, review-history,
           audit-record). */
        timeline: {
            statusUpdated: "Status updated",
            by: "By",
            system: "System",
            createdAt: "Created at",
            updatedAt: "Last updated"
        }
    },
quickActions: {
        registerDesc: "Submit certification documents",
        trackingDesc: "Check progress steps",
        profileDesc: "Edit profile",
        settingsDesc: "Manage account"
    },
trackingPage: {
        subtitle: "Check progress of your GACP certification application",
        plantingCycles: "Planting Cycles",
        plantingCyclesDesc: "Manage cycles",
        lots: "Lots",
        lotsDesc: "Product lots",
        cultivationLog: "Cultivation Log",
        cultivationLogDesc: "Care records",
        applicationNo: "Application No.",
        progress: "Progress",
        noTracking: "No tracking items",
        noTrackingDesc: "You haven't submitted any GACP certification applications yet",
        createNew: "Create New Application"
    },
settingsPage: {
        notifications: "Receive notifications",
        notificationValue: "On",
        edit: "Edit"
    },
loginPage: {
        heroTitle: "Elevating Thai Herbal Standards to Global Quality",
        heroSubtitle: "Good Agricultural and Collection Practices (GACP) Certification System\nDepartment of Thai Traditional and Alternative Medicine",
        accountLocked: "Account Temporarily Suspended",
        errorOccurred: "An Error Occurred"
    },
tracePage: {
        notFound: "Product not found",
        connectionError: "Connection error occurred",
        verifying: "Verifying Authenticity..."
    },
dashboard: {
        greeting: {
            morning: "Good Morning",
            afternoon: "Good Afternoon",
            evening: "Good Evening",
        },
        verification: {
            warningTitle: "Identity Verification Required",
            warningMsg: "You have not verified your identity or it is under review.\nPlease complete the verification to start applying for certification.",
            button: "Verify Identity Now",
            statusPending: "Status: Verification Pending",
        },
        hero: {
            newApp: "New Application",
            verifyToStart: "Verify to Start",
        },
        stats: {
            total: "Total Applications",
            active: "Processing",
            pendingAudit: "Pending Audit",
            certified: "Certificates",
            docReview: "Document Review",
            inProgress: "In Progress",
        },
        status: {
            DRAFT: "Draft",
            SUBMITTED: "Submitted",
            PENDING_DOC_FEE: "Payment 1 Pending",
            PAID_PHASE_1: "Paid Phase 1",
            PAYMENT_2_PENDING: "Payment 2 Pending",
            PENDING_AUDIT_FEE: "Payment 2 Pending",
            PAID_PHASE_2: "Paid Phase 2",
            REVISION_REQUESTED: "Revision Required",
            DOC_APPROVED: "Document Approved",
            AUDIT_CONFIRMED: "Audit Pending",
            APPROVED: "Certified",
        },
        welcome: "Hello",
        subtitle: "Manage your cultivation plots and certificates here",
        actions: {
            newApplication: "New Application",
            register: "Register Plot",
            tracking: "Track Status",
            profile: "My Profile",
            settings: "System Settings",
            viewAll: "View All",
            startNow: "Start Now"
        },
        sections: {
            recent: "Recent Activities",
            certificates: "My Certificates",
            quickMenu: "Quick Menu",
            noCert: "No Certificates Yet",
            noApp: "No Applications Yet",
            startApp: "Start your first application now",
            status: "Application Status",
            todo: "To Do",
        },
        menus: {
            manual: "User Manual",
            manualDesc: "For Applicants",
            report: "Report Issue",
            reportDesc: "Contact Support",
        },
        alerts: {
            auditFeeTitle: "Payment Required: Audit Fee",
            auditFeeDesc: "Your application documents have been approved. Please pay the audit fee to schedule an inspector.",
            auditFeeButton: "Pay Now",
            auditApptTitle: "Audit Appointment Scheduled",
            date: "Date",
            time: "Time",
            modeOnline: "Mode: Online (Google Meet)",
            modeOnsite: "Mode: Onsite",
            location: "Location",
            meetButton: "Join Google Meet",
            paymentTitle: "Payment Alert",
            paymentDesc: "Please complete your payment to proceed with the application",
            paymentButton: "Pay Now",
        },
        appCard: {
            title: "GACP Certification Application",
            lastInfo: "GACP Certificate Request",
            continue: "Continue",
            lastUpdate: "Last Update"
        },
        empty: {
            title: "No Applications Found",
            desc: "Start your GACP certification journey to elevate your farm standards"
        },
        buttons: {
            download: "Download"
        },
        social: {
            placeholder: "What's happening on your farm?",
            post: "Post",
            trends: "Trends for you",
            welcomeTitle: "Welcome to GACP!",
            welcomeDesc: "This is where your certification journey lives. Start by creating your first application.",
            welcomeBtn: "Let's go!",
            newPost: "New Post"
        },
        nav: {
            home: "Home",
            notifications: "Notifications",
            profile: "Profile"
        }
    },
sidebar: {
        dashboard: "Dashboard",
        applications: "Applications",
        establishments: "Establishments",
        planting: "Planting Cycles",
        certificates: "Certificates",
        tracking: "Tracking",
        payments: "Payments",
        notifications: "Notifications",
        profile: "Profile",
        settings: "Settings",
        logout: "Log out"
    },
tracking: {
        title: "Track Application Status",
        subtitle: "Check the latest status of your GACP application",
        searchPlaceholder: "Search by Application ID...",
        steps: {
            step1: "Submit Application",
            step2: "Fee Payment (1)",
            step3: "Document Check",
            step4: "Audit Payment (2)",
            step5: "Onsite Audit",
            step6: "Certified"
        },
        status: {
            title: "Current Status",
            currentStep: "Current Step",
            lastUpdate: "Last Update",
            viewDetails: "View Details"
        },
        empty: {
            title: "No Applications",
            subtitle: "You haven't submitted any applications yet. Start by clicking 'New Application'."
        }
    },
payment: {
        title: "Payment History",
        subtitle: "All your invoices and payment records",
        tabs: {
            all: "All",
            pending: "Pending",
            paid: "Paid"
        },
        table: {
            date: "Date",
            docNo: "Document No.",
            type: "Type",
            amount: "Amount (THB)",
            status: "Status",
            action: "Action"
        },
        stats: {
            pending: "Pending Amount",
            paid: "Paid Amount"
        },
        types: {
            quotation: "Quotation",
            invoice: "Invoice",
            receipt: "Receipt"
        },
        actions: {
            pay: "Pay Now",
            download: "Download",
            view: "View Details"
        }
    },
settings: {
        title: "Settings",
        subtitle: "System configuration and preferences",
        general: "General",
        language: "Language",
        security: "Security",
        notifications: "Notifications",
        theme: "Theme",
        darkMode: "Dark Mode",
        password: "Password",
        changePassword: "Change Password",
        display: "Display",
        currentPassword: "Current Password",
        newPassword: "New Password",
        confirmNewPassword: "Confirm New Password",
        passwordPlaceholder: "Enter current password",
        newPasswordPlaceholder: "Enter new password (at least 8 characters)",
        confirmPasswordPlaceholder: "Re-enter new password",
        changePasswordSuccess: "Password changed successfully!",
        changePasswordFail: "Failed to change password",
        fillAllFields: "Please fill in all fields",
        passwordTooShort: "New password must be at least 8 characters",
        passwordsDoNotMatch: "New passwords do not match",
        genericError: "An error occurred. Please try again."
    },
eyebrow: {
        applicantDashboard: "Applicant Dashboard",
        applicantApplications: "Applicant · Applications",
        applicantNotifications: "Applicant · Notifications",
        staffNotifications: "Staff · Notifications",
        applicantCertificates: "Applicant · Certificates",
        applicantSettings: "Applicant · Settings",
        applicantTracking: "Applicant · Track & Trace"
    },
time: {
        minutesAgo: "{n} minutes ago",
        hoursAgo: "{n} hours ago",
        daysAgo: "{n} days ago"
    },
filters: {
        actionRequired: "Action Required",
        inProgress: "In Progress",
        completed: "Completed",
        unreadOnly: "Unread Only"
    },
deadline: {
        overdueBy: "Overdue by {n} days",
        timeLeftHours: "{n} hours left",
        timeLeftDays: "{n} days left",
        carUrgent: "— Please submit CAR urgently!",
        revisionUrgent: "— Please revise urgently!",
        beforeCarDeadline: "before CAR deadline",
        beforeRevisionDeadline: "before revision deadline"
    },
notifications: {
        title: "Notifications",
        subtitle: "Track your application status and latest activities",
        markAllRead: "Mark all as read",
        new: "New",
        unread: "Unread",
        noUnread: "No new items!",
        noUnreadDesc: "You've read all notifications. Great job.",
        empty: "No notifications",
        emptyDesc: "No notifications yet. Please check back later.",
        viewDetails: "View Details",
        officialLetter: "Official letter",
        officialLetterKept: "Kept permanently",
        // N6 — {date} is filled in by the inbox; an unread letter shows nothing.
        letterOpenedAt: "Opened {date}",
        dueBy: "Due {date}",
        overdue: "Overdue",
        keptThirtyDays: "Kept 30 days after you read it",
        keptUntilRead: "Kept until you read it",
        retentionNote: "General notifications are removed 30 days after you read them. Official letters are kept permanently."
    },
certificates: {
        title: "GACP Certificates",
        subtitle: "Per-farm certification (1 farm = 1 certificate)",
        active: "Active",
        expiring: "Expiring Soon",
        expired: "Expired",
        notFoundTitle: "No certificates found",
        notFoundHint: "Submit a new application to request a GACP assessment",
        loadFailTitle: "Unable to load certificates",
        loadFailHint: "Unable to load certificate list",
        connectionError: "Unable to connect to the server. Please try again.",
        retry: "Try again",
        newApplication: "New Application",
        viewCert: "View Certificate",
        download: "Download",
        renew: "Renew",
        validityProgress: "Certificate validity ({n}-year term)",
        validityProgressUnknown: "Certificate validity",
        daysRemaining: "{n} days remaining",
        expiredAlready: "Already expired",
        issuedAt: "Issued on",
        expiresAt: "Expires on",
        auditor: "Auditor",
        lastAudit: "Last audited",
        score: "Score",
        area: "Area",
        closeWindow: "Close window",
        qrAltText: "QR code for GACP certificate"
    },
applicationsList: {
        title: "GACP Applications",
        subtitle: "Track status, take action, and manage all your GACP applications",
        metricTotal: "Total Applications",
        metricActionRequired: "Action Required",
        metricInProgress: "In Progress",
        metricCompleted: "Completed",
        newApplicationBtn: "+ New Application",
        listHeading: "Application List",
        itemCount: "items",
        emptyTitle: "No applications match this filter",
        emptyHint: "Try changing status or search query, or click 'Create New Application' above to begin.",
        continueDraft: "Continue",
        deleteDraft: "Delete this draft",
        deleteDraftTitle: "Delete this draft?",
        deleteDraftDesc: "The draft application will be permanently deleted — this action cannot be undone.",
        deleteDraftConfirm: "Delete draft",
        stepLabel: "Step {current}/{total}",
        loadError: "Unable to load application list",
        loadErrorRetry: "An error occurred loading applications. Please try again.",
        deleteDraftError: "Unable to delete draft. Please try again.",
        deleteDraftErrorGeneric: "An error occurred while deleting the draft"
    },
renewalAdvisory: {
        title: "The renewal fee cannot be paid in the system yet",
        body: "These renewal steps are not yet connected to the system's payment page, so the renewal fee cannot be paid from here, and you have not been charged. The renewal fee is paid to the platform service company, through the system only. It is not paid to the Department of Thai Traditional and Alternative Medicine directly.",
        contactCta: "Contact staff",
        contactEmail: SUPPORT_EMAIL,
        contactFormCta: "Open contact form"
    }
};

