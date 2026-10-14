# Luxy — estado canónico del proyecto

Última actualización: **2026-10-06 — el trabajo de fondo de la bóveda estaba
parado desde el 28/09: el `claude` de la consola perdió la sesión y Luxy
disfrazaba el error de respuesta y de negativa. Arreglado (`D-109`) con
`npm run check` a solas en verde (233 archivos, 4942 pruebas), sin verse en
Electron. La bóveda sigue sin copia.**

> **Trabajo de fondo, 06/10 (`INV-FONDO-001`, `D-109`).** Desde el 28/09 no
> se apuntaban promesas, no se catalogaban escenas y no se reescribía la
> memoria del enganche. La sesión del CLI ya ha vuelto (`LA-059`), y el código
> ya no toma un fallo por respuesta ni por negativa: espera por lanzamiento y
> se recupera solo. La «llave en bucle» de `INV-LLAVE-001` no existía. Quedan
> 153 transcripciones en claro en la Papelera, que hay que vaciar (`LA-060`).
> El 06/10, DeepSeek-V4-Pro de la pasarela escribe sólo la escena, sin foto ni
> memoria: Lía va con V4-Flash.

> **Lo anterior, del 29/09** (los tres encargos del 25/09 y los tres frentes
> del 28/09): corregidos en diez rondas y commiteados en `ae41d2e`. La
> revisión de la décima dejó dieciséis defectos abiertos, dos importantes,
> los dos en la medida del eco. Nada visto en pantalla.

> **Lo primero: la bóveda no tiene ninguna copia de seguridad.** Existe sólo en
> este disco, no se ha sincronizado nunca, y la sincronización de hoy no serviría:
> tres fallos en el código y, por diseño, no sube ni a Lía ni las fichas de
> memoria. Copia a mano en `LA-049`; el detalle, en `SEG-SYNC-001`.

> **Novena y décima ronda (29/09, `REV-CUATRO-FRENTES-001`), sin commitear.**
> La octava, commiteada en `f77efb6`, la revisaron ocho revisores con `npm run
> check` a solas en verde (228 archivos, 4716 pruebas). La novena corrigió lo
> que encontraron: la medida del eco ya no depende de la tercera conversación
> ni casa por un nombre; la nota de GLM-5.2 y la contradicción de Z.AI sobre
> apagar los GLM, escritas; `visible` se decide antes que `counted`; una ficha
> retroactiva o un índice que aparecen después de enganchar ya se reescriben;
> la pantalla no afirma que viaja una ficha sin aprobar. La revisaron seis
> revisores (13 defectos, 3 importantes) con el check a solas en verde (229
> archivos, 4741), y la décima lo corrigió todo: el apoyo del eco, lo heredado
> solo pasa a pendiente cuando un turno lo usa, y «Borrar su memoria» vuelve a
> quitar la reescrita antes que la sellada. Otros seis revisores sobre la
> décima, con el check a solas en verde (229 archivos, 4751), dejaron
> **dieciséis defectos, dos importantes y los dos en la medida del eco**: el
> control detecta menos solapamientos que en `f77efb6`, y una frase corta con
> un nombre sigue inflando `sinApoyoAqui`. **Sin corregir.** Detalle en
> `CURRENT-TASK.md`; lo que Daniel prueba, en `LA-058`. **Nada visto en
> Electron ni ninguna reescritura real.**

> **Cómo se revisaron los tres encargos del 25/09 (`REV-TRES-ENCARGOS-001`).** El
> flujo que los construyó se cortó al caducar la autenticación y **su revisión
> independiente no llegó a hacerse**: los siete revisores se cayeron. Una ronda de
> revisión posterior encontró defectos reales —entre ellos que reintentar el
> primer mensaje fallido de una conversación nueva la dejaba sin personaje, que la
> galería de personajes sobrevivía al cierre de la bóveda y que Win+L se aplazaba
> también por una imagen—, y se corrigieron el 28/09. Una segunda ronda ese mismo
> día encontró más, también corregido: la ficha editada de Lía ya no llegaba a
> ninguna conversación existente (ahora main la sella cuando cambia); Claude Code
> y `codex exec` guardaban en claro, en sus carpetas de sesiones, el prompt entero
> de cada turno de la bóveda (ahora van sin sesión en disco; lo ya escrito sigue
> ahí); un turno con imagen del Horde podía perder la respuesta de Lía al cerrarse
> la bóveda; y la regla de pendientes negaba promesas que el mismo prompt le
> daba. Las dos rondas tuvieron después su revisión: la de la primera dejó la
> segunda, y siete revisores sobre las dos dejaron la tercera. Detalle en
> `CURRENT-TASK.md`.
>
> **Tercera ronda (28/09), parte de main, shared y documentos.** Un envío cortado
> por el cierre de la bóveda, con la llamada sin respuesta, podía borrar la
> respuesta anterior de Lía (el turno se retiraba dos veces): corregido. La imagen
> de un turno ya no aplaza Win+L una vez guardado el texto, que es lo que decían
> los documentos (la sexta ronda lo cambia: ver abajo). La nota de «ya salió» reconoce las formas de un mismo verbo
> («traigo» y «traer») sin tocar sus umbrales. Y queda escrito que la ficha
> editada que sella main cambia el prompt de conversaciones empezadas aunque
> todas las casillas estén apagadas, a propósito. La parte de pantalla de esta
> ronda también está hecha: la confirmación del enganche lleva la vista a sí
> misma, el aviso «¿Es de…?» ya no trocea la conversación en cada tecla y los
> textos de las casillas ya no prometen de más. Revisada después por cinco
> revisores, y `npm run check` a solas en verde tras ella (222 archivos, 4511
> pruebas). **Nada de la pantalla se ha visto en Electron.**
>
> **Cuarta ronda (28/09).** «Sincronizar» durante un envío podía subir el mensaje
> de Daniel que luego se retiraba, y el servidor se quedaba con ese en vez del
> bueno: ahora la conversación a la que se está contestando se deja para la
> siguiente sincronización, y retirar un mensaje sin respuesta mira su
> identificador en vez de quitar «la última línea». Si el turno falla con la
> bóveda abierta (el agente parado, por ejemplo), el mensaje ya no se queda
> huérfano. La nota de «ya salió» deja de unir palabras distintas («casa» y
> «caso»); con citas largas sigue casi sin dispararse, y en vez de bajar el listón
> —medido: metía falsos— el diagnóstico cuenta cuántas citas largas hay. Revisada
> después sin nada que rompa, y `npm run check` en verde tras ella.
>
> **Quinta ronda (28/09).** La nota de «ya salió» reconoce ahora «traerme» frente
> a «traigo», «prepararte» frente a «preparo» y el gerundio con pronombre: con el
> texto inventado de la revisión, 29 de 32 paráfrasis (antes 25), sin falsos
> nuevos. No se puede enviar dos veces a la misma conversación a la vez, y una
> ficha de solo espacios ya no sustituye a la buena. Revisada después por cinco
> revisores y `npm run check` a solas en verde (222 archivos, 4531 pruebas);
> commiteada en `a45953b`. **Nada visto en Electron.**
>
> **Resumen de la verificación de `REV-TRES-ENCARGOS-001`:** tres rondas de cinco
> revisores, una tras cada ronda de arreglos de la tercera a la quinta, y las
> tres pasaron `npm run check` a solas: 222 archivos y 4511, 4520 y 4531 pruebas
> (12 omitidas); la última quedó commiteada en `a45953b`.
>
> **Octava ronda (29/09, `REV-CUATRO-FRENTES-001`).** Ocho revisores sobre la
> séptima dejaron siete defectos importantes, y su `npm run check` a solas cayó
> por una prueba que pasó del tope de tiempo (`account-client.test.ts`, que sola
> pasa). Corregidos: la reescrita lista llega ya a sus otras conversaciones
> (antes solo tras un mensaje en la enganchada); una pendiente se reintenta tras
> cualquier envío en Privado, no solo en ella; una salida corta no sale «oculto»;
> el eco no casa por los nombres; la firma vuelve a la de `a45953b` en las
> conversaciones del Studio anterior y no pone su nombre en lo que escribió otro
> personaje; la confirmación dice qué memoria viaja; y los documentos recogen el
> `npm run check` en verde de la sexta (4677). La imagen del turno solo aplaza
> Win+L con el proveedor de pago. Commiteada en `f77efb6`; revisada después por
> ocho revisores, con `npm run check` a solas en verde (228 archivos, 4716
> pruebas). **Nada visto en Electron.**
>
> **Séptima ronda (29/09, `REV-CUATRO-FRENTES-001`).** Ocho revisores (aquí
> decía «cinco») sobre la sexta y los tres frentes sin commitear, con un `npm run
> check` a solas en verde sobre ellos (228 archivos, 4677 pruebas), dejaron diez
> defectos importantes, todos
> corregidos: la reescritura del enganche ya no puede vaciar una memoria corta y
> también cubre las enganchadas que viajan con su ficha retroactiva; su botón
> dice en qué acabó; la confirmación no promete que los mensajes de antes dejen
> de leerse; el razonamiento no da un falso «oculto» en una vuelta con
> herramientas; el control del eco mide igual los dos lados; la pista manda a
> «Registros». Revisada después por ocho revisores; su `npm run check` a solas
> cayó por tiempo en una prueba ajena (lo cierra la octava). **Nada visto en
> Electron.**
>
> **Sexta ronda (28/09).** Un Win+L aplazado tiraba la imagen del turno, ya
> pagada, en cuanto se guardaba el texto: ahora el aplazamiento la espera también,
> como mucho 15 minutos más desde que Luxy ve ese tramo (desde el texto o desde
> Win+L, lo que llegue después), y después cierra sin cancelarla. Borrar una conversación mientras
> contesta se rechaza (la resucitaba). La cifra «Ya salió» de la pantalla dice
> que es una cota superior. «llegué», «busqué», «empecé», «pagué» y «leer» se
> unen con su verbo, y «te cuento» ya no casa con «cuéntame». Los documentos
> dejan de contradecirse sobre qué se verificó. Revisada después por ocho
> revisores, con `npm run check` a solas en verde (4677; aquí decía «sin
> revisión, sin check»). **Nada visto en Electron.**

> **Construido (25/09, corregido el 28/09): la bóveda se cierra sola
> (`SEG-BOVEDA-001`, `D-106`).** Leer ya no cuenta como actividad: solo abrirla,
> teclado y ratón reales en Privado con la ventana visible y con el foco, esperar
> una respuesta o una imagen que pidió él, y las operaciones de cuenta. Win+L,
> suspender y la X de la ventana la cierran; Win+L solo se aplaza por un envío
> suyo: hasta que su respuesta queda guardada (10 minutos como mucho desde
> Win+L) y, si el turno lleva imagen del proveedor de pago, hasta que esa
> imagen termina (15 minutos como mucho desde que Luxy ve ese tramo). Una
> imagen de AI Horde o del panel no lo aplaza. Cada apertura y
> cada cierre dejan una línea en
> `studio.log` con el motivo. **Nada visto en pantalla**, y que Windows avise de
> Win+L a Luxy no está comprobado: `LA-053`.

> **Construido (25/09, corregido el 28/09): `F33-ENGANCHE-LOCAL-001` y
> `F33-RECUERDO-001`.** Se puede enganchar una conversación sin personaje a Lía
> **en este equipo** (no sube al servidor), el dueño se resuelve en un solo sitio
> (`D-103`) y, con una casilla en su ficha, Lía recibe la memoria de sus dos
> últimas conversaciones (`D-105`; entera desde el 28/09, abajo). Sin verse en
> pantalla: `LA-052`.

> **Construido (25/09, corregido el 28/09): `F33-PROMESAS-001`.** Con la casilla
> «Sacar los pendientes solo de vez en cuando» de su ficha, el bloque de
> pendientes va como mucho en uno de cada cuatro mensajes, el permiso pide que la
> escena la traiga y una nota le dice que ya sacó una sin decir cuál (`D-104`).
> Sin medir contra una conversación real: `LA-054`.

