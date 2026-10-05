export const enPROVIDER = {
provider: {
        nav: {
            dashboard: "Dashboard",
            applications: "Applications",
            audits: "Audits",
            certificates: "Certificates",
            calendar: "Calendar",
            accounting: "Accounting",
            analytics: "Analytics",
            verification: "Verification",
            management: "Management",
            menuLabel: "Menu"
        },
        roles: {
            reviewer_auditor: "Reviewer/Auditor",
            scheduler: "Scheduler",
            accountant: "Accountant",
            admin: "Admin",
            super_admin: "Super Admin",
            assessor: "Assessor"
        },
        dashboard: {
            title: "Dashboard",
            subtitle: "Overview",
            stats: {
                total: "Total Tasks",
                pendingDocs: "Pending Docs",
                pendingAudits: "Pending Audits",
                approvedToday: "Approved Today"
            },
            tabs: {
                documents: "Pending Documents",
                audits: "Pending Audits"
            },
            table: {
                titleDocs: "Document Review Queue",
                titleAudits: "Audit schedule Queue",
                priority: "Priority: High",
                headers: {
                    jobId: "JobID",
                    applicant: "Applicant",
                    plant: "Plant",
                    status: "Status",
                    wait: "Wait Time",
                    action: "Action"
                },
                actions: {
                    verify: "Verify"
                },
                empty: "No tasks pending."
            },
            tools: {
                title: "provider Tools",
                users: "User Management",
                stats: "Statistics",
                accounting: "Accounting",
                calendar: "Schedule"
            },
            reviewer: {
                layoutTitle: "Officer Dashboard",
                layoutSubtitle: "Work queue and SLA oversight",
                welcome: "Welcome back",
                officer: "Officer",
                description: "Logged in as authorized GACP standard reviewer. All system actions are monitored and logged. Last synced:",
                refresh: "Refresh",
                viewAll: "View All",
                metrics: {
                    totalQueue: "Total Queue",
                    newToday: "New Today",
                    awaiting: "Awaiting",
                    slaRisk: "SLA Risk"
                },
                roleLabels: {
                    document_reviewer: "Document Reviewer",
                    scheduler: "Scheduler",
                    auditor: "Auditor",
                    account: "Accountant",
                    admin: "Admin",
                    fallback: "Provider Operations"
                },
                queue: {
                    title: "Priority Work Queue",
                    searchPlaceholder: "Search...",
                    searchLabel: "Search queue items",
                    filterLabel: "Filter by priority",
                    priorityAll: "All",
                    priorityHigh: "High",
                    priorityMedium: "Medium",
                    priorityNormal: "Normal",
                    loadingLabel: "Loading queue",
                    noMatch: "No items match your filters.",
                    columns: {
                        application: "Application",
                        applicant: "Applicant",
                        stage: "Stage",
                        action: "Action"
                    },
                    openAria: "Open application"
                },
                actions: {
                    title: "Recent Actions"
                },
                secureAccess: {
                    title: "Secure Access",
                    description: "You are accessing the government secure portal. All sessions are monitored via Audit Trail."
                }
            }
        },
        applicationsList: {
            title: "Applications Management",
            subtitle: "Review and manage GACP certification requests",
            eyebrow: "GACP Platform",
            heading: "Applications Directory",
            description: "Access all submitted GACP certification applications. You can filter by status, search for applicants, and manage the workflow of each case.",
            stats: {
                all: "All Cases",
                pendingReview: "Pending Review",
                pendingAudit: "Pending Audit",
                certified: "Certified"
            },
            filters: {
                all: "All",
                submitted: "Submitted",
                assigned: "Assigned",
                approved: "Approved",
                certified: "Certified",
                revision: "Revision Requested",
                docApproved: "Doc Approved"
            },
            totalRecords: "Total {count} Records",
            searchPlaceholder: "Search applicant / application no. / national ID",
            searchAria: "Search applications",
            columns: {
                idSubmission: "ID & Submission",
                applicantName: "Applicant Name",
                plantType: "Plant Type",
                status: "Status",
                actions: "Actions"
            },
            empty: {
                title: "No applications in this category",
                hint: "Try changing the filter above or make sure there are applications in this status."
            }
        },
        applicationDetail: {
            loadingTitle: "Loading Application...",
            title: "Application Review",
            subtitle: "Regulatory compliance verification",
            notFoundTitle: "Not Found",
            notFoundDescription: "Application record not found or unauthorized access.",
            backToList: "Back to List",
            eyebrow: "Compliance Audit",
            descriptionTemplate: "Applicant: {applicant}. Application for {plant} cultivation at {farm}. Currently in {status} status.",
            actions: {
                print: "Print Form",
                backToList: "Back to List"
            },
            metrics: {
                slaStatus: "SLA Status",
                submitted: "Submitted",
                status: "Status",
                urgency: "Urgency",
                urgencyHigh: "High",
                urgencyNormal: "Normal"
            },
            actionPanel: {
                eyebrow: "Pending Action",
                title: "Awaiting Review Result",
                approve: "Approve Documents",
                requestRevision: "Request Revision"
            },
            readonlyNotice: {
                title: "Your account is read-only",
                description: "Only document reviewers, auditors, or administrators can approve or request revisions on this application."
            },
            sections: {
                applicant: "Applicant",
                farmLocation: "Farm Location",
                viewOnMaps: "Open plot in map",
                productionPlan: "Production Plan",
                postHarvest: "Post-Harvest"
            },
            details: {
                plant: "Plant",
                type: "Type",
                latitude: "Latitude",
                longitude: "Longitude",
                plantCount: "Plant count",
                estYield: "Est. yield",
                seedSource: "Seed source",
                harvestMethod: "Harvest method",
                dryingMethod: "Drying method",
                storage: "Storage"
            },
            tabs: {
                overview: "Overview",
                documents: "Documents",
                stepReview: "Step Review",
                activities: "Activities",
                reviewHistory: "Review History"
            },
            history: {
                empty: "No review history records found.",
                statusUpdated: "Status Updated",
                noComment: "No comment provided.",
                by: "By",
                system: "SYSTEM"
            }
        },
        documentsTab: {
            checklist: "Document Checklist",
            preview: "Document Preview",
            previewBtn: "Preview",
            openBtn: "Open",
            missing: "Missing",
            needsRevision: "Needs revision",
            previewHint: "Click \"Preview\" on a document to view it here",
            mobilePreviewTitle: "Document Preview",
            mobilePreviewDescription: "Selected document preview",
            mobilePreviewEmpty: "No document selected"
        },
        reviewProgress: {
            revisionTitle: "Revision Requested",
            changesDetected: "Changes Detected",
            editedAt: "Edited at",
            stepLabels: {
                step1: "Applicant Information",
                step2: "Cultivation Plot",
                step3: "Cultivation Details",
                step4: "Soil & Water Results",
                step5: "Pest Management",
                step6: "Harvest",
                step7: "Drying / Curing",
                step8: "Storage",
                step9: "Supporting Documents"
            }
        },
        applications: {
            title: "All Applications",
            subtitle: "GACP Certification Requests",
            stats: {
                all: "Total Applications",
                pendingReview: "Pending Review",
                pendingAudit: "Pending Audit",
                approved: "Approved"
            },
            filters: {
                all: "All",
                pendingReview: "Review",
                revision: "Revision",
                pendingAudit: "Audit",
                approved: "Approved"
            },
            table: {
                headers: {
                    id: "Application ID",
                    applicant: "Applicant",
                    plant: "Plant",
                    status: "Status",
                    date: "Submitted Date",
                    action: "Action"
                },
                view: "Verify",
                empty: "No applications found"
            },
            status: {
                submitted: "New Submission",
                pendingReview: "Pending Review",
                revision: "Revision Required",
                documentApproved: "Docs Approved",
                pendingAudit: "Pending Audit",
                approved: "Certified"
            }
        },
        audits: {
            title: "All Field Audits",
            subtitle: "Field Audits Management",
            filters: {
                all: "All",
                waitingSchedule: "Queueing",
                scheduled: "Scheduled",
                waitingResult: "Results",
                passed: "Passed",
                failed: "Failed"
            },
            buttons: {
                calendar: "Audit Calendar"
            },
            table: {
                headers: {
                    id: "ID",
                    applicant: "Applicant",
                    plant: "Plant",
                    status: "Status",
                    appointment: "Appointment",
                    action: "Action"
                },
                actions: {
                    schedule: "Schedule",
                    view: "View Details"
                },
                inspector: "Inspector",
                calendar: "+ Calendar",
                empty: "No audits found"
            },
            status: {
                waitingSchedule: "Queueing",
                scheduled: "Scheduled",
                inProgress: "In Progress",
                waitingResult: "Pending Result",
                passed: "Passed",
                failed: "Failed"
            },
            scheduleModal: {
                title: "Schedule Audit",
                date: "Date",
                time: "Time",
                mode: "Mode",
                onsite: "On-site",
                online: "Online (Video Call)",
                cancel: "Cancel",
                confirm: "Confirm"
            },
            dashboard: {
                eyebrow: "Audit Dashboard",
                title: "Auditor Dashboard",
                description: "Manage your audit queue, track results, and view your appointment schedule in one place.",
                refresh: "Refresh",
                refreshAria: "Refresh dashboard data",
                metrics: {
                    todayPassed: "Today",
                    scheduledThisWeek: "This Week",
                    pendingResults: "Awaiting Result",
                    majorTriggers: "Findings"
                },
                tabs: {
                    today: "Today",
                    inProgress: "In Progress",
                    followUps: "Follow Up"
                },
                actions: {
                    meeting: "Meeting",
                    map: "Map",
                    start: "Start Audit",
                    details: "Details",
                    online: "Online",
                    onsite: "Onsite",
                    pendingReceipt: "Pending Receipt"
                },
                ariaLabels: {
                    meetingLink: "Open meeting link for {id}",
                    mapLink: "Open map for {id}",
                    details: "Audit details for {id}"
                },
                empty: {
                    queueTitle: "No items in this queue",
                    queueHint: "The queue is empty — switch tabs above to see other queues, or take a break"
                },
                schedule: {
                    title: "Audit Schedule",
                    empty: "No upcoming audits",
                    online: "ONLINE",
                    onsite: "ONSITE",
                    readyToStart: "Ready to start"
                },
                kpi: {
                    title: "Performance Summary (KPI)",
                    todayCompleted: "Completed Today",
                    scheduledThisWeek: "Scheduled This Week",
                    pendingResults: "Awaiting Results",
                    majorFindings: "Major Findings"
                },
                loadFailedTitle: "Load failed",
                loadFailed: "Unable to load auditor dashboard",
                startSuccessTitle: "Inspection started",
                startSuccessMessage: "Application moved to in-progress queue",
                startFailedTitle: "Start failed",
                startFailed: "Unable to start inspection",
                inspectionStartedComment: "Inspection started from auditor dashboard",
                errorTitle: "Error",
                errorGeneric: "Unexpected error"
            },
            detail: {
                loadingTitle: "Audit Job Sheet",
                loadingSubtitle: "Loading...",
                notFoundTitle: "Audit Job Sheet",
                notFoundSubtitle: "Application not found",
                notFoundMessage: "Unable to load application details for this audit job.",
                backToDashboard: "Back to Auditor Dashboard",
                pageTitle: "Job Sheet {id}",
                pageSubtitle: "Applicant: {applicant}",
                pendingReceipt: "Pending receipt",
                scheduledLabel: "Scheduled:",
                revisionDueLabel: "Revision due",
                print: "Print",
                joinMeeting: "Join Meeting",
                openMap: "Open Map",
                vocabBanner: "Decisions can be saved via two paths: use \"Field Tools\" (PASS/FAIL/NEEDS_REVIEW) for on-site inspection, or \"Job Sheet\" (PASS/MINOR/MAJOR) for document audit — please match the path to the audit type.",
                tabs: {
                    application: "Application",
                    history: "Audit History",
                    audit: "Audit Record",
                    fieldtools: "Field Tools"
                },
                workflowHistory: "Workflow History",
                workflowEmpty: "No workflow history yet",
                auditLog: "Audit Log",
                auditLogEmpty: "No audit log entries yet",
                actions: {
                    title: "Job ID:",
                    startInspection: "Start Inspection",
                    pass: "Pass (PASS)",
                    minorCar: "Minor CAR",
                    majorCar: "Major CAR",
                    notActionable: "This job is not in an actionable state. Please verify the receipt status and workflow."
                },
                applicantInfo: {
                    title: "Applicant Information",
                    name: "Full Name",
                    email: "Email",
                    phone: "Phone",
                    applyDate: "Application Date"
                },
                summary: {
                    title: "Application Summary",
                    plant: "Plant",
                    areaType: "Area Type",
                    province: "Province",
                    updated: "Last Updated"
                },
                docs: {
                    title: "Supporting Documents (click to view)",
                    viewBtn: "View Document",
                    openNewBtn: "Open New",
                    noDoc: "No document",
                    auditorNote: "Auditor Note",
                    notePlaceholder: "Record observations for this document...",
                    notePendingTooltip: "Per-document notes are not yet available (X3.5)",
                    notePending: "Per-document notes are not yet available (X3.5)"
                },
                viewer: {
                    zoomOut: "Zoom out",
                    zoomIn: "Zoom in",
                    rotate: "Rotate",
                    close: "Close document",
                    noPreview: "Cannot show preview",
                    download: "Download Document",
                    selectDoc: "Select a document from the list on the left",
                    clickToView: "Click \"View Document\" to display in this pane"
                }
            },
            inspect: {
                pageTitle: "Field Audit Inspection",
                pageSubtitle: "Data capture tool for auditors",
                noAccess: "No access",
                noAccessHint: "Your account does not have permission to use this tool",
                gpsTitle: "GPS Coordinates",
                gpsCapture: "Capture Current Location",
                gpsLatLng: "Latitude {lat} / Longitude {lng}",
                gpsAccuracy: "Accuracy {accuracy} m",
                photoTitle: "Photos",
                photoTake: "Take Photo",
                photoCount: "{count} photo(s)",
                photoCaption: "Caption",
                photoRemove: "Remove",
                checklistTitle: "Checklist",
                checklistPass: "Pass",
                checklistFail: "Fail",
                checklistNeedsReview: "Needs Review",
                notesTitle: "Notes",
                notesPlaceholder: "Record observations and additional details...",
                submitBtn: "Submit Results",
                cancelBtn: "Cancel",
                submittingLabel: "Submitting...",
                successMsg: "Audit results saved successfully",
                errorMsg: "Unable to save results. Please try again."
            }
        },
        coordinator: {
            title: "Audit Coordinator Room",
            subtitle: "Queue and assign field auditors",
            eyebrow: "Coordinator Room",
            refresh: "Refresh",
            refreshAria: "Refresh queue data",
            metrics: {
                pending: "Pending",
                assigned: "Assigned",
                today: "Today",
                thisWeek: "This Week"
            },
            queue: {
                title: "Pending Queue",
                emptyTitle: "No pending applications",
                emptyHint: "All applications have been assigned",
                assignBtn: "Assign",
                viewBtn: "View",
                receiptIssued: "Receipt issued",
                receiptPending: "Receipt pending"
            },
            assigned: {
                title: "Assigned Applications",
                empty: "No assigned applications yet",
                inspector: "Inspector",
                appointment: "Appointment",
                changeBtn: "Change",
                cancelBtn: "Cancel"
            },
            contextPanel: {
                title: "Application Overview",
                applicant: "Applicant",
                farm: "Farm",
                plant: "Plant",
                province: "Province",
                contactPhone: "Phone",
                contactEmail: "Email",
                docs: "Documents",
                receipt: "Receipt",
                receiptIssued: "Issued",
                receiptPending: "Pending"
            }
        },
        calendar: {
            title: "Audit Calendar",
            subtitle: "View all scheduled audit appointments",
            eyebrow: "Audit Calendar",
            today: "Today",
            scheduleBtn: "New Appointment",
            metrics: {
                today: "Today",
                thisWeek: "This Week",
                thisMonth: "This Month",
                pending: "Pending"
            },
            emptyTitle: "No appointments in this period",
            emptyHint: "Press \"New Appointment\" to schedule an audit",
            scheduleModal: {
                title: "Schedule Audit",
                applicationLabel: "Application ID",
                applicantLabel: "Applicant",
                inspectorLabel: "Inspector",
                inspectorPlaceholder: "Select inspector",
                dateLabel: "Audit Date",
                timeLabel: "Time",
                modeLabel: "Inspection Mode",
                modeOnsite: "On-site",
                modeOnline: "Online",
                meetingLinkLabel: "Meeting Link",
                mapLinkLabel: "Map Link",
                notesLabel: "Notes",
                notesPlaceholder: "Additional information about the appointment...",
                submitBtn: "Confirm Appointment",
                cancelBtn: "Cancel",
                submittingLabel: "Submitting...",
                successTitle: "Appointment scheduled",
                successMsg: "Appointment saved successfully",
                errorTitle: "Schedule failed",
                errorMsg: "Unable to save appointment"
            }
        },
        scheduler: {
            queue: {
                title: "Inspector Queue",
                subtitle: "Applications pending inspector assignment",
                emptyTitle: "No items in queue",
                emptyHint: "All items have been scheduled"
            },
            reassign: {
                title: "Reassign Inspector",
                subtitle: "Change the inspector assigned to this application",
                currentInspector: "Current Inspector",
                newInspector: "New Inspector",
                inspectorPlaceholder: "Select inspector",
                reasonLabel: "Reason for reassignment",
                reasonPlaceholder: "Specify reason...",
                submitBtn: "Confirm Reassign",
                cancelBtn: "Cancel",
                submittingLabel: "Submitting...",
                successTitle: "Inspector reassigned",
                successMsg: "Inspector reassigned successfully",
                errorTitle: "Reassign failed",
                errorMsg: "Unable to reassign inspector"
            }
        },
        work: {
            list: {
                title: "Work Queue",
                subtitle: "Assigned tasks",
                eyebrow: "Work Overview",
                refresh: "Refresh",
                tabsAll: "All",
                tabsOpen: "Open",
                tabsClaimed: "Claimed",
                tabsDone: "Done",
                emptyTitle: "No items in queue",
                emptyHint: "New tasks will appear here when assigned",
                columns: {
                    workType: "Work Type",
                    application: "Application",
                    state: "State",
                    due: "Due",
                    assigned: "Assigned To"
                },
                stateLabels: {
                    TODO: "To Do",
                    CLAIMED: "Claimed",
                    IN_PROGRESS: "In Progress",
                    DONE: "Done",
                    CANCELLED: "Cancelled"
                },
                workTypeLabels: {
                    SCHEDULING: "Scheduling",
                    DOC_REVIEW: "Document Review",
                    FIELD_AUDIT: "Field Audit",
                    CAR_REVIEW: "CAR Review",
                    FINAL_APPROVAL: "Final Approval",
                    RECEIPT_ISSUE: "Receipt Issue"
                }
            },
            detail: {
                title: "Work Detail",
                subtitle: "Task information and history",
                back: "Back",
                claimBtn: "Claim",
                startBtn: "Start",
                completeBtn: "Complete",
                cancelBtn: "Cancel",
                applicationLink: "View Application",
                noteLabel: "Note",
                notePlaceholder: "Add note...",
                cancelReasonLabel: "Cancel reason",
                cancelReasonPlaceholder: "Specify reason...",
                history: "Activity History",
                createdAt: "Created at",
                claimedAt: "Claimed at",
                startedAt: "Started at",
                completedAt: "Completed at",
                cancelledAt: "Cancelled at",
                dueAt: "Due at",
                assignedTo: "Assigned to",
                completedBy: "Completed by"
            }
        },
        analytics: {
            pageTitle: "Analytics & Reports",
            pageSubtitle: "System performance and statistics",
            eyebrow: "Provider Insights",
            heading: "System Analytics Overview",
            description: "Comprehensive overview of system performance, application trends, and financial metrics for the last {days} days.",
            refresh: "Refresh",
            workKpis: "Work KPIs",
            retry: "Retry",
            errorMessage: "Unable to load analytics data",
            errorRetry: "Unable to load analytics data. Please try again.",
            periods: {
                last7: "Last 7 days",
                last30: "Last 30 days",
                last90: "Last 90 days",
                lastYear: "Last year",
                placeholder: "Period"
            },
            metrics: {
                totalApps: "Total Apps",
                approved: "Approved",
                revenue: "Revenue",
                farmers: "Farmers"
            },
            cards: {
                totalApplications: "Total Applications",
                totalRevenue: "Total Revenue",
                activeFarmers: "Active Farmers",
                certificatesIssued: "Certificates Issued",
                newSuffix: "new",
                renewalsSuffix: "renewals",
                pendingPrefix: "Pending:",
                newThisPeriod: "new this period",
                approvedTotal: "approved total"
            },
            tabs: {
                overview: "Overview",
                performance: "Performance",
                geographic: "Geographic"
            },
            charts: {
                trends: "Application Trends",
                date: "Date",
                applications: "Applications",
                approved: "Approved",
                revenue: "Revenue",
                plantTypeDist: "Plant Type Distribution",
                units: "units",
                topProvinces: "Top Provinces by Volume",
                province: "Province",
                marketShare: "Market Share",
                distribution: "Distribution"
            },
            performance: {
                avgProcessing: "Avg. Processing",
                avgAudit: "Avg. Audit Time",
                satisfaction: "Satisfaction",
                days: "Days",
                targetProcessing: "Target: 14 days",
                targetAudit: "Target: 3 days",
                userRating: "User Rating"
            }
        },
        profile: {
            pageTitle: "Officer Profile",
            pageSubtitle: "Account identity and access control",
            eyebrow: "Identity Management",
            fallbackTitle: "Officer Profile",
            description: "Manage your provider account details, view assigned roles, and understand your system-wide permissions and access level.",
            refresh: "Refresh",
            logout: "Log out",
            errorPrefix: "Unable to load provider profile",
            metrics: {
                role: "Role",
                verified: "Verified",
                status: "Status",
                yes: "Yes",
                no: "No",
                active: "Active"
            },
            sections: {
                officialIdentity: "Official Identity",
                contactInfo: "Contact Information",
                permissions: "Authorized Capabilities",
                sessionGov: "Session & Governance"
            },
            ministryVerified: "Ministry Verified",
            labels: {
                providerId: "Provider ID",
                accountType: "Account Type",
                email: "Email Address",
                phone: "Phone Number",
                organization: "Organization",
                orgName: "Department of Thai Traditional and Alternative Medicine"
            },
            quickActions: {
                securityMfa: "Security & MFA",
                systemSettings: "System Settings",
                notifications: "Notification Preferences",
                dashboard: "Dashboard",
                endSession: "End Session"
            },
            roleFallback: "Role-based access enabled"
        },
        // FU-3 mirror of th-provider.certificates (dictionary-parity enforced).
        certificates: {
            title: "Certificates",
            subtitle: "Certification lifecycle and renewal monitoring",
            heading: "Certificate Operations",
            refresh: "Refresh",
            notifyExpiry: "Notify 30-day expiry",
            queueing: "Queueing...",
            metrics: {
                active: "Active certificates",
                expiring30: "Expiring in 30 days",
                expiring90: "Expiring in 90 days",
                renewalHealth: "Renewal health",
                lastSync: "Last sync"
            },
            byStandard: "By Standard",
            topProvinces: "Top Provinces",
            noStandardData: "No standard distribution data",
            noProvinceData: "No province distribution data",
            unknownStandard: "Unknown standard",
            unknownProvince: "Unknown province",
            expiringTitle: "Expiring Certificates (within 90 days)",
            autoSorted: "Auto-sorted by nearest expiry",
            emptyExpiring: "No certificates expiring within 90 days.",
            table: {
                certificate: "Certificate",
                farm: "Farm",
                standard: "Standard",
                province: "Province",
                expiry: "Expiry",
                contact: "Contact"
            },
            daysLeftSuffix: "days left",
            unknown: "Unknown",
            errors: {
                loadFailed: "Unable to load certificates dashboard",
                notifyFailed: "Unable to queue renewal notifications"
            }
        }
    }
};
