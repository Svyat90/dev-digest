import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsRepoDocsReader } from '../src/adapters/repo-docs/fs.js';

let base: string;
let root: string;
const reader = new FsRepoDocsReader();

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'repo-docs-'));
  root = join(base, 'clone');
  await mkdir(join(root, 'docs'), { recursive: true });
  await mkdir(join(root, '.devdigest/specs'), { recursive: true });
  await mkdir(join(root, 'node_modules/x/docs'), { recursive: true });
  await writeFile(join(root, 'docs/a.md'), '# A\n');
  await writeFile(join(root, '.devdigest/specs/b.md'), '# B\n');
  await writeFile(join(root, 'node_modules/x/docs/c.md'), '# C\n');
  await writeFile(join(root, 'docs/bin.md'), Buffer.from([0x63, 0x61, 0x66, 0xe9]));
  await writeFile(join(root, 'docs/big.md'), 'é'.repeat(400 * 1024)); // 800 KiB, 2 bytes each
  await writeFile(join(base, 'outside.md'), 'secret');
  await symlink(join(base, 'outside.md'), join(root, 'docs/evil.md'));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('FsRepoDocsReader', () => {
  it('lists markdown files, skipping symlinks and node_modules', async () => {
    expect(await reader.listMarkdown(root)).toEqual([
      '.devdigest/specs/b.md',
      'docs/a.md',
      'docs/big.md',
      'docs/bin.md',
    ]);
  });

  it('returns null for a missing root', async () => {
    expect(await reader.listMarkdown(join(base, 'nope'))).toBeNull();
  });

  it('reads a document', async () => {
    expect(await reader.read(root, 'docs/a.md')).toEqual({ ok: true, text: '# A\n', clipped: false });
  });

  it('maps failures to distinct reasons', async () => {
    expect(await reader.read(root, 'docs/evil.md')).toEqual({ ok: false, reason: 'outside_clone' });
    expect(await reader.read(root, '../x.md')).toEqual({ ok: false, reason: 'outside_clone' });
    expect(await reader.read(root, '/etc/passwd')).toEqual({ ok: false, reason: 'outside_clone' });
    expect(await reader.read(root, 'docs\\a.md')).toEqual({ ok: false, reason: 'outside_clone' });
    expect(await reader.read(root, 'docs/bin.md')).toEqual({ ok: false, reason: 'not_utf8' });
    expect(await reader.read(root, 'docs/none.md')).toEqual({ ok: false, reason: 'missing' });
    expect(await reader.read(join(base, 'nope'), 'docs/a.md')).toEqual({ ok: false, reason: 'missing' });
  });

  it('clips at 512 KiB on a codepoint boundary', async () => {
    const r = await reader.read(root, 'docs/big.md');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.clipped).toBe(true);
      expect(r.text).toBe('é'.repeat(256 * 1024));
    }
  });
});
