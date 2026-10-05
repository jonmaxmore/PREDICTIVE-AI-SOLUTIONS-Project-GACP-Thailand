# ข้อมูลเขตการปกครองไทย — Thai administrative divisions

**Read this before changing `thai-locations-data.json`.**

## What this data is

`apps/backend/data/thai-locations-data.json` lists every จังหวัด, อำเภอ/เขต and
ตำบล/แขวง in Thailand with its standard administrative code, its Thai and
English names, and — at ตำบล level — its postal code.

| Level | Records |
| --- | --- |
| จังหวัด | 77 |
| อำเภอ / เขต | 928 |
| ตำบล / แขวง | 7,467 |
| distinct รหัสไปรษณีย์ | 955 |

Codes follow the standard Thai administrative scheme: จังหวัด 2 digits, อำเภอ 4,
ตำบล 6, each nesting inside its parent (ตำบล `100101` sits under อำเภอ `1001`
under จังหวัด `10`). These are the codes every Thai government system uses, so a
value stored against an application stays meaningful outside this platform.

## Where the facts come from

The administrative divisions and their codes are set by **กรมการปกครอง (DOPA)**;
รหัสไปรษณีย์ are **ไปรษณีย์ไทย**'s. Those are the authorities, and they are the
origin of every fact in this file.

Both are Thai government material. Under **พ.ร.บ. ลิขสิทธิ์ พ.ศ. 2537 มาตรา 7(3)**
regulations and announcements of government bodies are not subject to copyright,
and Thailand has no separate database right. The facts here are therefore free
for anyone to use — this file carries no licence obligation to any third party,
and the schema, the build tooling, the validation rules and the corrections
below are this repository's own work.

## What this data is NOT

**It is not an official DTAM or DOPA publication.** No government body has
attested to this particular file. What stands behind it is the verification
described below, which we performed ourselves.

Say that plainly wherever provenance matters. If DTAM later supplies an official
extract, replace the contents and re-run the checks — the shape this repo
consumes will not change.

## How it is verified

Three things guard it, in order of how much they catch:

1. **Structural validation** (`thai-locations-transform.js` → `validateLocations`).
   Duplicate codes, orphan references, missing Thai names, malformed postal
   codes, and any ตำบล code that does not sit under its own อำเภอ code. A
   dataset can look plausible row by row while its hierarchy is broken; this is
   what catches that.

2. **Reachability** (`scripts/ci/check-thai-locations.js`). Every จังหวัด must
   offer at least one อำเภอ and every อำเภอ at least one ตำบล, plus the record
   counts above. The defect this replaced was exactly a dead end: a farmer chose
   their province and met an empty dropdown.

3. **Cross-source reconciliation** (`thai-locations-corrections.js`). Names were
   compared against more than one independent transcription of the same DOPA
   facts. A row was only changed where the others agreed with each other and
   disagreed with us; a single dissenting source never changed anything. Every
   corrected row carries its reason in that file.

## Corrections we made, and one class of fault worth knowing

Five ตำบล rows are corrected. Two are not spelling slips.

**บึงกาฬ was separated from หนองคาย in 2554 and every code beneath it was
reissued.** In that renumbering, two อำเภอ names ended up occupying ตำบล slots
of a different อำเภอ: `ตำบลบึงโขงหลง` inside อำเภอเมืองบึงกาฬ (บึงโขงหลง is
อำเภอ `3806`), and `ตำบลศรีวิไล` inside อำเภอปากคาด (ศรีวิไล is อำเภอ `3805`).
Neither is a misspelling of the real ตำบล — โคกก่อง and สมสนุก were simply
absent, so those farmers could not enter their own address and an inspector
would have been routed to a tambon that is not there.

A test in `thai-locations-corrections.test.js` asserts that no อำเภอ name sits
in a ตำบล slot of a different อำเภอ anywhere in บึงกาฬ, so the fault cannot
return quietly.

Beware the mirror-image mistake: **a ตำบล legitimately sharing a name with an
อำเภอ elsewhere in the same province is normal in Thailand** — ตำบลแกลง in
อำเภอเมืองระยอง alongside อำเภอแกลง, ตำบลสันทราย in three different อำเภอ of
เชียงใหม่ alongside อำเภอสันทราย. Thirty-two such pairs exist here and all but
the two above are correct. Name collision alone is not evidence of an error.

## แขวง in กรุงเทพมหานคร, added later

กรุงเทพมหานคร has redrawn แขวง boundaries twice in living memory and this
dataset had not caught up. An applicant in พระโขนงใต้ or บางนาใต้ — both created
in 2560 — had no way to state where they actually are. Fifteen แขวง were added:

