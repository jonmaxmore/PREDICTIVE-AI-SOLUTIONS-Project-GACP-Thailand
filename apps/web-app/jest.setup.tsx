import { afterAll, beforeAll, jest } from '@jest/globals';
import { TextDecoder, TextEncoder } from 'node:util';
import '@testing-library/jest-dom';

if (!globalThis.TextEncoder) {
    (globalThis as typeof globalThis & { TextEncoder: typeof TextEncoder }).TextEncoder = TextEncoder;
}

if (!globalThis.TextDecoder) {
    (globalThis as typeof globalThis & { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder as typeof TextDecoder;
}

// Mock Next.js router
jest.mock('next/navigation', () => ({
    useRouter: () => ({
        push: jest.fn(),
        replace: jest.fn(),
        refresh: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        prefetch: jest.fn(),
        pathname: '/',
        query: {},
    }),
    usePathname: () => '/',
    useSearchParams: () => new URLSearchParams(),
}));

// Mock next/image
jest.mock('next/image', () => ({
    __esModule: true,
    default: (props: unknown) => {
        {/* eslint-disable-next-line @next/next/no-img-element */}
        return <img alt="" {...props} />;
    },
}));

// Y1 global mock — useLanguage hook must work in unit tests that don't
// wrap their renders in <LanguageProvider>. Default language is Thai
// (production default) so existing X1-X6 tests asserting Thai copy
// continue to pass without changes.
jest.mock('@/lib/i18n/language-context', () => {
    // reason: jest.mock factory must be sync — cannot use ES import inside.
    // Standard jest pattern for mocking with real module data.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { th } = require('@/lib/i18n/dictionaries/th');
    return {
        __esModule: true,
        useLanguage: () => ({
            language: 'th',
            setLanguage: jest.fn(),
            dict: th,
            t: (key: string) => key,
        }),
        LanguageProvider: ({ children }: { children: React.ReactNode }) => children,
    };
});

if (typeof window !== 'undefined') {
    // Mock window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: jest.fn().mockImplementation(query => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: jest.fn(),
            removeListener: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
        })),
    });

    // Mock IntersectionObserver
    class MockIntersectionObserver {
        observe = jest.fn();
        disconnect = jest.fn();
        unobserve = jest.fn();
    }
    Object.defineProperty(window, 'IntersectionObserver', {
        writable: true,
        value: MockIntersectionObserver,
    });

    // Mock ResizeObserver
    class MockResizeObserver {
        observe = jest.fn();
        disconnect = jest.fn();
        unobserve = jest.fn();
    }
    Object.defineProperty(window, 'ResizeObserver', {
        writable: true,
        value: MockResizeObserver,
    });
}

// Suppress console errors during tests (optional)
const originalError = console.error;
beforeAll(() => {
    console.error = (...args: unknown[]) => {
        // Filter out specific React warnings if needed
        if (/Warning: ReactDOM.render is no longer supported/.test(args[0])) {
            return;
        }
        originalError.call(console, ...args);
    };
});

afterAll(() => {
    console.error = originalError;
});
