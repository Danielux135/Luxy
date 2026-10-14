// coherencia entre la documentacion y la implementacion real.
//
// estas pruebas evitan que CLAUDE.md, AGENTS.md o el README se queden
// describiendo comandos o archivos que ya no existen.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const read = (relative: string): string => readFileSync(join(repoRoot, relative), 'utf8');

const rootPackage = JSON.parse(read('package.json')) as {
  scripts: Record<string, string>;
  workspaces: string[];
};

const claudeMd = read('CLAUDE.md');
const agentsMd = read('AGENTS.md');
const readme = read('README.md');

/** extrae los `npm run <algo>` y `npm test` citados en un texto */
function citedNpmScripts(text: string): string[] {
  const scripts = new Set<string>();
  for (const match of text.matchAll(/npm run ([a-z][a-z0-9:_-]*)/g)) {
    scripts.add(match[1]!);
  }
  if (/\bnpm test\b/.test(text)) scripts.add('test');
  return [...scripts];
}

describe('archivos de contexto obligatorios', () => {
  const requeridos = [
    'CLAUDE.md',
    'AGENTS.md',
    'README.md',
    '.claude/settings.json',
    'apps/gateway/CLAUDE.md',
    'apps/agent/CLAUDE.md',
    'packages/shared/CLAUDE.md',
    'supabase/CLAUDE.md',
    'docs/ARCHITECTURE.md',
    'docs/SECURITY.md',
    'docs/TELEGRAM.md',
    'docs/SUPABASE.md',
    'docs/CLOUDFLARE.md',
    'docs/SETUP_WINDOWS.md',
    'docs/decisions/0001-luxy-architecture.md',
    '.env.example',
    '.env.providers.example',
    'apps/gateway/wrangler.toml.example',
  ];

  for (const archivo of requeridos) {
    it(`existe ${archivo}`, () => {
      expect(existsSync(join(repoRoot, archivo))).toBe(true);
    });
  }

  const plantillas = [
    'implement-feature',
    'fix-bug',
    'review-security',
    'review-diff',
    'create-provider',
    'create-telegram-command',
    'database-migration',
    'release-check',
  ];

  for (const plantilla of plantillas) {
    it(`existe la plantilla ${plantilla}.md`, () => {
      expect(existsSync(join(repoRoot, 'docs', 'agent-prompts', `${plantilla}.md`))).toBe(true);
    });
  }

  const scripts = [
    'setup-machine.ps1',
    'start-luxy.ps1',
    'start-luxy.cmd',
    'install-autostart.ps1',
    'uninstall-autostart.ps1',
  ];

  for (const script of scripts) {
    it(`existe scripts/${script}`, () => {
      expect(existsSync(join(repoRoot, 'scripts', script))).toBe(true);
    });
  }
});

// un script citado es valido si existe en la raiz o en algun workspace,
// porque la documentacion a veces indica "cd apps/gateway && npm run dry-run"
const workspaceScripts = ['apps/gateway', 'apps/agent', 'packages/shared'].flatMap((dir) => {
  const packageJson = JSON.parse(read(join(dir, 'package.json'))) as {
    scripts?: Record<string, string>;
  };
  return Object.keys(packageJson.scripts ?? {});
});

const knownScripts = new Set([...Object.keys(rootPackage.scripts), ...workspaceScripts]);

describe('los comandos citados existen de verdad', () => {
  it('CLAUDE.md solo cita scripts que existen', () => {
    const faltan = citedNpmScripts(claudeMd).filter((name) => !knownScripts.has(name));
    expect(faltan, `scripts citados que no existen: ${faltan.join(', ')}`).toEqual([]);
  });

  it('AGENTS.md solo cita scripts que existen', () => {
    const faltan = citedNpmScripts(agentsMd).filter((name) => !knownScripts.has(name));
    expect(faltan, `scripts citados que no existen: ${faltan.join(', ')}`).toEqual([]);
  });

  it('el README solo cita scripts que existen', () => {
    const faltan = citedNpmScripts(readme).filter((name) => !knownScripts.has(name));
    expect(faltan, `scripts citados que no existen: ${faltan.join(', ')}`).toEqual([]);
  });

  it('los scripts clave existen en package.json', () => {
    for (const nombre of ['lint', 'typecheck', 'test', 'build', 'check', 'demo', 'setup:machine']) {
      expect(rootPackage.scripts[nombre], `falta el script ${nombre}`).toBeTruthy();
    }
  });
});

