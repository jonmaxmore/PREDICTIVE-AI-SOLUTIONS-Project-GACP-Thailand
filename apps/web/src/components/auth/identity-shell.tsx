import Image from 'next/image';
import type { ReactNode } from 'react';
import { messages } from '@/messages/th.ts';

// โครงหน้าเข้าสู่ระบบทุกทางเข้า (ผู้ขอรับรอง เจ้าหน้าที่กรม บริษัท ผลลัพธ์การล็อกอิน):
// พื้นหลังแบบ MOPH ID, หัวเป็นตรากรมและชื่อระบบ, การ์ดขาวตรงกลาง (แบบ ข. ที่ operator เลือก 2026-09-09)
export function IdentityShell({ children }: { readonly children: ReactNode }) {
  const login = messages.login;
  return (
    <main className="identity-backdrop flex min-h-screen flex-col items-center gap-6 overflow-hidden px-4 py-10 sm:py-14">
      <DecorativeCross className="left-[6%] top-[14%] hidden h-[120px] w-[120px] opacity-[0.12] lg:block" />
      <DecorativeCross className="right-[10%] bottom-[10%] hidden h-[180px] w-[180px] opacity-[0.10] lg:block" />
      <DecorativeCross className="-right-5 top-6 h-[110px] w-[110px] opacity-[0.10] lg:hidden" />

      <header className="flex flex-col items-center gap-2 text-center text-white">
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-3.5 sm:text-left">
          <div className="relative h-16 w-16 overflow-hidden rounded-full bg-white shadow-[0_8px_24px_-12px_rgba(0,0,0,0.5)]">
            {/* ตราจากเว็บกรมเป็นภาพรวมตรา + ชื่อ จึงครอปให้เห็นเฉพาะตรา รอไฟล์ต้นฉบับความละเอียดสูงจากกรม */}
            <Image
              src="/identity/dtam-emblem.webp"
              alt={login.emblemAlt}
              width={126}
              height={105}
              priority
              className="absolute -left-3 -top-[3px] h-auto w-[126px] max-w-none"
            />
          </div>
          <div className="flex flex-col">
            <span className="text-balance text-lg font-bold sm:text-xl">
              {login.departmentName}
            </span>
            <span className="text-[13px] text-white/75">{login.ministryName}</span>
          </div>
        </div>
        <p className="mt-1 max-w-[520px] text-balance text-sm font-semibold sm:text-base">
          {login.systemName}
        </p>
      </header>

      {children}
    </main>
  );
}

// การ์ดขาวตรงกลางของทุกหน้าในโครงนี้
export function IdentityCard({ children }: { readonly children: ReactNode }) {
  return (
    <section className="flex w-full max-w-[560px] flex-col gap-5 rounded-lg bg-surface p-5 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.45),0_12px_32px_-20px_rgba(20,60,35,0.18)] sm:p-8">
      {children}
    </section>
  );
}

// ข้อความใต้การ์ด (สีขาวจางบนพื้นเขียว)
export function IdentityFootnote({ children }: { readonly children: ReactNode }) {
  return (
    <p className="max-w-[560px] text-center text-[13px] leading-relaxed text-white/80">
      {children}
    </p>
  );
}

// ลายกากบาทจาง ๆ ประกอบพื้นหลัง (ตกแต่งเท่านั้น)
function DecorativeCross({ className }: { readonly className: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`pointer-events-none absolute ${className}`}
      viewBox="0 0 120 120"
      fill="none"
    >
      <path
        d="M45 10h30v35h35v30H75v35H45V75H10V45h35z"
        stroke="#ffffff"
        strokeWidth="6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
