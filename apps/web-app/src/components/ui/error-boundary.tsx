"use client";

import { Component, ReactNode } from "react";
import { Button } from '@/components/ui/primitives/button';
import { Icons } from './icons';

interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: ReactNode;
    onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error?: Error;
}

/**
 * Eco-Professional Error Boundary
 * Catch JavaScript errors with UI Kit styling
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error("[ErrorBoundary] Caught error:", error, errorInfo);
        this.props.onError?.(error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="mx-auto w-full max-w-sm px-4">
                    <div className="rounded-lg border border-mantine-red-2 bg-card p-6 shadow-sm">
                        <div className="mb-4 flex items-center justify-center">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                <Icons.AlertTriangle size={32} />
                            </div>
                        </div>
                        <p className="mb-2 text-center text-lg font-bold">
                            เกิดข้อผิดพลาด
                        </p>
                        <p className="mb-5 text-center text-muted-foreground">
                            กรุณาลองใหม่อีกครั้ง หรือติดต่อผู้ดูแลระบบ
                        </p>
                        <div className="flex items-center justify-center">
                            <Button
                                color="green"
                                onClick={() => this.setState({ hasError: false })}
                            >
                                ลองใหม่
                            </Button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
