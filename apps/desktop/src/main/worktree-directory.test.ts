import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { WorktreeDirectoryError, resolveWorktreeDirectory } from './worktree-directory.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('resolveWorktreeDirectory', () => {
  it('acepta una carpeta existente dentro de la raiz de Luxy', () => {
    const root = mkdtempSync(join(tmpdir(), 'luxy-worktrees-'));
    roots.push(root);
    const worktree = join(root, 'lux-uno');
    mkdirSync(worktree);

    expect(resolveWorktreeDirectory(worktree, root)).toBeTruthy();
  });

  it('rechaza una carpeta externa aunque el renderer la proponga', () => {
    const root = mkdtempSync(join(tmpdir(), 'luxy-worktrees-'));
    const outside = mkdtempSync(join(tmpdir(), 'luxy-outside-'));
    roots.push(root, outside);

    expect(() => resolveWorktreeDirectory(outside, root)).toThrow(WorktreeDirectoryError);
  });
});
