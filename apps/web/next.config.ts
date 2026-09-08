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
  headers: async () => [{ source: '/(.*)', headers: securityHeaders }],
};

export default nextConfig;
