# format-size

`src/lib/format-size.ts` renders file sizes with
[`pretty-bytes`](https://github.com/sindresorhus/pretty-bytes).

- `formatSize(bytes)` — a byte count in human-readable units: `1337` → `1.34 kB`.
- `formatSizeDelta(before, after)` — the size change between two versions: `+1.2 kB`.

The upload limit shown next to it comes from `NEXT_PUBLIC_MAX_UPLOAD_BYTES`
(see `.env.example`).
