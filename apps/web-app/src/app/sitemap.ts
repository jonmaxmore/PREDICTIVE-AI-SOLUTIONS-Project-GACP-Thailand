import { MetadataRoute } from 'next';
import {
    HEALTH_LOGIN_ROUTE,
    PROVIDER_LOGIN_ROUTE,
    REGISTER_ROUTE,
} from '@/lib/constants/auth-routes';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://gacp-platform.com';

type ChangeFrequency = MetadataRoute.Sitemap[number]['changeFrequency'];

const STATIC_ROUTES: Array<{ path: string; priority: number; changeFrequency: ChangeFrequency }> = [
    // Marketing surface (Iter 28) — public, indexable. Since E1 the root
    // redirects to the /auth login chooser, so /about is the indexable front
    // of the marketing surface; advertising '/' as a priority-1.0 marketing
    // page would send crawlers to a login redirect (E1 audit finding).
    { path: '/about', priority: 1.0, changeFrequency: 'monthly' },
    { path: '/pricing', priority: 0.9, changeFrequency: 'monthly' },
    { path: '/terms-of-service', priority: 0.7, changeFrequency: 'yearly' },
    { path: '/privacy-policy', priority: 0.7, changeFrequency: 'yearly' },
    // Auth entry points.
    { path: HEALTH_LOGIN_ROUTE, priority: 0.9, changeFrequency: 'monthly' },
    { path: PROVIDER_LOGIN_ROUTE, priority: 0.9, changeFrequency: 'monthly' },
    { path: REGISTER_ROUTE, priority: 0.8, changeFrequency: 'monthly' },
    // Legacy short slugs (kept indexable for backwards compatibility).
    { path: '/terms', priority: 0.5, changeFrequency: 'yearly' },
    { path: '/privacy', priority: 0.5, changeFrequency: 'yearly' },
];

export default function sitemap(): MetadataRoute.Sitemap {
    const lastModified = new Date();

    return STATIC_ROUTES.map((route) => ({
        url: `${BASE_URL}${route.path}`,
        lastModified,
        changeFrequency: route.changeFrequency,
        priority: route.priority,
    }));
}
