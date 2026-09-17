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
usuario, kudos, cuántas peticiones simultáneas te permite la red y —desde el
2026-09-17— el **desglose de los kudos por conceptos** que esa misma llamada ya
devolvía y la pantalla tiraba.

## La clave anónima `0000000000`

Diez ceros. Funciona sin registrarse y genera imágenes de verdad. Lo que de
verdad cuesta es la cola: **la red te atiende la última**, porque el puesto va
por kudos y esa clave tiene el suelo más bajo de todos (−50). Registrarse es
gratis y sube ese suelo.

**Lo que esta sección decía, y era falso.** Hasta el 2026-09-17 aquí ponía que
con la clave anónima el servidor **ignora** `shared: false` y **fuerza**
`shared: true`, donando lo generado. Eso lo dice la documentación oficial de AI
Horde —«For anonymous users, this is always True»—, pero **no es lo que hace el
código desplegado**: en `initiate_waiting_prompt` la última línea de la cadena es
`else: shared = False`, y pisa también el forzado del anónimo en todos los modelos
menos uno de Stability retirado (`SDXL_beta::stability.ai#6901`), que es la única
rama que deja `shared` en cierto. Está así desde el 2023-07-08, y la versión del
repositorio (`HORDE_VERSION = "5.1.11"`) coincide con la que responde
`aihorde.net`. Ver «Compartir» más abajo y `D-093`.

Luxy **sigue avisando** de que la clave anónima comparte lo que generas
(`hordeAnonymous`, y el aviso `AnonymousKeySharesImage` que fabrica el adaptador
cuando se pide `shared: false` con esa clave). Ese aviso se apoya en la
documentación oficial, no en el código, así que hoy sobra. Se ha dejado donde
está a propósito: quitar un aviso de privacidad pide su propia decisión y su
propia prueba, y no se ha hecho ninguna de las dos. **Lo anotado, no arreglado.**

## Kudos

Los kudos **no son dinero**. No se compran, no se venden, no caducan y no
desbloquean funciones. Lo único que hacen es decidir **en qué puesto de la cola
entra tu petición**. Con 0 kudos se genera igual: se espera más.

### 25 no es un saldo, es un suelo

El servidor cobra cada imagen y **después** sube la cuenta al mínimo de su clase:
−50 con la clave anónima, 14 si te registraste con usuario y contraseña, 25 si te
registraste con un servicio externo (`get_min_kudos()`, y
`ensure_kudos_positive()` que lo aplica). Por eso un saldo puede quedarse clavado
en 25 semanas enteras: no es que no se cobre, es que **lo que hundiría la cuenta
por debajo del suelo se perdona**. El cargo crudo sí queda apuntado, en la
casilla `accumulated` del desglose, que no se recorta al suelo. Un `accumulated`
muy negativo junto a un saldo de 25 es exactamente eso, y no un error. Ojo con el
nombre de esa casilla: su contrato la define como «accumulated **or used**», así
que ahí cae también lo que paga prestar la GPU. **No es solo gasto**, y por eso
un número negativo dice que se ha gastado más de lo que ha entrado, no cuánto se
ha gastado.

**Cuál de las tres clases es la tuya lo dice el servidor, no el número.**
`/v2/find_user` devuelve `pseudonymous`, definido en su contrato como «If true,
this user has not registered using an oauth service», y Studio ya lo lee: con
`true` enseña el suelo de 14 y con `false` el de 25. Si el Horde no manda ese
campo, la pantalla **no dice de qué clase eres** y se limita a describir lo que se
ve. **Con qué servicio externo** te registraste no lo dice ningún campo de esa
respuesta, así que este documento tampoco lo nombra: `service` suena a eso pero es
otra cosa —«This is a service account used by a horde proxy»—.

Estar en el suelo no es neutro. Los kudos **disponibles** se calculan restando el
suelo, o sea 0: no se pueden transferir, y los workers configurados con
`require_upfront_kudos` rechazan el trabajo. Además Luxy manda
`allow_downgrade: true`, que le dice al servidor que **degrade pasos y resolución
en vez de fallar** cuando la petición exigiría kudos por adelantado. Con la
cuenta en el suelo se puede estar recibiendo una imagen peor sin ningún error que
lo diga, y Luxy hoy no registra si esa degradación ocurrió.

### Qué NO da kudos

