export const enWizard = {
wizard: {
        steps: {
            general: "Applicant Info",
            personnel: "Personnel",
            facilities: "Facilities",
            farm: "Farm Info",
            planting: "Planting",
            production: "Production",
            lots: "Lots",
            review: "Review"
        },
        plantSelection: {
            title: "Select Medicinal Plant",
            subtitle: "Start your GACP certification application",
            sections: {
                plant: "Select Plant Type",
                plantDesc: "Please select the plant for GACP certification",
                serviceType: "Application Type",
                serviceTypeDesc: "Select your application type",
                purpose: "Purpose",
                purposeDesc: "Select production purpose",
                method: "Cultivation Method",
                methodDesc: "Select cultivation method"
            },
            serviceTypes: {
                new: { label: "New Application", desc: "For first-time applicants or expired certificates" },
                renewal: { label: "Renewal", desc: "For existing certificates (apply within 90 days before expiry)" },
                modify: { label: "Amendment", desc: "For modifying existing certificate details" }
            },
            note: "One application = One cultivation method. Please submit separate applications for multiple methods."
        },
        general: {
            title: "Applicant Information",
            subtitle: "Please provide complete applicant details",
            infoHeader: "Applicant Information",
            typeHeader: "Select Applicant Type",
            types: {
                individual: { label: "Individual", subLabel: "Smallholder Farmer", idLabel: "Citizen ID (13 digits)" },
                juristic: { label: "Juristic Person", subLabel: "Company / Partnership", idLabel: "Registration No. (13 digits)" },
                community: { label: "Community Enterprise", subLabel: "Community Group", idLabel: "Registration No." }
            },
            applicantName: "Applicant Name",
            firstName: "First Name",
            lastName: "Last Name",
            personalId: "National ID / Passport",
            address: "Registered Address",
            contact: "Contact Information",
            email: "Email",
            phone: "Phone Number",
            docs: {
                idCard: "ID Card Copy",
                houseReg: "House Registration Copy",
                communityReg: "Community Enterprise Registration",
                companyReg: "Company Registration Certificate",
                meetingReport: "Meeting Minutes",
                directorList: "List of Directors"
            }
        },
        farm: {
            title: "Farm Information",
            subtitle: "Location details, environment, and security as per GACP standards",
            sections: {
                general: "General Farm Information",
                environment: "Site Environment (GACP)",
                sanitation: "Sanitation & Facilities",
                water: "Water Sources & Quality",
                gps: "GPS Coordinates",
                security: "Security System",
                documents: "Site Documents"
            },
            fields: {
                farmName: "Farm Name / Establishment",
                farmNamePlaceholder: "e.g. Sookjai Herb Farm",
                address: "Farm Address",
                addressPlaceholder: "House No., Village, Road...",
                province: "Province",
                postalCode: "Postal Code",
                totalArea: "Total Area",
                unit: "Unit",
                ownership: "Land Ownership",
                ownershipOptions: {
                    owner: "Owner",
                    rented: "Rented",
                    consent: "Consent Used"
                }
            },
            units: {
                sqm: "Sqm."
            },
            map: {
                title: "Farm Location (GPS)",
                currentLocation: "Current Location",
                loading: "Loading map...",
                lat: "Latitude",
                lng: "Longitude",
                error: "Unable to retrieve location"
            },
            borders: {
                title: "Borders",
                north: "North",
                south: "South",
                east: "East",
                west: "West"
            },
            soil: {
                title: "Soil Information",
                type: "Soil Type",
                ph: "Soil pH (Optional)",
                history: "Land Use History"
            },
            water: {
                source: "Water Source",
                quality: "Water Quality",
                status: {
                    pass: "Pass",
                    fail: "Fail",
                    pending: "Pending"
                }
            },
            docs: {
                landTitle: "Land Title Document",
                rentalContract: "Rental Contract",
                consentLetter: "Consent Letter",
                farmMap: "Farm Layout / Map",
                waterReport: "Water Analysis Report"
            }
        },
        plots: {
            title: "Plot Zoning",
            subtitle: "Define zones and sub-plots for QR Code generation and traceability",
            summary: {
                title: "Area Summary",
                totalArea: "Total Area",
                allocatedArea: "Allocated",
                remainingArea: "Remaining",
                qrCount: "QR Codes",
                unit: "Unit",
                noTotalArea: "No total area found: Please provide details in Step 3 (Farm Info) first"
            },
            list: {
                title: "Plot List",
                empty: {
                    title: "No plots added yet",
                    subtitle: "Click here or the button below to add a new plot"
                },
                badges: {
                    soil: "Soil",
                    seed: "Seed",
                    ipm: "IPM"
                },
                addTitle: "Add New Plot",
                addSubtitle: "Click to enter plot details",
                addBtn: "Add Plot"
            },
            form: {
                name: "Plot Name",
                namePlaceholder: "e.g., A1, Zone B",
                area: "Area Size",
                areaPlaceholder: "Number",
                unit: "Unit",
                gacpTitle: "Quality Data (GACP)",
                soilType: "Soil Type",
                seedSource: "Seed Source",
                ipmLabel: "Integrated Pest Management (IPM) Plan",
                select: "-- Select --"
            },
            systems: {
                outdoor: "Outdoor",
                greenhouse: "Greenhouse",
                indoor: "Indoor"
            },
            alerts: {
                areaExceeded: "Area added ({area}) exceeds remaining area ({remaining})"
            }
        },
        documents: {
            title: "Documents",
            subtitle: "Please upload the required documents below for consideration.",
            aiScan: "AI System is checking",
            downloadForm: "Download Form",
            upload: "Click to Upload",
            dragDrop: "or Drag & Drop files here",
            status: {
                mandatory: "Required",
                uploaded: "Uploaded",
                missing: "Missing",
                complete: "Complete",
                missingCount: "missing",
            },
            headers: {
                todo: "To Do",
                done: "Uploaded",
            },
            extra: {
                video: "Farm Introduction Video",
                hint: "Introduce yourself and show the farm briefly (max 5 minutes)",
            },
            docNames: {
                APP_FORM: "Application Form",
                house_reg: "House Registration",
                land_deed: "Land Deed/Usage Rights",
                land_consent: "Land Usage Consent",
                site_map: "Farm Site Map",
                building_plan: "Building/Facility Plan",
                photos_exterior: "Exterior Photos",
                photos_interior: "Interior Photos",
                production_plan: "Production Plan",
                security_measures: "Security Measures",
                medical_cert: "Medical Certificate",
                elearning_cert: "e-Learning Certificate",
                strain_cert: "Strain Source Certificate (If any)",
                sop_thai: "Standard Operating Procedures (SOPs)",
                training_records: "provider Training Records",
                PROVIDER_test: "provider Knowledge Test Results",
                soil_water_test: "Soil/Water Analysis Results",
                flower_test: "Flower Analysis Results (If any)",
                input_report: "Agricultural Input Records",
                cp_ccp_plan: "Critical Control Points Plan (CP/CCP)",
                calibration_cert: "Equipment Calibration Certificate",
            },
            messages: {
                analyzing: "Analyzing document... Please wait",
                valid: "Document passed initial check",
                invalid: "Document not found or invalid",
                error: "Upload Error"
            },
        },

        preview: {
            title: "Review",
            subtitle: "Please review the information before submitting your application.",
            print: "Print/Save PDF",
            headers: {
                applicant: "Applicant Information",
                farm: "Production Site Information",
                plots: "Plots",
                production: "Production Management",
                documents: "Attached Documents",
            },
            labels: {
                name: "Full Name",
                id: "ID Card / Business ID",
                phone: "Phone Number",
                email: "Email",
                address: "Address",
                hygiene: "Personal Hygiene",
                farmName: "Farm/Site Name",
                location: "Location",
                totalArea: "Total Area",
                ownership: "Ownership",
                water: "Water Sources",
                gps: "GPS Coordinates",
                sanitation: "Sanitation",
                totalPlants: "Total Plants",
                plantingDate: "Estimated Planting Date",
                docCount: "Document Count",
            },
            stats: {
                plots: "Plots",
                plants: "Total Plants",
                area: "Area (Rai)",
                docs: "Documents"
            },
            actions: {
                ready: "Ready for Submit",
                expand: "Expand",
                collapse: "Collapse",
                edit: "Edit",
                next: "Proceed to Submit"
            }
        },
        quote: {
            title: "Quotation",
            subtitle: "Please review and accept the quotation to proceed.",
            milestone1Title: "Milestone 1: Document Review Fee",
            milestone1Desc: "Payment is divided into 2 milestones. The first milestone is for experts to review your application documents.\nOnce paid, the verification process will begin within 5-7 business days.",
            dtam: {
                title: "GACP Fee",
                subtitle: "DTAM",
                footer: "Official Registration Portal",
                feeLabel: "Document Check (Phase 1)",
            },
            platform: {
                title: "Platform Fee",
                subtitle: "GACP Platform Co., Ltd.",
                feeLabel: "Service Fee (10%)",
            },
            buttons: {
                viewDetails: "View Details",
                accept: "Accept Quote",
                accepted: "Accepted",
            },
            summary: {
                totalLabel: "Net Total",
                netTotal: "Total Payment",
            },
            labels: {
                certBody: "Certification Body",
                platform: "Software Platform",
                vatIncluded: "* VAT Included"
            },
        },
        invoice: {
            title: "Payment",
            subtitle: "Please make the payment according to the invoice to proceed to the next step.",
            phase1Title: "Payment (Fee)",
            phase2Title: "Audit Fee Payment",
            paper: {
                orgName: "Department of Thai Traditional and Alternative Medicine",
                orgAddress: "88/23 Moo 4, Tiwanon Road, Mueang District, Nonthaburi 11000",
                invoiceTitle: "INVOICE",
                customer: "Customer Name",
                address: "Address",
                date: "Date:",
                dueDate: "Due Date:",
                no: "No:",
                note: "This document is computer generated.",
            },
            table: {
                no: "No.",
                description: "Description",
                amount: "Amount (THB)",
                total: "Net Amount",
            },
            items: {
                standardFee: "GACP Certification Standard Fee",
                docCheck: "Document Check Fee",
                auditFee: "Audit Fee",
            },
            payment: {
                qrTitle: "Pay via QR Code",
                qrSubtitle: "Supports all banks (Mobile Banking)",
                actions: {
                    verifying: "Verifying...",
                    payViaMobile: "Pay via Mobile Banking",
                    downloadInvoice: "Download Invoice",
                    viewPdf: "View PDF"
                },
                supportedMethods: "Supports Thai QR Payment, Mobile Banking, and Credit Card",
                vatIncluded: "* VAT Included"
            },
            modal: {
                scanQr: "Scan QR Code to Pay",
                simulate: "Simulate Success",
                cancel: "Cancel",
            },
        },
        submit: {
            title: "Confirm Submission",
            subtitle: "Verify accuracy and confirm to proceed.",
            button: "Confirm Submission",
            submitting: "Submitting...",
            infoCard: {
                title: "Applicant Info",
                applicantName: "Applicant Name",
                farmName: "Farm Name",
                location: "Location",
                plant: "Plant",
            },
            declarations: {
                title: "Confirmation and Declarations",
                dataCorrect: "I confirm that all information is correct and true. If found false, I consent to immediate cancellation.",
                termsAccepted: "I accept the Terms and Conditions of GACP Certification by DTAM.",
                paymentUnderstood: "I understand that the Audit Fee must be paid after receiving the Invoice.",
            },
        },
        success: {
            title: "Submission Successful!",
            message: "Thank you for applying for GACP Certification.\nOur team has received your information.",
            caseId: "Application Case ID",
            saveNote: "Please save this ID to track your status.",
            status: "Status: Pending Review",
            timeline: {
                title: "Verification Time",
                desc: "Approx. 3-5 Business Days"
            },
            notification: {
                title: "Status Notification",
                desc: "Via SMS & Email"
            },
            researchInfo: {
                title: "Research Info:",
                project: "Project: GACP Standard Development for Thai Herbs",
                researcher: "Researcher: DTAM",
                contact: "Contact: support@gacp-research.com",
            },
            buttons: {
                home: "Back to Home",
                print: "Print Receipt/Application",
            },
        },
        navigation: {
            next: "Next",
            back: "Back",
            saveDraft: "Save Draft"
        },
        common: {
            errorTitle: "An error occurred"
        },
        generalStep: {
            applicantTypeHeader: "Applicant Type",
            typeNames: {
                INDIVIDUAL: "Individual",
                COMMUNITY: "Community Enterprise",
                JURISTIC: "Juristic Person"
            },
            typeCards: {
                individual: { label: "Individual", subLabel: "Smallholder Farmer" },
                community: { label: "Community Enterprise", subLabel: "Farmer Group (registered with CAEW)" },
                juristic: { label: "Juristic Person", subLabel: "Company / Partnership / Cooperative" }
            },
            workspace: {
                banner: "Applying as Workspace",
                typePrefix: "Type",
                bindNote: "This application is bound to the workspace; the certificate will be issued under its name.",
                editLink: "Edit workspace profile",
                switchHint: "Need to switch or add a new applicant workspace? Go to the workspace management page and select Create new workspace."
            },
            companyTypeOptions: {
                LIMITED_COMPANY: "Limited Company",
                LIMITED_PARTNERSHIP: "Limited Partnership",
                PUBLIC_LIMITED: "Public Limited Company",
                COOPERATIVE: "Agricultural Cooperative",
                OTHER: "Other"
            }
        },
        farmInfo: {
            sections: {
                basic: { title: "1) Basic Farm Information", subtitle: "Enter farm name, address, province, and total area." },
                gps: { title: "2) Farm GPS Coordinates", subtitle: "Mark the plot location for inspection." },
                water: { title: "3) Water Source Information", subtitle: "As per DTAM standards." }
            },
            fields: {
                farmName: {
                    label: "Farm / Cultivation Site Name",
                    placeholder: "e.g., Ban Na Herb Farm",
                    description: "This name will appear on the GACP certificate."
                },
                address: {
                    label: "Address",
                    placeholder: "House no., village, lane, road"
                },
                province: { label: "Province", placeholder: "Select province" },
                district: {
                    label: "District",
                    placeholderEnabled: "Select district",
                    placeholderDisabled: "Please select province first",
                    placeholderText: "Type district name"
                },
                subdistrict: {
                    label: "Sub-district",
                    placeholder: "Enter sub-district",
                    placeholderEnabled: "Select sub-district"
                },
                postalCode: { label: "Postal Code", placeholder: "00000" },
                totalArea: { label: "Total Area", placeholder: "0" },
                landOwnership: { label: "Land Ownership", description: "Supporting document required." }
            },
            gps: {
                setBadge: "Set",
                pickMap: { title: "Pick from map", subtitle: "Recommended - most accurate" },
                currentLocation: {
                    title: "Use current location",
                    searching: "Searching...",
                    subtitle: "Must be at the farm"
                },
                selected: { title: "Selected coordinates", editBtn: "Edit" },
                required: "Please specify the farm GPS coordinates (required)."
            },
            water: {
                sourceType: { label: "Water Source Type", placeholder: "Select water source type" },
                irrigation: { label: "Primary Irrigation System (farm-level)", placeholder: "Select irrigation system" },
                otherSource: { label: "Specify other water source", placeholder: "e.g., groundwater combined with community supply" },
                filtration: { label: "Water Filtration System (multi-select)" },
                testFile: {
                    label: "Water Quality Test Report (if any)",
                    description: "Attach the lab report to support evaluation.",
                    placeholder: "Choose PDF/JPG/PNG file"
                }
            }
        },
        qc: {
            headers: {
                main: "Quality Control",
                mainSubtitle: "Fill in harvest, drying, curing, storage, and GACP measure details.",
                harvest: "Harvest",
                harvestSubtitle: "Specify harvest method, maturity stage, and trimming method per GACP (DTAM Section 10).",
                post: "Post-Harvest",
                postSubtitle: "Drying, curing, storage, and packaging (DTAM Sections 11-14).",
                gacp: "Quality Control Measures (GACP)",
                gacpSubtitle: "DTAM Sections 1-3"
            },
            summary: {
                harvestLabel: "Harvest",
                storageLabel: "Storage / Packaging",
                gacpLabel: "GACP Measures",
                configured: "Configured",
                notConfigured: "Not specified",
                items: "items"
            },
            errorTitle: "Error",
            fields: {
                selectPlaceholder: "Select...",
                harvestMethodTitle: "Harvest Method *",
                maturity: "Harvest Maturity Stage",
                trim: "Trimming Method",
                dryingMethod: "Drying Method *",
                airflow: "Ventilation System",
                dryDays: "Drying Days",
                dryDaysPlaceholder: "e.g., 7-14",
                dryTemp: "Temperature (°C)",
                dryTempPlaceholder: "e.g., 18-25",
                dryHumidity: "Relative Humidity (%RH)",
                dryHumidityPlaceholder: "e.g., 45-55",
                dryDarkRoom: "Dry in dark room",
                hasCuring: "Has curing process",
                curingDuration: "Curing Duration (weeks)",
                curingDurationPlaceholder: "e.g., 2-8",
                curingTemp: "Temperature (°C)",
                curingTempPlaceholder: "e.g., 15-21",
                curingHumidity: "Humidity (%RH)",
                curingHumidityPlaceholder: "e.g., 55-65",
                curingContainer: "Curing Container",
                burpFreq: "Ventilation / Burp Frequency",
                storage: "Storage System *",
                storageTempControl: "Controlled Temperature (°C)",
                storageTempControlPlaceholder: "e.g., 15-25",
                storageHumidity: "Storage Humidity (%RH)",
                storageHumidityPlaceholder: "e.g., 45-60",
                packaging: "Select Packaging Type *",
                packagingOther: "Specify details",
                packagingOtherPlaceholder: "e.g., coated paper bag, cardboard box"
            },
            gacpIntro: "Select the measures implemented at the establishment to improve readiness before assessment.",
            measuresLabel: "Selected measures",
            note: {
                prefix: "Note:",
                body: "Security system data (fence, CCTV, access control) was entered earlier in the \"Farm Information\" step."
            }
        },
        documentsStep: {
            uploadStatus: {
                title: "Document upload status",
                mandatoryBadge: "mandatory documents",
                completeMessage: "All mandatory documents uploaded.",
                remainingPrefix: "Remaining",
                remainingSuffix: "items"
            },
            errorBlock: {
                title: "Cannot proceed yet"
            },
            errors: {
                missingType: "Document type not found for upload. Please try again.",
                fileTooLargePrefix: "File",
                fileTooLargeSuffix: "exceeds 20 MB. Please upload a smaller file.",
                fileTypePrefix: "File",
                fileTypeSuffix: "does not match the allowed format",
                uploadFailed: "Document upload failed. Please try again.",
                missingMandatoryPrefix: "Please upload all mandatory documents before proceeding",
                missingListPrefix: "Missing documents",
                missingMorePrefix: "and",
                missingMoreSuffix: "more items"
            },
            tags: {
                required: "Required",
                optional: "Optional"
            },
            uploaded: {
                success: "Upload successful",
                open: "Open",
                remove: "Remove"
            },
            video: {
                helper: "Provide a YouTube or platform URL the agency can access.",
                placeholder: "https://www.youtube.com/watch?v=..."
            },
            uploadHint: {
                click: "Click to upload",
                supports: "Supports"
            }
        },
        reviewStep: {
            header: {
                title: "Review information before confirming",
                subtitle: "The preview below aggregates data from every step so you can verify accuracy before officially submitting the application."
            },
            stats: {
                completion: "Application completeness",
                uploaded: "Documents uploaded",
                fieldCount: "Fields in preview",
                items: "items"
            },
            checklist: {
                consent: "Consent and application type",
                plant: "Plant, purpose, and cultivation method",
                applicant: "Applicant information",
                farm: "Farm and plot information",
                production: "Cultivation information",
                quality: "Harvest and quality",
                documents: "Supporting documents"
            },
            snapshot: {
                loading: "Loading the latest preview from the system...",
                errorPrefix: "Could not load the latest preview",
                errorFallback: "Could not load the latest preview from the system.",
                retry: "Try again"
            },
            canProceed: {
                notReady: "Incomplete information — please fix before confirming.",
                fixData: "Fix data",
                editAria: "Edit data",
                ready: "Data is complete. Ready to confirm and submit."
            },
            errors: {
                missingPrefix: "Incomplete data",
                confirmAll: "Please confirm all 3 conditions below before continuing.",
                preparing: "Error preparing the application",
                prepareTitle: "Error preparing the application",
                cannotPrepare: "Could not prepare the application.",
                retry: "Try again"
            },
            confirmCard: {
                title: "Confirm and submit",
                subtitle: "Please read and confirm all 3 conditions before officially submitting the application.",
                dataCorrect: {
                    title: "Confirm that the data and documents are correct",
                    body: "I have reviewed the data and attached documents and confirm that they are accurate."
                },
                terms: {
                    title: "Accept GACP terms and standards",
                    body: "I acknowledge the application, assessment, and GACP standard conditions."
                },
                payment: {
                    title: "Acknowledge the preview and payment steps",
                    body: "After confirmation, the system will route to the preview and request the milestone 1 payment before the official submission."
                }
            },
            alertProceed: "Once confirmed, the system will prepare the application and route to the preview for one more review before continuing to payment and the official submission.",
            metadata: {
                applicantName: "Applicant name",
                createdDate: "Preview creation date",
                refNumber: "Application reference",
                statusLabel: "Review status",
                complete: "Complete",
                incomplete: "Incomplete"
            },
            selectionRows: {
                plantType: "Plant type",
                cultivation: "Cultivation method"
            },
            submitNav: {
                submitting: "Preparing application...",
                confirmCta: "Confirm and go to preview"
            }
        },
        /* Y1-FIX-A — wizard chrome (header, step counter, tip toggle,
           error states). Used by:
             - apps/web-app/src/app/health/applications/_components/application-step-page.tsx
             - apps/web-app/src/app/health/applications/new/_steps/layout.tsx
           Step counter uses `{n}` / `{total}` placeholders the consumer
           interpolates via String.replace, matching the pattern used by
           `common.time.minutesAgo`. */
        chrome: {
            stepCounter: "Step {n} of {total}",
            tipShow: "Show tip",
            tipHide: "Hide tip",
            loadingStep: "Preparing step...",
            errorTitle: "Error",
            stepNotFound: "Step data not found",
            stepNumberNotFound: "Step {n} not found",
            stepLoadFailed: "Unable to load step data",
            stepNotAvailable: "This step is not available yet",
            closeAria: "Close",
            headerTitleEdit: "Edit GACP Application",
            headerTitlePayment: "Payment Phase",
            headerTitleNew: "GACP Application System",
            headerSubtitleStatus: "Status: {label}",
            headerSubtitleForm: "Online application form",
            editBannerTitle: "Items to revise",
            editBannerBadge: "MODE: EDIT"
        },
        /* Y1-FIX-A — per-FLOW_STEP labels in English. Each entry mirrors
           the Thai canonical labels in `application-flow-config.ts:33-110`.
           Consumers should call `resolveStepLabel(step, language)` etc.
           rather than reach into this dict directly, but we keep it here
           as the source of truth in case future refactors switch the
           config to dict-key-only lookups. */
        flowSteps: {
            consent: {
                label: "Consent",
                title: "Consent & Application Type",
                description: "Accept the terms and choose the certification application type."
            },
            plant_selection: {
                label: "Plant info",
                title: "Plant & Strain Information",
                description: "Specify certification type, plant species, strain, and quantity."
            },
            general: {
                label: "Applicant",
                title: "Applicant Information",
                description: "Choose applicant type and fill in the required details."
            },
            farm_info: {
                label: "Farm site",
                title: "Farm Site & Plots",
                description: "Provide farm location, GPS coordinates, and plot details."
            },
            production_info: {
                label: "Cultivation",
                title: "Cultivation",
                description: "Specify cultivation method, seed source, and production inputs."
            },
            quality_control: {
                label: "Harvest & quality",
                title: "Harvest & Quality",
                description: "Specify harvest method, drying, and quality standards."
            },
            documents: {
                label: "Documents",
                title: "Supporting Documents",
                description: "Upload supporting documents per applicant type."
            },
            review: {
                label: "Review",
                title: "Review & Submit",
                description: "Review all information before confirming submission."
            }
        },
        /* Y1-FIX-A — payment phase step labels in English. */
        paymentSteps: {
            invoice: {
                label: "Payment",
                title: "Quotation & Invoice"
            },
            success: {
                label: "Submitted",
                title: "Success"
            }
        }
    },
};
