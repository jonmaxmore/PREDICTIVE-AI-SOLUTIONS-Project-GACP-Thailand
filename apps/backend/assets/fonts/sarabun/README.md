# Sarabun (vendored) — PDF rendering font

These files are the **only** source of the Sarabun typeface used by the PDF
pipeline. They are read at render time by
`services/pdf/pdf-assets.js → getSarabunFontFaceCss()`, base64-encoded into
`data:font/woff2` URIs and injected into every document by
`services/pdf/pdf-generator.service.js`.

## Why they are here

Until 2026-07-25 all 14 PDF templates opened with

```css
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;…');
```

so every certificate, tax invoice, receipt and revenue receipt render made a
**server-side** request from the DTAM production host to a US font CDN. No
document content travelled, but the server IP, the headless-Chrome UA and a
real-time certification-issuance volume/timing signal did — and because the
renderer waits on `networkidle0`, a blocked or slow CDN stalled every
government PDF. The font is now vendored so no render depends on a remote host.

## Required files

`getSarabunFontFaceCss()` looks for exactly these, and **skips any that is
missing** (logging a warning; the templates then fall back to their declared
`'Noto Sans Thai', Tahoma, sans-serif` stack, so PDFs still render but with
degraded typography):

| weight | style  | files                                                              |
| ------ | ------ | ------------------------------------------------------------------ |
| 400    | normal | `sarabun-thai-400-normal.woff2`, `sarabun-latin-400-normal.woff2`   |
| 500    | normal | `sarabun-thai-500-normal.woff2`, `sarabun-latin-500-normal.woff2`   |
| 600    | normal | `sarabun-thai-600-normal.woff2`, `sarabun-latin-600-normal.woff2`   |
| 700    | normal | `sarabun-thai-700-normal.woff2`, `sarabun-latin-700-normal.woff2`   |
| 800    | normal | `sarabun-thai-800-normal.woff2`, `sarabun-latin-800-normal.woff2`   |
| 400    | italic | `sarabun-thai-400-italic.woff2`, `sarabun-latin-400-italic.woff2`   |

Both subsets are needed: `thai` carries the Thai script the documents are
written in, `latin` the ASCII numerals, certificate numbers and Latin plant
names. Weights above 800 (a handful of `font-weight: 900` rules) are
synthesised by the renderer from 800 — same behaviour as with the CDN.

## Where they come from

Copied verbatim from the `@fontsource/sarabun` package already vendored in this
repo at `apps/web-app/node_modules/@fontsource/sarabun/files/` (version 5.2.8),
which is the same self-hosting route the Next.js app uses.

To refresh, from the repo root:

```sh
SRC=apps/web-app/node_modules/@fontsource/sarabun/files
for w in 400 500 600 700 800; do
  for s in thai latin; do cp "$SRC/sarabun-$s-$w-normal.woff2" apps/backend/assets/fonts/sarabun/; done
done
for s in thai latin; do cp "$SRC/sarabun-$s-400-italic.woff2" apps/backend/assets/fonts/sarabun/; done
```

Do **not** re-point any template at a remote font host. The renderer's
sub-resource allowlist (`isPdfResourceAllowed`) now permits only `data:` and
`about:blank`, so a remote `@import` would be aborted at the network layer and
silently produce a fallback-font PDF.

## Licence

Sarabun is designed by Cadson Demak (Bangkok) and published under the
**SIL Open Font License 1.1** — see `LICENSE` in this directory. The OFL
permits bundling and redistribution with this software; the font name is
unchanged and the licence file travels with the binaries.
