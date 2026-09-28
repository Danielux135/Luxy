// la confirmacion del enganche y el aviso «¿Es de…?» (`D-103`), revision del
// 28/09.
//
// Es una prueba ESTATICA, sobre el texto del codigo, como
// `renderer-effect-deps.test.ts`: el renderer no se monta en las pruebas. Vive en
// `main` porque necesita leer archivos. Un cambio de formato puede darle un falso
// rojo; lo que fija son tres fallos que se vieron en el codigo:
//
// 1. el boton de la cabecera abria la confirmacion varias pantallas mas abajo
//    sin llevar la vista a ella: pulsar parecia no hacer nada;
// 2. reabrir la MISMA conversacion o «Sincronizar» tiraba la vista previa y la
//    confirmacion no la volvia a pedir: «Comprobando…» para siempre;
// 3. el aviso por nombre troceaba toda la conversacion en cada tecla.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const leer = (relativo: string): string =>
  readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

const VAULT_PAGE = leer('../renderer/pages/Vault.tsx');
const USE_VAULT = leer('../renderer/useVault.ts');

/**
 * el cuerpo de una funcion de primer nivel: hasta el cierre `}` en la columna 0.
 * Cortar en la siguiente funcion se llevaba lo de en medio, y el
 * `scrollIntoView` del formulario del horde podia dar un falso verde.
 */
function cuerpo(source: string, firma: string): string {
  const start = source.indexOf(firma);
  if (start < 0) return '';
  const end = source.indexOf('\n}\n', start);
  return source.slice(start, end < 0 ? undefined : end);
}

describe('la confirmacion del enganche', () => {
  const panel = cuerpo(VAULT_PAGE, 'function OwnerChangePanel(');

  it('existe donde se la busca', () => {
    expect(panel.length).toBeGreaterThan(0);
    // y el corte se queda en su funcion: lo del horde, que tambien se desplaza,
    // no puede contar como suyo
    expect(panel).not.toContain('hordeForm');
    expect(panel).not.toContain('\nfunction ');
  });

  it('lleva la vista a si misma al abrirse', () => {
    expect(panel).toContain('scrollIntoView(');
    expect(panel).toMatch(/className="vault-generate" ref=\{box\}/);
  });

  it('vuelve a pedir la vista previa cuando se relee la conversacion', () => {
    // el efecto que la pide depende del contador...
    expect(panel).toMatch(/\}, \[[^\]]*\bownerPreviewEpoch\b[^\]]*\]\);/);
    // ...y el controlador lo sube justo donde tira la vista previa al releer
    const releer = USE_VAULT.indexOf('setConversationOwnerView(result.value.owner);');
    expect(releer).toBeGreaterThan(0);
    const tramo = USE_VAULT.slice(releer, releer + 600);
    expect(tramo).toContain('setOwnerPreview(null);');
    expect(tramo).toContain('setOwnerPreviewEpoch(');
  });

  it('Enviar dice en pantalla por que espera, no solo en el `title`', () => {
    const panelConversacion = cuerpo(VAULT_PAGE, 'function ConversationPanel(');
    expect(panelConversacion).toContain('Enviar espera a que confirmes o dejes estar el cambio de personaje');
  });

  it('el boton de la cabecera, desactivado, dice donde esta la confirmacion', () => {
    // la vista solo se lleva a la confirmacion la primera vez: al volver a la
    // conversacion, el boton salia gris y sin explicacion (revision del 28/09)
    const inicio = VAULT_PAGE.indexOf('disabled={vault.sending || ownerChange !== undefined}');
    expect(inicio).toBeGreaterThan(0);
    const boton = VAULT_PAGE.slice(inicio, VAULT_PAGE.indexOf('Enganchar a un personaje', inicio));
    expect(boton).toMatch(/title=\{\s*ownerChange !== undefined/);
    expect(boton).toContain('encima del selector de personaje');
  });
});

describe('el aviso por nombre', () => {
  it('no trocea la conversacion en cada render', () => {
    const panelConversacion = cuerpo(VAULT_PAGE, 'function ConversationPanel(');
    // el historial va memoizado con los turnos; en cada render solo el borrador
    expect(panelConversacion).toMatch(/useMemo\(\s*\(\) =>[\s\S]*?charactersNamedIn\(userTextsOf\(vault\.turns\)/);
    expect(panelConversacion).toContain('suggestWithHistory(');
    expect(panelConversacion).not.toContain('suggestCharacters(');
  });
});
