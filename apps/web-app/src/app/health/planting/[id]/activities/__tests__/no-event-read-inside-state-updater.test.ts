/**
 * A React event must be read BEFORE the state updater, never inside it.
 *
 * Found by the G4 walk (2026-08-25) while recording a care activity: typing into
 * "หน่วย" crashed the whole activities screen —
 *
 *   TypeError: Cannot read properties of null (reading 'value')
 *     at .../activities/client-view.tsx
 *     at basicStateReducer   ← the updater ran AFTER the handler returned
 *
 * React nulls `event.currentTarget` as soon as the handler returns. A functional
 * updater — `setForm(prev => ({ ...prev, unit: event.currentTarget.value }))` — is not
 * guaranteed to run inside that window: React may invoke it later, during the reducer
 * pass, and then `currentTarget` is null and the component throws. Under batching it
 * usually survives, which is why this shipped: it fails only sometimes, and when it
 * does the error boundary swallows the stack and tells the farmer "ลองใหม่อีกครั้ง" —
 * advice that cannot work, on a screen they cannot use.
 *
 * The safe shape is one line longer and never wrong:
 *
 *   onChange={(event) => { const value = event.currentTarget.value;
 *                          setForm(prev => ({ ...prev, unit: value })); }}
 *
 * This test reads the source because the defect is a code shape, not a value: any new
 * field written the unsafe way is caught the moment it is added, in every file of the
 * planting activity screen.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(__dirname, '..');

/**
 * Matches `setSomething( (args) => ... event.currentTarget ... )` — an event read that
 * happens inside the updater callback. Deliberately narrow: reads that occur before the
 * setter, on their own line, are the correct pattern and must NOT match.
 */
const EVENT_INSIDE_UPDATER = /set[A-Z]\w*\(\s*\([^)]*\)\s*=>[\s\S]{0,200}?\bevent\.(currentTarget|target)\b/g;

describe('planting activities: no event read inside a state updater', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));

  it('has source files to check (guards against a silent empty pass)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} reads the event before calling the setter`, () => {
      const src = readFileSync(join(DIR, file), 'utf8');
      const hits = src.match(EVENT_INSIDE_UPDATER) || [];
      expect(hits.map((h) => h.replace(/\s+/g, ' ').slice(0, 120))).toEqual([]);
    });
  }
});