> **`F33-IGUAL-001` (`D-108`, 2026-09-29): una conversación enganchada queda
> como una empezada con su personaje.** Su memoria sellada, escrita sin la
> ficha, la reescribe con ella Claude Code o Codex en segundo plano, fuera del
> `.jsonl` y solo mientras siga atada a la última sellada; lo que pierde
> material no se aplica. Sus respuestas firman con su nombre —salvo las que se
> escribieron con la ficha de otro personaje—, su foto de
> perfil se copia al enganchar y una imagen generada ya no cuenta como foto de
> perfil. Lo que no se iguala: los últimos ocho mensajes viajan tal cual.
> **Implementado; corregido de la séptima a la décima ronda, cada una revisada
> y con su `npm run check` a solas; quedan menores abiertos (`D-108`). Sin
> ninguna reescritura real y sin verse en pantalla**: `LA-057`.

> **`F34-RAZONAMIENTO-001` (`D-107`, 2026-09-28): el razonamiento de una
> conexión HTTP se elige por modelo**, junto a la temperatura, y sólo con los
> valores que la documentación de ese modelo admite; vacío no manda nada. Luxy lee
> ahora el razonamiento en `reasoning`, en `<think>` y sin transmisión, y cada
> llamada apunta `reasoningVerdict` y `charsPerOutput`. **Implementado;
> corregido de la séptima a la novena ronda, cada una revisada y con su `npm
> run check` a solas. La regla de los GLM que se apagan espera a Daniel
> (`D-107`). Sin saber si la pasarela deja pasar el campo**: lo dirá `LA-055`.

> **`F33-RECUERDO-ENTERO-001` (`D-105`, quinta ronda, 2026-09-28): con la
> casilla «Pasarle la memoria de sus dos últimas conversaciones» le llega la
> memoria entera de cada una** —resumen, hechos, decisiones y lecciones, sin
> `plan` ni `openQuestions` y sin los mensajes—, con una salvaguarda de 6.000 por
> conversación que quita lo más viejo primero. La palabra cortada a mitad se
> arregla donde nacía (el `slice` al guardar memorias y fichas) y, en lo ya
> guardado, al presentarlo. `ecoRecientes` gana un control con la tercera
> conversación. **Implementado; corregido de la séptima a la décima ronda, cada
> una revisada y con su `npm run check` a solas; la medida del eco tiene dos
> defectos importantes abiertos (`D-105`). Sin verse en pantalla**: `LA-056`.

> **Lo segundo: `F33-VARIEDAD-001`.** Cuatro cambios contra la autocopia de Lía,
> con interruptor y sin verse en pantalla. Se prueban con `LA-050`.

> Lo de abajo, hasta el próximo encabezado, es del **2026-09-23** y sigue siendo
> cierto, **salvo `SEG-BOVEDA-001`**: lo que dice de que la bóveda no se cierra
> sola es de antes de construir el arreglo (arriba).

Última actualización anterior: **2026-09-23 — se puede borrar la memoria que una
conversación se escribe sola, y la bóveda no se cierra por inactividad**

> *(Histórico: esto era el 23/09. El arreglo se construyó el 25/09 y está
> arriba.)* **Lo primero, porque es seguridad y está SIN ARREGLAR.** La bóveda no
> se cierra sola. El ajuste de Daniel son 15 minutos y estuvo hora y media abierta. La causa
> está **medida** en su equipo: la propia pantalla se relee cada uno o dos minutos
> y toda lectura reinicia el contador, porque `touch()` vive dentro de
> `subkeyFor()`. Además, cerrar la ventana con la X y bloquear Windows con Win+L
> **tampoco** la cierran. Nada de esto se ha tocado: el bloque `SEG-BOVEDA-001` de
> `CURRENT-TASK.md` tiene la cadena entera y el arreglo descrito.

> **Lo segundo: `F32-OLVIDAR-001`.** Una conversación con memoria propia ya se
> puede leer y borrar. Antes no ofrecía **ninguna** acción, y no por decisión: el
> botón colgaba de que existiera la ficha retroactiva y no de que existiera
> memoria. Cuatro rondas, 13 defectos cazados por revisión adversarial con
> `npm run check` en verde todo el rato, y `npm run check` final con **4.107
> pruebas**. **Nadie lo ha visto en pantalla** y quedan tres defectos conocidos que
> no alcanzan al caso de Daniel. Detalle en `CURRENT-TASK.md` y `CHANGELOG-WORK.md`
> de esa fecha, y en `D-099`, `D-100` y `D-101`.

> Lo de abajo, hasta el próximo encabezado, es del **2026-09-21** y sigue siendo
> cierto: una escena con los dos se puede dibujar entera.

Daniel pidió poder ilustrar las escenas en las que salen los dos. Hasta hoy esas
escenas se dibujaban recortadas —sólo el personaje, en plano cercano— y no por
descuido: está escrito a propósito desde `D-057`, que nació de una generación
real con **una segunda mujer que nadie había pedido**. Se le avisó de que la
calidad con dos figuras es irregular en estos modelos y aun así lo quiere, con un
interruptor para apagarlo. Todo está en `D-097`.

**Lo que se abre, y cómo.** Un ajuste por personaje —`imageCast`, gemelo exacto
de `imageReview`, apagado por defecto y de una pulsación—. Con él apagado **no
cambia absolutamente nada**, y eso está medido, no supuesto: el prompt negativo
es el mismo string byte a byte que en `HEAD`, y el bloque de instrucciones ocupa
los mismos **6.474** caracteres en prosa y **6.478** en etiquetas que dejó
`F29-POSTURA-004`. Encendido ocupa 63 menos, porque las dos redacciones son
excluyentes.

**Las tres piezas, que es lo que hay que aprenderse:** con una sola, la foto
sigue saliendo de una figura. La **instrucción** (dos frases, no una: la del caso
2 y el bullet donde de verdad se prohibía nombrar al usuario, que es lo único que
lo hace aparecer); el **negativo**, que prohíbe literalmente lo que la
instrucción acaba de pedir; y el **`solo` de la receta**, que es la que se
descubre escribiendo un prompt a mano y es fácil no ver nunca: en el vocabulario
de estos modelos significa «una sola persona en la imagen» y vive en el texto de
apariencia del usuario, contradiciendo la escena sin que nadie lo pusiera ahí
para eso.

**Dos puertas, no una.** El ajuste dice que se PUEDE dibujar a los dos; la escena
dice si en ésa hacen falta los dos. El bloque depende sólo del ajuste —se escribe
antes de que exista la escena—, pero el negativo y el recorte del `solo` sólo se
relajan cuando la escena nombra de verdad a la segunda figura, con una lista
cerrada de nombres de persona y **nunca pronombres**. Una foto de ella sola
conserva así sus defensas con el interruptor encendido, que es lo que evita
reabrir el fallo de `D-057`.

**Probado, no visto, y sin una sola imagen.** Suite completa en verde en esta
pasada —**192 archivos, 4.036 pruebas pasadas y 12 saltadas**, medidas
ejecutándola en este worktree—, con 31 pruebas nuevas repartidas en dos archivos.
Nadie ha abierto Studio con el interruptor, pero **sí hay dos imágenes de dos
figuras**, generadas a mano por Daniel con el prompt pegado en el panel: las dos
limpias. O sea que lo que falta por ver es el camino automático, no si el modelo
sabe dibujar dos figuras. Que el generador obedezca no lo fija ninguna prueba;
ésa sigue siendo la única comprobación que vale y es de la pantalla de Daniel.

Lo anterior — **doce generaciones tumban el desambiguador de orientación, y
dejan una regla mejor en su sitio** (2026-09-18):

Daniel repitió la misma petición doce veces con la semilla `1080257389` y el
modelo WAI-ANI-NSFW-PONYXL, moviendo una cosa cada vez. El resultado no admite
lectura amable: **ninguna etiqueta de cámara movió la cámara.** Fallaron las seis
—`from behind`, `ass to camera`, `back to camera`, `top-down bottom-up`,
`presenting`, `rear view`—, solas y juntas, y tampoco cambió nada subirles el
peso, tocar el prompt negativo, quitar las etiquetas faciales ni cambiar el
orden. Lo que sí funcionó fue nombrar una parte del cuerpo que en esa postura
**sólo se puede dibujar desde detrás**. La tabla entera, fila a fila, está en
`D-096`.

**La regla que sale de ahí, y es lo que había que aprender:** este modelo obedece
lo que puede **dibujar**, no las instrucciones sobre dónde poner la cámara. Para
conseguir un ángulo se nombra algo que sólo se vea desde ese ángulo, y la cámara
se coloca sola porque no hay otra forma de dibujarlo.

**El método vale tanto como la regla**, porque no depende del generador: seis
hipótesis por el camino de **añadir** variables al prompt que fallaba no dieron
nada; tres pruebas por el de **quitarlas** del que funcionaba aislaron la causa.
Cuando un prompt falla y otro funciona, se adelgaza el que funciona.

**Lo que cambia en el producto**, en dos pasos del mismo día:

1. **El desambiguador de orientación se va entero** (`F29-POSTURA-003`). Con él,
   el módulo `vault-image-orientation.ts` —471 líneas— y su prueba —251—, su
   llamada al componer el plan, su export, el campo `added` del plan, la función
   que lo quitaba y el cartel del panel que lo anunciaba. Ese cartel es el motivo
   de fondo: no sólo metía una etiqueta inútil en cada prompt, sino que le decía
   a Daniel que Luxy le había resuelto el encuadre. Un aviso que da por cerrado
   un problema abierto cuesta más que el silencio. **El recorte (`dropped`) no se
   toca**: ése funciona y se le ha visto trabajar.
2. **El bloque de instrucciones aprende la regla** (`F29-POSTURA-004`). Donde
   pedía escribir «ass to camera» ahora enseña el principio: la etiqueta de
   encuadre sola no mueve la cámara, hay que nombrar además algo que sólo se vea
   desde ahí. **No nombra ninguna etiqueta explícita concreta** —la última frase
   devuelve la decisión a la escena, y hay una prueba sobre esa frase—: la regla
   salió de una etiqueta explícita, pero escribirla en el bloque convertiría a
   Luxy en quien impone el contenido. De la tabla de equivalencias sólo cayó el
   par demostrado falso; `close-up` y compañía se quedan, marcados como **no
   sabidos** porque nunca se probaron aisladas. El guardián de 6.500 caracteres
   **no se subió**: se entró con 44 de margen y se sale con 22.

**`D-095` se retira un día después de escribirse**, y su error es el que esta
documentación lleva cuatro veces en tres días corrigiendo: **razonar cómo debería
comportarse el generador en vez de medirlo.** Su premisa era impecable como
razonamiento y falsa como hecho. Lo que se midió entonces fue el texto del
prompt —que la etiqueta llegara—, nunca la imagen. `CURRENT-TASK.md` lo decía con
todas las letras en «lo que sigue sin comprobar», y ahí estaba la respuesta.

**El alcance, declarado:** doce generaciones, **una semilla y un modelo**. No está
comprobado que otro modelo se comporte igual, ni otra semilla. Si Daniel cambia
de modelo de imagen, `D-096` no se hereda: se vuelve a medir.

**Probado, no visto.** Suite completa en verde en esta pasada —**190 archivos,
3.996 pruebas pasadas y 12 saltadas, exit 0**—, medida ejecutando `npm run check`
en este worktree y no heredada de ninguna entrada anterior. Aqui no va la duracion
a proposito: la que figuraba era la de una corrida distinta de la que cerro el
trabajo, y un numero copiado de otra ejecucion es exactamente lo que esta
documentacion lleva la semana corrigiendo. Las doce
generaciones son de la pantalla de Daniel, no de una prueba: **ninguna prueba
puede fijar que el generador obedezca**, y ésa sigue siendo la única comprobación
que vale. Nadie ha abierto Studio con estos cambios.

Lo anterior — **la revisión de los siete arreglos: once defectos cerrados, y
la documentación que afirmaba de más** (2026-09-17, madrugada):

