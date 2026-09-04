# Imágenes gratis con AI Horde

Cómo generar imágenes en la pestaña **Privado** sin pagar nada y sin dar una
tarjeta. Es el proveedor alternativo al de pago: no lo sustituye, convive con él.
Un personaje pertenece a uno de los dos y no se migra.

## Qué es AI Horde y por qué es gratis

AI Horde es una red de voluntarios. Gente que tiene una GPU encendida presta su
tiempo de cálculo y tu petición se ejecuta en el ordenador de alguno de ellos.
Detrás hay una organización sin ánimo de lucro, no una empresa que vende
créditos.

De ahí salen las dos consecuencias que importan:

- **No hay método de pago.** No se pide tarjeta ni al registrarse ni después. No
  hay plan de pago que desbloquee nada.
- **No hay servicio garantizado.** Si nadie tiene cargado el modelo que pides, la
  petición no se hace. El horde lo dice (`is_possible: false`) y Luxy aborta en
  vez de esperar a que caduque.

## Sacar la clave

1. Entra en <https://aihorde.net> y regístrate. Basta un correo.
2. Copia la clave de API que te da la web. No tiene prefijo reconocible: es una
   cadena suelta.
3. En Luxy: pestaña **Privado** → guardar clave de AI Horde.

La clave se cifra en la bóveda (`secrets.enc`) como cualquier otro secreto. No se
escribe en `config.json`, no vuelve a mostrarse y no aparece en los logs.

Una vez guardada, Luxy puede consultar tu cuenta (`/v2/find_user`) y enseñarte
usuario, kudos y cuántas peticiones simultáneas te permite la red.

## La clave anónima `0000000000`

Diez ceros. Funciona sin registrarse y genera imágenes de verdad. Tiene dos
consecuencias, y las dos son malas para una bóveda privada:

- **La red te atiende la última.** Prioridad casi nula en la cola.
- **Comparte lo que generas.** Con la clave anónima el servidor **ignora**
  `shared: false` y fuerza `shared: true`, es decir, **dona tus imágenes a un
  conjunto de datos público**. Luxy pide siempre `shared: false`; con esa clave
  el horde no lo respeta.

Por eso Luxy avisa en cuanto detecta que la clave guardada es la anónima
(`hordeAnonymous`), antes de generar nada. Registrarse es gratis y quita las dos
consecuencias. Usar la anónima en una bóveda privada es exactamente lo contrario
de lo que se espera de una bóveda.

## Kudos

Los kudos **no son dinero**. No se compran, no se venden, no caducan y no
desbloquean funciones.

Lo único que hacen es decidir **en qué puesto de la cola entra tu petición**. Con
0 kudos se genera igual: se espera más. Registrarse ya te da algunos, y prestar tu
propia GPU es la forma de tener más — pero no hace falta para usar el sistema.

Lo que sí consume más kudos por imagen: más píxeles, más pasos, `hiresFix`,
post-procesado y cada LoRA (+3 kudos). Mandar **varios modelos a la vez no cuesta
kudos extra**.

## Crear un personaje: la receta

Aquí está la diferencia real con el proveedor de pago.

En el proveedor de pago el personaje vive **en su servidor**: creas una identidad,
te devuelve un identificador, lo mandas y la cara vuelve igual. Editarlo cuesta.

**En AI Horde el personaje no existe en ningún servidor.** Cada petición nace de
cero. El personaje **es su receta**, guardada aquí, cifrada, en tu ordenador:

- `models`: de 1 a 4 nombres de modelo, exactos.
- `appearance`: el aspecto fijo (pelo, ojos, complexión, rasgos), en inglés.
- `outfit`: la ropa habitual, aparte porque cambia más a menudo que la cara.
- `negative`, `seed`, `width`, `height`, `steps`, `cfgScale`, `samplerName`,
  `scheduler`, `clipSkip`, `loras`, `hiresFix`, `postProcessing`, `promptStyle`.

Consecuencia práctica: **editar un personaje del horde no cuesta nada**. No hay
que volver a entrenar ni a subir nada; es cambiar texto en local. Al revés que en
el proveedor de pago.

### Qué hace que la cara se repita

Tres cosas, y las tres tienen que quedarse quietas entre imágenes:

1. **El aspecto fijo.** `appearance` se antepone palabra por palabra en cada
   generación, y va **primero** porque los primeros tokens pesan más: si la escena
   se adelanta, la identidad se diluye.
2. **La semilla.** Con la misma `seed` la cara se repite mucho mejor. **Sin seed
   fija (`null`) la cara cambia más entre imágenes.**
3. **El mismo modelo.** Cambiar de modelo cambia la cara aunque el prompt sea
   idéntico.

No es una garantía: es una difusión, no un identificador. Se parece mucho, no es
la misma persona bit a bit.

