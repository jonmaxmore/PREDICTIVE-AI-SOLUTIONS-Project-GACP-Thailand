/**
 * SVG icon components for the GACP platform.
 * Clean, minimal, monochromatic — designed to render at the same
 * sizes as the surrounding text, avoiding emoji where possible.
 */

import * as CoreIcons from './icons/core-icons';
import * as SharedIcons from './icons/shared-icons';
import * as FeatureIcons from './icons/feature-icons';

export * from './icons/core-icons';
export * from './icons/shared-icons';
export * from './icons/feature-icons';

const all = {
    ...CoreIcons,
    ...SharedIcons,
    ...FeatureIcons,
};

export const Icons = {
    // ... existing
    Camera: all.IconCamera,
    Activity: all.IconActivity,
    LayoutDashboard: all.IconLayoutDashboard,
    Beaker: all.IconBeaker,
    Drop: all.IconDrop,
    Seed: all.IconSeed,


    // Navigation
    Home: all.IconHome,

    Document: all.IconDocument,
    Compass: all.IconCompass,
    Payment: all.IconPayment,
    CreditCard: all.IconCreditCard,
    User: all.IconUser,
    // Actions
    Sun: all.IconSun,
    Moon: all.IconMoon,
    Logout: all.IconLogout,
    Plus: all.IconPlus,
    ChevronRight: all.IconChevronRight,
    ChevronLeft: all.IconChevronLeft,
    // Status
    Draft: all.IconDraft,
    Search: all.IconSearch,
    Warning: all.IconWarning,
    Building: all.IconBuilding,
    Calendar: all.IconCalendar,
    CheckCircle: all.IconCheckCircle,
    Certificate: all.IconCertificate,
    // Data
    Chart: all.IconChart,
    Clock: all.IconClock,
    Receipt: all.IconReceipt,
    Leaf: all.IconLeaf,
    // Utils
    XCircle: all.IconXCircle,
    ArrowLeft: all.IconArrowLeft,
    AlertTriangle: all.IconAlertTriangle,
    AlertCircle: all.IconAlertCircle,
    Upload: all.IconUpload,
    Settings: all.IconSettings,
    Soil: all.IconSoil,
    Globe: all.IconGlobe,
    Bell: all.IconBell,
    Phone: all.IconPhone,
    Mail: all.IconMail,
    Info: all.IconInfo,
    Help: all.IconHelp,

    Secure: all.IconSecure,
    Printer: all.IconPrinter,
    ArrowRight: all.IconArrowRight,
    Calculator: all.IconCalculator,
    ChevronDown: all.IconChevronDown,
    ChevronUp: all.IconChevronUp,
    compassLarge: all.IconCompass,
    Copy: all.IconCopy,
    Download: all.IconDownload,
    Edit: all.IconEdit,
    Eye: all.EyeIcon,
    FileText: all.IconFileText,
    Key: all.IconKey,
    Lock: all.IconLock,
    Link: all.IconLink,
    Loader: all.IconLoader,
    MapPin: all.IconMapPin,
    QrCode: all.IconQrCode,
    ShieldCheck: all.IconShieldCheck,
    Target: all.IconTarget,
    Trash: all.IconTrash,
    Tree: all.IconTree,
    Tshirt: all.IconTshirt,
    UserCheck: all.IconUserCheck,
    Users: all.IconUsers,
    Video: all.IconVideo,
    x: all.IconX,
    X: all.IconX,
    check: all.IconCheck,
    Check: all.IconCheck,
    file: all.IconDocument,
    image: all.IconImage,
    pdf: all.IconDocument,
    RefreshCcw: all.IconRefreshCcw,
    List: all.IconList,
    Package: all.IconPackage,
    Plant: all.IconPlant,
    Folder: all.IconFolder,
    FolderOpen: all.IconFolderOpen,
    Tag: all.IconTag,
    // Additional icons
    Filter: all.IconFilter,
    Award: all.IconAward,
    Box: all.IconBox,
    Layers: all.IconLayers,
    Droplet: all.IconDroplet,
    Seedling: all.IconSeedling,
    Flask: all.IconFlask,
    ClipboardList: all.IconClipboardList,
    Scissors: all.IconScissors,
    Tractor: all.IconTractor,
    Gauge: all.IconGauge,
    ChartBar: all.IconChartBar,
    FileCheck: all.IconFileCheck,
    Coins: all.IconCoins,
    TrendingUp: all.IconTrendingUp,
    TrendingDown: all.IconTrendingDown,
};