| ประกาศ | เขต | แขวง |
| --- | --- | --- |
| 26 ก.ค. 2560 | พระโขนง | พระโขนงใต้ |
| 26 ก.ค. 2560 | พญาไท | พญาไท |
| 26 ก.ค. 2560 | สวนหลวง | พัฒนาการ, อ่อนนุช |
| 26 ก.ค. 2560 | สะพานสูง | ราษฎร์พัฒนา, ทับช้าง |
| 26 ก.ค. 2560 | บางนา | บางนาเหนือ, บางนาใต้ |
| 26 ก.ค. 2560 | บางบอน | บางบอนเหนือ, บางบอนใต้, คลองบางพราน, คลองบางบอน |
| มีผล 21 ก.ย. 2552 | วังทองหลาง | สะพานสอง, คลองเจ้าคุณสิงห์, พลับพลา |

The seven ประกาศ of 26 กรกฎาคม 2560 together changed five แขวง, dissolved two,
and created thirteen; รัชดาภิเษก (เขตดินแดง), the thirteenth, was already here.

**How far the evidence goes, precisely.** Name, parent เขต and effective date
are confirmed against the ประกาศ. The เขต prefix of each code is structural and
asserted by the build. The **last two digits come from a single transcription** —
they are consistent across all seven เขต (บางนา dissolved `104701` then took
`104702`–`104703`; บางบอน dissolved `105001` then took `105002`–`105005`), which
is why they are trusted, but no second source confirmed them.

## Known open questions

Recorded rather than guessed at. Each needs an authoritative source before it is
touched:

- **The two dissolved แขวง are still listed** — บางนา (`104701`) and บางบอน
  (`105001`). Removing them would orphan any address already stored against
  them, so they stay until that migration is thought through. They should not
  be offered for new applications.
- **แขวงนวมินทร์ and แขวงนวลจันทร์** (เขตบึงกุ่ม, same 2552 round). Sources
  disagree on whether they are `102702`/`102703` or `102704`/`102705`, and this
  dataset still carries สะพานสูง and คันนายาว at `102702`/`102703` from before
  those became เขต of their own. Guessing would overwrite a real แขวง.
- **แขวงวงศ์สว่าง** (เขตบางซื่อ) and **แขวงรามอินทรา** (เขตคันนายาว) — present
  in one transcription, no ประกาศ found to confirm them.
- **อำเภอกัลยาณิวัฒนา, เชียงใหม่** (`5025`). The mapping of บ้านจันทร์ / แม่แดด /
  แจ่มหลวง to codes `502501`–`502503`, and their postal code, differ between
  transcriptions.
- **`550116`** — สวก or บ่อสวก, อำเภอเมืองน่าน.

Checked and found NOT to be gaps: แขวงหลักสอง, บางมด and ทุ่งครุ appear in one
transcription under เขตหนองแขม and เขตราษฎร์บูรณะ, but they moved to เขตบางแค
and เขตทุ่งครุ when those were created. เขตราษฎร์บูรณะ has exactly two แขวง,
which is what ships here. Likewise ตำบลโนนสว่าง under อำเภอเมืองบึงกาฬ: that
อำเภอ has twelve ตำบล, which is what ships here.

## Two upstream rows are deliberately absent

Thailand has 928 อำเภอ/เขต, which is what ships here. Some transcriptions carry
930 rows, the extra two being `ท้องถิ่นเทศบาลตำบลบ้านฆ้อง` and
`ท้องถิ่นเทศบาลตำบลสำนักขาม` — municipality registration units overlaying an
existing ตำบล rather than อำเภอ anyone would select, with no ตำบล beneath them.
An applicant who picked one would face an empty ตำบล dropdown and be stuck.

## Postal codes are not one-to-one

A ตำบล has one postal code, but **174 of the 955 postal codes span more than one
อำเภอ**. Prefill the field from the selected ตำบล and leave it editable. Do not
lock it, and do not infer a ตำบล from a postal code.

## Why it is vendored and not fetched

Nothing in the build or at runtime downloads this data. Fetching it would put a
foreign host in the request path of a Thai government service — the same kind
of dependency removed everywhere else in this repo (see
the third-party services review and
`scripts/ci/check-third-party-services.js`). The JSON file in this repo is the
source of truth; it is not regenerated from anything external.

## Changing this data

1. Edit `thai-locations-data.json`, or add an entry to
   `thai-locations-corrections.js` and run
   `node scripts/data/apply-thai-locations-corrections.js`.
2. Every correction must state its reason and its expected previous value. The
   build refuses a correction whose target is missing or whose "before" no
   longer matches — a stale correction fails loudly instead of silently
   reverting to a bad name.
3. `node scripts/ci/check-thai-locations.js` runs the structural and
   reachability checks; CI runs the same ones, so a bad edit fails the build
   rather than shipping an address that points nowhere.
4. Update the counts above and say what changed and why.
