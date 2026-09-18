import { describe, it, expect } from 'vitest';
import { ORIENTATION_TAGS, disambiguateOrientation } from './vault-image-orientation.js';

describe('desambiguar «desde detras»', () => {
  it('el prompt exacto que salio de frente tres veces gana la orientacion sexual', () => {
    // medido: `from behind` lo cumple el generador girando el cuerpo, porque
    // dice donde esta la camara y no que parte va al objetivo. Con la postura a
    // cuatro patas ya declarada, la lectura correcta no es una opinion
    const escena = 'from behind, on all fours, looking back, nude, soft light, on bed';
    const salida = disambiguateOrientation(escena);

    expect(salida.added).toEqual([ORIENTATION_TAGS.rear]);
    expect(salida.text).toBe(
      'from behind, ass to camera, on all fours, looking back, nude, soft light, on bed',
    );
  });

  it('«looking back» no cuenta como orientacion: el prompt que fallo lo llevaba', () => {
    // dice donde queda la cara, no hacia donde va el cuerpo. Si contara, la
    // escena medida arriba se habria quedado sin arreglo
    const salida = disambiguateOrientation('from behind, looking back, on bed');
    expect(salida.added).toEqual([ORIENTATION_TAGS.neutral]);
  });

  it('de pie sale la forma neutra, no la sexual', () => {
    // sin postura que deje el trasero hacia atras no se añade nada sexual: eso
    // seria inventar contenido que la escena no implica
    const salida = disambiguateOrientation('from behind, standing by the window, soft light');
    expect(salida.added).toEqual([ORIENTATION_TAGS.neutral]);
    expect(salida.text).toBe(
      'from behind, back to camera, standing by the window, soft light',
    );
  });

  it('tumbada tambien sale la forma neutra', () => {
    const salida = disambiguateOrientation('from behind, lying on the bed, warm light');
    expect(salida.added).toEqual([ORIENTATION_TAGS.neutral]);
  });

  it('no toca una escena que ya dice «ass to camera»', () => {
    const escena = 'from behind, ass to camera, on all fours, on bed';
    const salida = disambiguateOrientation(escena);
    expect(salida.added).toEqual([]);
    expect(salida.text).toBe(escena);
  });

  it('no toca una escena que ya dice «back to camera», «facing away» o «face down»', () => {
    for (const ya of ['back to camera', 'facing away', 'lying face down', 'back turned']) {
      const escena = `from behind, ${ya}, on bed`;
      expect(disambiguateOrientation(escena)).toEqual({ text: escena, added: [] });
    }
  });

  it('una escena sin «desde detras» no se toca, ni con la postura puesta', () => {
    // la condicion es desambiguar lo PEDIDO, no añadir un encuadre que nadie
    // pidio: a cuatro patas mirando a camara es una foto perfectamente valida
    const escena = 'on all fours, looking at viewer, nude, on bed';
    expect(disambiguateOrientation(escena)).toEqual({ text: escena, added: [] });
  });

  it('reconoce las otras formas de decir «desde detras»', () => {
    for (const disparador of ['from the back', 'rear view', 'back view', 'from the rear']) {
      const salida = disambiguateOrientation(`${disparador}, standing, soft light`);
      expect(salida.added).toEqual([ORIENTATION_TAGS.neutral]);
    }
  });

  it('reconoce las posturas que dejan el trasero hacia atras', () => {
    for (const postura of [
      'on all fours',
      'hands and knees',
      'bent over the desk',
      'bending over',
      'crawling',
      'ass up',
    ]) {
      const salida = disambiguateOrientation(`from behind, ${postura}, soft light`);
      expect(salida.added).toEqual([ORIENTATION_TAGS.rear]);
    }
  });

  it('las posturas que tambien se escriben de frente NO dan la etiqueta sexual', () => {
    // medido: «1girl, rear view, kneeling, indoors» salia con `ass to camera`,
    // una etiqueta sexual en una escena que no la implica. Arrodillarse,
    // asomarse o inclinarse se escriben igual mirando a camara, asi que caen en
    // la neutra por el mismo liston que dejo fuera «arched back»
    const salida = disambiguateOrientation('1girl, rear view, kneeling, indoors');
    expect(salida.added).toEqual([ORIENTATION_TAGS.neutral]);
    expect(salida.text).toBe('1girl, rear view, back to camera, kneeling, indoors');

    for (const postura of ['on her knees', 'on his knees', 'leaning forward', 'leaning over']) {
      const otra = disambiguateOrientation(`from behind, ${postura}, soft light`);
      expect(otra.added).toEqual([ORIENTATION_TAGS.neutral]);
    }
  });

  it('«from behind» de la LUZ no dispara nada', () => {
    // es la forma normal de escribir la iluminacion, y el bloque de
    // instrucciones pide la luz en cada escena: aqui llegaba a escribir `back to
    // camera` al lado del `facing the camera` que la escena ya traia
    for (const escena of [
      '1girl, backlit from behind, facing the camera, warm rim light',
      'light from behind, smiling at viewer',
      '1girl, backlit from behind, on all fours, on bed',
      'sunlight from behind, standing by the window',
    ]) {
      expect(disambiguateOrientation(escena)).toEqual({ text: escena, added: [] });
    }
  });

  it('la coma separa la luz del encuadre, y entonces si dispara', () => {
    // «warm light from behind» es una lampara; «warm light, from behind» son dos
    // etiquetas y la segunda si pide el encuadre
    const salida = disambiguateOrientation('warm light, from behind, standing');
    expect(salida.added).toEqual([ORIENTATION_TAGS.neutral]);
  });

  it('«detras de algo» y «sujetando a alguien» tampoco son un encuadre', () => {
    for (const escena of [
      'she peeks from behind the curtain, looking at viewer',
      'he holds her from behind, her face toward the camera',
      'from the back of the room, she smiles at the camera',
      'she hides from behind a tree, standing',
    ]) {
      expect(disambiguateOrientation(escena)).toEqual({ text: escena, added: [] });
    }
  });

  it('si la escena ya dice que mira a camara no se toca, diga lo que diga el resto', () => {
    // la puerta que mas escenas salva de las medidas: con esto dentro, añadir la
    // etiqueta seria mandar dos ordenes opuestas en el mismo prompt
    for (const mira of [
      'looking at viewer',
      'facing the camera',
      'front view',
      'eye contact',
      'smiles at the camera',
    ]) {
      const escena = `from behind, on all fours, ${mira}, on bed`;
      expect(disambiguateOrientation(escena)).toEqual({ text: escena, added: [] });
    }
  });

  it('«looking back» sigue sin contar como mirar a camara', () => {
    // es la postura de espaldas con la cara girada, que es justo lo que el
    // prompt que fallo tres veces llevaba
    for (const cara of ['looking back', 'looking back at viewer']) {
      const salida = disambiguateOrientation(`from behind, ${cara}, on bed`);
      expect(salida.added).toEqual([ORIENTATION_TAGS.neutral]);
    }
  });

  it('el articulo no hace que se repita lo que la escena ya decia', () => {
    // medido: «from behind, her back to the camera, standing» salia con «back to
    // camera, her back to the camera», la misma orden dos veces
    const conArticulo = 'from behind, her back to the camera, standing';
    expect(disambiguateOrientation(conArticulo)).toEqual({ text: conArticulo, added: [] });
    const sexual = 'from behind, ass to the camera, on all fours';
    expect(disambiguateOrientation(sexual)).toEqual({ text: sexual, added: [] });

    for (const ya of [
      'ass towards the viewer',
      'back towards viewer',
      'buttocks to the viewer',
      'she turns her back to the camera',
    ]) {
      const escena = `from behind, ${ya}, on all fours`;
      expect(disambiguateOrientation(escena)).toEqual({ text: escena, added: [] });
    }
  });

  it('no casa dentro de otra palabra', () => {
    // «behind» suelto, o pegado a otra cosa, no es una peticion de encuadre
    expect(disambiguateOrientation('a lamp behind the bed, standing').added).toEqual([]);
    expect(disambiguateOrientation('withdrawn expression, standing').added).toEqual([]);
  });

  it('aguanta espacios raros y mayusculas, y entonces la etiqueta va al final', () => {
    // el emparejamiento es sobre la forma normalizada, asi que reconoce la
    // peticion; el pegado no puede localizarla sin reescribir el resto, y
    // prefiere el final antes que tocar un texto que no entiende del todo
    const salida = disambiguateOrientation('From  Behind, standing');
    expect(salida.added).toEqual([ORIENTATION_TAGS.neutral]);
    expect(salida.text).toBe('From  Behind, standing, back to camera');
  });

  it('el disparador solo, sin nada detras, tampoco duplica la coma', () => {
    expect(disambiguateOrientation('from behind ').text).toBe('from behind, back to camera');
    expect(disambiguateOrientation('from behind,').text).toBe('from behind, back to camera');
  });

  // «seen from behind» es un encuadre de verdad y aun asi se deja pasar: es el
  // precio declarado de exigir que el disparador sea un elemento entero. Se
  // paga a gusto, porque esa misma indulgencia es la que impide meter un
  // encuadre en «he kisses her neck from behind»
  it('en prosa corrida no actua, aunque la frase pida un encuadre', () => {
    expect(disambiguateOrientation('seen from behind ').added).toEqual([]);
  });

  // MEDIDOS uno a uno sobre la version anterior, que reconocia los usos que no
  // son encuadre con listas de palabras: de 35 frases de dormitorio escritas
  // sin mirar esas listas, 22 ganaron una etiqueta que nadie habia pedido. Se
  // colaban por cuatro sitios —la luz con una palabra que no estaba en la
  // lista, la luz nombrada a mas de tres palabras, los verbos de contacto, y
  // «from a back room»— y los cuatro desaparecen con la misma regla: que el
  // disparador sea un elemento entero
  describe('los usos que NO son encuadre', () => {
    const frases = [
      'warm candlelight coming from behind, indoors',
      'the glow of the fireplace from behind, she stands',
      'moonlight spilling through the window from behind, on bed',
      'backlit from behind, facing the camera, warm rim light',
      'he kisses her neck from behind, her eyes closed',
      'he holds her from behind, her face toward the camera',
      'she peeks from behind the curtain, looking at viewer',
      'she walks in from a back room, bare feet, morning light',
      'rear view mirror hanging, night drive',
      'a voice from behind, she looks over her shoulder',
    ];

    for (const frase of frases) {
      it(`no toca «${frase.slice(0, 34)}…»`, () => {
        const salida = disambiguateOrientation(frase);
        expect(salida.added).toEqual([]);
        expect(salida.text).toBe(frase);
      });
    }
  });

  it('es idempotente: pasar dos veces no añade dos etiquetas', () => {
    const una = disambiguateOrientation('from behind, on all fours, on bed');
    const dos = disambiguateOrientation(una.text);
    expect(dos.added).toEqual([]);
    expect(dos.text).toBe(una.text);
  });

  it('una escena vacia no gana nada', () => {
    expect(disambiguateOrientation('')).toEqual({ text: '', added: [] });
  });
});
