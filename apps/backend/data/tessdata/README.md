# Tesseract language models (tessdata)

This directory is the `langPath` for every tesseract.js worker in the backend.
It is wired in `services/ocr/tessdata.js` and consumed by:

- `services/ocr/tesseract-service.js` (`Tesseract.createWorker(['tha','eng'], …)`)
- `services/fraud-detection/document-verification-methods.js` (`createWorker('tha+eng', …)`)

The files are committed to the repository and baked into the backend image,
so OCR reads Thai and English text reliably and reproducibly, everywhere,
with no runtime download.

## Files that must be present

| file               | language | source          | sha256                                                              |
| ------------------ | -------- | --------------- | -------------------------------------------------------------------- |
| `tha.traineddata`  | Thai     | `tessdata_fast` | `294227cc2d1292b0acb28d61d4115c88252b96d466ca90b417cf4cf0c67bf07c` |
| `eng.traineddata`  | English  | `tessdata_fast` | `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2` |

**Uncompressed `.traineddata`, not `.traineddata.gz`.** `TESSERACT_WORKER_OPTIONS`
in `services/ocr/tessdata.js` sets `gzip: false` to match — a `.gz` file here
will not be found.

Set `TESSDATA_PATH` to override this directory (e.g. a mounted volume for a
deployment that wants a different model set without rebuilding the image).

## Where they come from

Source: [`tesseract-ocr/tessdata_fast`](https://github.com/tesseract-ocr/tessdata_fast),
pinned at commit [`87416418657359cb625c412a48b6e1d6d41c29bd`](https://github.com/tesseract-ocr/tessdata_fast/commit/87416418657359cb625c412a48b6e1d6d41c29bd)
(2024-08-01), licensed [Apache-2.0](https://github.com/tesseract-ocr/tessdata_fast/blob/87416418657359cb625c412a48b6e1d6d41c29bd/LICENSE).

```sh
COMMIT=87416418657359cb625c412a48b6e1d6d41c29bd
curl -fL -o tha.traineddata \
  "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${COMMIT}/tha.traineddata"
curl -fL -o eng.traineddata \
  "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${COMMIT}/eng.traineddata"
sha256sum tha.traineddata eng.traineddata   # compare against the table above
```

To refresh: bump `COMMIT`, re-run, re-verify the checksums, update the table
above, and re-run `__tests__/unit/tessdata-local-only.test.js`.

## Known trade-off: tone marks / sara am with `tessdata_fast`

`tessdata_fast`'s `tha` model reliably reads whole words and phrases (verified
against real rendered Thai text — see the test), but on some individual
tone-mark-bearing syllables it:

- normalizes สระอำ (`ำ`, U+0E33) to `ํ` (NIKHAHIT, U+0E4D) + `า` (SARA AA,
  U+0E32) — visually identical, different codepoints, and
- can drop a tone mark such as ไม้โท (`้`, U+0E49) entirely (`น้ำ` → `นํา`).

`tessdata_best/tha` (commit `e12c65a915945e4c28e237a9b52bc4a8f39a0cec`, also
Apache-2.0) was tried as a fix. It does **not run** on tesseract.js 7's
bundled WASM core: `Tesseract.recognize()` aborts with
`missing function: _ZN9tesseract13DotProductSSEEPKfS1_i` — the "best" LSTM
models need a dot-product intrinsic the shipped `tesseract.js-core` build
does not export. Swapping cores is a bigger change than this task (a
different `tesseract.js-core` variant, or a self-built WASM core), so it is
left as a follow-up rather than silently downgrading the test.
`__tests__/unit/tessdata-local-only.test.js` pins the two things that are
actually true of the bundled data instead of skipping the case: composing the
decomposed สระอำ back to `ำ` recovers `ทำ` exactly, and comparing tone-mark-
insensitively (ไม้เอก–จัตวา stripped from both sides) shows the `นำ` core is
still read even though `ไม้โท` is lost. Task 2's `normalize.js` will own
those two helpers for real; here they exist only to keep this test honest.

## Failure behaviour

If a model file is missing, the worker throws `ENOENT` naming the expected path
and the caller surfaces a failed OCR check (`tesseract-service.js` re-throws
from `initialize()`; `document-verification-methods.js` returns a failed
`OCR Validation` result). That is deliberate: a loud local failure, not a
silent fallback to a runtime CDN download — the models are bundled so OCR
reads Thai offline and gives the same result on every machine.
