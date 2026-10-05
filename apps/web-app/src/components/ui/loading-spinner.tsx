"use client";

import { Spinner } from '@/components/ui/spinner';
interface LoadingSpinnerProps {
    message?: string;
    size?: "sm" | "md" | "lg";
    fullScreen?: boolean;
}

/**
 * Loading Spinner — minimal / administrative.
 *
 * Government regulatory platforms benefit from a subdued loading state:
 * neutral gray spinner (not branded green), no bouncing dots, just a
 * thin ring + label. Per QA feedback 2026-05-02 — "loading ไม่มืออาชีพ
 * มันดูมีสีสันและไม่เหมาะกับรูปแบบบริหาร".
 */
export function LoadingSpinner({
    message = "กำลังโหลด...",
    size = "md",
    fullScreen = false
}: LoadingSpinnerProps) {

    const content = (
        <div className="flex items-center justify-center p-6">
            <div className="flex flex-col items-center gap-3">
                <Spinner color="gray" size={size} />
                {message && (
                    <p className="text-sm text-muted-foreground">
                        {message}
                    </p>
                )}
            </div>
        </div>
    );

    if (fullScreen) {
        return (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-mantine-gray-9">
                {content}
            </div>
        );
    }

    return content;
}

/**
 * Full page loading for route transitions
 */
export function PageLoading() {
    return <LoadingSpinner size="lg" message="กำลังโหลดหน้า..." fullScreen />;
}

export default LoadingSpinner;
