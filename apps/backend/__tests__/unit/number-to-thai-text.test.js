const { numberToThaiText } = require('../../utils/number-to-thai-text');

describe('numberToThaiText', () => {
    const cases = [
        [0, 'ศูนย์บาทถ้วน'],
        [1, 'หนึ่งบาทถ้วน'],
        [11, 'สิบเอ็ดบาทถ้วน'],
        [21, 'ยี่สิบเอ็ดบาทถ้วน'],
        [100, 'หนึ่งร้อยบาทถ้วน'],
        [5000, 'ห้าพันบาทถ้วน'],
        [5535, 'ห้าพันห้าร้อยสามสิบห้าบาทถ้วน'],
        [25000, 'สองหมื่นห้าพันบาทถ้วน'],
        [27675, 'สองหมื่นเจ็ดพันหกร้อยเจ็ดสิบห้าบาทถ้วน'],
        [30000, 'สามหมื่นบาทถ้วน'],
        [100000, 'หนึ่งแสนบาทถ้วน'],
        [1000000, 'หนึ่งล้านบาทถ้วน'],
        [1234567, 'หนึ่งล้านสองแสนสามหมื่นสี่พันห้าร้อยหกสิบเจ็ดบาทถ้วน'],
    ];

    test.each(cases)('converts %d to Thai text', (num, expected) => {
        expect(numberToThaiText(num)).toBe(expected);
    });

    test('handles satang', () => {
        expect(numberToThaiText(100.50)).toBe('หนึ่งร้อยบาทห้าสิบสตางค์');
    });

    test('handles non-number input', () => {
        expect(numberToThaiText(null)).toBe('ศูนย์บาทถ้วน');
        expect(numberToThaiText(undefined)).toBe('ศูนย์บาทถ้วน');
        expect(numberToThaiText('abc')).toBe('ศูนย์บาทถ้วน');
    });
});
