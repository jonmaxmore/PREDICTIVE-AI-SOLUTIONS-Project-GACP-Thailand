'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { consumeAccountInactiveSignOut } from '@/lib/api/account-inactive';

/**
 * Whether a login page should tell the person that their account is suspended.
 *
 * True only when this browser has just been signed out for that reason
 * (lib/api/account-inactive.ts): the reason is in the URL and the marker cookie
 * our own pages set is there. The marker is removed once read, so the notice is
 * shown once. Read after mount, because the server render cannot see
 * document.cookie.
 */
export function useAccountInactiveNotice(): boolean {
    const searchParams = useSearchParams();
    const [show, setShow] = useState(false);

    useEffect(() => {
        if (consumeAccountInactiveSignOut(searchParams)) {
            setShow(true);
        }
    }, [searchParams]);

    return show;
}