- **Compartir lo que generas.** Nunca fue un ingreso: la propia API lo describe
  como un **descuento de 2 kudos** sobre esa misma petición, y ese descuento está
  apagado —el código calcula la rebaja y a continuación la pisa con
  `horde_tax = 1  # FIXME: hlky meltdown disabled sharing`—. Ver «Compartir».
- **Registrarse.** No regala nada: fija el suelo.
- **Esperar.** No hay regeneración pasiva por tiempo para una cuenta corriente:
  los kudos mensuales solo los reciben moderadores, mecenas y suscriptores.

### Qué sí da kudos

Según la FAQ oficial del proyecto y su código:

- **prestar la GPU**, que es la vía principal: 50 kudos cada 10 minutos por estar
  encendido, +2 por cada modelo cargado y +30 si aceptas LoRAs, más lo que pague
  cada trabajo que atiendas. **El neto de una cuenta nueva es muy distinto del
  titular**: mientras no seas «de confianza», el 100 % del premio por estar
  encendido y la mitad de lo generado se quedan retenidos en depósito
  (`evaluating_kudos`), que no es saldo gastable ni da puesto en la cola. Se
  liberan al ascender —mínimo 7 días de cuenta y superar un umbral—, y ese umbral
  lo fija una variable del servidor que no es observable desde fuera: si estuviera
  sin poner, el depósito **no se liberaría solo**. Y montar un worker publica tu
  cuenta en la lista pública y mete prompts de desconocidos en tu máquina;
- **pedir una transferencia en el Discord oficial.** Lo recomienda su propia FAQ
  («People tend to give plenty to new users»). Es lo único gratis, inmediato y
  sin hardware;
- **publicar un estilo** que otros usen (casilla `styled` del desglose). Cuánto
  paga y con qué condiciones, sin comprobar;
- **valorar imágenes** (cae en la casilla `awarded`, que recoge además lo que
  concede el endpoint `AwardKudos`), con una puerta prácticamente cerrada hoy: el
  endpoint exige que la petición valorada esté **compartida**, y el servidor deja
  `shared` en falso en todos los modelos menos uno de Stability retirado. Además
  está topado: nunca devuelve más de lo que costó esa generación. Ver
  `IDEA-KUDOS-001` en `CURRENT-TASK.md`.

### Qué consume kudos

Más píxeles, más pasos, `hiresFix` y post-procesado. Verificados en el código del
servidor: img2img ×1,3, multiplicadores por post-procesado, ×1,2 si no se aceptan
workers lentos y ×1,1 con lista negra de workers; más un impuesto quemado de 1
kudos por petición —que se cobra aunque la canceles o falle— y 1 por job.

Mandar **varios modelos a la vez no cuesta kudos extra**.

El **+3 kudos por LoRA** que se repite en este documento **no se ha comprobado
contra el código del servidor**: no aparece entre los recargos de
`calculate_extra_kudos_burn`. Se deja escrito porque es lo que se venía diciendo,
marcado como lo que es: sin verificar.

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
- **Cuesta +3 kudos por LoRA**, además del coste de la imagen —cifra heredada,
  **sin comprobar** contra el código del servidor: ver «Qué consume kudos»—. El
  máximo son 5.
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

**Y publicarlo tiene un límite que no es técnico.** Los términos de CivitAI
—apartado 9.6, leídos el 2026-09-09— **prohíben el contenido adulto**:
pornografía, desnudos, «contenido destinado a causar excitación sexual». No es
una zona gris con avisos, es una prohibición, y sus moderadores pueden retirar
lo que quieran sin avisar.

Consecuencia práctica para un personaje de la bóveda: **un LoRA entrenado con
desnudos no se puede publicar allí**, y sin publicarlo el worker no puede
descargarlo. Los dos requisitos son incompatibles.

Lo que sí encaja: un LoRA de **identidad**, entrenado con imágenes vestidas y
publicado con vistas previas vestidas. Da la cara, el pelo y la complexión en
todas las escenas, que es para lo que sirve; lo explícito lo pone el modelo base
y el prompt en cada generación, no el LoRA. Sigue siendo **público**, que es el
otro peaje y el que más pesa con un personaje privado.

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
| LoRAs                 | **máximo 5** (+3 kudos cada uno, cifra sin comprobar)                    |
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

