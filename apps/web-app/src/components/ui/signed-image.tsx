'use client';

/**
 * SignedImage — render an image that lives behind the gated `/uploads` mount
 * (W1-2, 2026-08-21).
 *
 * A plain `<img src="/uploads/...">` cannot attach an Authorization header, so
 * a Bearer-only client got 401 on its own file. This component asks the backend
 * to mint a short-lived signed URL for that exact object first (see
 * `@/lib/services/signed-file-url`), then renders it with no credentials at all.
 *
 * Use this instead of a bare `<img>` wherever the source is an uploaded file,
 * ESPECIALLY inside a `.map()` — a hook cannot be called per iteration, a
 * component can.
 *
 * A `data:` / `blob:` / absolute source passes straight through unsigned, so a
 * list that mixes a local camera preview with a stored file just works.
 */

import * as React from 'react';
import { useSignedFileUrl } from '@/lib/hooks/use-signed-file-url';

export interface SignedImageProps {
    src?: string | null;
    alt: string;
    className?: string;
    /** Rendered while the mint is in flight. Defaults to a neutral placeholder box. */
    placeholderClassName?: string;
    'data-testid'?: string;
}

export function SignedImage({
    src,
    alt,
    className,
    placeholderClassName,
    'data-testid': testId,
}: SignedImageProps) {
    const { url, error } = useSignedFileUrl(src);

    if (error) {
        return (
            <span
                role="img"
                aria-label={`เปิดรูปไม่ได้: ${alt}`}
                title={error}
                data-testid={testId ? `${testId}-error` : undefined}
                className={placeholderClassName || className}
            >
                <span aria-hidden="true">!</span>
            </span>
        );
    }

    if (!url) {
        return (
            <span
                aria-hidden="true"
                data-testid={testId ? `${testId}-loading` : undefined}
                className={placeholderClassName || className}
            />
        );
    }

    return (
        // eslint-disable-next-line @next/next/no-img-element -- uploaded files come
        // from many storage backends (local disk, MinIO presign); next/image would
        // need every host enumerated in remotePatterns. Kept backend-agnostic.
        <img src={url} alt={alt} className={className} data-testid={testId} />
    );
}

export default SignedImage;