Daniel pasó la tarde generando imágenes de su personaje y comparando prompts. De
ahí salieron siete arreglos, todos de casos vistos en pantalla. Esa tanda pasó
`npm run check` y **aun así tenía once defectos**, la mayoría verificados
ejecutando el código; se cierran en la madrugada siguiente. Lo corregido en el
código: el rastro de un intento ya no dice «no lo hubo» de una imagen que existe;
el registro de intentos deja de tirar los fallos, que son lo único
irrecuperable; cinco arreglos en el recorte de rasgos, que se llevaba muebles
(«small **window frame**») y luz («red **nose** from the cold»); y el bullet que
decidía por verbos, rehecho, con una regla que se había perdido al condensar,
devuelta.

**Lo que hay que llevarse de la revisión, porque es la tercera vez en dos días:**
nueve de los once eran **documentación afirmando de más**. Una duración de la
suite **inventada** y presentada como salida de vitest; una comparación de
tamaños heredada de otra entrada sin comprobarla; citas de código por número de
línea que ya no apuntaban a lo que decían; y dos deducciones escritas como
hechos. Ninguna cifra que no se haya medido en la pasada que la escribe, y
ninguna afirmación sin decir de dónde sale.

**`D-091` sigue confirmada, pero por UNA vía.** Aquella decisión dejó escrita una
predicción falsable: si el filtro puntúa la imagen y no el texto, un bloqueo llega
**después** de una ronda completa de sondeos, con worker asignado. Un bloqueo real
tardó la cola entera y sólo después devolvió `csam`, y eso es observable en
pantalla. Lo que **no** es evidencia instrumentada, y se presentaba como si lo
fuera, es que esa misma tarde cuatro prompts más explícitos pasaran y uno menos
explícito fuera bloqueado: es memoria de lo que Daniel vio, sin prompts, sin
semillas y sin `rc` guardados en ninguna parte. Encaja con la hipótesis; no la
confirma. El matiz de método se mantiene entero: esa hipótesis **no salió de
deducir una causa mirando síntomas** —de ésas hubo tres el mismo día y las tres
eran falsas— sino de **leer el código del servicio**.

**Lo que cambia en el producto**, en tres bloques:

1. **El prompt de imagen gana cuatro reglas.** La mayor: **el encuadre no es la
   postura**. «Desde detrás» dice desde dónde se mira, no cómo está el cuerpo, y
   lo que no se escribe se lo inventa el generador. Lo demostró una prueba
   controlada de Daniel —misma semilla, mismo modelo, cuatro variantes moviendo
   una cosa cada vez— que descartó pesos, negativo anti-retrato y etiquetas de
   cara: `D-094`. Las otras tres: que «quédate como estás» repita también el
   encuadre, que no se escriba relleno decorativo que no se dibuja, y que
   «descríbeme esta foto» comente la que ya existe en vez de mandar otra —esa
   última se rehízo en la revisión: **nombrar una foto no es pedirla**, y el
   criterio sigue siendo el determinante, no el verbo—. Todo **sin subir el
   guardián de tamaño**: medido, el bloque cabe en **6.296** (`prose`) y **6.300**
   (`tags`) de 6.500 porque se condensó lo ya escrito. Al condensar sí se
   perdieron dos textos: uno está devuelto y el otro consta como perdido en
   `CHANGELOG-WORK.md`.
2. **El recorte automático de rasgos pasa de dos familias a cuatro**: a color de
   pelo/ojos y origen se le añaden **complexión** y **rubor**, con las mismas dos
   reglas —sólo se quita lo que la apariencia fija ya dice, y se quita el rasgo, no
   la frase— y todo lo quitado sigue saliendo en la lista de descartados.
3. **Un fallo de imagen deja el rastro entero**: worker, id del worker, modelo y
   semilla se guardan también cuando falla, y un campo nuevo separa **tres**
   silencios, no dos: «no lo dijo» (el proveedor generó y no publica el dato), «no
   lo hubo» (rechazo anterior a la cola) y «no se apuntó» (no se sabe). Quién
   decide cuál es de quien apunta el intento. Además, un fallo ya no lo empuja
   fuera del registro una racha de imágenes buenas: son dos cupos, 50 para lo que
   tiene copia en otro sitio y 200 para lo que sólo existe ahí. Es el hueco de
   instrumentación que `D-091` señaló, y **queda cerrado**.

**Probado, no visto.** Suite completa en verde —3.965 pruebas y 12 saltadas en 190
archivos—, `lint`, `typecheck` y `build` los tres exit 0, y 380 pruebas en los seis
archivos que cubren lo tocado; todo medido en la pasada que lo escribe, con las
salidas literales en `TEST-RESULTS.md`. Ninguna prueba puede fijar que el generador
obedezca una postura: eso lo confirma Daniel en pantalla, y son seis comprobaciones
pendientes en `F29-POSTURA-001`. La tarde de Daniel son cuatro generaciones, un
personaje y un modelo, y el bloqueo con reloj se ha observado **una vez**. El build
reconstruye el `dist`; **nadie ha abierto Studio**, que no es lo mismo.

Lo anterior — **la casilla de compartir dejaba de prometer kudos que no existen**:

La pantalla Privado ofrecía «donar sus imágenes a AI Horde **a cambio de
kudos**». Eso era falso, y la promesa no venía de ninguna fuente del Horde: la
escribió Luxy a partir de una frase de una conversación. Verificado contra el
código público del servidor y contra el servidor en vivo: **AI Horde descarta la
petición de compartir desde julio de 2023** en todos los modelos menos uno de
Stability retirado —se pidió compartir y contestó «compartida: no»—, **compartir
nunca fue un ingreso** sino un descuento de 2 kudos sobre esa misma imagen, hoy
también apagado, y **25 no es un saldo sino un suelo**: se cobra cada imagen y
después se perdona lo que hundiría la cuenta por debajo del mínimo de su clase,
clase que **declara el servidor** en `pseudonymous` y que Studio ya lee en vez de
deducirla del número del saldo.

La casilla se queda —el mecanismo puede volver y quitar una opción es perder
función— pero su texto ya sólo dice lo verificado. Además, lo que el servidor
responde sobre el compartido se guarda en el intento cifrado
(`sharedByServer`), y el botón «Ver mis kudos» enseña el **desglose por
conceptos** que la misma llamada ya devolvía y se tiraba, con una regla que
gobierna toda la pantalla: **un cero afirma y un silencio no**.

La regla que queda, en `D-093`: **un texto de la pantalla que afirme cómo
funciona un servicio ajeno necesita fuente, igual que el código.** Es el patrón
de `D-091` un escalón más arriba, porque esto vivía en la interfaz. Seis puntos
de incertidumbre quedan declarados ahí; el mayor es que **nadie ha mirado la
cuenta de Daniel**. `IDEA-KUDOS-001` se cierra: valorar imágenes exige tenerlas
compartidas y el servidor deja el compartido apagado salvo en ese modelo de
Stability.

Y lo más instructivo del episodio, también en `D-093`: **el propio trabajo de
corrección plantó siete afirmaciones nuevas del mismo tipo**, deducciones escritas
como hechos, y las cazó la fase de revisión, no sus autores. Entre ellas una que
el informe declaraba expresamente no verificada. El criterio se aplicó al código
que se corregía y no al que se escribía.

Lo anterior — **el texto que sale hacia el generador de imágenes deja de ser
invisible**:

Cuando el personaje pide una imagen, el turno **termina sin generarla** y deja un
plan pendiente: el texto exacto que saldría —positivo, negativo, parámetros,
semilla y los rasgos que el recorte automático borró—. Daniel lo ve, lo corrige si
quiere y decide generar o descartar. El turno no se pausa: se parte, así que la
respuesta se guarda entera y el plan sobrevive a cerrar Studio.

Cada intento queda apuntado cifrado por conversación, **también los que fallan o
censuran**, con el código del Horde —que distingue `csam` de `censored`, dos cosas
opuestas que hasta ahora se aplanaban en un error genérico—, la semilla real y el
worker. Es el hueco de instrumentación que `D-091` dejó señalado.

El interruptor es **por personaje**; en «nunca» todo se comporta exactamente como
antes. Decisión en `D-092`. **Sin ver en pantalla**: nadie lo ha abierto todavía.

Lo anterior — **el encuadre que pide Daniel llega a la imagen, y por qué el filtro
del Horde bloquea unas veces sí y otras no**:

Cuando en la bóveda se pide una foto diciendo **desde dónde** —«desde detrás»,
«el culo a cámara», «de cerca», «de cuerpo entero»—, esa indicación se traduce y
llega al generador. Antes se perdía al escribir el prompt en inglés. La regla es
que **lo que pide el usuario manda**: si lo dice, es lo único que hay que
obedecer. «A cámara» se entiende como una dirección de la mirada, no como un
aparato que haya que dibujar.

Aparte, y sin tocar código: se entendió por fin por qué el filtro anti-CSAM de AI
Horde bloquea unas veces sí y otras no **la misma petición**. Hay **dos**
comprobaciones, y la que bloquea **puntúa la imagen ya dibujada**, en el worker, no
el texto. Por eso el mismo prompt da resultados distintos: la imagen no es la misma.
Su propio autor documenta que da falsos positivos con estilo anime.

`D-091` **se reescribió entera**: su primera versión, escrita ese mismo día, culpaba
al prompt negativo y a un umbral de 1.000 caracteres. Las dos cosas eran falsas —el
filtro de texto descarta el negativo antes de mirarlo, y el umbral real son 7.000—.
Queda un hueco de instrumentación concreto y accionable: Luxy distingue `csam` de
`censored`, que significan cosas opuestas, pero los aplana en un error genérico y
tira el worker, así que **un bloqueo no deja rastro de cuál de los dos fue**.

Las dos cosas están implementadas y probadas; **lo del encuadre no se ha visto en
pantalla todavía** y sólo lo confirma una foto real de Daniel.

Lo anterior — **Lía puede sacar sola lo que quedó pendiente entre los dos**:

La bóveda apunta las promesas y los planes que quedaron sin cumplir, con la
cita literal verificada contra el turno donde se dijo, y se los recuerda a ella
en el prompt para que pueda sacarlos **sin que Daniel los nombre**. Lo extraen
Claude Code o Codex entre turnos, nunca una API de pago; se guardan cifrados en
`vault/relation.json`; Daniel los repasa en «Lo que tenéis pendiente» y tiene la
última palabra. Como mucho salen dos por turno, con 72 h de reposo entre
repeticiones. Implementado y comprobado con `npm run check`; **sin ejecutar aún
con la bóveda abierta** (ver `LA-045`).

Lo anterior:

La pestaña Privado tiene un **banco de pruebas de visión**: eliges una imagen de
tu disco, eliges proveedor y modelo, y te devuelve lo que el modelo dice de ella.
**No escribe nada** —ni bóveda, ni conversación, ni pie de foto— y no necesita
conversación abierta.

Existe por un problema de diseño real que salió al usarlo: **`describeMedia`
usaba el proveedor y el modelo del compositor**, es decir los mismos de la
conversación. Elegir un modelo con vista para describir una imagen cambiaba
también quién encarna al personaje. Un selector para dos cosas distintas. El
banco tiene los suyos.

Lo que **no** ocurría, y conviene tenerlo claro: la descripción nunca entraba en
la conversación. `vaultMediaDescribe` no añade ningún turno, corre en modo
técnico y sólo escribe el pie de foto.

Seguridad del canal nuevo: el archivo lo elige el usuario en un diálogo del
proceso principal y **el renderer no puede nombrar una ruta**. Si pudiera, podría
pedir que se leyera cualquier cosa del disco y se enviara a un proveedor externo.
Hay una prueba que fija esa ausencia.

De paso, el botón **Adjuntar** explica por qué está desactivado —los archivos
cuelgan de una conversación— en texto visible, en vez de en un `title` del
navegador que tarda un segundo y casi nadie ve.

`npm run check` exit 0: **141 archivos, 2.467 pruebas superadas, 12 omitidas.**

**Lo siguiente, y a propósito sin hacer:** que «Describir con IA» sobre un
archivo ya guardado use también ese modelo aparte. El banco existe para decidir
cuál antes de cablearlo; hacerlo ya sería fijar un modelo sin haber comprobado
que ve (`LA-043`).

---

