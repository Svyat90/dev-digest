import prettyBytes from "pretty-bytes";

/**
 * A human-readable file size for the diff and upload screens, e.g. 1337 -> "1.34 kB".
 */
export function formatSize(bytes: number | null): string {
  return prettyBytes(bytes ?? 0);
}

/**
 * The size change between two versions of a file, e.g. "+1.2 kB".
 */
export function formatSizeDelta(before: number, after: number): string {
  const delta = after - before;
  return `+${prettyBytes(delta)}`;
}
