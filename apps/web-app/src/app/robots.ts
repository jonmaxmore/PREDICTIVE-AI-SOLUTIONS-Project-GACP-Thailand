import { MetadataRoute } from 'next';

/**
 * Dynamic robots.txt — Iter 28 update.
 *
 * Allows the public marketing surface (root, about, pricing, terms,
 * privacy, verify) and the auth entry points. Disallows
 * authenticated app routes that have no value to crawlers and that
 * leak signed-in state.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/about', '/pricing', '/terms-of-service', '/privacy-policy', '/auth/'],
        disallow: ['/api/', '/admin/', '/provider/', '/health/'],
      },
    ],
    sitemap: 'https://gacpth.com/sitemap.xml',
  };
}
