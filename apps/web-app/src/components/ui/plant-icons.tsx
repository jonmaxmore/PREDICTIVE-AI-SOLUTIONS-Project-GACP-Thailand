'use client';

import React from 'react';

// Minimal line-art SVG icons for plants and cultivation methods
// Following Thai government web standards (DGA)

interface IconProps {
    className?: string | undefined;
    size?: number | undefined;
}

// Plant Icons
export const CannabisIcon: React.FC<IconProps> = ({ className = '', size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M12 22V12" />
        <path d="M12 12C12 12 8 10 6 6C6 6 10 8 12 12" />
        <path d="M12 12C12 12 16 10 18 6C18 6 14 8 12 12" />
        <path d="M12 8C12 8 9 5 5 4C5 4 9 6 12 8" />
        <path d="M12 8C12 8 15 5 19 4C19 4 15 6 12 8" />
        <path d="M12 5C12 5 10 2 7 2C7 2 10 3 12 5" />
        <path d="M12 5C12 5 14 2 17 2C17 2 14 3 12 5" />
    </svg>
);

export const KratomIcon: React.FC<IconProps> = ({ className = '', size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M12 22V14" />
        <ellipse cx="12" cy="9" rx="7" ry="5" />
        <path d="M12 4V2" />
        <path d="M8 8L6 6" />
        <path d="M16 8L18 6" />
    </svg>
);

export const TurmericIcon: React.FC<IconProps> = ({ className = '', size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M12 2v4" />
        <path d="M12 6c-2 0-4 1-4 3s2 4 4 6c2-2 4-4 4-6s-2-3-4-3z" />
        <path d="M12 15v7" />
        <ellipse cx="12" cy="18" rx="3" ry="2" />
    </svg>
);

export const GingerIcon: React.FC<IconProps> = ({ className = '', size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M8 12c-3 0-5 2-5 4s2 2 4 2c1 0 2-1 3-1" />
        <path d="M16 12c3 0 5 2 5 4s-2 2-4 2c-1 0-2-1-3-1" />
        <ellipse cx="12" cy="12" rx="4" ry="3" />
        <path d="M12 9V5" />
        <path d="M10 6l2-2 2 2" />
    </svg>
);

export const PlaiIcon: React.FC<IconProps> = ({ className = '', size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M12 22V10" />
        <path d="M12 10C8 10 5 7 5 4h14c0 3-3 6-7 6z" />
        <path d="M9 4c0-1 1-2 3-2s3 1 3 2" />
    </svg>
);

export const BlackGalingaleIcon: React.FC<IconProps> = ({ className = '', size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M12 2v6" />
        <path d="M8 5l4 3 4-3" />
        <ellipse cx="12" cy="14" rx="5" ry="4" />
        <path d="M12 18v4" />
        <path d="M9 22h6" />
    </svg>
);

// Cultivation Method Icons
export const OutdoorIcon: React.FC<IconProps> = ({ className = '', size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <circle cx="12" cy="5" r="3" />
        <path d="M12 8v2" />
        <path d="M5 5l2 2" />
        <path d="M19 5l-2 2" />
        <path d="M3 12h2" />
        <path d="M19 12h2" />
        <path d="M12 16v6" />
        <path d="M8 18l4-2 4 2" />
        <path d="M6 22h12" />
    </svg>
);

export const GreenhouseIcon: React.FC<IconProps> = ({ className = '', size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M3 22V10l9-8 9 8v12" />
        <path d="M3 10h18" />
        <path d="M12 2v8" />
        <path d="M7 14v4" />
        <path d="M12 14v4" />
        <path d="M17 14v4" />
        <path d="M3 22h18" />
    </svg>
);

export const IndoorIcon: React.FC<IconProps> = ({ className = '', size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M2 8h20" />
        <path d="M6 12h4v6H6z" />
        <path d="M14 12h4v3h-4z" />
        <circle cx="16" cy="18" r="1" />
        <path d="M12 4v4" />
    </svg>
);

// Utility Icons
export const CheckIcon: React.FC<IconProps> = ({ className = '', size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

export const InfoIcon: React.FC<IconProps> = ({ className = '', size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
    </svg>
);

export const ArrowRightIcon: React.FC<IconProps> = ({ className = '', size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
    </svg>
);

// Map plant code to icon component
export const getPlantIcon = (code: string, props?: IconProps) => {
    const iconMap: Record<string, React.ReactNode> = {
        'CANNABIS': <CannabisIcon {...props} />,
        'KRATOM': <KratomIcon {...props} />,
        'TURMERIC': <TurmericIcon {...props} />,
        'GINGER': <GingerIcon {...props} />,
        'PLAI': <PlaiIcon {...props} />,
        'BSD': <BlackGalingaleIcon {...props} />,
    };
    return iconMap[code] || <PlaiIcon {...props} />;
};

// Map cultivation method to icon component
export const getCultivationIcon = (method: string, props?: IconProps) => {
    const iconMap: Record<string, React.ReactNode> = {
        'outdoor': <OutdoorIcon {...props} />,
        'greenhouse': <GreenhouseIcon {...props} />,
        'indoor': <IndoorIcon {...props} />,
    };
    return iconMap[method] || <OutdoorIcon {...props} />;
};