Última actualización anterior: **2026-09-04 — el catálogo dice qué sabe hacer cada modelo**

Dos arreglos que salen del mismo sitio: con 46 modelos de Mistral en pantalla,
elegir uno era adivinar.

**`/v1/models` dice, por modelo, lo que sabe hacer, y Luxy lo tiraba.**
`parseProviderModels` se quedaba con el identificador y descartaba el resto, así
que para saber cuál acepta imágenes había que deducirlo del nombre. Ahora se
guardan las banderas que la pasarela declara **en `true`, con sus nombres y sin
traducir**, y la traducción a nuestro vocabulario va aparte y **sólo traduce lo
que reconoce**: una bandera desconocida se conserva como dato pero no se
convierte en una capacidad nuestra. Lo declarado se **suma** a la ficha escrita a
mano, no la sustituye.

**«Actualizar modelos» no avisaba a nadie.** El catálogo se escribía en disco y
cada pantalla lo leía sólo al montarse, así que el selector de Privado seguía
vacío hasta reiniciar Luxy. Medido en el equipo de Daniel: la aplicación arrancó
a las 16:44:05 y el catálogo se escribió a las 16:44:16. Un contador con
suscripción basta; no hay estado que compartir, sólo «vuelve a leer».

En pantalla: etiquetas por modelo en «Catálogo real» con **«ve imágenes»**
resaltada, y `· ve imágenes` en el desplegable de Privado. En silencio significa
«la conexión no lo declara», no «no puede».

`npm run check` exit 0: **141 archivos, 2.462 pruebas superadas, 12 omitidas.**

**Sin verificar:** nada en pantalla. Y el catálogo de Mistral que hay en disco se
descargó antes de este cambio, así que hay que volver a leerlo para que aparezcan
las capacidades (`LA-042`). Sigue abierto el hueco de `imageUrlFormat`, que no
tiene campo en la interfaz.

---

Última actualización anterior: **2026-09-04 — el catálogo ya sabe preguntarle a las dos listas**

Luxy guarda las conexiones en **dos sitios distintos** —`connections` y
`providers.http`— y toda la maquinaria del catálogo miraba sólo el primero, y
sólo su primer elemento, escrito a mano como `connections[0]` en tres puntos.
Consecuencia visible: añadir un proveedor HTTP, pulsar «Actualizar modelos» y
recibir el catálogo de otra pasarela **sin ningún error**.

Ahora el catálogo se direcciona por **origen + identificador** (`D-070`): hay un
selector de a quién se le pregunta, el catálogo que alimenta los selectores de
Privado, Conversaciones y Laboratorio lee **todos** los orígenes, y cada uno
guarda su lectura por separado —los de `connections` conservan su nombre de
archivo de siempre, para no dejar huérfano lo ya leído—.

Debajo había un segundo fallo que habría dejado el arreglo a medias: **la
familia de un modelo se adivinaba por su nombre**, y los de Mistral con vista se
llaman `pixtral`, así que caían en `other`. Como el identificador de proveedor
**es** la familia con la que el agente lo ejecuta, su selector de modelo habría
seguido vacío. Un proveedor HTTP impone ahora su identificador como familia; una
conexión agregadora sigue adivinando, porque sirve muchas a la vez.

`family` sigue siendo un enum **cerrado** a propósito: un identificador que no
sea una familia conocida no se impone, se vuelve a adivinar. Aceptar cualquier
cadena convertiría una errata en la configuración en un catálogo que desaparece
entero.

`npm run check` exit 0: **140 archivos, 2.453 pruebas superadas, 12 omitidas.**

**Sin verificar:** no se ha llamado a Mistral ni se ha visto la pantalla nueva
(`LA-040`). Y queda un hueco conocido: `imageUrlFormat` existe en el esquema y
lo usa el agente, pero **no tiene campo en la interfaz**, así que no se puede
cambiar a la forma de cadena que documenta Mistral.

---

Última actualización anterior: **2026-09-04 — Privado se puede mirar: galería y hilos por personaje**

Dos arreglos de uso en la pestaña Privado, ninguno de arquitectura.

**Las conversaciones se separan por personaje.** La lista era plana y ordenada
sólo por fecha, así que los hilos de Lía salían mezclados con los que no son
suyos y había que abrirlos para saber de quién eran. Ahora van agrupados, con el
nombre del personaje y la fecha en lenguaje normal («hoy», «hace 3 días»). Lo
que costó trabajo no fue agrupar: el personaje **sólo se vuelve a sellar cuando
cambia**, para no repetirlo en cada turno, así que el último turno devuelve
`null` en casi todos los hilos y hay que recorrerlos hacia atrás.

**Los archivos van en rejilla, con visor.** Antes era una lista de botones «Ver»
y no se veía nada sin abrirlos de uno en uno. **No hay miniaturas guardadas y no
es un olvido:** `nativeImage` de Electron no decodifica webp ni gif —comprobado
ejecutándolo—, y webp es el formato de casi todo lo que entra en la bóveda. Cada
baldosa descifra su imagen al entrar en pantalla y ninguna antes (`D-069`).

**Defecto de fondo corregido de paso:** `--line` y `--accent` se usaban en trece
sitios de la hoja de estilos y **no existían en la paleta**. Una `var()` sin
definir invalida la declaración entera, así que esos bordes no se pintaban: la
lista de conversaciones y varios paneles llevaban tiempo sin marco.

`npm run check` exit 0: **137 archivos, 2.436 pruebas superadas, 12 omitidas.**

**Nada de esto se ha visto en pantalla** (`LA-039`), y sigue pendiente `LA-038`,
probar AI Horde contra la red real.

---

Última actualización anterior: **2026-09-04 — F11-HORDE-001, imágenes sin pagar**

La bóveda privada ya no depende de un proveedor de pago para generar imágenes.
**AI Horde** entra como segundo proveedor: es gratis de verdad, no pide método
de pago y admite contenido adulto anime y realista. Vive en Privado, bajo la
bóveda, como todo lo de roleplay.

Lo que cambió el diseño: **AI Horde no tiene personajes.** El de pago guarda la
identidad en su servidor detrás de un identificador; aquí no hay nada al otro
lado que recuerde una cara. Así que un personaje del horde **es** su receta
—modelos, aspecto fijo, semilla, tamaño—, guardada cifrada en local. Editarla no
cuesta nada y conserva el identificador, con lo que las imágenes y los recuerdos
que ya cuelgan de él siguen siendo suyos (`D-064`).

Lo que decidió la política de claves: con la clave anónima `0000000000` el
servidor **fuerza `shared`**, es decir, dona lo generado a un conjunto de datos
público. No se pone sola; se puede escribir a mano y entonces la pantalla avisa
de lo que implica (`D-065`). Y la clave que hace falta es la del proveedor de
**ese** personaje, no la de la máquina (`D-066`).

**Cohere ya funcionaba sin tocar código** por Ajustes → Conexiones → Proveedores
HTTP. Lo único que se añadió es un selector de proveedores conocidos —Cohere,
DeepSeek, Groq, Mistral y OpenRouter— para no tener que recordar la URL base.
`safety_mode` no viaja por su capa de compatibilidad y sus Términos prohíben
contenido pornográfico: está escrito en `docs/PROVIDERS.md` sin recomendar
rodearlo.

Guía nueva para el usuario: `docs/IMAGENES-GRATIS.md`.

Una revision adversarial posterior —26 hallazgos candidatos, 12 confirmados—
dejo ocho arreglos, entre ellos uno de seguridad ANTERIOR a este cambio: por
`configSave` se podia declarar un proveedor HTTP con el `apiKeyEnv` de un
secreto reservado y conseguir que el agente se lo entregara. Ver el registro
del 2026-09-04 10:30.

Despues, `F11-HORDE-002`: el editor de LoRAs —lo unico que fija de verdad la
cara de un personaje en esa red— y partir de una imagen anterior (img2img).
AI Horde **no tiene ningun mecanismo de identidad por imagen**, comprobado
contra su swagger y sus 178 modelos, asi que la interfaz lo dice en vez de
prometerlo (`D-067`).

`npm run check` verde: **133 archivos, 2.356 pruebas superadas, 12 omitidas.**

**No verificado, y es lo único que queda:** nada se ha ejecutado contra la red
real de AI Horde ni se ha visto en pantalla. Las pruebas fijan qué contrato se
envía, no que la red responda lo que se espera. Es `LA-038`.

---

Última actualización anterior: **2026-09-02 — VAULT-ROLEPLAY-001, cinco fallos de la conversación privada**

Revisión de una conversación real: cinco síntomas con cinco causas distintas y
ninguna del modelo. El proveedor elegido y las instrucciones a medio escribir
vivían en estado del componente y se perdían al cambiar de pestaña. El prompt
del generador de imágenes iba en español, describía a más de una persona y
mencionaba fotos, de donde salían la segunda mujer y la cámara. La instrucción
empujaba a enviar imágenes y no prohibía hacerlo sin que las pidieran. Adjuntar
guardaba el archivo sin ninguna descripción. Y el prompt global decía «no
inventes una negativa», que un modelo complaciente lee como «no digas que no».

Dos decisiones nuevas: `D-056` —el personaje puede negarse dentro del rol, y el
prompt global abre la posibilidad sin imponer el tono, que pertenece a las
instrucciones del usuario— y `D-057` —el prompt de imagen se escribe en inglés,
solo con el personaje, y lo que no debe salir viaja en el negativo—.

`npm run check` verde: **122 archivos, 2.127 pruebas superadas, 9 omitidas**.
Pendiente `LA-037`: nada de esto está visto en pantalla todavía.

---

Última actualización anterior: **2026-09-02 — BUG-VAULT-CHARACTER-001, un identificador de personaje que nadie comprobaba**

Una conversación privada podía quedarse fijada a un `character_id` que la bóveda
no conoce. El campo acepta texto libre, nadie lo verificaba, y el único que lo
desmentía era el proveedor —con un `404 character_not_found` volcado como JSON
crudo— al final del turno, con la respuesta ya escrita y la foto ya prometida.

Corregido en tres capas: `xavira.ts` traduce `error.code` a un mensaje y una
pista accionables y conserva `code` y `requestId`; `imageBlockReason`, en
`apps/desktop/src/shared/`, exige que el personaje esté en la bóveda y la usan
tanto el proceso principal como la pantalla; el alta manual exige el UUID del
proveedor.

El personaje perdido se recuperó sin gastar créditos consultando
`GET /v1/generations/{id}` del avatar, que devuelve el `character_id`.

`npm run check` verde: **122 archivos, 2.116 pruebas superadas, 9 omitidas**.
Sin commit. Pendiente `LA-036`: darlo de alta en Studio y ver el aviso nuevo
en pantalla.

---

Última actualización anterior: **2026-09-02 — F9.29, el roleplay ya no compite con un asistente técnico**


Corregida la causa estructural del personaje que salía del rol. El prompt
privado sí ordenaba encarnar al personaje, pero el ejecutor envolvía después el
bloque entero como datos y las conexiones HTTP añadían un `system` de asistente
técnico. Ahora el turno privado conserva las directivas como órdenes, los HTTP
reciben modo conversacional y el prompt fija ficción consentida entre adultos,
canon de escena y el uso obligatorio de `LUXY_IMAGEN` cuando corresponde.

`npm run check` verde: **120 archivos, 2.093 pruebas superadas, 9 omitidas**.
F9.29 queda sin commit ni push. Falta confirmarlo con un modelo real (`LA-034`):
las pruebas demuestran qué contrato se envía, no que todo proveedor lo seguirá.

Al abrir el paso, `HEAD` y `origin/luxy/f9-1-vault-crypto` ya coincidían en
`296fe9a`; las menciones a «13 commits sin publicar» eran documentación atrasada
y se han corregido.

---

Última actualización anterior: **2026-09-02 — la bóveda privada, funcionando de verdad**

La sección **Privado** dejó de ser código probado con dobles: la migración
`0007` y la `0008` están **aplicadas**, el gateway está **desplegado**
(`luxy-gateway`, versión `44aee3d5`), y contra los servicios reales ya funcionan
vincular la bóveda a una cuenta, iniciar sesión, crear personajes y generar
imágenes.

