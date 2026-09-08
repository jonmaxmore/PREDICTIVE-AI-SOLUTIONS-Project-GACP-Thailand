export type EnumValues<T extends Record<string, string>> = [T[keyof T], ...T[keyof T][]];

// ทุกชุดค่าปิดประกาศเป็น `as const` โดยค่า = ชื่อ ฟังก์ชันนี้แปลงเป็น tuple ให้ zod ใช้
export function enumValues<T extends Record<string, string>>(record: T): EnumValues<T> {
  return Object.values(record) as EnumValues<T>;
}