### Lo único que fija de verdad la cara: un LoRA

Un LoRA de personaje son **pesos**: no describe la cara, la impone. Es lo único
en AI Horde que la mantiene entre escenas distintas, y el formulario del
personaje tiene su propio apartado para pedirlo.

Lo que hay que saber antes:

- **Tiene que estar publicado en CivitAI.** El worker lo descarga de allí. **No
  se puede subir un LoRA propio al horde**: no existe endpoint de subida.
- **Cuesta +3 kudos por LoRA**, además del coste de la imagen. El máximo son 5.
- **Sólo 9 de los 18 workers de hoy aceptan LoRAs**, así que pedir uno **reduce
  a la mitad** quién puede atenderte. Se nota en la espera.
- Con la casilla **«es un id de versión»** marcada, el valor tiene que ser el id
  **numérico** de esa versión en CivitAI, no su nombre. Sin marcar, vale el
  nombre exacto o el id de la página del modelo, y siempre te sirve la última
  versión.
- Si el LoRA necesita una **palabra de activación** y no la pones —ni en
  `injectTrigger` ni en el aspecto— el LoRA prácticamente no hace nada. El valor
  `any` coge la primera que encuentre.
- Un LoRA marcado NSFW en CivitAI lo rechazan los workers SFW, y uno de acceso
  restringido falla al descargarse.

Entrenar uno es trabajo de contenido, no de Luxy: se hace fuera y se publica.

### Partir de una imagen anterior (img2img)

En el panel de generar, con un personaje del horde, se puede elegir una imagen
que ya esté en la conversación como punto de partida.

**Lo que hace y lo que no**, porque es la confusión más fácil de esta pantalla:

- **Sí**: varía una imagen que ya salió bien conservando bastante de lo que
  había —encuadre, pose, cara— para sacar otra parecida.
- **No**: llevar la cara del personaje a una escena nueva. Para eso haría falta
  un adaptador de identidad —IP-Adapter, FaceID, InstantID— o un modelo de
  edición por instrucción, y **AI Horde no tiene ninguno de los dos**
  (comprobado contra su swagger y sus 178 modelos el 2026-09-04: ni un worker).

Cuánto se aleja del original lo decide el campo **«Cuánto puede cambiar»** del
personaje (`denoisingStrength`, 0,45 por defecto). Por debajo de **0,3** devuelve
casi la misma imagen; por encima de **0,6** se pierde la cara, que es justo lo
que se quería conservar.

Dos costes: la petición gasta **un 30 % más de kudos**, y la imagen viaja entera
dentro del cuerpo. Luxy sólo admite **webp** como punto de partida, que es lo que
documenta la API y lo que el propio horde devuelve, así que cualquier imagen que
haya generado él vale; un PNG adjuntado a mano se rechaza diciéndolo.

## Elegir modelo

Luxy trae dos listas de partida, **verificadas contra `/v2/status/models` el
2026-09-04**. Los números de workers de esa lista son una foto de ese día y sirven
sólo para ordenar la lista en pantalla; el número real se consulta en vivo con
_cargar modelos_ y cambia cada pocas horas.

**Anime** (Pony, Illustrious, NoobAI y derivados). Se les escribe con **etiquetas
estilo booru** separadas por comas, no con frases. Quieren `clipSkip 2`.

**Realista** (Juggernaut, AlbedoBase, CyberRealistic, Realistic Vision…). Se les
escribe en prosa.

Lo que decide tamaño y `clipSkip` no es el estilo sino la familia del modelo:

| Familia  | Tamaño típico     | clipSkip |
| -------- | ----------------- | -------- |
| **SDXL** | 1024×1024         | 2        |
| **SD1**  | 512×768 (retrato) | 1        |

No es una preferencia estética. SD1 se entrenó a 512: pedirle 1024 da cuerpos
deformes y personajes duplicados, y encima cuesta más kudos, que se cobran por
píxel. SDXL a 512 pierde detalle. `recipeDefaultsFor(baseline)` ya pone estos
valores al crear la receta.

### Marca varios modelos a la vez

Una receta admite hasta **4 modelos**. Merece la pena marcar varios:

- El horde **suma los workers** de todos y reparte la petición entre ellos.
- Así no te quedas esperando a que se libere el modelo popular.
- **No cuesta kudos extra.**

El precio es que la cara varía algo más entre modelos. Si te importa más la
consistencia que la espera, marca uno solo.

## La trampa de los nombres

**El horde no busca por parecido.** El nombre del modelo se compara exacto, byte a
byte. Un solo carácter distinto —o un espacio de más— deja la petición **en cola
hasta que caduca**: sin error, sin imagen y sin explicación.

El caso concreto que más engaña:

