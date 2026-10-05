# Sarabun (bundled) — mobile app

Bundled so the app never downloads a font at runtime. Declared in
`pubspec.yaml` under `flutter: fonts: - family: Sarabun` and used as
`TextStyle(fontFamily: 'Sarabun', …)`.

## Why they are here

Until 2026-07-25 the app depended on the `google_fonts` package
(`pubspec.yaml: google_fonts: ^6.1.0`) and called `GoogleFonts.sarabun(...)` on
three widgets across the **login** and **registration** screens. With no
`assets:` block and no `GoogleFonts.config.allowRuntimeFetching = false`, that
package takes its default path: an HTTP GET to `fonts.gstatic.com` for the
Sarabun file on first use.

No application data was in the payload — but it meant that **every citizen who
opened the login screen caused a callback to a US host carrying their device's
public IP and User-Agent, before any consent screen**, on the two most
sensitive screens in the app. It also put a network dependency on the
offline-first login path: on a farm with no signal the title text silently fell
back to the system font.

Bundling removes the request entirely. `google_fonts` has been dropped from
`pubspec.yaml`.

## Files

| file                      | weight | Flutter `weight:` |
| ------------------------- | ------ | ----------------- |
| `Sarabun-Regular.ttf`     | 400    | 400               |
| `Sarabun-Medium.ttf`      | 500    | 500               |
| `Sarabun-SemiBold.ttf`    | 600    | 600               |
| `Sarabun-Bold.ttf`        | 700    | 700               |
| `Sarabun-ExtraBold.ttf`   | 800    | 800               |

`FontWeight.w900` (the login title) resolves to the 800 face — Sarabun has no
900 weight, and this is the same face `GoogleFonts.sarabun` resolved to before.

No italic face is bundled; nothing in the app requests one.

## Provenance

Built from the `@fontsource/sarabun` package (v5.2.8) already vendored in this
repo at `apps/web-app/node_modules/@fontsource/sarabun/files/` — the same
Sarabun the web app and the backend PDF pipeline self-host. Fontsource ships
per-subset `woff2`; Flutter needs a single `ttf` covering both scripts, so for
each weight the `thai` and `latin` subsets are decompressed and merged:

```python
# pip install fonttools brotli
from fontTools.ttLib import TTFont
from fontTools.merge import Merger
import tempfile, os

SRC = 'apps/backend/assets/fonts/sarabun/'          # same woff2 files the PDF pipeline uses
for weight, label in {400:'Regular',500:'Medium',600:'SemiBold',700:'Bold',800:'ExtraBold'}.items():
    d, parts = tempfile.mkdtemp(), []
    for subset in ('latin', 'thai'):                 # latin first: it supplies `space`
        f = TTFont(SRC + f'sarabun-{subset}-{weight}-normal.woff2')
        f.flavor = None                              # woff2 -> ttf
        p = os.path.join(d, f'{subset}.ttf'); f.save(p); parts.append(p)
    Merger().merge(parts).save(f'apps/mobile-app/assets/fonts/Sarabun-{label}.ttf')
```

Verified after merging (with `uharfbuzz`, per weight): shaping a Thai string
containing tone marks and above/below vowels through the merged font produces a
glyph/advance/offset sequence **identical** to the original `thai` subset —
i.e. the GPOS mark-positioning tables survived the merge — Latin advances match
the original `latin` subset, and no `.notdef` appears for either script.
Re-run that check if you rebuild these files.

## Licence

Sarabun is designed by Cadson Demak (Bangkok) and published under the
**SIL Open Font License 1.1** — see `LICENSE` in this directory. The OFL permits
bundling and redistribution with this software; the font name is unchanged and
the licence file travels with the binaries.