describe('CLAUDE.md y AGENTS.md no se contradicen', () => {
  // reglas que deben aparecer en AMBOS archivos
  const reglas: Array<[string, RegExp]> = [
    ['prohibida la API de Anthropic', /API de Anthropic/i],
    ['prohibida la API de OpenAI', /API de OpenAI/i],
    ['prohibida ANTHROPIC_API_KEY', /ANTHROPIC_API_KEY/],
    ['prohibida OPENAI_API_KEY', /OPENAI_API_KEY/],
    ['prohibido dangerously-skip-permissions', /dangerously-skip-permissions/],
    ['prohibido exec / shell', /exec|shell/i],
    ['obligatorio spawn con argumentos separados', /spawn/i],
    ['validar con Zod', /Zod/i],
    ['no hacer git push sin autorizacion', /git push/i],
    ['ejecutar lint, typecheck, test y build', /typecheck/],
  ];

  for (const [descripcion, patron] of reglas) {
    it(`ambos declaran: ${descripcion}`, () => {
      expect(patron.test(claudeMd), `falta en CLAUDE.md`).toBe(true);
      expect(patron.test(agentsMd), `falta en AGENTS.md`).toBe(true);
    });
  }

  it('ninguno autoriza lo que el otro prohibe respecto al push', () => {
    // ninguno debe decir que el push sea automatico
    expect(claudeMd).not.toMatch(/push автомат|push automatico sin/i);
    expect(agentsMd).not.toMatch(/push automatico sin/i);
  });
});

describe('.claude/settings.json es seguro', () => {
  const settings = JSON.parse(read('.claude/settings.json')) as {
    permissions: { allow: string[]; deny: string[] };
  };

  const allow = settings.permissions.allow.join(' ');
  const deny = settings.permissions.deny.join(' ');

  it('no autoriza git push', () => {
    expect(allow).not.toMatch(/git push/i);
    expect(deny).toMatch(/git push/i);
  });

  it('no autoriza borrados recursivos', () => {
    expect(allow).not.toMatch(/rm -rf|Remove-Item -Recurse/i);
    expect(deny).toMatch(/rm -rf/i);
  });

  it('no autoriza despliegues', () => {
    expect(allow).not.toMatch(/wrangler deploy|npm publish/i);
    expect(deny).toMatch(/wrangler deploy/i);
  });

  it('no autoriza migraciones remotas', () => {
    expect(deny).toMatch(/supabase db push|psql/i);
  });

  it('no autoriza descargar y ejecutar scripts de internet', () => {
    expect(allow).not.toMatch(/curl|wget|Invoke-WebRequest/i);
    expect(deny).toMatch(/curl/i);
  });

  it('no autoriza cambios en el registro de windows', () => {
    expect(deny).toMatch(/reg add|reg delete|HKLM/i);
  });

  it('deniega el acceso a los archivos con credenciales', () => {
    expect(deny).toMatch(/\.env/);
    expect(deny).toMatch(/\.env\.providers/);
    expect(deny).toMatch(/wrangler\.toml/);
  });

  it('no contiene rutas absolutas de ningun ordenador', () => {
    const texto = read('.claude/settings.json');
    expect(texto).not.toMatch(/[A-Z]:\\\\Users\\\\/);
    expect(texto).not.toMatch(/\/home\/[a-z]+\//);
  });
});

describe('no hay secretos ni rutas personales versionadas', () => {
  const versionados = [
    'CLAUDE.md',
    'AGENTS.md',
    'package.json',
    '.claude/settings.json',
    '.env.example',
    '.env.providers.example',
    'apps/gateway/wrangler.toml.example',
    'supabase/migrations/0001_luxy_initial_schema.sql',
    'supabase/migrations/0002_luxy_job_claim.sql',
    'scripts/start-luxy.ps1',
    'scripts/setup-machine.ps1',
    'scripts/install-autostart.ps1',
    'scripts/uninstall-autostart.ps1',
  ];

  it('ningun archivo versionado contiene un secreto con forma reconocible', () => {
    for (const archivo of versionados) {
      const contenido = read(archivo);
      expect(contenido, `${archivo}: jwt`).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\./);
      expect(contenido, `${archivo}: token de telegram`).not.toMatch(/\b\d{8,}:[A-Za-z0-9_-]{30,}\b/);
      expect(contenido, `${archivo}: clave con prefijo`).not.toMatch(/\b(sk|ghp|xoxb)[-_][A-Za-z0-9]{20,}\b/);
    }
  });

  it('los archivos de ejemplo marcan los valores como PENDIENTE', () => {
    for (const archivo of ['.env.example', '.env.providers.example']) {
      const contenido = read(archivo);
      const asignaciones = [...contenido.matchAll(/^([A-Z_]+)=(.+)$/gm)];
      expect(asignaciones.length).toBeGreaterThan(0);
      for (const [, nombre, valor] of asignaciones) {
        // se admiten valores numericos de configuracion y marcadores PENDIENTE
        const aceptable = /PENDIENTE|^\d+$|^https:\/\/PENDIENTE/.test(valor!);
        expect(aceptable, `${archivo}: ${nombre} no esta marcado como pendiente`).toBe(true);
      }
    }
  });

  it('wrangler.toml.example no contiene ningun secreto', () => {
    const contenido = read('apps/gateway/wrangler.toml.example');
    for (const secreto of [
      'TELEGRAM_BOT_TOKEN',
      'SUPABASE_SERVICE_ROLE_KEY',
      'MACHINE_REGISTRATION_SECRET',
    ]) {
      // pueden mencionarse en comentarios, pero nunca asignarse un valor
      expect(contenido).not.toMatch(new RegExp(`^\\s*${secreto}\\s*=`, 'm'));
    }
  });
});

