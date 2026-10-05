export const enAuth = {
auth: {
        loginTitle: "Login",
        registerTitle: "Register",
        login: {
            title: "Log in to GACP",
            subtitle: "Manage your farm standards seamlessly.",
            placeholder: {
                identifier: "National ID (13 digits)",
                password: "Password"
            },
            button: {
                submit: "Log in",
                loading: "Logging in..."
            },
            noAccount: "Don't have an account?",
            registerLink: "Sign up",
            error: {
                invalid: "Invalid credentials",
                connection: "Connection failed",
                sessionExpired: "Session expired. Please log in again."
            }
        },
        register: {
            title: "Register",
            subtitle: "Fill in the details to create an account",
            stepIndicator: "Step {step} / {total}",
            marketing: {
                title: "Entrepreneur Registration\nLogin to GACP System",
                subtitle: "GACP System Registration",
                desc: "Join us in elevating Thai herbs\nto international standards with traceable quality",
                footer: "Official Registration Portal"
            },
            accountTypes: {
                individual: { label: "Individual", subtitle: "Smallholder Farmer", idLabel: "National ID (13 Digits)", idHint: "1-2345-67890-12-3" },
                juristic: { label: "Juristic Person", subtitle: "Company / Partnership", idLabel: "Juristic ID (13 Digits)", idHint: "0-1055-12345-67-8" },
                enterprise: { label: "Community Enterprise", subtitle: "Farming Group", idLabel: "Enterprise ID", idHint: "XXXX-XXXX-XXX" }
            },
            steps: {
                pdpa: "PDPA",
                account: "Account",
                identity: "Identity",
                personal: "Personal Info",
                security: "Password"
            },
            pdpa: {
                title: "Privacy Policy",
                accept: "I have read and agree to the terms above",
                acceptHint: "Please scroll to the bottom to accept the terms",
                content: {
                    terms: "Terms and Conditions",
                    intro: "Department of Thai Traditional and Alternative Medicine (DTAM) needs to collect your personal data for GACP Thailand certification...",
                    collectionTitle: "1. Data Collection",
                    collectionDesc: "We collect your name, surname, national ID, and establishment coordinates...",
                    purposeTitle: "2. Purpose",
                    purposeDesc: "To identify and verify rights for holding safe agriculture standard certificates..."
                }
            },
            form: {
                subtitles: {
                    selectAccount: "Select Account Type",
                    identity: "Identity Verification",
                    personal: "Personal Information",
                    juristic: "Establishment Information",
                    security: "Set Secure Password"
                },
                fields: {
                    firstName: "First Name",
                    lastName: "Last Name",
                    companyName: "Company Name",
                    communityName: "Enterprise Name",
                    phone: "Phone Number (10 Digits)",
                    email: "Email (Optional)",
                    password: "New Password",
                    confirmPassword: "Confirm Password",
                    terms: "I accept the Terms of Service and Privacy Policy"
                },
                errors: {
                    phoneLength: "Entered {length}/10 digits",
                    phoneFormat: "Number must start with 06, 08, or 09",
                    passwordMismatch: "Passwords do not match",
                    general: "An error occurred"
                },
                buttons: {
                    back: "Back",
                    next: "Continue",
                    submit: "Confirm Registration",
                    login: "Login",
                    loginLink: "Login Here"
                },
                helpers: {
                    usernameNote: "This ID will be used as your Username for login and initial rights verification.",
                    existingAccount: "Already have an account?"
                }
            }
        }
    },
};
