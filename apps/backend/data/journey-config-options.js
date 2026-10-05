const PURPOSES = [
    {
        id: 'domestic',
        nameTH: 'จำหน่ายในประเทศ',
        nameEN: 'Domestic Sales (B2B)',
        description: 'จำหน่ายให้กับผู้ประกอบการในประเทศ โรงพยาบาล คลินิก',
        requirements: ['GACP'],
        sortOrder: 1,
    },
    {
        id: 'export',
        nameTH: 'ส่งออก',
        nameEN: 'Export (International)',
        description: 'ส่งออกไปต่างประเทศ ต้องผ่านมาตรฐาน GACP ขั้นสูง',
        requirements: ['GACP_ADVANCED'],
        sortOrder: 2,
    },
    {
        id: 'research',
        nameTH: 'วิจัย',
        nameEN: 'Research',
        description: 'การวิจัยและพัฒนา ต้องมี Protocol การวิจัย',
        requirements: ['GACP', 'RESEARCH_PROTOCOL'],
        sortOrder: 3,
    },
];

// CULTIVATION METHODS
const CULTIVATION_METHODS = [
    {
        id: 'outdoor',
        nameTH: 'กลางแจ้ง',
        nameEN: 'Outdoor',
        description: 'ปลูกในแปลงกลางแจ้ง อาศัยแสงแดดธรรมชาติ',
        icon: 'sun',
        pros: ['ต้นทุนต่ำ', 'เหมาะกับพื้นที่กว้าง'],
        cons: ['ควบคุมสภาพแวดล้อมยาก', 'เสี่ยงศัตรูพืช'],
        feeMultiplier: 1.0,
        sortOrder: 1,
    },
    {
        id: 'greenhouse',
        nameTH: 'โรงเรือน',
        nameEN: 'Greenhouse',
        description: 'ปลูกในโรงเรือนที่มีหลังคาโปร่งแสง',
        icon: 'home',
        pros: ['ควบคุมสภาพแวดล้อมได้บางส่วน', 'ปลูกได้ตลอดปี'],
        cons: ['ต้นทุนสูงกว่ากลางแจ้ง'],
        feeMultiplier: 1.0,
        sortOrder: 2,
    },
    {
        id: 'indoor',
        nameTH: 'ระบบปิด',
        nameEN: 'Indoor Controlled',
        description: 'ปลูกในอาคารปิดที่ควบคุมสภาพแวดล้อมทั้งหมด',
        icon: 'building',
        pros: ['ควบคุมทุกปัจจัยได้', 'คุณภาพสม่ำเสมอ'],
        cons: ['ต้นทุนสูง', 'ค่าไฟฟ้าสูง'],
        feeMultiplier: 1.0,
        sortOrder: 3,
    },
];

// FARM LAYOUTS
const FARM_LAYOUTS = [
    // OUTDOOR layouts
    {
        id: 'row_cultivation',
        nameTH: 'แปลงยาว',
        nameEN: 'Row Cultivation',
        description: 'ปลูกเป็นแถวยาว ระยะห่างต้น 0.5-1 เมตร',
        applicableTo: ['outdoor'],
        plantsPerSqm: 1,
        spacingRowCm: 100,
        spacingPlantCm: 100,
        icon: 'rows',
    },
    {
        id: 'raised_bed',
        nameTH: 'แปลงยกร่อง',
        nameEN: 'Raised Bed',
        description: 'แปลงยกสูงเพื่อระบายน้ำ ระยะห่าง 50 ซม.',
        applicableTo: ['outdoor'],
        plantsPerSqm: 4,
        spacingRowCm: 50,
        spacingPlantCm: 50,
        icon: 'layer',
    },
    {
        id: 'block_plot',
        nameTH: 'แปลงบล็อก',
        nameEN: 'Block Plot',
        description: 'แปลงสี่เหลี่ยมแบ่งโซน ปลูกหลากหลายสายพันธุ์',
        applicableTo: ['outdoor'],
        plantsPerSqm: 1,
        spacingRowCm: 100,
        spacingPlantCm: 100,
        icon: 'grid',
    },
    {
        id: 'container',
        nameTH: 'ปลูกในกระถาง',
        nameEN: 'Container Growing',
        description: 'ปลูกในกระถางหรือภาชนะ สามารถเคลื่อนย้ายได้',
        applicableTo: ['outdoor', 'greenhouse'],
        plantsPerSqm: 0, // Manual input
        manualPlantCount: true,
        icon: 'pot',
    },
    // GREENHOUSE layouts
    {
        id: 'ground_rows',
        nameTH: 'แปลงพื้น',
        nameEN: 'Ground Rows',
        description: 'ปลูกลงดินภายในโรงเรือน',
        applicableTo: ['greenhouse'],
        plantsPerSqm: 1,
        spacingRowCm: 100,
        spacingPlantCm: 100,
        icon: 'rows',
    },
    {
        id: 'raised_tables',
        nameTH: 'โต๊ะยกสูง',
        nameEN: 'Raised Tables',
        description: 'ปลูกบนโต๊ะระดับเอว สะดวกในการดูแล',
        applicableTo: ['greenhouse'],
        plantsPerSqm: 2,
        spacingRowCm: 70,
        spacingPlantCm: 70,
        icon: 'table',
    },
    {
        id: 'hydroponic',
        nameTH: 'ไฮโดรโปนิกส์',
        nameEN: 'Hydroponic',
        description: 'ปลูกในระบบน้ำวน ไม่ใช้ดิน',
        applicableTo: ['greenhouse', 'indoor'],
        plantsPerSqm: 4,
        spacingRowCm: 50,
        spacingPlantCm: 50,
        icon: 'drop',
        subTypes: ['nft', 'dwc', 'drip'],
    },
];

// GROWING STYLES (INDOOR ONLY)
const GROWING_STYLES = [
    {
        id: 'traditional',
        nameTH: 'แบบดั้งเดิม',
        nameEN: 'Traditional',
        description: 'ปลูกแบบธรรมชาติ ให้ต้นโตเต็มที่',
        applicableTo: ['indoor'],
        plantsPerSqm: 2,
        icon: 'plant',
    },
    {
        id: 'sog',
        nameTH: 'Sea of Green (SOG)',
        nameEN: 'SOG',
        description: 'ปลูกต้นเล็กจำนวนมาก เก็บเกี่ยวเร็ว',
        applicableTo: ['indoor'],
        plantsPerSqm: 12,
        icon: 'grid-3x3',
    },
    {
        id: 'scrog',
        nameTH: 'Screen of Green (ScrOG)',
        nameEN: 'ScrOG',
        description: 'ใช้ตาข่ายบังคับทิศทางการเติบโต',
        applicableTo: ['indoor'],
        plantsPerSqm: 2,
        icon: 'net',
    },
    {
        id: 'vertical',
        nameTH: 'ชั้นวางแนวตั้ง',
        nameEN: 'Vertical Rack',
        description: 'ปลูกหลายชั้น เพิ่มพื้นที่ปลูกหลายเท่า',
        applicableTo: ['indoor'],
        plantsPerSqm: 6,
        supportsMultipleTiers: true,
        maxTiers: 5,
        icon: 'layers',
    },
];

// JOURNEY CONFIGS (PURPOSE × METHOD)

module.exports = {
    PURPOSES,
    CULTIVATION_METHODS,
    FARM_LAYOUTS,
    GROWING_STYLES,
};