### Compartir

**Ya no es cierto que «Luxy pida siempre `shared: false`».** Desde el 2026-09-09
(commit `d2ec593`) hay una casilla **por personaje** en la pantalla Privado, y lo
que se pide es lo que diga esa casilla. Por defecto está apagada.

Lo que pasa de verdad con ella, verificado el 2026-09-17 contra el código público
de Haidra-Org y contra el servidor en vivo:

- **el servidor descarta la petición.** En `initiate_waiting_prompt` la cadena
  termina en `else: shared = False`, que pisa todo lo anterior —incluido el
  forzado del anónimo— salvo con un modelo beta de Stability retirado hace años.
  La línea entró el 2023-07-08. Comprobado además pidiendo una generación con la
  casilla marcada: **el Horde devolvió «compartida: no»**;
- **el destino del archivo depende de ese interruptor.** Con `shared` en falso,
  la imagen va al almacén transitorio de siempre; el almacén compartido y la
  subida del texto del prompt solo ocurren por la rama que no se activa;
- **compartir nunca fue un ingreso de kudos**, era un descuento de 2 sobre esa
  misma petición, y también está apagado. Comprobado pidiendo dos presupuestos
  idénticos, con y sin compartir: **el mismo precio, 8 kudos**.

Consecuencia práctica: **con cualquier modelo que no sea ese beta de Stability**,
marcar la casilla hoy no cede nada y tampoco da nada. Luxy deja elegir modelo y no
comprueba cuál es al generar, así que la excepción se dice en vez de callarse. La
casilla sigue en la pantalla porque el mecanismo puede volver, pero su texto ya
solo dice lo verificado, y ahora el intento cifrado de cada imagen guarda **las
dos cosas**: lo que se pidió y lo que el servidor dijo que hizo
(`sharedByServer`).

Si el mecanismo volviera, lo que se cedería es la imagen **y el texto completo de
lo que se pidió** —la rama compartida sube las dos cosas—, y **no se ha encontrado
forma de retirarlo después**. Se dice así, y no «no hay forma de retirarlo»: es
una ausencia, no se buscó a fondo, y una ausencia no se demuestra leyendo un
archivo suelto.

Tres cosas que **no** se han comprobado, y conviene que consten: la prueba en vivo
se hizo con la **clave anónima**, no con una cuenta registrada —el código no
distingue en esa línea, y el anónimo es el caso más favorable a compartir, pero
en rigor no se repitió—; no se puede descartar desde fuera que algún otro proceso
del servidor lea el almacén normal; y nadie ha pedido una generación con el modelo
de Stability que sí activa el compartido, así que esa rama está leída, no vista.

Luxy también pide `nsfw: true` en las peticiones de la bóveda. **No significa
«genera porno»**: le dice al horde que no mande el trabajo a los workers que
censuran, que son los que devuelven una imagen negra sin avisar cuando el prompt
les parece dudoso.

## Qué prohíbe la red

AI Horde tiene **dos** comprobaciones anti-CSAM, y confundirlas cuesta semanas de
diagnóstico (ver `D-091`):

- una **sobre el texto**, en el servidor, al encolar. Descarta el negativo antes de
  mirarlo y sólo se ocupa del positivo;
- otra **sobre la imagen ya dibujada**, en el worker, que es la que devuelve
  `censorship: csam`. Ésta **sí depende del worker** que atienda la petición, y de la
  versión del comprobador que tenga puesta.

Que la segunda puntúe píxeles y no palabras tiene una consecuencia que desconcierta:
**el mismo prompt puede pasar una vez y caer la siguiente**, porque la imagen no es la
misma. Y su propio autor documenta que **da falsos positivos con estilo anime**.

Si salta, Luxy **lo dice tal cual y no reintenta**. Ojo con no confundirlo con
`censored`, que es otra cosa: ahí el worker aplicó su censura propia y repetir la
petición para que la coja otro es exactamente lo indicado.

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
es gratis, no pide tarjeta y sube el suelo de kudos, que es lo que decide tu
puesto en la cola. El aviso dice además que esa clave comparte lo que generas;
eso es lo que dice la documentación oficial del Horde, pero en **su código
desplegado el forzado del anónimo queda pisado** por la misma línea que descarta
el compartido en todos los modelos menos uno de Stability (ver «La clave
anónima»).