Lo que la sección hace hoy: conversaciones privadas cifradas que se ejecutan en
la máquina local, con memoria acumulativa, **instrucciones fijas** y un
**personaje** que el modelo encarna; el modelo puede **pedir una imagen** —
generarla, que cuesta créditos, o **reenviar** una que ya existe, gratis—; y
todo ello se sincroniza entre equipos, turnos y medios, autorizado por sesión de
cuenta.

`npm run check` verde en ese checkpoint: **120 archivos, 2.088 pruebas
superadas, 9 omitidas**. Ese bloque se publicó después; ver la actualización
superior para el estado actual.

**Lo que NO está verificado, y es lo único de seguridad que queda:** que un
usuario no pueda leer los registros de otro (`withVaultAuth`). Necesita una
segunda cuenta real; es `LA-033`, junto con la sincronización entre dos equipos.

Dos cosas que conviene saber antes de tocar nada:

1. **La API de generación corrigió el contrato dos veces**, y ninguna de las dos
   estaba en su documentación pública. La lección quedó escrita: ese contrato se
   corrige con lo que la API responde, no con lo que se supone. El detalle, en
   `CURRENT-TASK.md`.
2. **Las instrucciones que escribe el usuario son órdenes, no datos** (`D-054`).
   Enviarlas marcadas «(DATOS)» hacía que el modelo las tuviera en cuenta sin
   obedecerlas, que es justo lo contrario de lo que pide quien las escribe.

---

Última actualización anterior: **2026-09-01 — F9.18 y F9.19, la bóveda en varios equipos**

La bóveda privada ya se puede usar en **más de un ordenador**. Era la avería
central del bloque: el archivo local y la llave envuelta del servidor eran dos
orígenes de la misma llave maestra que nadie unía. Ahora la **cuenta es el
origen** y el archivo local su **caché** (`D-047`), y sincronizar autoriza por
**sesión de cuenta**, no por token de máquina (`D-048`).

Lo que esto añade en Studio: pantalla de crear cuenta / entrar / salir, la
opción de usar la bóveda sólo en este equipo, y la de **vincular** después una
bóveda que ya existiera —como la de Daniel— sin recifrar nada.

`F9.19` cierra la otra mitad: la **clave de recuperación abre desde cualquier
ordenador**. El servidor guarda una segunda copia de la llave cerrada con ella,
con propósito y hash de acceso propios, y tampoco puede abrirla (`D-049`).
Olvidar la contraseña ya no es perder la bóveda ni aunque cambies de equipo. Las
columnas entraron en `0007` **antes** de aplicarla, así que no hace falta una
migración aparte.

`npm run check` verde: **117 archivos, 2.030 pruebas superadas, 9 omitidas**.
Sin commit, push, deploy ni migración aplicada.

Lo que hay que tener presente antes de seguir: **nada de esto se ha ejecutado
contra Supabase ni contra el gateway real.** La autorización cruzada entre
usuarios sólo se confirma con Postgres delante, y la generación de imagen y
vídeo de Xavira nunca ha hecho una llamada de verdad. Es `LA-031`, ya
**desbloqueada** y ahora la única acción que bloquea lo demás.

Actualización del mismo día: **`0007` ya está aplicada** (las cinco tablas con
`rowsecurity = true`), y se cierran dos piezas más — `F9.20`, instrucciones
fijas por conversación, y `F9.16` remoto, **los medios ya viajan entre equipos**
(bucket privado de Supabase Storage, `D-050`). `npm run check` exit 0: 118
archivos, 2.046 superadas, 9 omitidas.

Actualización del 2026-09-02: **el gateway está desplegado y verificado** —
`/health` responde y una petición de prueba demuestra que habla con el Supabase
donde están las tablas—, `0008` aplicada con el bucket privado, y `F9.22` cierra
el flujo que faltaba: **el modelo puede pedir una imagen dentro de la
conversación y se genera, se cifra y se guarda sola** (`D-051`).

Lo que falta, por orden: la primera llamada real a la API de generación, `F9.21` (un vídeo de más de 20 MB se
guarda pero no se previsualiza), la limpieza de objetos huérfanos y `F9.12`
(documentación de privacidad). Sin streaming es deliberado (`D-043`), no un
olvido. El detalle, con tamaños y causas, en `CURRENT-TASK.md`.

---

Última actualización anterior: **2026-09-01 — F9-VAULT-001, punto de retoma**

Capacidad nueva, en rama aislada `luxy/f9-1-vault-crypto` (25 commits sobre
`main` @ `00a9cc1`, sin push): **bóveda privada cifrada**. Una sección
«Privado» en Studio que se abre con contraseña y cuyas conversaciones, memoria
e imágenes/vídeos se cifran en el equipo antes de salir. Funciona de extremo a
extremo **en local** y Daniel lo confirmó a mano. La sincronización entre
equipos y las cuentas de usuario tienen la lógica implementada y probada con
mocks, **pero sin interfaz de cuenta y sin ejecución contra Supabase real**.

`npm run check` verde: 116 archivos, 1.997 pruebas superadas, 9 omitidas.

Lo canónico de esta capacidad —estado por paso, arquitectura de claves, los
diez puntos a tener en cuenta y el siguiente paso exacto— vive en
`CURRENT-TASK.md`, sección `F9-VAULT-001`, bajo «PUNTO DE RETOMA». Quien
retome debe leerlo entero antes de tocar nada.

> El aviso de este bloque —«dos orígenes de la misma llave maestra sin unir»—
> **ya no está vigente**: los unió `F9.18`, arriba. Lo demás del bloque sí lo
> está.

Decisiones nuevas del bloque: `D-039` a `D-048`. `D-045` matiza `D-001`: Luxy
admite varias personas con cuenta propia; el resto de `D-001` (coste cero, sin
facturación) sigue vigente.

Última actualización: **2026-09-01 — BUG-GIT-IDENTITY-001**

Capacidad corregida: Luxy ya puede confirmar el trabajo de un worktree en un
ordenador **sin identidad de Git configurada**. `commitWorktree` aporta una
identidad de respaldo (`Luxy <luxy@local.invalid>`) sólo cuando el equipo no
tiene ninguna, conservando la autoría real del usuario cuando sí existe.
Antes fallaba de forma silenciosa, después de haber inicializado el proyecto
correctamente. `npm run check` exit 0: 96 archivos, 1.653 superadas, 14
omitidas. Sin commit, push, deploy ni migración.

Nota de entorno: la copia operativa de esta sesión es
`C:\Users\oscar\Desktop\Daniel\Luxy`, un clon nuevo, no la
`C:\Users\daniel\Desktop\Luxy` que describe el checkpoint del 2026-08-21.
La integración de `F4.9` ya está hecha (`main` @ `00a9cc1`), aunque los
documentos anteriores todavía la presentan como pendiente; `LA-029` sí sigue
abierta. `LA-030` recoge la identidad global de Git de este equipo.

Trabajo acordado y no empezado: `F5-VAULT-001`, conversaciones privadas
cifradas en cliente y sincronizadas, con la infraestructura viendo sólo
ciphertext. Diseño y pasos en `CURRENT-TASK.md`.

Actualización 2026-08-31 — `LUX-BHM8` demostró que el guard de `tool_calls`
alcanzaba por error el lector SSE del bucle agentic. Se movió a la ruta de
consulta de solo texto: Kimi K3 agentic ya entrega sus llamadas al ejecutor
confinado y devuelve sus resultados al modelo en la siguiente vuelta.

Actualización 2026-08-31 — `LUX-SKA7` confirma que Kimi K3 ya usa herramientas
reales: ejecutó `list_files` y `write_file` en su worktree aislado. El fallo
posterior fue `fetch failed` sin HTTP, y se detectó que la ruta agentic sólo
reintentaba 429. Ahora también reintenta cortes de red y errores HTTP
recuperables, sin reejecutar herramientas ya terminadas. Sigue experimental
hasta completar manualmente el reintento de ese trabajo.

Última actualización: **2026-08-31 — máquina registrada y agente iniciado**

Daniel completó OAuth de Wrangler y la cuenta correcta administra
`luxy-gateway`; el secreto existe por nombre y su rotación está autorizada, pero
se pospone hasta poder consumirlo. `CiTool` identifica Smart App Control
`VerifiedAndReputableDesktop` en enforcement, y Electron 43.2.0 está sin firma.
No se desactivó ninguna protección. Los dos suplementos creados por App Control
Wizard quedaron vacíos y no se instalaron. El bloqueo operativo vigente no era
Code Integrity: `ELECTRON_RUN_AS_NODE=1` hacía que el ejecutable funcionara como
Node. Al eliminarlo sólo del proceso de desarrollo, Luxy abrió correctamente.
El secreto de registro ya se rotó, se consumió una vez y se retiró del
portapapeles. La máquina `portatil-oscar` quedó registrada con ID
`6f34d4b8-5927-43ee-a0d0-360ac54f3c01`: existe `config.json`, el token no está
en claro y `secrets.enc` cifrado existe. Tras reiniciar Desktop sin
`ELECTRON_RUN_AS_NODE`, el proceso informó `agente listo`. No se aplicó ninguna
política de App Control ni se relajó protección alguna; ver `LA-031`.

El catálogo inicial de API China también se actualizó a los 19 modelos actuales:
retira versiones ya ausentes y añade GLM 4.5 Air, Kimi K3, Qwen 3.8 27B,
SenseNova 6.8 Flash Lite y SenseNova U1.5 Lite. Las capacidades de las versiones
nuevas continúan sin verificar salvo las que ya tenían evidencia; no se ejecutó
ninguna API real para asumir contratos.

Corrección operativa posterior: un trabajo de Kimi K3 podía terminar con
`finish_reason=tool_calls`, cero texto visible y ninguna herramienta autorizada,
pero la ruta de consulta lo marcaba como completado. Ahora esa respuesta termina
como fallo explícito, preserva el diagnóstico y no ejecuta herramientas sin un
contrato agentic verificado. El trabajo histórico no se reescribe porque no hizo
cambios; los trabajos nuevos ya usan la corrección.

Kimi K3 queda habilitado únicamente como experimento agentic solicitado por
Daniel: la traza real confirmó `tool_calls`, pero aún no existe una ejecución
completa que valide el contrato. Recibe sólo el ejecutor ya confinado al
worktree, con los límites y prohibiciones habituales. Un primer trabajo nuevo
debe confirmar que crea archivos y registra sus llamadas antes de marcarlo como
verificado.

Última actualización: **2026-08-31 — reintento de alta aún bloqueado**

El Gateway real sigue sano y configurado. Desktop recompila, pero Windows
repite el rechazo de Electron con `spawn UNKNOWN`, eventos 3033/3077 y la misma
Policy ID empresarial. Wrangler está instalado pero sin sesión Cloudflare y no
hay certificado local de firma de código. Continúan ausentes el secreto de
registro, `config.json` y `secrets.enc`; no se creó una identidad parcial ni se
dejó un token en claro. Próximo punto de decisión y acciones: `LA-031`.

Última actualización: **2026-08-28 — alta de este ordenador bloqueada fuera de Luxy**

El onboarding ya conserva y muestra la `machineId` real devuelta por Gateway y
propone un nombre desde el hostname. La implementación pasa lint, typecheck,
1.662 pruebas y build. Este perfil sigue sin registrarse: falta
`MACHINE_REGISTRATION_SECRET` y Windows Code Integrity exige nivel de firma
empresarial para ejecutar Electron (eventos 3033/3077, Policy ID
`{0283ac0f-fff1-49ae-ada1-8a933130cad6}`). No se fabricó ninguna ID, no se
guardó token en claro y la app no quedó abierta. Pasos externos: `LA-031`.

Última actualización: **2026-08-28 — F2.4-T1 implementada y verificada**