> `AlbedoBase XL (SDXL)` **no** es `AlbedoBase XL 3.1`.

Se parecen en el nombre y no en lo que hacen: el primero **no admite NSFW** y
devuelve otra cosa sin decir por qué. La lista de Luxy trae `AlbedoBase XL 3.1`.

Por eso conviene elegir de la lista y no escribir el nombre a mano. Si lo
escribes, cópialo de `/v2/status/models`.

## Qué no hace

- **No transfiere una cara a una escena nueva.** No hay IP-Adapter, ni FaceID,
  ni InstantID, ni PhotoMaker, ni face-swap, ni ningún modelo de edición por
  instrucción (Flux Kontext, Qwen-Image-Edit: **cero workers**). Comprobado
  contra su swagger 2.6 y sus 178 modelos el 2026-09-04. Lo más parecido es un
  LoRA, y eso son pesos, no una foto de referencia.
- **No genera vídeo.** Ni corto ni largo. Sólo imágenes fijas.
- **No promete tiempos.** No hay SLA. Una petición puede tardar 20 segundos o
  varios minutos según cuántos workers estén conectados y cuánta cola haya.
- **No guarda nada tuyo.** No hay galería remota ni personajes en su servidor.

## Límites reales

| Límite                | Valor                                                                    |
| --------------------- | ------------------------------------------------------------------------ |
| Tamaño                | lados **múltiplos de 64**, entre 512 y 1536 en la receta                 |
| Modelos por receta    | 1 a 4                                                                    |
| LoRAs                 | **máximo 5** (cada uno +3 kudos)                                         |
| Post-procesado        | máximo 2                                                                 |
| `steps`               | 1 a 60                                                                   |
| `cfgScale`            | 0 a 30, **como mucho dos decimales**                                     |
| Caducidad de petición | **10 minutos**; pasados, el horde la descarta y hay que volver a pedirla |
| Enlace del resultado  | caduca a los 30 minutos                                                  |
| Espera típica         | de 20 segundos a varios minutos, según cola                              |

Un lado que no sea múltiplo de 64 hace que el horde rechace la petición entera,
así que Luxy la corta antes de enviarla, cuando todavía se puede explicar. Lo
mismo con `cfgScale`: con más de dos decimales la API responde `BadCFGDecimals`
**después** de encolar.

## Privacidad

Esto es lo que hay que entender antes de escribir un prompt:

**Tu prompt sale de tu ordenador y lo ve un voluntario.** El worker que genera la
imagen es el PC de un desconocido, y ve el texto que le mandas.

La bóveda cifra lo que **Luxy guarda** —la clave, la receta, el personaje—. No
protege, ni puede proteger, lo que un tercero ve porque **se lo estás enviando**.
Son dos cosas distintas y confundirlas es el error caro.

En la práctica: **nada de datos reales en el prompt.** Ni nombres de personas
reales, ni direcciones, ni nada que no darías a un desconocido.

Luxy pide siempre `shared: false` para no donar la imagen a ningún conjunto de
datos. Con la clave anónima el horde lo ignora (ver arriba).

Luxy también pide `nsfw: true` en las peticiones de la bóveda. **No significa
«genera porno»**: le dice al horde que no mande el trabajo a los workers que
censuran, que son los que devuelven una imagen negra sin avisar cuando el prompt
les parece dudoso.

## Qué prohíbe la red

AI Horde tiene un **filtro anti-CSAM** propio, en el servidor. No es opcional, no
depende del worker y no depende de Luxy.

Si salta, la respuesta trae `censorship: csam`. Luxy **lo dice tal cual y no
reintenta**: no es un fallo técnico y repetir la petición no lo arregla, sólo
vuelve a llamar a la puerta del mismo filtro.

El resto de las normas de contenido son las de la red y las de cada worker, no las
de Luxy.

## Problemas

**«la petición pudo caducar: el horde la descarta a los 10 minutos»**
El trabajo tardó más que el tope. Vuelve a pedir la imagen desde el principio.

**«el enlace de AI Horde caduca a la media hora»**
La URL firmada del resultado expiró. Vuelve a pedir el resultado.

**La petición se queda en cola y nunca avanza**
Casi siempre es un nombre de modelo mal escrito, que no coincide con ninguno
cargado. Vuelve a elegirlo de la lista.

**«ningún worker conectado tiene ese modelo»**
`is_possible: false`. No mejora esperando: marca otro modelo, o varios.

**Las caras no se parecen entre imágenes**
Falta la semilla, o estás repartiendo entre varios modelos. Fija una `seed` y deja
un único modelo.

**Te avisa de que la clave es anónima**
Es la clave `0000000000`. Regístrate en <https://aihorde.net> y guarda la tuya:
es gratis, no pide tarjeta y deja de compartir lo que generas.
