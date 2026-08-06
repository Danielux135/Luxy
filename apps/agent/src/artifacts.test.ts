// pruebas de la escritura real de artefactos.
//
// POR QUE EXISTE: hasta ahora el agente solo escribia dentro de un worktree de
// git. Esto abre una carpeta mas para texto que ha generado un modelo, y lo que
// hay que demostrar no es que sepa escribir un archivo, sino que NO puede
// escribirlo en ningun otro sitio.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { MAX_ARTIFACT_BYTES } from '@luxy/shared';
import { ArtifactError, artifactsDir, jobArtifactDir, writeJobArtifact } from './artifacts.js';

const raices: string[] = [];

function entorno(): NodeJS.ProcessEnv {
  const root = mkdtempSync(join(tmpdir(), 'luxy-artifacts-'));
  raices.push(root);
  return { LOCALAPPDATA: root } as NodeJS.ProcessEnv;
}

afterEach(() => {
  for (const root of raices.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('writeJobArtifact', () => {
  it('escribe el archivo y devuelve una referencia comprobable', async () => {
    const env = entorno();
    const contenido = '<!doctype html><html><body>hola</body></html>';

    const escrito = await writeJobArtifact({
      jobId: '11111111-1111-4111-8111-111111111111',
      fileName: 'LUX-1.html',
      kind: 'html',
      content: contenido,
      env,
      now: () => new Date('2026-08-06T12:00:00.000Z'),
    });

    expect(readFileSync(escrito.path, 'utf8')).toBe(contenido);
    expect(escrito.bytes).toBe(Buffer.byteLength(contenido, 'utf8'));
    expect(escrito.sha256).toBe(createHash('sha256').update(contenido, 'utf8').digest('hex'));
    expect(escrito.createdAt).toBe('2026-08-06T12:00:00.000Z');
    // cada trabajo tiene su carpeta: dos respuestas no se pisan
    expect(escrito.path.includes('11111111-1111-4111-8111-111111111111')).toBe(true);
  });

  it('crea la carpeta si no existia', async () => {
    const env = entorno();
    expect(existsSync(artifactsDir(env))).toBe(false);

    await writeJobArtifact({
      jobId: 'trabajo-1',
      fileName: 'LUX-2.txt',
      kind: 'txt',
      content: 'contenido',
      env,
    });

    expect(existsSync(jobArtifactDir('trabajo-1', env))).toBe(true);
  });

  it('rechaza pasarse del tope por archivo', async () => {
    const env = entorno();
    await expect(
      writeJobArtifact({
        jobId: 'trabajo-2',
        fileName: 'LUX-3.txt',
        kind: 'txt',
        content: 'x'.repeat(MAX_ARTIFACT_BYTES + 1),
        env,
      }),
    ).rejects.toBeInstanceOf(ArtifactError);
  });

  it('un identificador con traversal no saca el archivo de la carpeta de Luxy', async () => {
    const env = entorno();
    const escrito = await writeJobArtifact({
      jobId: '../../fuera',
      fileName: 'LUX-4.txt',
      kind: 'txt',
      content: 'contenido',
      env,
    });

    // los separadores se filtran: acaba dentro, en una carpeta con nombre plano
    expect(escrito.path.startsWith(artifactsDir(env))).toBe(true);
    expect(escrito.path).not.toContain('..');
  });

  it('un nombre de archivo con traversal se rechaza', async () => {
    const env = entorno();
    await expect(
      writeJobArtifact({
        jobId: 'trabajo-3',
        // no deberia poder llegar aqui: `artifactFileName` ya lo filtra. Esta
        // es la segunda barrera, la que sigue estando si alguien cambia aquella
        fileName: '../../../fuera.txt',
        kind: 'txt',
        content: 'contenido',
        env,
      }),
    ).rejects.toBeInstanceOf(ArtifactError);
  });
});
