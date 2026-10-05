import { apiClient } from "@/lib/api/api-client";

export interface Application {
    id: string;
    applicationNumber?: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    plantId?: string;
    rejectCount?: number;
    data?: {
        applicantInfo?: { name: string };
        formData?: { plantId: string };
    };
    scheduledDate?: string;
    audit?: {
        mode?: "ONLINE" | "ONSITE";
        meetingUrl?: string;
        location?: string;
        scheduledDate?: string; // Legacy or redundant, keeping for safe measure
    };
    plant?: string;
    // [NEW] Expanded fields for UI
    fees?: {
        phase1?: { items: { description: string; amount: number }[] };
        phase2?: { items: { description: string; amount: number }[] };
    };
    applicantData?: {
        firstName?: string;
        lastName?: string;
        address?: string;
        [key: string]: unknown;
    };
    items?: unknown[];
}

export interface DashboardStats {
    total: number;
    pending: number;
    approved: number;
    todayChecked: number;
}

interface DashboardReportResponse {
    total?: number;
    pendingReview?: number;
    approved?: number;
}

export const ApplicationService = {
    /**
     * Get statistics for provider Dashboard
     */
    /**
     * Get statistics for provider Dashboard
     */
    getStats: async () => {
        // Updated to use the new Reports API
        const response = await apiClient.get<DashboardReportResponse>("/reports/dashboard");
        if (response.success && response.data) {
            return {
                success: true,
                data: {
                    total: response.data.total || 0,
                    pending: response.data.pendingReview || 0, // Map 'pendingReview' to 'pending'
                    approved: response.data.approved || 0,
                    todayChecked: 0 // Not yet implemented in backend
                }
            };
        }
        return response;
    },

    /**
     * Get applications for HEALTH_USER Dashboard
     */
    getMyApplications: async () => {
        return apiClient.get<Application[]>("/applications/my");
    },

    /**
     * Get pending reviews for provider (Document Review)
     */
    /**
     * Get single application by ID
     */
    getMyCertificates: async () => {
        return apiClient.get<Certificate[]>("/certificates/my");
    },

    /**
     * Download Certificate (Mock)
     */
    downloadCertificate: async (id: string) => {
        // This would typically trigger a blob download
        // For now, we return the URL to open in new tab
        return {
            success: true,
            data: `/api/certificates/${id}/download`
        };
    }
};

export interface Certificate {
    id: string;
    certificateNumber: string;
    siteName: string; // Farm Name
    plantType: string;
    issuedDate: string;
    expiryDate: string;
    status: string;
    qrCode: string;
}
