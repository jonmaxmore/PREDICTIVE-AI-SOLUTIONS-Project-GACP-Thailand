import Image from 'next/image';
import type { ReactNode } from 'react';
import { messages } from '@/messages/th.ts';

type IdentityButtonProps = {
  readonly href: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly brandClassName: string;
  readonly logo: ReactNode;
};

const BASE_CLASS_NAME =
  'flex h-[50px] w-full items-center justify-center gap-3 rounded-md px-5 text-[15px] font-bold transition-opacity';

// ปุ่มพาไปผู้ให้บริการยืนยันตัวตน: สีและโลโก้ตามเจ้าของบัญชี (Health ID, ThaID, Provider ID)
// เมื่อยังไม่ตั้งค่า client แสดงเป็นปุ่มปิด (ไม่ใช่ลิงก์) พร้อมคำอธิบายจากหน้าที่เรียก
function IdentityButton({ href, label, enabled, brandClassName, logo }: IdentityButtonProps) {
  if (!enabled) {
    return (
      <span
        aria-disabled="true"
        className={`${BASE_CLASS_NAME} cursor-not-allowed border border-border-soft bg-paper text-quiet`}
      >
        <span className="opacity-40 grayscale">{logo}</span>
        <span>{label}</span>
      </span>
    );
  }
  return (
    <a href={href} className={`${BASE_CLASS_NAME} text-white hover:opacity-95 ${brandClassName}`}>
      {logo}
      <span>{label}</span>
    </a>
  );
}

type ProviderButtonProps = { readonly href: string; readonly enabled: boolean };

// โลโก้ Health ID เป็นตัวอักษรขาว วางบนปุ่มเขียวของ Health ID ได้ตรง ๆ
export function HealthIdButton({ href, enabled }: ProviderButtonProps) {
  return (
    <IdentityButton
      href={href}
      enabled={enabled}
      label={messages.login.healthId}
      brandClassName="bg-health-id"
      logo={
        <Image
          src="/identity/health-id.png"
          alt=""
          width={68}
          height={30}
          className="h-[30px] w-auto"
        />
      }
    />
  );
}

export function ThaidButton({ href, enabled }: ProviderButtonProps) {
  return (
    <IdentityButton
      href={href}
      enabled={enabled}
      label={messages.login.thaid}
      brandClassName="bg-thaid"
      logo={
        <Image
          src="/identity/thaid.webp"
          alt=""
          width={30}
          height={30}
          className="h-[30px] w-[30px] rounded-[7px]"
        />
      }
    />
  );
}

// โลโก้ Provider ID ต้นฉบับเป็นตัวอักษรเขียว จึงกลับเป็นขาวล้วนให้เห็นบนปุ่มเขียว (ไม่พบไฟล์โลโก้ขาวจากผู้ให้บริการ)
export function ProviderIdButton({ href, enabled }: ProviderButtonProps) {
  return (
    <IdentityButton
      href={href}
      enabled={enabled}
      label={messages.login.providerId}
      brandClassName="bg-provider-id"
      logo={
        <Image
          src="/identity/provider-id.png"
          alt=""
          width={64}
          height={28}
          className={`h-7 w-auto ${enabled ? 'brightness-0 invert' : ''}`}
        />
      }
    />
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <span className="h-px flex-grow bg-border" />
      <span className="text-xs text-quiet">{messages.login.or}</span>
      <span className="h-px flex-grow bg-border" />
    </div>
  );
}
