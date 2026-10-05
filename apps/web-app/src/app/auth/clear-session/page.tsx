'use client';

import { useEffect, useState } from 'react';
import '@/styles/provider-styles.css';
import { PROVIDER_LOGIN_ROUTE } from '@/lib/constants/auth-routes';

export default function ClearSessionPage() {
    const [status, setStatus] = useState('Clearing session...');

    useEffect(() => {
        async function clearAll() {
            // 1. Call server-side logout to clear httpOnly cookies
            try {
                await fetch('/api/auth/provider/logout', { method: 'POST', credentials: 'include' });
            } catch { /* ignore */ }
            // ประตูของเกษตรกร · เดิมหน้านี้ยิง /api/auth/logout ซึ่งไม่มีเราเตอร์อยู่จริง
            // (index.js แขวนแค่ /auth/health, /auth/provider, /auth/idp) ⇒ คุกกี้ httpOnly
            // ของเกษตรกรไม่เคยถูกล้าง และ jti ไม่เคยถูกเขียนลง blocklist โทเคนจึงยังใช้ได้
            // ต่อจนหมดอายุเอง ทั้งที่ผู้ใช้กด "ออกจากระบบ" ไปแล้ว
            try {
                await fetch('/api/auth/health/logout', { method: 'POST', credentials: 'include' });
            } catch { /* ignore */ }

            // 2. Clear ALL localStorage keys
            localStorage.clear();

            // 3. Clear ALL client-accessible cookies
            document.cookie.split(';').forEach((c) => {
                const name = c.trim().split('=')[0];
                if (name) {
                    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
                }
            });

            setStatus('Session cleared! Redirecting to login...');

            // 4. Redirect to provider login
            setTimeout(() => {
                window.location.href = PROVIDER_LOGIN_ROUTE;
            }, 500);
        }

        void clearAll();
    }, []);

    return (
        <div className="clear-session-container">
            <p>{status}</p>
        </div>
    );
}
