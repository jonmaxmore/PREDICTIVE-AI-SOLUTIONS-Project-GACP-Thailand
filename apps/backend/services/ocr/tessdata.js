/**
 * Local Tesseract language-model location — single source of truth.
 *
 * `tha.traineddata` and `eng.traineddata` are bundled in the repo and the
 * deployment image (see data/tessdata/README.md) so OCR reads Thai reliably:
 * the exact, checksummed model that was tested runs on every host, every
 * time, with no runtime download.
 *
 * Without an explicit `langPath`, tesseract.js falls back to downloading
 * `${lang}.traineddata` from a public CDN on first use
 * (node_modules/tesseract.js/src/worker-script/index.js:127-130) — slower,
 * non-reproducible (whatever that CDN happens to serve that day), and it
 * fails the first OCR outright if that request ever fails. Pointing
 * `langPath` at the bundled directory avoids all of that.
 *
 * @module services/ocr/tessdata
 */

const path = require('path');

/**
 * Directory holding `tha.traineddata` and `eng.traineddata`.
 * Overridable with TESSDATA_PATH for deployments that mount the models from a
 * volume or a DTAM-internal artifact store instead of baking them into the image.
 */
const TESSDATA_DIR = process.env.TESSDATA_PATH
    || path.join(__dirname, '..', '..', 'data', 'tessdata');

/**
 * Options every `Tesseract.createWorker()` / `createScheduler()` worker in this
 * codebase must be constructed with.
 *
 *  • `langPath`  — the local directory; set explicitly so the jsdelivr fallback
 *                  above can never be reached.
 *  • `gzip:false` — the vendored files are plain `.traineddata`, not
 *                  `.traineddata.gz`. With the default `gzip: true` the library
 *                  would look for `${langPath}/tha.traineddata.gz` and miss.
 *  • `cachePath` — same directory, so the worker's cache lookup (which reads
 *                  `${cachePath}/${lang}.traineddata`) hits the vendored file
 *                  directly and no stray `./tha.traineddata` is written into
 *                  the process CWD.
 *  • `errorHandler` — a required no-op. Without it, tesseract.js's worker
 *                  message loop (node_modules/tesseract.js/src/createWorker.js)
 *                  does `promises[id].reject(data); ...; throw Error(data)`
 *                  for SOME rejected jobs — that unconditional `throw` runs
 *                  inside a MessagePort 'message' handler with no
 *                  call-stack `catch` above it, so Node reports it as an
 *                  uncaught exception and the process exits. Verified: a
 *                  `node -e` pointing `TESSDATA_PATH` at an empty directory
 *                  crashed the whole process before this line existed.
 *                  This alone is NOT enough to make a missing/corrupt
 *                  language model a clean rejection — see the next
 *                  paragraph and `services/ocr/tesseract-service.js`'s
 *                  `initialize()`, which is where that is actually fixed.
 *
 * A missing/corrupt `${lang}.traineddata` rejects under
 * `action:'loadLanguage'`, not `action:'load'` — the only two cases
 * `createWorker.js`'s own `workerResReject()` covers are a `load`-action
 * rejection and a `worker.onerror` (an actual worker_thread crash).
 * `loadLanguage` rejections instead fall into
 * `loadInternal().then(...).catch(() => {})` at the bottom of that same
 * file, which swallows the rejection — `Tesseract.createWorker()`'s
 * returned promise then never resolves NOR rejects; it hangs forever, not
 * "throws ENOENT" as this comment's earlier draft claimed. Verified: a
 * `node -e` reproduction pointing `TESSDATA_PATH` at an empty directory hung
 * indefinitely (`timeout 15` had to kill it) once `errorHandler` above
 * stopped it from crashing instead. `tesseract-service.js`'s `initialize()`
 * checks both files exist BEFORE ever calling `Tesseract.createWorker()`,
 * which is what actually turns this into a fast, catchable rejection.
 *
 * @type {{langPath: string, gzip: boolean, cachePath: string, errorHandler: (err: unknown) => void}}
 */
const TESSERACT_WORKER_OPTIONS = Object.freeze({
    langPath: TESSDATA_DIR,
    gzip: false,
    cachePath: TESSDATA_DIR,
    errorHandler: () => {},
});

module.exports = { TESSDATA_DIR, TESSERACT_WORKER_OPTIONS };
