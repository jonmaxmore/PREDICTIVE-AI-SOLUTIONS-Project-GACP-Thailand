const CROP_CALENDAR = {
  cannabis: {
    bestPlantingMonths: [10, 11, 12],
    duration: 90,
    stages: [
      { name: 'เพาะเมล็ด', days: 7 },
      { name: 'ต้นกล้า', days: 14 },
      { name: 'เจริญเติบโต', days: 35 },
      { name: 'ออกดอก', days: 28 },
      { name: 'เก็บเกี่ยว', days: 6 },
    ],
    tips: {
      north: 'ปลูกพ.ย. - ธ.ค. ดีที่สุด',
      central: 'ปลูกต.ค. - พ.ย.',
      south: 'ปลูกได้ตลอดปี',
    },
  },
};

class CropCalendarService {
  getBestPlantingDate(crop, province) {
    const calendar = CROP_CALENDAR[crop] || CROP_CALENDAR.cannabis;
    const region = this.getRegion(province);

    return {
      bestMonths: calendar.bestPlantingMonths,
      duration: calendar.duration,
      stages: calendar.stages,
      regionalTip: calendar.tips[region] || calendar.tips.central,
    };
  }

  getRegion(province) {
    const north = ['เชียงใหม่', 'เชียงราย', 'ลำปาง'];
    const south = ['ภูเก็ต', 'สุราษฎร์ธานี', 'กระบี่'];
    if (north.includes(province)) {
      return 'north';
    }
    if (south.includes(province)) {
      return 'south';
    }
    return 'central';
  }
}

module.exports = CropCalendarService;