El estado Git real corrige el siguiente paso antiguo de `F4.9`: `main` y
`origin/main` ya contienen `00a9cc1 feat: añade proveedores HTTP configurables`.
La publicación y validación manual permanecen separadas en `LA-029`; no se han
ejecutado en este relevo. El desarrollo continúa en el worktree aislado
`luxy/f2-4-conversation-library`. Studio ya permite renombrar, archivar,
restaurar y buscar conversaciones sin migración ni sondeo adicional. El cambio
está conectado desde Zod/Gateway hasta IPC y renderer y pasa lint, typecheck,
1.655 pruebas y build. Permanece sin commit, push, deploy ni prueba manual; esas
acciones requieren revisión o autorización y la validación local está en
`LA-030`.

Última actualización: **2026-08-27 — F4.9-DYNAMIC-HTTP-PROVIDERS**

Luxy Studio ya permite añadir, editar, activar, desactivar y eliminar proveedores
HTTP compatibles con `chat completions`, sin editar `config.json`. La clave se
guarda cifrada, nunca vuelve al renderer y se invalida al cambiar de endpoint o
eliminar el proveedor. Los identificadores configurados viajan por Gateway y
aparecen en Trabajos y Conversaciones; el agente aplica la configuración al
quedar libre, sin interrumpir un trabajo en curso. URLs remotas exigen HTTPS y
siguen bloqueadas las APIs prohibidas por D-003.

Estado: implementado y verificado en el worktree aislado
`luxy/f4-9-dynamic-http-providers`, con el commit local
`feat: añade proveedores HTTP configurables`; sin push, deploy ni migración. La
puerta `npm run check` pasa con 96 archivos, 1.656 pruebas superadas y 9
omitidas. No se llamó a ningún proveedor real; la integración, publicación y
prueba manual están en `LA-029`.

Última actualización: **2026-08-21**

`LUXY-CONSOLIDATION-001` cerró la consolidación de los ocho worktrees en una
sola línea canónica: `C:\Users\daniel\Desktop\Luxy`, rama `feat/luxy-desktop`,
HEAD `e40268a`. `git worktree list` sólo contiene ya esa copia. El bloque de
`luxy/consolidate-worktrees` (workspaces reutilizables, Remote 4d, ficha de
proyecto, diálogos de confirmación React embebidos) quedó fusionado por
fast-forward; los worktrees restantes se auditaron archivo por archivo y se
eliminaron al confirmarse sin trabajo único. Detalle completo en
`CURRENT-TASK.md` y en las entradas del 2026-08-21 de `CHANGELOG-WORK.md`.
Las notas de «consolidación en curso» de más abajo describen ese proceso
mientras estuvo abierto; quedan como historial, no como estado pendiente.

Actualización puntual: **BUG-HUNYUAN-002** recupera en la rama de Studio la
compatibilidad ya desarrollada para el historial de proveedores. La lectura de
trabajos admite identificadores seguros externos; crear, reintentar y continuar
siguen acotados a proveedores reconocidos. No se realizó despliegue ni migración.

Actualización puntual: el catálogo detectado clasifica `hy3` como modelo de texto
de la familia `other`; esto no elimina el identificador histórico `hunyuan` de
los trabajos ya guardados. Los modelos nuevos detectados quedan sin herramientas
ni capacidad de agente.

Actualización 2026-08-11: `F4.8-T5` implementado. Studio puede crear y abrir un
worktree antes de una tarea, recordar el seleccionado y reutilizarlo en llamadas
posteriores sin perder archivos. El contrato de Gateway necesita publicación
manual y la interfaz necesita reconstrucción para la validación real.

Última actualización: **2026-08-10**

Actualización 2026-08-10: `F4.8-T4` implementado. Cuando un retry reutiliza el
worktree, el prompt del agente marca explícitamente la ejecución como
continuación y le ordena inspeccionar y conservar los archivos existentes. La
prueba y la reconstrucción de Desktop quedan pendientes en este checkpoint.

Actualización 2026-08-10: `F4.8-T1` implementado. Los proyectos con
`allowEdits: true` que aún no tienen Git se inicializan automáticamente con un
`.gitignore` seguro y el commit local `estado inicial`, sin remoto; después el
trabajo usa el worktree aislado habitual. `allowEdits: false` sigue siendo sólo
lectura. Prueba focalizada 72/72; typecheck pendiente por dependencia ausente.

`F4.8-T2` implementado y desplegado: un reintento agentic conserva un nuevo
registro, pero Gateway y agente validan y reutilizan el mismo worktree y rama.
Una web parcial continúa desde sus archivos, no desde el proyecto base. Gateway
`a5cb5ba8-34d9-4cca-85ba-e02f95e3942f`, `/health` HTTP 200; Desktop y agente
reconstruidos con timeout ampliado; falta validación manual.

Estado documental: **checkpoint reconciliado en Windows; `F4.1-T4/T5`,
`F4.2-T1/T2/T3` y `F4.3-T1`–`F4.3-T8` verificados y commiteados localmente;
`F4.3-T9/T10` y `F4.4-T1/T2` commiteados en `3771549`; `F4.4-T3` y `F4.5/F4.6`
verificados después del commit y pendientes de commit; push pendiente**

Gateway desplegado con autorización el 2026-08-09: `luxy-gateway`, versión
`b3fb5c99-5cf1-42a1-b011-f6d44b9f0730`; comprobación pública `/health` HTTP 200.

## 1. Cómo interpretar este estado

Orden de precedencia:

1. El contenido real del worktree de Windows.
2. Este archivo.
3. `CURRENT-TASK.md`, `DECISIONS.md` y `MASTER-PLAN.md`.
4. `CHANGELOG-WORK.md`, `TEST-RESULTS.md` y `LOCAL-ACTIONS.md`.
5. README y documentación técnica.
6. Handoffs, capturas y parches antiguos.

Si el worktree contradice este archivo, no se reescribe código para hacerlo
coincidir. Se registra la discrepancia, se averigua qué cambio existe realmente
y se actualiza primero la documentación.

## 2. Producto y restricciones vinculantes

Luxy es un sistema privado y personal para controlar modelos y agentes de IA.
La interfaz principal es **Luxy Studio para Windows**. Telegram queda como canal
secundario. Luxy Mobile para Android es una fase futura y Luxy Remote permanece
pausado, no eliminado.

Restricciones:

- Coste obligatorio de producto: **0 €**.
- No SaaS, facturación, multi-tenant, iOS ni publicación comercial.
- Claude Code y Codex usan las sesiones locales de las suscripciones; no se
  pagan ni se integran sus APIs.
- No automatizar las webs de Claude o ChatGPT.
- No usar `--dangerously-skip-permissions` ni equivalentes.
- El modelo sólo edita en un worktree aislado; al primer trabajo editable Luxy
  puede crear en la carpeta original el `.git` y el commit local `estado
inicial` necesarios para disponer de ese aislamiento.
- No commit sin aprobación explícita de Daniel.
- No push sin dos confirmaciones y `allowPush: true`.
- No desplegar ni aplicar migraciones reales sin autorización explícita.
- No usar APIs reales en pruebas automatizadas.
- No exponer secretos, rutas personales ni el entorno completo a procesos hijo.

## 3. Arquitectura actual

```text
Luxy Studio / Telegram
        |
        v
Cloudflare Worker (gateway y única pieza pública)
        |
        v
Supabase/Postgres (trabajos, leases, eventos, aprobaciones y metadata)
        ^
        | polling HTTPS saliente
Agente local de Windows
        |
        +-- Claude Code o Codex CLI con sesión local
        +-- Proveedores HTTP configurados
        +-- Worktrees Git para tareas que pueden editar
```

Monorepo:

| Ruta                  | Responsabilidad                                       |
| --------------------- | ----------------------------------------------------- |
| `packages/shared`     | tipos, esquemas Zod y lógica pura compartida          |
| `apps/gateway`        | API de Studio, cola, autenticación y Telegram         |
| `apps/agent`          | proveedores, procesos, worktrees, checks y resultados |
| `apps/desktop`        | Electron/React, IPC, Studio y secretos cifrados       |
| `supabase/migrations` | SQL acumulativo                                       |
| `packages/remote-*`   | Luxy Remote conservado y pausado                      |

## 4. Checkpoint operativo conocido

**Corrección del 2026-08-09, comprobada en este ordenador.** El checkpoint
operativo actual es:

- repositorio activo: el checkout `Luxy` del workspace actual;
- rama activa: `feat/luxy-desktop`, HEAD local con el commit
  `feat: incorpora modelos y laboratorio reproducible`, un commit por delante de
  `origin/feat/luxy-desktop` (`59870c6`);
- `P0.0`–`P0.5` están **commiteados** (`9012eda`, `16c6e9a`, `845c3cb`,
  `c6e5094`). El riesgo de las 7.997 líneas sin commit que registraba `LA-008`
  ya no existe;
- `P0.6a`–`P0.6d`, `P0.8`, `P0.9`, `F4.1-T1`–`F4.1-T5`, `F4.2-T1`–`F4.2-T3`
  y `F4.3-T1`–`F4.3-T8` están incorporados;
- hay un cambio local ajeno en `package-lock.json` y elementos sin seguimiento
  con claves/demos. Se preservan y no forman parte del trabajo actual.

- Commit y push: **autorizados y hechos** el 2026-08-06 (`af095b3`, `9f0ab42`).
- Despliegue del gateway: **autorizado y hecho** por Daniel el 2026-08-07,
  versión `096f2623-c6cc-4dcd-94d3-b41a12608ea4`. Sin migración: todo lo nuevo
  viaja en `metadata` (`D-014`, `D-017`).
- Migración nueva: sigue sin autorizarse y sin hacer falta.

Checkpoint anterior, conservado por si hace falta rastrear algo:

- Repositorio: `Danielux135/Luxy`.
- Worktree de prueba en Windows:
  `%LOCALAPPDATA%\Luxy\worktrees\luxy-work-update-001`.
- Rama conocida: `luxy/work-update-001-studio`.
- Perfil de prueba de Desktop:
  `%LOCALAPPDATA%\Luxy\test-profiles\studio-001`.
- Gateway local: Wrangler en `apps/gateway`, normalmente
  `http://localhost:8787`.

El estado exacto de Git y de las migraciones debe volver a leerse en Windows al
abrir la siguiente sesión. No asumir que un parche está aplicado sólo porque sus
pruebas existen; usar el código real y `git apply --reverse --check` cuando sea
necesario.

## 5. Capacidades implementadas

| Área                   | Estado conocido           | Observaciones                                                                                     |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------------------------------- |
| Agente, gateway y cola | Implementado              | polling saliente, leases, heartbeats, eventos y cancelación                                       |
| Desktop Electron       | Implementado              | agente en utility process, bandeja, configuración y secretos cifrados                             |
| Studio — trabajos      | Implementado en código    | formulario real, historial, eventos, resultado, diff, pruebas y trazabilidad de llamadas/worktree |
| Worktrees              | Implementado              | la carpeta original no se modifica; el primer trabajo puede preparar Git en un proyecto sin repositorio |
| Aplicar/descartar      | Implementado en código    | aplicar crea commit aislado; descartar borra worktree tras confirmar; sin push                    |
| Conversaciones         | Implementado parcialmente | uno o dos modelos, streaming, historial, tiempos, tokens y cancelación                            |
| Diagnóstico del final  | Implementado y verificado | señal de transporte, aborto, límites efectivos y tokens; sin contenido                            |
| Finales explícitos     | Implementado y verificado | seis resultados; la salida parcial se conserva y no se reintenta a ciegas                         |
| Memoria                | Implementado y verificado | sin fallback: sólo un bloque válido la sustituye; el código se rechaza                            |
| Recomendaciones        | Implementado              | feedback y resultados ajustan una recomendación explícita; nunca cambia solo                      |
| Continuación           | Implementado              | unión con evidencia y aviso cuando no la hay; el parcial viaja como dato                          |
| Cancelación            | Implementado              | conserva lo generado como resultado; no ofrece continuar ni escribe memoria                       |
| Feedback               | Arreglo preparado         | el primer clic usa la respuesta del gateway; falta confirmación manual final                      |
| Proveedores/modelos    | Implementado; validar     | 23 modelos reales; el snapshot detectado alimenta las pantallas operativas; sin sondeo de precios |
| Laboratorio            | Implementado; validar     | catálogo, ejecución individual/par, persistencia, evidencia, comparación y recomendación prudente |
| Errores de proveedor   | Implementado y verificado | límite de plan y 429 explicados; se obedece `Retry-After`; intentos reales                        |
| Telegram               | Conservado                | canal secundario                                                                                  |
| Mobile Android         | No iniciado               | prioridad posterior a estabilizar Desktop                                                         |
| Remote                 | Pausado                   | conservar código, ADR, threat model y pruebas                                                     |

