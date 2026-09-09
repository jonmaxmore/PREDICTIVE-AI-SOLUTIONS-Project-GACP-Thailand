type IdentityProviderButtonProps = {
  readonly href: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly tone: 'primary' | 'secondary';
};

// ปุ่มพาไปผู้ให้บริการยืนยันตัวตน: เมื่อยังไม่ตั้งค่า client แสดงเป็นปุ่มปิด (ไม่ใช่ลิงก์) พร้อมคำอธิบายจากหน้าที่เรียก
export function IdentityProviderButton({
  href,
  label,
  enabled,
  tone,
}: IdentityProviderButtonProps) {
  const base =
    'inline-flex h-12 w-full items-center justify-center rounded-md px-6 font-bold transition-colors';
  const toneClass =
    tone === 'primary'
      ? 'bg-leaf text-white shadow-button hover:bg-leaf-hover'
      : 'border border-border bg-surface text-ink hover:bg-paper';
  if (!enabled) {
    return (
      <span
        aria-disabled="true"
        className={`${base} cursor-not-allowed border border-border-soft bg-paper text-quiet`}
      >
        {label}
      </span>
    );
  }
  return (
    <a href={href} className={`${base} ${toneClass}`}>
      {label}
    </a>
  );
}
