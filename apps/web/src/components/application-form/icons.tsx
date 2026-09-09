// ไอคอนเส้นบางชุดเดียวของฟอร์ม (ตามแบบที่อนุมัติ) ขนาดปรับด้วย prop size ทุกไอคอนเป็นภาพประกอบ ซ่อนจาก screen reader

type IconProps = {
  readonly size?: number;
  readonly className?: string;
  readonly strokeWidth?: number;
};

function base({ size = 16, className, strokeWidth = 2.5 }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
  };
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base({ strokeWidth: 3, ...props })} aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function PendingIcon(props: IconProps) {
  return (
    <svg {...base(props)} aria-hidden="true">
      <path d="M12 5v9" />
      <circle cx="12" cy="18" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...base(props)} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base(props)} aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg {...base(props)} aria-hidden="true">
      <path d="M20 12H5" />
      <path d="m11 18-6-6 6-6" />
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...base(props)} aria-hidden="true">
      <path d="M4 12h15" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg {...base({ strokeWidth: 2, ...props })} aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
