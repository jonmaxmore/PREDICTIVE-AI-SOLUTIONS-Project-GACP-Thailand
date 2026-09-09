// พืชที่ระบบรองรับ กัญชาก่อน (operator 2026-09-08) พืชอื่นเพิ่มเมื่อกรมส่งแบบคำขอ พร้อมชุดกฎของตัวเอง
export type PlantSeed = {
  readonly code: string;
  readonly nameTh: string;
  readonly scientificName: string | null;
  readonly isActive: boolean;
};

export const plantSeeds: readonly PlantSeed[] = [
  {
    code: 'cannabis',
    nameTh: 'กัญชา',
    scientificName: 'Cannabis sativa L.',
    isActive: true,
  },
];
