// pruebas de la conversion de markdown a HTML de Telegram.
//
// ORIGEN: los mensajes se enviaban sin parse_mode, asi que el usuario veia
// literalmente **Luxy** en vez de negrita.
//
// La invariante que mas importa NO es que el formato sea bonito, sino que el
// mensaje NUNCA se pueda perder por culpa del formato: Telegram rechaza el
// mensaje entero con un 400 si el marcado esta mal, y ahi se iria el resultado
// de un trabajo de media hora.
import { describe, it, expect } from 'vitest';
import { markdownToTelegramHtml, escapeHtml, hasBalancedTags } from './markdown.js';

describe('escapado', () => {
  it('escapa las tres entidades que exige Telegram', () => {
    expect(escapeHtml('a < b > c & d')).toBe('a &lt; b &gt; c &amp; d');
  });

  it('no escapa nada mas', () => {
    // en modo HTML el resto de caracteres son literales: por eso se elige HTML
    // y no MarkdownV2, que obliga a escapar dieciocho
    expect(escapeHtml('guion- punto. parentesis() llave{}')).toBe('guion- punto. parentesis() llave{}');
  });
});

describe('formato basico', () => {
  it('convierte negrita', () => {
    expect(markdownToTelegramHtml('defendiendo a **Luxy** con ganas')).toBe(
      'defendiendo a <b>Luxy</b> con ganas',
    );
  });

  it('convierte cursiva sin comerse los guiones bajos de un identificador', () => {
    expect(markdownToTelegramHtml('esto es *importante*')).toBe('esto es <i>importante</i>');
    // nombre_de_variable no debe volverse cursiva
    expect(markdownToTelegramHtml('usa nombre_de_variable aqui')).toBe('usa nombre_de_variable aqui');
  });

  it('convierte codigo en linea', () => {
    expect(markdownToTelegramHtml('el archivo `poema.txt` existe')).toBe(
      'el archivo <code>poema.txt</code> existe',
    );
  });

  it('convierte bloques de codigo con lenguaje', () => {
    const html = markdownToTelegramHtml('```ts\nconst a = 1;\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('language-ts');
    expect(html).toContain('const a = 1;');
  });

  it('convierte encabezados a negrita', () => {
    expect(markdownToTelegramHtml('## Resumen')).toBe('<b>Resumen</b>');
  });

  it('convierte enlaces http y https', () => {
    expect(markdownToTelegramHtml('mira [aqui](https://ejemplo.com/x)')).toBe(
      'mira <a href="https://ejemplo.com/x">aqui</a>',
    );
  });

  it('ignora enlaces con esquemas peligrosos', () => {
    // javascript: no debe convertirse en un enlace
    const html = markdownToTelegramHtml('[pulsa](javascript:alert(1))');
    expect(html).not.toContain('<a href');
  });
});

describe('lo que no puede romperse', () => {
  it('el codigo se escapa: no puede inyectar etiquetas', () => {
    const html = markdownToTelegramHtml('mira `<script>alert(1)</script>`');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('dentro de un bloque de codigo los asteriscos son literales', () => {
    const html = markdownToTelegramHtml('```\nint **puntero;\n```');
    expect(html).toContain('**puntero');
    expect(html).not.toContain('<b>');
  });

  it('un numero suelto no se confunde con un marcador interno', () => {
    // el marcador de sustitucion usa NUL, no " 5 ": con espacios, un texto
    // como "capitulo 3 y 5" se habria destrozado
    expect(markdownToTelegramHtml('capitulo 3 y 5 del libro')).toBe('capitulo 3 y 5 del libro');
  });

  it('los asteriscos sueltos no rompen nada', () => {
    const html = markdownToTelegramHtml('2 * 3 = 6 y a ** b');
    expect(hasBalancedTags(html)).toBe(true);
  });

  it('un markdown a medias no deja etiquetas abiertas', () => {
    for (const roto of ['**sin cerrar', 'a ` sin cerrar', '```\nsin cerrar', '__a', '~~b']) {
      expect(hasBalancedTags(markdownToTelegramHtml(roto))).toBe(true);
    }
  });

  it('el resultado siempre tiene las etiquetas equilibradas', () => {
    const casos = [
      'texto normal',
      '**negrita** y *cursiva* y `codigo`',
      '## Titulo\n\n- uno\n- dos',
      'a < b && c > d',
      '```js\nif (a < b) {}\n```',
      'mezcla **de `todo` a la vez**',
    ];
    for (const caso of casos) {
      expect(hasBalancedTags(markdownToTelegramHtml(caso))).toBe(true);
    }
  });

  it('detecta etiquetas desequilibradas', () => {
    expect(hasBalancedTags('<b>abierta')).toBe(false);
    expect(hasBalancedTags('cerrada</b>')).toBe(false);
    expect(hasBalancedTags('<b><i>cruzadas</b></i>')).toBe(false);
    expect(hasBalancedTags('<b>bien</b>')).toBe(true);
  });
});

describe('caso real', () => {
  it('el resumen que fallaba se ve bien', () => {
    const real = [
      'Hecho. He creado el archivo **`poema_para_hugo.txt`** con un poema para Hugo',
      'en tono humoristico, defendiendo a tu programa **Luxy**.',
    ].join('\n');
    const html = markdownToTelegramHtml(real);

    expect(html).toContain('<b><code>poema_para_hugo.txt</code></b>');
    expect(html).toContain('<b>Luxy</b>');
    expect(html).not.toContain('**');
    expect(hasBalancedTags(html)).toBe(true);
  });
});
