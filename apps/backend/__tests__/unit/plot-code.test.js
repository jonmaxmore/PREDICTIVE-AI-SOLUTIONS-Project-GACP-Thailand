/**
 * The plot code is the one identifier a farmer physically holds.
 *
 * มกษ. 3502-2561 ข้อ 8(1) requires recording "รหัสแปลงปลูกและข้อมูลประจำแปลงปลูก" —
 * a plot code and per-plot data (docs/standards/tas-3502-2561-records-and-traceability.md).
 * Today Plot has no code of its own; the QR hangs off PlantingCyclePlot, which is unique
 * per (cycle, plot), so it is reborn every season and a permanent field sign is impossible.
 *
 * Two constraints decide the format, and they pull against each other:
 *
 * TYPEABLE. The sign lives outdoors. It will fade, get splashed, get scratched. When the
 * QR stops scanning the farmer must be able to read the code aloud down a phone line or
 * type it in, so: no characters that look alike in the field (0/O, 1/I/L), no lowercase,
 * grouped so the eye can hold it.
 *
 * UNGUESSABLE. The plot page is public and unauthenticated. A sequential code would let
 * anyone walk every plot in the country — for cannabis that is a map of where the crop is.
 * So the code carries real entropy, not a counter.
 *
 * Crockford base32 minus the ambiguous letters gives both: a 30-character alphabet, 10
 * characters of payload, ~9.3e14 combinations. Enumeration is not worth anyone's time and
 * a human can still read it out.
 */
const { generatePlotCode, isValidPlotCode, PLOT_CODE_ALPHABET } = require('../../shared/plot-code');

describe('generatePlotCode', () => {
  it('never emits a character that can be misread in a field', () => {
    // 0/O and 1/I/L are the pairs that actually get confused on a weathered sign.
    for (const forbidden of ['0', 'O', '1', 'I', 'L', 'U']) {
      expect(PLOT_CODE_ALPHABET).not.toContain(forbidden);
    }
    // The constraint is on the PAYLOAD, not on the literal prefix: "PLOT" contains an O
    // and an L, and a person reads it as a word rather than transcribing it character by
    // character. Asserting against the whole string instead caught the prefix and said
    // the generator was broken when it was not.
    const codes = Array.from({ length: 200 }, () => generatePlotCode());
    for (const code of codes) {
      const payload = code.replace(/^PLOT-/, '').replace(/-/g, '');
      expect(payload).not.toMatch(/[01OILU]/);
    }
  });

  it('is grouped so a person can read it aloud without losing their place', () => {
    expect(generatePlotCode()).toMatch(/^PLOT-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  });

  it('carries enough entropy that scanning the country plot by plot is pointless', () => {
    const codes = new Set(Array.from({ length: 5000 }, () => generatePlotCode()));
    // 5000 draws from ~9.3e14 should collide essentially never. A generator seeded from
    // a counter or a weak clock would show up here immediately.
    expect(codes.size).toBe(5000);
  });

  it('accepts its own output', () => {
    for (let i = 0; i < 100; i++) {
      expect(isValidPlotCode(generatePlotCode())).toBe(true);
    }
  });
});

describe('isValidPlotCode', () => {
  it('rejects the shapes a mistyped sign actually produces', () => {
    expect(isValidPlotCode('PLOT-ABCDE-FGHJ')).toBe(false);   // one short
    expect(isValidPlotCode('PLOT-ABCDE-FGHJKM')).toBe(false); // one long
    expect(isValidPlotCode('PLOTABCDEFGHJK')).toBe(false);    // dashes dropped
    expect(isValidPlotCode('PLOT-ABCDE-FGH0K')).toBe(false);  // zero typed for O
    expect(isValidPlotCode('PLOT-ABCDE-FGHIK')).toBe(false);  // I typed for J
    expect(isValidPlotCode('')).toBe(false);
    expect(isValidPlotCode(null)).toBe(false);
    expect(isValidPlotCode(undefined)).toBe(false);
    expect(isValidPlotCode(12345)).toBe(false);
  });

  it('is forgiving about how a person types it, since the sign is the source', () => {
    const code = generatePlotCode();
    // Lowercase and stray spaces are transcription noise, not a different plot.
    expect(isValidPlotCode(code.toLowerCase())).toBe(true);
    expect(isValidPlotCode(` ${code} `)).toBe(true);
  });

  it('does not accept a different prefix pretending to be a plot', () => {
    expect(isValidPlotCode('LOT-ABCDE-FGHJK')).toBe(false);
    expect(isValidPlotCode('PLOTX-ABCDE-FGHJK')).toBe(false);
  });
});