describe('.gitignore protege los archivos sensibles', () => {
  const gitignore = read('.gitignore');

  for (const patron of [
    '.env',
    'wrangler.toml',
    'config.json',
    '.dev.vars',
    'node_modules/',
    'dist/',
  ]) {
    it(`ignora ${patron}`, () => {
      expect(gitignore).toContain(patron);
    });
  }

  it('no ignora los archivos de ejemplo', () => {
    expect(gitignore).toContain('!.env.example');
    expect(gitignore).toContain('!.env.providers.example');
  });
});

/** identificadores de las cabeceras `## <prefijo>-NNN`, en orden de aparicion */
function headerIds(text: string, prefix: 'LA' | 'D'): string[] {
  return [...text.matchAll(new RegExp(`^## (${prefix}-\\d+)`, 'gm'))].map((match) => match[1]!);
}

/** los que aparecen mas de una vez, cada uno una sola vez */
function repeatedIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) repeated.add(id);
    seen.add(id);
  }
  return [...repeated];
}

// el resto de la documentacion cita las acciones locales y las decisiones solo
// por su numero, asi que un numero repetido vuelve ambigua cada cita. ya
// ocurrio: dos copias del repositorio (la de Claude y el worktree de Codex)
// numeraban cada una por su cuenta y, al unirse, LA-022, LA-023, LA-030, LA-031
// y LA-032 quedaron con dos entradas distintas cada uno. se renumeraron el
// 2026-10-14. antes de escribir una entrada nueva hay que mirar el ultimo numero
// del archivo; esta prueba falla si alguien no lo hizo.
describe('los numeros de LA y de D no se repiten', () => {
  // sin la primera comprobacion, una expresion que no casara con nada dejaria
  // la prueba en verde para siempre
  it('LOCAL-ACTIONS.md no repite el numero de ninguna cabecera LA', () => {
    const ids = headerIds(read('LOCAL-ACTIONS.md'), 'LA');
    expect(ids.length, 'no se encontro ninguna cabecera ## LA-NNN').toBeGreaterThan(0);
    const repetidos = repeatedIds(ids);
    expect(repetidos, `LOCAL-ACTIONS.md repite cabecera: ${repetidos.join(', ')}`).toEqual([]);
  });

  it('DECISIONS.md no repite el numero de ninguna cabecera D', () => {
    const ids = headerIds(read('DECISIONS.md'), 'D');
    expect(ids.length, 'no se encontro ninguna cabecera ## D-NNN').toBeGreaterThan(0);
    const repetidos = repeatedIds(ids);
    expect(repetidos, `DECISIONS.md repite cabecera: ${repetidos.join(', ')}`).toEqual([]);
  });
});
