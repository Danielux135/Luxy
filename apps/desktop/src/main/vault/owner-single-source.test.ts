// el dueño de una conversacion se lee en UN sitio (`D-103`).
//
// Tres funciones que miraban hacia atras por su cuenta dieron dos verdades: el
// identificador y la ficha se resolvian aparte, y soltar un personaje dejaba la
// ficha del anterior en vigor. Esta prueba falla si alguien vuelve a leer el
// personaje de un turno fuera de `conversation-store.ts`, o si reaparece alguno
// de los tres lectores retirados.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN = join(fileURLToPath(new URL('.', import.meta.url)), '..');

function sources(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

describe('una sola fuente del dueño', () => {
  const files = sources(MAIN);

  it('encuentra el codigo del proceso principal', () => {
    expect(files.some((file) => file.endsWith('conversation-store.ts'))).toBe(true);
    expect(files.some((file) => file.endsWith('handlers.ts'))).toBe(true);
  });

  // es una guarda de TEXTO, no un analisis del codigo: caza el acceso con punto,
  // con `?.`, con corchetes y la desestructuracion directa de un `turn`, y los
  // tres campos que resuelve `resolveConversationOwner`. Un alias
  // (`const t = opened.turn; t.characterId`) se le escapa, y solo mira el
  // proceso principal: el renderer no descifra turnos
  const FIELDS = '(characterId|characterDescription|instructions)';
  const READS = [
    new RegExp(`\\bturn\\s*(\\?\\.|\\.)\\s*${FIELDS}\\b`),
    new RegExp(`\\bturn\\s*(\\?\\.)?\\[\\s*['"\`]${FIELDS}`),
    new RegExp(`\\{[^}]*\\b${FIELDS}\\b[^}]*\\}\\s*=\\s*[\\w.?]*\\bturn\\b`),
  ];

  it('el personaje de un turno solo se lee en conversation-store.ts', () => {
    const fuera = files
      .filter((file) => !file.endsWith('conversation-store.ts'))
      .filter((file) => {
        const text = readFileSync(file, 'utf8');
        return READS.some((pattern) => pattern.test(text));
      })
      .map((file) => relative(MAIN, file));
    expect(fuera).toEqual([]);
  });

  it('la guarda caza las formas que dice cazar', () => {
    const casos = [
      'const id = opened.turn.characterId;',
      'const id = opened.turn?.characterDescription;',
      "const id = opened.turn['instructions'];",
      'const { characterId, text } = opened.turn;',
    ];
    for (const caso of casos) expect(READS.some((pattern) => pattern.test(caso))).toBe(true);
    // y no confunde un personaje cualquiera con el de un turno
    expect(READS.some((pattern) => pattern.test('const id = character.characterId;'))).toBe(false);
  });

  it('los lectores retirados no vuelven', () => {
    const conRetirados = files
      .filter((file) =>
        /\b(characterOf|latestCharacterId|latestCharacterDescription|latestInstructions)\b/.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map((file) => relative(MAIN, file));
    expect(conRetirados).toEqual([]);
  });
});
