import { config as loadDotenv } from 'dotenv';
import type { NextConfig } from 'next';

// .env.local ของทั้ง repo อยู่ที่ root ไฟล์เดียว
loadDotenv({ path: '../../.env.local', quiet: true });
loadDotenv({ path: '../../.env', quiet: true });

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // เอกสารสำหรับ AI agent อยู่ที่ docs/ ของ repo ไม่ให้ Next สร้าง AGENTS.md/CLAUDE.md ซ้อน
  agentRules: false,
  headers: async () => [
    // ทุกหน้าห้ามถูกฝังใน frame ยกเว้นเอกสารของผู้ใช้ที่เปิดดูในหน้า (viewer ของเราเอง origin เดียวกัน)
    { source: '/((?!applicant/documents/).*)', headers: securityHeaders },
    {
      source: '/applicant/documents/:documentId/content',
      headers: [
        ...securityHeaders.filter((header) => header.key !== 'X-Frame-Options'),
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
      ],
    },
  ],
};

export default nextConfig;