## 6. Flujo de Conversaciones que ya funciona

- Crea cada respuesta como un trabajo persistente de Studio.
- Agrupa conversación, turno y columna A/B en metadata.
- Ejecuta el proveedor en solo lectura, sin herramientas, worktree ni checks.
- Muestra streaming, primer texto, duración total y tokens cuando el proveedor
  los entrega.
- El botón **Detener** cancela y recupera cancelaciones huérfanas.
- Las respuestas normales pasan solas a **Guardado**.
- La memoria estructurada se separa del texto visible y se reutiliza en turnos
  posteriores.
- El feedback `Útil` / `No me sirvió` alimenta la selección de proveedor y
  modelo, pero no entrena sus pesos.
- En A/B, la respuesta útil más reciente es la fuente canónica del siguiente
  turno; sin valoración se usa A.

Arreglos acumulados relevantes:

1. Lectura de `finish_reason`, `[DONE]`, usage final y último evento sin salto.
2. Cancelación real y recuperación de estados huérfanos.
3. Finalización por señales de protocolo, no por una pausa breve arbitraria.
4. Publicación de respuestas cortas.
5. Conservación de `inputTokens` y `outputTokens` como números: el redactor ya
   no los confunde con credenciales.
6. Feedback visual al primer clic.

## 7. Incidencias abiertas prioritarias

### LUXY-P0-001 — respuesta larga incompleta — **causa demostrada el 2026-08-05**

**Era el tope de guardado, no el proveedor ni el transporte.** Con la telemetría
de `P0.1` funcionando, dos ejecuciones reales dieron:

| Trabajo    | tokens salida | caracteres recibidos | guardado | transporte    | finish_reason | aborto  |
| ---------- | ------------- | -------------------- | -------- | ------------- | ------------- | ------- |
| `LUX-YJT9` | 3.180         | 7.716                | 4.000    | `done_marker` | `stop`        | ninguno |
| `LUX-8B8T` | 2.720         | 7.691                | 4.000    | `done_marker` | `stop`        | ninguno |

La llamada terminaba bien y la respuesta llegaba entera. `summary` estaba
limitado a 4.000 caracteres para cualquier trabajo, así que una conversación
perdía la mitad al persistir. Corregido en `P0.3b` (`D-020`).

Lo que **no** era, ya con evidencia: ni el límite de tokens (2.720 y 3.180 de
8.192), ni un aborto de Luxy (`abortedBy: null`), ni un socket caído
(`done_marker`).

Queda abierto y **ya confirmado como límite real**: el trabajo `LUX-3966` con
KAT Coder Pro v2.5 terminó con `finish_reason: length` y exactamente 8.192
tokens de salida — 22.574 caracteres, unas 700 líneas. Para páginas de
1.000–2.000 líneas hace falta el tope real por modelo (`LA-007`, `F2.14`).

Ese mismo trabajo confirma en producción los arreglos: se guardaron 22.025
caracteres donde antes cabían 4.000, el final se clasificó `truncated` y la
memoria quedó marcada `truncated_block` sin contaminarse.

Evidencia original observada el 2026-08-04, que abrió la incidencia:

- Kimi generó una respuesta durante aproximadamente **23 min 43 s**.
- El panel del proveedor registró la llamada y alrededor de **6.422 tokens de
  salida**.
- El HTML visible terminó a mitad de una etiqueta.
- La respuesta no permite distinguir todavía si el motivo fue
  `finish_reason: length`, timeout local, timeout o aborto del upstream, cierre
  anómalo del socket, proxy intermedio o pérdida de un evento terminal.

No está demostrado que fuese el límite de tokens. Tampoco está demostrado que
Luxy cortase la conexión. La siguiente tarea debe añadir diagnóstico seguro y
reproducir todos los finales posibles antes de cambiar otro timeout.

Avance del 2026-08-05 (`P0.1`, verificado): el transporte ya deja evidencia. Un
trabajo publica un evento `log` con `metadata.responseTermination`, que conserva
código HTTP, si hubo streaming, bytes, chunks, duración, última señal observada
(`done_marker`, `body_closed`, `local_end`, `read_error`, `no_stream`),
`finish_reason` exacto, si el usage era final, quién abortó, timeout y
`max_tokens` efectivos, tokens y longitud del texto. Nunca el contenido. Con
esto, la próxima repetición del caso sí podrá clasificarse.

Hallazgo del mismo paso, **ya resuelto en `P0.2`**: un corte de lectura con
texto parcial se reintentaba entero, porque los errores sin `status` se
consideraban reintentables. Para una generación de 20 minutos eso era empezar de
cero tres veces. Ahora no se reintenta (`D-016`), lo generado se conserva y el
turno se clasifica como `interrupted`.

Avance del 2026-08-05 (`P0.2`, verificado): existen seis finales explícitos —
`completed`, `truncated`, `interrupted`, `timed_out`, `cancelled` y `failed`—
decididos por lógica pura en `packages/shared/src/response-outcome.ts`. Una
salida parcial se guarda con su motivo real en la metadata del trabajo
(`D-017`), sin tocar el enum de Postgres, y **no escribe memoria**.

Dato de código: una conversación HTTP usa el `jobTimeoutMs` general, una hora
por defecto, y no el antiguo tope fijo de cinco minutos. El esquema permite
hasta seis horas. Aun así, un intermediario o el proveedor puede imponer su
propio límite.

Aviso para cualquier pantalla: desde `D-017`, `status: completed` **ya no
significa** que la respuesta llegara entera. Hay que leer `responseOutcome`.

### Fallo latente corregido el 2026-08-05 (`P0.2b`)

Luxy armaba el cierre local al ver una señal terminal y lo ejecutaba un segundo
después aunque el modelo siguiera escribiendo. Bastaba un `usage` sin `choices`
a mitad de la respuesta. **Reproducido** en `sse.test.ts` y corregido con señales
fuertes y débiles (`D-018`).

Aviso importante para no confundir dos cosas: este fallo era real, pero la
telemetría demostró después que **no** fue la causa de los cortes que veía
Daniel. Ésa está en `LUXY-P0-001`, y era el tope de guardado.

### LUXY-P0-002 — memoria contaminada por código — **resuelto el 2026-08-05**

El fallback compactaba los primeros 1.200 caracteres del texto visible cuando no
llegaba un bloque `LUXY_MEMORY` válido. En una respuesta de HTML/CSS/JS eso
guardaba código como resumen, y además pisaba una memoria anterior correcta.

Corregido en `P0.3` (`D-019`): el fallback ya no existe. Sólo un bloque completo,
válido, sin código dentro y en una respuesta `completed` sustituye la memoria;
cualquier otro caso conserva la última válida y registra por qué
(`absent`, `truncated_block`, `invalid`, `rejected_code`). `looksLikeCode` se
aplica también dentro de un bloque bien formado, porque el modelo puede meter la
respuesta ahí.

Queda para `P0.5`: que Studio **diga** que la memoria se conservó y de qué turno
viene, en lugar de limitarse a mostrar la última.

Requisitos originales, todos cubiertos salvo el aviso en pantalla:

- Nunca convertir HTML, CSS, JavaScript, JSON extenso ni bloques de código en
  memoria.
- No reemplazar una memoria anterior válida cuando el turno acaba truncado,
  interrumpido, cancelado o sin bloque estructurado válido.
- Registrar por separado si la memoria fue `structured`, `preserved` o
  `unavailable`.
- Conservar una respuesta parcial como salida o artefacto, no como memoria.

### LUXY-P0-003 — salidas largas no son artefactos

Desde `P0.3b` una conversación guarda hasta 120.000 caracteres y avisa si aun
así no cabe, así que ya no se pierde una respuesta normal. Eso **no** cierra la
incidencia: sigue siendo el campo de resultado, no un almacén de documentos, y
el listado de Studio devuelve esas respuestas completas.

Una web completa no debe depender de ese campo ni de la memoria.

Avance del 2026-08-06 (`P0.6a` y `P0.6b`, verificado por pruebas): continuar una
generación interrumpida **ya no duplica fragmentos**. `joinContinuation` decide
dónde empieza lo nuevo con cinco estrategias, `continuesJobId` guarda el enlace
en la metadata para que la unión sobreviva a una recarga, y cuando no hay prueba
de continuidad se pega y se avisa en vez de descartar texto (`D-021`).

Sigue faltando la ruta de artefacto: un documento largo aún vive en el
`resultSummary` de cada fragmento, y la memoria acumulativa se cierra turno a
turno en lugar de esperar a que la secuencia esté completa. Es `P0.6c`, y
empieza por una decisión de Daniel sobre dónde se guarda un artefacto.

### LUXY-P0-004 — sondeo desbordado — **causa demostrada y corregida el 2026-08-06**

Observado por Daniel con Studio ya arrancando: **29.432 peticiones al API
Gateway de Supabase en 60 minutos**, 100 % de éxito, con el mismo bloque
repitiéndose cada menos de 3 s.

La causa no era el agente: era el renderer. `useConversations` recargaba cada
1.500 ms las opciones, la lista y el detalle de **cada** respuesta visible,
aunque llevara horas guardada. Con seis respuestas en pantalla, 8 peticiones cada
1,5 s ≈ 19.200/h. `useStudio` repetía el patrón cada 3 s.

Corregido en `P0.8`: un trabajo terminado no se vuelve a pedir, el ritmo baja a
10 s en reposo y a 60 s con la ventana oculta, y las opciones caducan a los 30 s.
Aritméticamente, de ≈19.200/h a ≈480/h en reposo.

Corregido en `P0.9` lo que faltaba, la generación: el agente corre dentro de
Studio y ya publicaba el texto acumulado por el bus local, así que preguntárselo
a Supabase cada 1,5 s era preguntar por algo que estaba en el propio proceso.
Ahora el directo se pinta desde ese bus, el final del agente dispara **una**
recarga dirigida y el sondeo queda de red de seguridad. De ~40 peticiones por
minuto de generación a ~7.

Regla que sostiene `P0.9` y no se puede relajar: **el evento local dispara la
lectura, nunca la sustituye.** Dice que el agente terminó, no lo que quedó
guardado; el final real se lee del trabajo persistido. Y basta una respuesta
viva de otra máquina para volver al sondeo rápido.

**Falta la medición real** (`LA-012`): los dos arreglos están en el renderer y
exigen reiniciar Studio.

Lo que sigue sondeando por diseño: el agente, con `pollIntervalMs` de 2 s
(≈1.800 reclamaciones/h) y heartbeat cada 10 s. Es la decisión `0001` — sin
puertos abiertos, sondea él — y su ajuste vive en la configuración de máquina.

## 8. Estado de migraciones: no inferir

La copia de referencia contiene `0001` a `0005`. Documentación anterior dice
que `0005_luxy_studio_jobs.sql` estaba preparada y debía probarse antes de
aplicarse. Las sesiones recientes mencionan además una `0006` en el worktree de
Windows y ordenan expresamente no tocarla.

Esto es una discrepancia abierta, no permiso para «arreglarla»:

- No modificar `0005`, `0006` ni ninguna migración existente.
- No crear `0007` durante la estabilización de Conversaciones salvo que el
  diseño demostrado lo exija y Daniel lo autorice.
- Verificar primero archivos locales y estado remoto; registrar el resultado en
  `LOCAL-ACTIONS.md` y `CHANGELOG-WORK.md`.

## 9. Validación conocida

Las últimas validaciones históricas comunicadas para los arreglos de
Conversaciones fueron:

- 91/91 pruebas específicas para finalización por señales.
- 30/30 para persistencia de resultado, tokens y memoria.
- 11/11 para estado de Conversaciones y feedback.
- `lint`, TypeScript y build completos en verde en la copia de desarrollo.
- Suite global más reciente: 1.312 pruebas ejecutadas; 1.294 pasaron, 9 se
  omitieron y quedaron 9 fallos ambientales conocidos en Linux más dos suites
  de Electron bloqueadas por caché/permisos. No se informó de regresiones de
  código nuevas.

