'use client';

/**
 * useSignedFileUrl — render an uploaded file in a browser element that cannot
 * carry an Authorization header (W1-2, 2026-08-21).
 *
 * Give it the stored path (`/uploads/...`) and it hands back a short-lived
 * signed URL that `<img src>`, `<iframe src>` and `<a href>` can use with no
 * credentials at all. See `@/lib/services/signed-file-url` for why that is
 * necessary rather than attaching a token per component.
 *
 * The three states are deliberately explicit so a caller cannot accidentally
 * render a broken image: `loading` while the mint is in flight, `error` (a Thai
 * message naming the cause and the next action) when the backend refuses, and
 * `url` only when there is something real to point at.
 */

import { useEffect, useState } from 'react';
import { getSignedFileUrl } from '@/lib/services/signed-file-url';

export interface SignedFileUrlState {
    url: string | null;
    loading: boolean;
    error: string | null;
}

const FALLBACK_MESSAGE = 'เปิดไฟล์ไม่ได้ คุณลองใหม่อีกครั้งได้';

export function useSignedFileUrl(fileUrl?: string | null): SignedFileUrlState {
    const target = String(fileUrl || '').trim();
    const [state, setState] = useState<SignedFileUrlState>({
        url: null,
        loading: Boolean(target),
        error: null,
    });

    useEffect(() => {
        if (!target) {
            setState({ url: null, loading: false, error: null });
            return;
        }

        let cancelled = false;
        setState({ url: null, loading: true, error: null });

        getSignedFileUrl(target)
            .then((signed) => {
                if (cancelled) { return; }
                setState({ url: signed, loading: false, error: null });
            })
            .catch((err: unknown) => {
                if (cancelled) { return; }
                const message = err instanceof Error && err.message ? err.message : FALLBACK_MESSAGE;
                setState({ url: null, loading: false, error: message });
            });

        return () => { cancelled = true; };
    }, [target]);

    return state;
}

export default useSignedFileUrl;
