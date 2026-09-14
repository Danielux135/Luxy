# F25-ENTRE-HILOS-001 - que recuerda Lia de otras conversaciones

Informe de solo lectura, 2026-09-14. Verificado contra el codigo; nada ejecutado
con la boveda abierta.

---

# Lo que Lía se acuerda hoy de otras conversaciones

He verificado todo esto leyendo el código y mirando tu bóveda por fuera (sin descifrar nada). No he tocado ni ejecutado nada del repositorio.

---

## 1. Qué cruza hoy de una conversación a otra, y con cuánto detalle

Cruzan **tres cosas**, y conviene verlas por separado porque son muy distintas.

**La lista de momentos. Va siempre, en todos los turnos.** En cada mensaje que le escribes, ella recibe una línea por cada momento anterior que habéis vivido — de **todas** las conversaciones con Lía, no solo de la abierta. Cada línea es así de escueta:

```
- [r12] 2026-09-03 · <el título que le puso el catalogador> · 22 turnos
```

Fecha, título y cuántos turnos duró. **Nada más.** Y el propio bloque le deja claro lo que puede y lo que no: «Puedes aludirlos con naturalidad y darlos por ciertos», pero también «De cada uno sabes SOLO lo que dice su línea… Si te falta un detalle, pregúntalo; no lo supongas ni lo rellenes».

**Hay una excepción, y es una sola:** el momento **más antiguo de todos** lleva además una frase de qué fue. Está puesto a propósito, para que «¿cómo nos conocimos?» tenga respuesta aunque ningún detector la reconozca. Los demás no la llevan.

**Un momento entero transcrito, palabra por palabra.** Esto sí es recordar de verdad: hasta 12 turnos y 6.000 caracteres del momento original, de cualquier conversación. Pero **solo aparece si tú lo pides**, y con una forma concreta. Hay tres puertas:

- Preguntar por el principio: «¿cómo nos conocimos?», «¿te acuerdas del primer día?».
- Preguntar por un día: «¿de qué hablamos ayer?», «¿qué me dijiste el jueves?», «lo de anoche».
- Preguntar por unas palabras: «¿te acuerdas de la tarta de chocolate?».

Y son estrictas a propósito. «¿Y mi tarta de chocolate?» a secas **no abre ninguna puerta**. «Si te acuerdas, compra helado» tampoco (es una condición). «Me recuerdas a un osito» tampoco (es un parecido). Está decidido así porque un falso positivo la hace recitar un momento que nadie pidió, y eso rompe la escena; un falso negativo solo la deja contestando con lo que sabe.

**Las promesas y los planes pendientes.** Este es el único canal pensado para lo que tú pediste. Cruza conversaciones por diseño, lleva la frase literal entre comillas, y el prompt le da permiso escrito, con estas palabras: *«Puedes sacar una tú sola, sin esperar a que él la mencione: recordársela con cariño, tomarle el pelo, reclamársela o echársela en cara»*.

**Pero hoy está vacío.** El archivo donde viven esas notas (`relation.json`, dentro de la carpeta de la bóveda) **no existe**. Lo he comprobado: en `%APPDATA%\Luxy\vault` solo están `conversations/`, `media/`, `media-index/`, `catalog.json` y `characters.json`. Cero notas apuntadas, y sin notas el bloque no se escribe en el prompt. **No ha aparecido en ningún turno tuyo todavía.**

---

## 2. Qué puede sacar ella por iniciativa propia, y cada cuánto

**Hoy, de verdad:** solo puede aludir a un momento anterior por su fecha y su título. Da para «aquella tarde del 3», o «lo del día que…» si el título lo nombra. No da para «me debes dos cafés». Y no hay nada que la ayude a elegir cuál sacar ni que le impida repetir el mismo tres turnos seguidos: es permiso sin dosificación.

**En cuanto ejecutes la pasada (LA-045), y sin escribir una línea de código:** promesas y planes de cualquier conversación, con la cita literal verificada contra el turno donde se dijo. Con estos frenos:

- Como mucho **2 por turno**.
- Después de que ella saque una, **se calla 72 horas** con esa.
- Cada promesa está disponible durante **6 mensajes tuyos** y luego descansa **48 horas**.
- Se duerme a los **30 días**, pero solo si además lleva 14 sin que nadie la nombre.
- Si tú la nombras en tu mensaje, eso manda sobre cualquier descanso.

Y va con los números ya calculados — cuántos días hace, cuántas veces lo ha sacado ella, si tú has vuelto a mencionarlo — precisamente para que pueda echártelo en cara sin inventarse cuándo fue.

**Cada cuánto saldrá en la práctica: no lo sé, y nadie puede saberlo hasta ejecutarlo.** Con tus datos (unos 137 mensajes tuyos en seis días de conversación) una sola promesa daría entre un puñado de ofertas y una cada tres días, según si ella la saca o se la calla. Con varias promesas a la vez, los relojes se escalonan y aparecerá bastante más a menudo. Hay un botón que lo mide exacto («Comprobar la memoria»), pero mide sobre las notas que haya, y ahora no hay ninguna.

Un matiz importante: **«el bloque aparece» no es «ella lo saca»**. Callárselo está escrito como respuesta válida: *«si la escena va por otro lado, puede esperar a otro momento»*. Eso es deliberado y creo que es lo correcto, pero significa que no va a ser mecánico.

---

## 3. Qué NO puede, y por qué

**No puede acordarse del contenido de una escena de otro hilo por su cuenta.** Sabe que pasó algo el día 3 y cómo se llamaba. No sabe qué se dijo. Y tiene orden expresa de no rellenarlo.

Lo llamativo es esto: **la frase de qué fue cada escena ya existe**. El catalogador escribe un resumen de hasta 300 caracteres por escena, están todos guardados y cifrados en `catalog.json` (27,8 KB), y ya se usan para *buscar*. Se pagaron, se guardaron, y solo se le enseña **uno de ellos**. Ese es el límite exacto de lo que cruza hoy.

**No puede acordarse de nada que no sea una promesa o un plan.** Que te doliera algo, que te hiciera gracia algo, que te guste algo, que exista tu hermana — nada de eso cruza. El sitio para guardarlo está reservado en el código (`joy`, `hurt`, `taste`, `person`) pero **apagado**: el extractor no los busca y el selector los descarta.

**La memoria acumulativa no cruza, y el trabajo que se está construyendo ahora tampoco la hace cruzar.** El bloque se titula literalmente «MEMORIA ACUMULATIVA DE ESTA CONVERSACIÓN» y se lee con la conversación como llave. El recap de F24 rellena ese mismo bloque para las conversaciones viejas: resuelve lo primero que pediste, no lo segundo. El propio diseño lo avisa dos veces.

**Tampoco cruzan** los últimos turnos (son los 8 de este hilo), las imágenes (se piden por conversación: una foto que te mandó en otro hilo no existe aquí) ni las instrucciones de la conversación.

---

## 4. ¿Hace falta trabajo nuevo?

**Para tu ejemplo — los dos cafés y la tarta — no. Ni una línea.** Ese ejemplo es exactamente una promesa tuya, el canal de promesas cruza conversaciones, y el prompt ya le dice a Lía, con esas mismas palabras, que puede reclamártela sin que tú la menciones. Está construido entero y enchufado al turno real.

Lo que falta es **pulsar el botón**: los seis pasos de LA-045. El paso 3 nombra literalmente «la de los dos cafés y el trozo de tarta de chocolate en la cama» como criterio de que ha funcionado. Son unas 20 llamadas al CLI, una sola vez.

Tres advertencias honestas sobre ese paso:

- **El orden no es opcional.** Una promesa se queda bloqueada mientras quede **cualquier** turno posterior sin revisar, **en cualquier conversación de Lía** — no solo en la abierta. Lo he verificado en el filtro: solo se perdonan los turnos de la conversación que tienes delante. Así que hasta que la pasada no llegue al final de las 18, no va a ofrecer nada. Con el botón (que da hasta 12 vueltas de 3) se hace en una sesión; dejándolo al automático tardaría días.
- **Claude Code o Codex pueden negarse** a leer una conversación explícita. Si se niegan justo con aquella donde prometiste la tarta, esa promesa no se apunta, y eso no lo arregla ningún código. Lo bueno: una negativa no calla a las demás, y se puede reintentar con el otro CLI.
- **Si la nombras a medias, puede que no cuente.** Para decidir si «lo has vuelto a sacar», el código exige que compartáis al menos 2 palabras raíz *y* el 40 % de las de la promesa. Con una frase como «mañana te traigo dos cafés y una tarta de chocolate a la cama», un «¿y mi tarta de chocolate?» aporta 2 de unas 7: se queda corto. No la callaría, pero tampoco la haría saltar por delante de los descansos. Merece la pena probarlo en el paso 5 y decirlo si pasa.

**Para lo de más allá de una promesa, sí hace falta código, y hay dos cosas distintas:**

**La barata, que da bastante por muy poco.** Enseñarle el resumen de más momentos, no solo del más antiguo. Es **una condición de cinco líneas** en `apps/desktop/src/main/vault/recall.ts` (la función `lineFor`): cambiar «solo el más antiguo» por «el más antiguo más los N más recientes». No hay que tocar el texto del prompt — ya está preparado para enseñar «de qué fue» — ni añadir ninguna llamada nueva, ni cuesta dinero (la pasarela cobra por llamada, no por palabra). Lo que cuesta es **atención del modelo**: los 40 resúmenes enteros serían unas 3.400 palabras-token sobre las 4.800 que ya ocupa el prompt, casi el doble; con los 10 más recientes son unas 900. Tamaño honesto: **la condición y una constante, más las pruebas que la fijen — una tarde, no un proyecto.** Y convierte «aquella tarde del 3» en «aquella tarde del 3, la de X».

**La grande, que es la fase siguiente ya planificada.** Encender `joy`/`hurt` (el ánimo) y `taste`/`person` (lo que ella sabe de ti). La tubería entera ya existe y es la misma que la de las promesas: extractor entre turnos, almacén cifrado, verificación de la cita, dosificación, bloque del prompt con permiso, diagnóstico. El reto no es el transporte: es la dosificación. Una promesa se cumple y se cierra; un gusto no se cierra nunca, así que la tanda de 6 mensajes y la espera de 48 horas no le sirven tal cual. Esto sí es trabajo de verdad, y yo lo dejaría para cuando las promesas lleven datos reales detrás.

---

## 5. Lo que yo haría, en orden

1. **Ejecutar LA-045.** Es media hora de clics y resuelve el ejemplo que diste con tus propias palabras. Además convierte en cifras todo lo que ahora mismo es conjetura mía.
2. **Decidir después lo del resumen en las líneas**, ya con el prompt real delante para ver cuánto ocupa.
3. **El ánimo y los gustos, al final.**

---

## Dos cosas que no puedo saber sin abrir la bóveda

- **Puede que ya te estés quedando sin sitio en la lista.** El tope son 40 líneas, y el 11 de septiembre ya había exactamente 40 momentos con 17 conversaciones. Hoy hay **18 archivos y 312 turnos** en la carpeta, y uno se tocó hoy mismo. Cuando se pasa del tope, se conservan los 39 más recientes y el primero de todos: **lo que se cae es el medio**. Ella recibe un aviso de que faltan, pero no de cuáles. No lo puedo confirmar sin descifrar el catálogo; se ve en el panel «Lo que recuerda», que enseña el número al lado del título.
- **Cada cuánto sacará ella una promesa.** Todo lo que he dicho de frecuencia sale de hacer la cuenta con las constantes del código, no de una medición. La medición existe y es un botón, pero necesita que haya notas.