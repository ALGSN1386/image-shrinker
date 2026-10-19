# image-shrinker

Compress and resize images in your browser. Nothing is uploaded.

**→ [algsn1386.github.io/image-shrinker](https://algsn1386.github.io/image-shrinker/)**

## Why this exists

Attachment limits are measured in megabytes, and the usual fix is to hand your
photos to a random upload site and hope it deletes them. The work is a resize and
a re-encode — both of which the browser can already do.

So this does it locally. Open the page, drop files in, download the result. No
account, no upload, no server to trust.

## What it does

- Resizes to a maximum edge you choose (or keeps the original dimensions)
- Re-encodes as JPEG or WebP at a quality you choose
- Shows original vs. compressed size and the percentage saved
- Handles many files at once, with a download-all button
- Paints white behind transparent PNGs so they don't turn black as JPEG
- Respects EXIF orientation, so phone photos aren't sideways

Changing a setting re-runs the whole batch, so you can find a quality that still
looks fine before downloading anything.

## How it works

Three browser APIs, no dependencies:

| Step | API |
|---|---|
| Read the file | `createImageBitmap` (falls back to `<img>`) |
| Resize | `<canvas>` + `drawImage` |
| Encode | `canvas.toBlob(type, quality)` |

The only state is the list of files you dropped. Nothing is persisted, and no
network request is made after the initial page load.

## Run it locally

No build step, no dependencies:

```sh
python -m http.server 8000
# then open http://localhost:8000
```

Any static file server works.

## Deploy

Static files at the repository root, served by GitHub Pages from `main`.

## License

MIT — see [LICENSE](LICENSE).