Son resultados históricos. `TEST-RESULTS.md` debe registrar por separado lo que
se ejecute en cada nuevo checkout o worktree.

La copia Linux usada para preparar este relevo reprodujo el 2026-08-04 la misma
línea base: formato, manifiesto, referencias, lint, tipos y build pasaron;
`npm test` mantuvo 1.294 verdes, 9 omitidas, 9 fallos ambientales y dos suites
Electron sin cargar. El detalle exacto está en `TEST-RESULTS.md`.

**Línea base real de Windows, 2026-08-05:** la suite completa pasa entera.
Antes de `P0.1`, 68 archivos y 1.316 verdes; tras `P0.1`, 69 y 1.334; tras
`P0.2`, 70 y 1.356; tras `P0.2b` y `P0.3`, 70 y 1.366; tras `P0.3b`, 70 y
1.370; tras `P0.3c`, 70 y 1.379; tras `P0.4`, 71 y 1.398; tras `P0.5`, 71 y
1.408; tras `P0.6a`, 72 y 1.426; tras `P0.6b`, 72 y 1.436; tras `P0.8`, 72 y
1.443; tras `P0.9`, 72 y 1.451; tras `P0.6d`, 72 y 1.453. Siempre 9 omitidas y
exit 0. Los 9 fallos «ambientales» eran exclusivos de la copia
Linux y aquí no existen: en esta máquina un fallo es una regresión.

## 10. Próximo objetivo

> **Desincronización conocida, 2026-09-23.** Las secciones **4, 8, 9 y 10** de
> este archivo son un checkpoint de agosto —rama `feat/luxy-desktop`,
> «migraciones 0001 a 0005», porcentajes de avance, `UX-001` como próximo
> objetivo— y **contradicen la cabecera de este mismo archivo**, que va por F30
> del 2026-09-21. No las leas como estado actual.
>
> **El estado real vive en `CURRENT-TASK.md`**, cuya cabecera dice qué tarea
> manda. `MASTER-PLAN.md` tiene el mismo problema: su fecha máxima es
> 2026-09-02 y su última tabla acaba en F9.29, sin una sola fila de F16 a F31
> —AI Horde, prompt de imagen, memoria acumulativa, promesas, recap, reparto,
> repetición—, que es todo lo construido desde entonces.
>
> Sincronizar §4-§10 y `MASTER-PLAN.md` queda **pendiente y declarado**. El §1
> de este archivo exige detener la edición y actualizar la documentación cuando
> el worktree la contradiga; eso no se hizo durante tres semanas, y esta nota
> es el primer paso de hacerlo, no una excusa para saltárselo otra vez.

### UX-001 — trazabilidad del detalle de trabajos (2026-08-20)

Implementado, verificado y commiteado en el worktree aislado
`luxy/ux-001-detalle-trabajo`: los proveedores HTTP informan las llamadas
efectivas al modelo y las herramientas ejecutadas. Gateway las conserva como
`callMetrics`; Studio las presenta sin estimar los trabajos históricos. El detalle
también muestra el worktree y permite abrirlo en el Explorador de Windows. El IPC
resuelve enlaces y rechaza cualquier ruta fuera de
`%LOCALAPPDATA%\Luxy\worktrees`.

Lint, typecheck, 1.574 pruebas (14 omitidas) y build pasaron. Requiere desplegar
el Gateway con autorización para que los trabajos nuevos persistan la métrica.
No cambia los trabajos anteriores ni crea migraciones.

`F4.1-T4` cerró la discrepancia entre la instantánea real y el catálogo
operativo: el snapshot persistido representa los 23 modelos declarados por la
pasarela el 2026-08-07. Los tres incorporados conservan un contrato mínimo y no
reciben herramientas ni aliases implícitos.

Este paso no atribuye precios, tool calling ni límites de salida sin evidencia.
`F4.1-T5` cerró la investigación de precios: las rutas observadas no publican
entradas útiles y Daniel decidió no consultarlas. Luxy actualiza únicamente
`/v1/models` y lo explica una vez en la pantalla. `LA-007` continúa bloqueada
hasta verificar topes por modelo.

`F4.2-T1` añade evidencia local sin benchmarks: una lectura al abrir Modelos
resume trabajos con modelo exacto en completas, parciales, fallos,
cancelaciones y mediana de duración. La muestra está limitada a los últimos 100
trabajos. `F4.2-T2` hace que el agente informe el `apiModel` realmente ejecutado
y que el gateway lo conserve en completados, fallos y cancelaciones; así los
trabajos creados mediante una familia dejan de quedar sin atribución. Los
trabajos históricos sin ninguna evidencia de modelo siguen sin inferirse.
`F4.2-T3` pagina el historial en bloques de 100 hasta 1.000 trabajos, muestra la
cobertura y detecta un Gateway anterior que ignore el desplazamiento. Falta la
comprobación visual `LA-017`; la paginación real requiere probar contra el
Gateway actualizado.

`F4.3-T1` inicia Laboratorio sin gastar tokens: ocho pruebas versionadas cubren
rapidez, código, frontend, español, instrucciones, JSON, contexto largo y tool
calling. Studio muestra prompts y criterios, pero todas las definiciones llevan
`executionEnabled: false`. `F4.3-T2` materializa las seis fixtures referenciadas
y valida localmente salida exacta, restricciones, JSON y recuperación en
contexto largo. Código necesita sandbox; frontend y español, rúbrica humana;
tool calling, una traza real validada. `F4.3-T3` filtra modelos por capacidades
declaradas y
compone una vista previa idéntica para todos, con la fixture marcada como datos.
No verifica capacidades ni crea trabajos. `F4.3-T4` añade el contrato
versionado de una ejecución: exige confirmación literal y modelo exacto, y el
Gateway sólo acepta el snapshot y prompt exactos del catálogo. La metadata
conserva definición, fixture, scoring y modo de validación sin inventar una
nota. El agente reserva un camino de solo lectura sin worktree, herramientas,
memoria ni comprobaciones. Laboratorio muestra la confirmación futura y mantiene
el botón deshabilitado: aún no hay IPC ni consumo.

`F4.3-T5` completa el contrato del resultado automático. En el cierre del
trabajo, Gateway aplica únicamente validadores puros a una respuesta
`completed` cuyo snapshot siga coincidiendo con el catálogo. Persiste checks,
modelo, versión, fixture, final real, caracteres, duración y tokens disponibles
como `evaluationResult`; una salida parcial, un modelo desconocido o un modo
manual/sandbox/traza queda `not_scored`. No existe score numérico, ranking ni
ejecución nueva.

`F4.3-T6` hace visible esa evidencia sin activar evaluaciones. Laboratorio lee
una vez los últimos 100 trabajos al abrirse y sólo repite la lectura mediante
**Actualizar**; no sondea. Un parser puro acepta exclusivamente resultados con
esquema válido y coherentes con ID, versión y modelo del trabajo. La pantalla
muestra hasta 12 recientes con estado, checks, duración, caracteres y tokens, o
explica que todavía no existe ninguno.

`F4.3-T7` habilita la primera ejecución individual únicamente para los cuatro
modos automáticos. Exige máquina conectada, proyecto, familia soportada, modelo
exacto, casilla de consumo y un segundo diálogo que repite prueba/modelo. El
Gateway vuelve a validar catálogo y prompt, rechaza runners pendientes y evita
crear otra evaluación cuando ya observa una activa del mismo Studio. No es un
bloqueo transaccional entre solicitudes simultáneas: esa garantía exigiría otra
estrategia de persistencia. El agente mantiene el trabajo sin worktree,
herramientas, memoria ni checks del proyecto.

`F4.3-T8` completa el ciclo visible sin introducir polling. Un parser separado
identifica evaluaciones no terminales con snapshot válido; Laboratorio muestra
ID, prueba, modelo y estado, y permite solicitar cancelación tras confirmación.
La misma sesión no repite esa solicitud. Cuando el agente confirma el cierre,
Gateway persiste `evaluationResult.status: not_scored` y
`responseOutcome: cancelled`, incluso sin texto parcial.

`F4.3-T9` cubre finales operativos restantes. Un fallo informado por el agente
genera `evaluationResult: not_scored` y `responseOutcome: failed`. Los motivos
de no puntuación ya distinguen truncamiento, interrupción, timeout, cancelación,
fallo y ausencia de final declarado. Un trabajo terminal con snapshot válido
pero sin `evaluationResult` —por ejemplo, un lease expirado o Gateway anterior—
se muestra como **Sin resultado validado** y no se reescribe.

`F4.3-T10` agrega evidencia por prueba, versión y modelo. No publica tasa hasta
tener 3 resultados puntuados; `not_scored` cuenta como muestra observada pero se
excluye de tasa y medianas. No hay ranking ni recomendación.

`F4.4-T1` añade el contrato de comparación controlada sin exponer aún interfaz:
un UUID enlaza los índices 0 y 1, y Gateway sólo acepta el segundo si coincide
con el primero en prueba/versión, prompt exacto, máquina y proyecto, usando un
modelo exacto distinto. La ejecución individual mantiene su exclusión anterior.
La comprobación lectura-creación no es transaccional; la futura orquestación debe
mostrar una aceptación parcial y no asumir atomicidad.

`F4.4-T2` conecta esa orquestación en Laboratorio. La persona elige modo, dos
modelos y confirma una sola vez; Desktop envía miembro 0 y luego 1. Un rechazo
del primero detiene el par y uno del segundo deja el primero visible como estado
parcial, sin reintento. La presentación conjunta por UUID quedaba para `F4.4-T3`.

`F4.4-T3` cierra esa presentación: el historial valida UUID/índice juntos y
reconstruye A/B exclusivamente por esa identidad. El panel conserva pares
parciales, estados activos, `not_scored` y terminales sin resultado. Duplicados o
pruebas/versiones mezcladas se marcan inválidos; no hay emparejamiento por fecha
ni ganador automático.

`F4.5` queda cubierto sin una migración adicional: `jobs` ya conserva prompt y
respuesta completos, y `evaluationResult` conserva snapshot, modelo efectivo,
checks, final, caracteres, duración y tokens. Laboratorio reúne esa evidencia en
un detalle colapsado. `failed/not_scored` sustituyen cualquier nota numérica
subjetiva.

`F4.6` añade recomendación local provisional. Exige dos modelos con tres
resultados puntuados de la misma prueba/versión. Prioriza tasa; mediana sólo para
`timing`; feedback repetido de conversaciones completadas del mismo proyecto
sólo desempata. Empates e insuficiencia no producen recomendación y seleccionar
el modelo no ejecuta nada.

La primera validación visual detectó una ambigüedad: el selector permitía elegir
Frontend, cuyo runner manual está bloqueado, y por eso deshabilitaba confirmación
y botón. Se corrigió separando las cuatro opciones ejecutables de las ocho fichas
del catálogo. No se relajó la política de runners.

La primera prueba de comparación devolvió `422` porque el Worker remoto aún era
anterior al contrato A/B. Tras renovar la sesión Cloudflare de la cuenta correcta,
se desplegó el Worker existente y `/health` confirmó que responde. Falta repetir
la prueba funcional desde Desktop con el agente reiniciado.

Estimación de alcance a 2026-08-09, sujeta a validación manual y decisiones de
producto:

- Modelos/Laboratorio: **100% implementado; validación manual pendiente**;
- Luxy Studio v1 de escritorio, excluyendo Mobile: **72–76%**;
- roadmap completo actual, incluyendo Proyectos avanzados, Playground, Flujos y
  Android: **44–49%**.

El porcentaje completo es menor porque las fases 3, 5, 6 y 7 siguen planificadas;
no invalida que el núcleo de Studio ya sea utilizable.

El bloque de respuestas largas (`P0.0`–`P0.9`, incluido el artefacto de
`P0.6c`) está implementado y automatizadamente verificado. Su validación manual
en Studio permanece separada en `LA-012`; no bloquea corregir el catálogo.
