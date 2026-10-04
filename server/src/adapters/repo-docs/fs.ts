import { open, readdir, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import type { RepoDocReadResult, RepoDocsReader } from '@devdigest/shared';

const MAX_BYTES = 512 * 1024;
const SKIP_DIRS: ReadonlySet<string> = new Set(['.git', 'node_modules']);

function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

/** Drop an incomplete trailing UTF-8 sequence left by a byte-level clip. */
function backOffToCodepoint(buf: Buffer): Buffer {
  let i = buf.length - 1;
  let back = 0;
  while (i >= 0 && back < 4 && (buf[i]! & 0xc0) === 0x80) {
    i--;
    back++;
  }
  if (i < 0) return buf;
  const lead = buf[i]!;
  const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
  return back + 1 < need ? buf.subarray(0, i) : buf;
}

export class FsRepoDocsReader implements RepoDocsReader {
  async listMarkdown(root: string): Promise<string[] | null> {
    try {
      await readdir(root);
    } catch {
      return null;
    }
    const out: string[] = [];
    const walk = async (rel: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(rel ? join(root, rel) : root, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.isSymbolicLink()) continue;
        const next = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) await walk(next);
        } else if (e.isFile() && e.name.endsWith('.md')) {
          out.push(next);
        }
      }
    };
    await walk('');
    return out.sort();
  }

  async read(root: string, path: string): Promise<RepoDocReadResult> {
    if (
      path === '' ||
      path.startsWith('/') ||
      /^[a-zA-Z]:/.test(path) ||
      path.includes('\0') ||
      path.includes('\\') ||
      path.split('/').includes('..')
    ) {
      return { ok: false, reason: 'outside_clone' };
    }
    let realRoot: string;
    try {
      realRoot = await realpath(root);
    } catch {
      return { ok: false, reason: 'missing' };
    }
    let real: string;
    try {
      real = await realpath(join(realRoot, path));
    } catch (err) {
      return { ok: false, reason: errCode(err) === 'ENOENT' ? 'missing' : 'unreadable' };
    }
    if (!real.startsWith(realRoot + sep)) return { ok: false, reason: 'outside_clone' };

    let fh;
    try {
      fh = await open(real, 'r');
      const buf = Buffer.alloc(MAX_BYTES + 1);
      const { bytesRead } = await fh.read(buf, 0, MAX_BYTES + 1, 0);
      const clipped = bytesRead > MAX_BYTES;
      const bytes = clipped ? backOffToCodepoint(buf.subarray(0, MAX_BYTES)) : buf.subarray(0, bytesRead);
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return { ok: true, text, clipped };
      } catch {
        return { ok: false, reason: 'not_utf8' };
      }
    } catch (err) {
      return { ok: false, reason: errCode(err) === 'ENOENT' ? 'missing' : 'unreadable' };
    } finally {
      await fh?.close();
    }
  }
}
