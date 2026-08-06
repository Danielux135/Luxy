// escritura de artefactos: la unica ruta por la que texto generado por un
// modelo acaba siendo un archivo en el disco.
//
// POR QUE ESTA SEPARADO: hasta ahora el agente solo escribia dentro de un
// worktree de git, y eso era una barrera de seguridad, no una casualidad. Esto
// abre una carpeta mas, asi que las reglas estan todas juntas y en un sitio:
//
// 1. la carpeta es fija y se calcula aqui, nunca llega de fuera;
// 2. el nombre lo construye Luxy a partir del identificador del trabajo; el
//    modelo no propone nombre ni extension;
// 3. la ruta final se vuelve a comprobar contra la raiz antes de escribir,
//    aunque los dos puntos anteriores ya lo garanticen. Es barato;
// 4. hay tope de tamaño;
// 5. si algo falla, el trabajo NO se cae: se avisa y la respuesta se guarda
//    como siempre. Un artefacto es una mejora, no un requisito.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { MAX_ARTIFACT_BYTES, isPathInside } from '@luxy/shared';
import type { ArtifactKind, JobArtifact } from '@luxy/shared';
import { dataDir } from './paths.js';

/** raiz de los artefactos: `%LOCALAPPDATA%\Luxy\artifacts` */
export function artifactsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(dataDir(env), 'artifacts');
}

/** carpeta de un trabajo concreto */
export function jobArtifactDir(jobId: string, env: NodeJS.ProcessEnv = process.env): string {
  // el identificador viene del gateway y es un uuid, pero se filtra igual:
  // esta es la ultima linea antes de tocar el disco
  const safe = jobId.replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
  return join(artifactsDir(env), safe.length > 0 ? safe : 'sin-identificador');
}

export class ArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactError';
  }
}

/**
 * escribe el artefacto y devuelve su referencia.
 *
 * lanza `ArtifactError` con un mensaje que dice QUE HACER; quien llama decide
 * si eso tumba el trabajo (no lo hace: se avisa y se sigue).
 */
export async function writeJobArtifact(input: {
  jobId: string;
  fileName: string;
  kind: ArtifactKind;
  content: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}): Promise<JobArtifact & { path: string }> {
  const env = input.env ?? process.env;
  const bytes = Buffer.byteLength(input.content, 'utf8');
  if (bytes > MAX_ARTIFACT_BYTES) {
    throw new ArtifactError(
      `la salida ocupa ${bytes} bytes y el tope por archivo son ${MAX_ARTIFACT_BYTES}. ` +
        'Pidela por partes.',
    );
  }

  const directory = jobArtifactDir(input.jobId, env);
  const target = resolve(directory, input.fileName);
  // el nombre ya viene construido por Luxy; esto cubre el caso de que alguien
  // cambie esa funcion algun dia y deje pasar un separador
  if (!isPathInside(target, resolve(artifactsDir(env)))) {
    throw new ArtifactError('la ruta del artefacto se sale de la carpeta de Luxy');
  }

  await mkdir(directory, { recursive: true });
  await writeFile(target, input.content, 'utf8');

  return {
    fileName: input.fileName,
    kind: input.kind,
    bytes,
    sha256: createHash('sha256').update(input.content, 'utf8').digest('hex'),
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    path: target,
  };
}
