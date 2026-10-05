/**
 * Test utilities for DOM testing
 * Wraps components with necessary providers
 */
import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';

// Mock providers (simplified versions for testing)
const MockLanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    return <>{children}</>;
};

// Custom render function with providers
interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
    withLanguage?: boolean;
}

function customRender(
    ui: ReactElement,
    options: CustomRenderOptions = {}
) {
    const { _withLanguage = true, ...renderOptions } = options;

    function AllProviders({ children }: { children: React.ReactNode }) {
        return (
            <MockLanguageProvider>
                {children}
            </MockLanguageProvider>
        );
    }

    return render(ui, { wrapper: AllProviders, ...renderOptions });
}

// Re-export everything from testing-library
export * from '@testing-library/react';

// Override render method
export { customRender as render };

// Helper functions for common test scenarios
export const createMockUser = (overrides = {}) => ({
    id: 'user-123',
    email: 'test@example.com',
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    role: 'HEALTH',
    accountType: 'INDIVIDUAL',
    ...overrides,
});

export const createMockApplication = (overrides = {}) => ({
    id: 'app-456',
    applicationNumber: 'GACP-2026-001',
    status: 'DRAFT',
    serviceType: 'new_application',
    createdAt: new Date().toISOString(),
    ...overrides,
});

export const waitForAsync = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
