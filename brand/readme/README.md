# README art

The hero and the framed screenshots in `docs/screenshots` are rendered from the two pages here, so they can be redone whenever the app changes.

1. Run the app (`node core/bin/curi.mjs app`) and take 1440×900 screenshots of the screens you need, at 2x.
2. Serve a folder that holds these pages, the screenshots, `app/fonts` as `fonts/` and `brand/export` as `brand/`, e.g. `python3 -m http.server`.
3. Open and capture at 2x:
   - `hero.html?src=<home screenshot>` at 1600×720
   - `frame.html?src=<screenshot>` at 1720×1100
4. Scale to 2400 px wide and save as JPEG (quality ~88), e.g. `sips -s format jpeg -s formatOptions 88 --resampleWidth 2400 in.png --out out.jpg`.

Keep the screenshots honest: real data from a real machine, no mock-ups.
