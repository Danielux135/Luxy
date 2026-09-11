# Roleplay con estado — investigación y plan

Investigación del 2026-09-10 sobre cómo mejorar la parte de roleplay con memoria
de la bóveda privada. **Es un plan, no está implementado.**

Se hizo con dos barridos en paralelo: uno mapeando el código actual y otro
peinando lo que hace la industria (9 agentes, 437 búsquedas, 99 mecanismos que
Luxy no tiene). Este documento es la síntesis, no el inventario.

## El diagnóstico, en una frase

**Lía sólo ve cuatro intercambios.** `VAULT_RECENT_TURNS = 8` en
`packages/shared/src/vault-prompt.ts`, y todo lo anterior sólo sobrevive si el
modelo lo metió en el resumen. Si la escena empezó hace doce turnos, no sabe
dónde estáis ni qué lleva puesto — no porque falte una capa de «ropa», sino
porque esa información salió por la ventana y no hay ningún sitio donde
guardarla.

Dos agravantes medidos:

- **el resumen se reescribe entero en cada turno**, así que a los veinte turnos
  ha pasado por veinte compresiones sucesivas (`D-058`);
- **su vocabulario es de tarea, no de escena**: hechos, decisiones, plan,
  preguntas abiertas. No hay hueco para lugar, hora, ropa ni postura; todo eso
  compite por doce ranuras de 240 caracteres pensadas para otra cosa.

## Tres cosas que llamamos «memoria» y se comportan distinto

Mezclarlas es el error de base. Cada una tiene una forma, un ritmo y un coste:

| | crece | se consulta | coste por turno |
| --- | --- | --- | --- |
| **Estado** — cómo están las cosas ahora | no: **se sustituye** | **cada turno** | ~40-150 tokens |
| **Recuerdos** — qué pasó | sí, sin parar | a veces | según lo que se traiga |
| **Ventana** — los últimos turnos literales | no | siempre | ~1.950 tokens medidos |

**Sólo falta la primera**, y es la que arregla las fotos: hoy la escena de cada
imagen se la inventa el modelo desde cero porque no hay de dónde leerla.

No es una intuición nuestra. **Kindroid tiene exactamente eso** y lo llama
*current setting*: un campo de 160 caracteres, separado de la memoria y del
trasfondo, que su documentación describe para «lugar, hora (incluso ficticia),
vestimenta y actividad actual».

## Arquitectura: dos niveles de modelo

La idea es de Daniel y cambia el plan entero. La pasarela de pago **cobra por
llamada, no por token** (verificado contra facturas, `DECISIONS.md`), así que
cualquier diseño con una segunda llamada por turno duplica el coste. Eso
descartaba de golpe medio sector.

La salida: **usar las suscripciones ya pagadas (Claude Code, Codex) para el
trabajo auxiliar**, y dejar la API de pago sólo para el turno de roleplay.

| nivel | quién | cuándo | qué hace |
| --- | --- | --- | --- |
| **de pago** | DeepSeek u otro sin filtros | en el momento | el turno de roleplay. **Una** llamada |
| **suscripción** | Claude Code / Codex | **entre** turnos | consolidar recuerdos, puntuar relevancia, catalogar escenas |

**Medido: un turno trivial del CLI de Claude tarda 16 s**, casi todo arranque
(Codex por su tubería, 11 s). Eso descarta poner trabajo auxiliar *dentro* del
turno —serían 15 s de espera en cada mensaje— y lo habilita **después** de
entregar la respuesta, mientras el usuario la lee. Luxy ya hace exactamente eso
con el catalogador de escenas: esto lo generaliza.

### El estado no necesita ninguno de los dos

Y aquí está el hallazgo que abarata todo. Varias extensiones de SillyTavern
—SimTracker, zTracker, el modo *inline* del Tracker de kaldigo— hacen que **el
modelo escriba el bloque de estado dentro de su propia respuesta**, en el mismo
turno que ya se paga. Cero llamadas extra, cero latencia.

Es **el transporte que Luxy ya usa** para la memoria acumulativa: el modelo
escribe su bloque y el código lo separa del texto visible. Sólo falta el
contenido.

Dos consecuencias de diseño que vienen con ese patrón:

- **el estado se re-inyecta cerca del FINAL del prompt.** Varios barridos
  coinciden: el canal de dirección va al final porque es lo que gobierna la
  respuesta inmediata. Identidad delante, estado pegado al mensaje;
- **cuelga del turno, no de la conversación.** Así, editar o retroceder devuelve
  el estado solo a lo que era. Luxy ya sella por turno en el mismo `.jsonl`, así
  que el patrón encaja sin inventar nada.

## El plan, por fases

### 1. Medir — **HECHA** (2026-09-10)

`composeVaultPrompt` devuelve los bloques etiquetados y `measureVaultPrompt`
los ordena de mayor a menor con su porcentaje. `buildVaultPrompt` se conserva
como envoltorio, así que **el texto que ve el modelo es idéntico byte a byte**:
lo fijan las 25 pruebas que ya existían, que pasaron sin tocar ninguna.

Cada turno privado registra ahora el tamaño de cada bloque —nunca su contenido—
en `prompt privado compuesto`. Ocho pruebas nuevas, incluida la que impide que
las etiquetas se cuelen en el prompt.

Era lo único de lo que dependen las demás fases: sin números por bloque,
cualquier presupuesto es una opinión. A partir de la próxima conversación real
hay medidas en vez de estimaciones.

### 2. El estado de escena

Lugar, hora de ficción, ropa de cada uno, postura o actividad, quién más está
presente, y cómo están las cosas entre los dos.

Cuatro decisiones, cada una con su motivo:

- **un solo bloque de salida, no cinco.** Cinco etiquetas multiplican por cinco
  la superficie de truncado y de parseo. Un bloque con sub-objetos conserva la
  atomicidad que ya compró `D-019`;
- **deltas** («se quitó el jersey»: ~15 tokens frente a ~150 de reescribir el
  estado entero), **con refresco completo cada N turnos**. Sin el refresco, un
  delta perdido descuadra el estado para siempre y en silencio;
- **procedencia**: si cada dato lo estableció el usuario o lo dedujo el modelo.
  Es la vacuna contra `D-061` a escala industrial — una capa de estado captura
  el detalle inventado *siempre*, por diseño;
- **editable a mano.** Un estado equivocado es muy visible («estás en la cocina»
  cuando la escena se mudó) y hoy no hay forma de tocarlo.

Y una quinta que salió de una pregunta de Daniel, y que habría entrado rota si
no la hace:

- **fuera de personaje, el estado no se toca.** Él quiere poder tratarla como a
  una persona *y* poder romper la cuarta pared: decirle que es un personaje de
  roleplay y hablarlo con ella. Si eso ocurre y el estado sigue escribiéndose, una
  charla meta contamina la escena — la ropa, el sitio y la hora se llenan de
  cosas que no pasaron en la ficción, y como el estado se re-inyecta en cada
  turno, esa basura se queda.

  Así que el bloque necesita marcar el turno como fuera de personaje y, en ese
  caso, **congelar la escena**: no actualizarla y retomarla donde estaba. Barato
  si se diseña desde el principio, un lío si se añade después.

**Grande.** Es el corazón del plan y lo único que no se puede hacer a medias:
media capa de estado, escrita a veces, es peor que ninguna.

#### Salir del personaje, por conversación

La directiva de encarnación ya dice hoy que no se presente como asistente
«salvo que el usuario pregunte por ellas de forma directa». La puerta existe,
pero depende de que el modelo juzgue si la pregunta fue «directa»: eso es una
interpretación, no un interruptor.

El sitio natural para convertirlo en decisión suya son las **instrucciones de la
conversación**, que ya existen, ya son por hilo y las escribe él. Tres formas, y
cada conversación con la suya: que no salga nunca del personaje, que salga si se
lo pide, o que sepa lo que es y pueda hablarlo. Al ser instrucciones y no código,
se puede cambiar a mitad de conversación sin tocar nada.

### Recordar por fecha — **HECHO** (2026-09-11), fuera del orden previsto

No estaba en el plan y deberia haberlo estado: la investigacion lo encontro con
nombre propio —*time-aware query expansion*, +11,3% de recuperacion por sesion— y
se descarto por costeado con una llamada a modelo, sin ver que la version por
patrones, al lado en la misma ficha, costaba cero. El motivo de fondo fue peor:
el plan se escribio alrededor del diagnostico propio y no de lo que Daniel le
pregunta a Lia. Lo destapo el, pidiendo «¿te acuerdas de lo que hablamos el
jueves?».

`packages/shared/src/temporal-reference.ts`, puro, con el reloj INYECTADO.
Entiende hoy, ayer, anteayer, las partes del dia, anoche, los dias de la semana
con «este» y «pasado», la semana pasada, «hace N dias/semanas» y el principio. El
dia civil empieza a las 05:00, y «el jueves» dicho en jueves es HOY.

En `recall.ts` la fecha va ANTES que la busqueda por palabras —«jueves» no
comparte ni una palabra con lo que se dijo ese jueves— pero **una fecha sola no
basta**: tiene que preguntarse por algo dicho. Sin eso, «hoy me duele la cabeza»
sacaba la transcripcion de la conversacion de hoy. Ese fallo lo introduje yo y lo
detecto la suite del subagente, que ademas corrigio el alcance del fallo UTC que
yo habia descrito mal: en España el corte en UTC acierta por la noche y se
equivoca de medianoche a las cinco.

Pendiente, y es lo que de verdad lo hara listo: **que elija Lia** entre los
candidatos de un dia en vez de citar el mas largo, y **enriquecer el catalogo**
—hoy una escena guarda solo `from`, `to` y un titulo de una linea, asi que
cualquier seleccion elige con casi nada—.

### 3. Recuperar los tokens del bloque de imagen

Las instrucciones de imagen ocupan **~2.050 tokens en cada turno**, se pida foto
o no. Pueden bajar a ~300 salvo en el turno donde de verdad se pide una.

**Mediano.** Ahí está financiada toda la memoria nueva sin subir el techo.

### 4. El puente con las fotos

La escena sale del **estado**, la identidad de la **receta**, y se ensamblan por
código. Hoy el modelo escribe toda la escena en texto libre y hubo que quitarle
deterministamente colores de pelo y orígenes que se colaban
(`stripConflictingTraits`).

Además: **la foto se congela con el estado del turno que la pidió**, y el turno
deja de bloquearse esperando a AI Horde.

**Mediano**, salvo la parte de no bloquear el turno, que es grande.

### 5. La ventana de turnos

Ampliar los 8 turnos actuales. Con cobro por llamada es **gratis en dinero**;
no lo es en atención del modelo, así que va después de medir.

**Pequeño**, pero requiere juicio humano sobre conversaciones reales.

### 6. Consolidación asíncrona

En el nivel de suscripción: dejar de reescribir el resumen en cada turno
(`D-058`) y consolidar en tandas. Añadir puntuación por relevancia, recencia e
importancia para decidir qué recuerdos entran — es aritmética local sobre
metadatos que ya existen, tal y como lo hacen los *Generative Agents* de
Stanford.

**Mediano.**

### 7. Tiempo y lo proactivo diferido

Con estado ya hay reloj de ficción. Y lo proactivo se vuelve un remate barato.

**Decidido con Daniel el 2026-09-10:** mientras esto viva en la bóveda de Luxy,
**la llave no se mantiene viva sin él**. Así que el personaje no escribe cuando
quiere: el temporizador anota que tenía algo que decir a tal hora y ella lo saca
al abrir la bóveda. Da casi todo el efecto sin tocar la seguridad.

Cuando esto se mueva a un teléfono, esa decisión se vuelve a tomar allí.

Otras dos reglas que salen de ahí:
- **la notificación no lleva su texto.** Iría a la pantalla de bloqueo y al
  centro de notificaciones, fuera de la bóveda, donde lo ve cualquiera;
- **nunca sale por Telegram.** Lo privado no toca la pasarela.

Y como cada mensaje proactivo es un turno de pago completo, la configuración
necesita **tope diario**, no sólo frecuencia.

## Lo que se descarta, y por qué

| descartado | motivo |
| --- | --- |
| Índice vectorial local | modelo en disco, minutos de indexado, y el índice léxico actual puede bastar. Se revisa si falla de forma demostrable |
| Grafo de conocimiento (Zep / Graphiti) | varias llamadas de modelo por episodio: el más caro de los 99 |
| Relación gamificada con XP y niveles (Replika) | convierte a una persona en una barra de progreso |
| Antirrepetición por muestreo (DRY, XTC) | no existe sobre HTTP, sólo en modelos locales |
| IP-Adapter / InstantID para identidad facial | exigen GPU propia, que no es el camino actual |
| Cinco bloques separados en la respuesta | multiplica por cinco la superficie de truncado |
| Cualquier segunda llamada **dentro** del turno de pago | duplica la factura con cobro por llamada |

## El riesgo que no arregla ninguna fase

Hay trabajo académico entre los hallazgos que dice algo incómodo: en
conversaciones largas **el diálogo converge hacia la voz del modelo, no hacia la
del personaje**. Y el andamiaje ayuda a eso: cuantos más bloques de campos se
metan, más probable es que el personaje suene a formulario.

Es el único fallo de la lista que **pasa el `npm run check` entero y llega a
producción intacto**, y además es gradual: no hay un turno en que se rompa. La
única defensa es el juicio humano repetido sobre conversaciones reales.

Un aviso de coste que salió medido, en la misma línea: una de las extensiones de
tracker declara **~9.000 tokens por generación** con sus ajustes por defecto. Ese
es el precio de hacerlo mal — esquema enorme con ejemplos en cada turno. Por eso
el presupuesto por bloque es la fase 1 y no el remate.

## Fuentes principales

- Kindroid — *current setting*, memoria en cascada, entradas de diario
- SillyTavern — World Info / Lorebooks, Author's Note e inyección a profundidad,
  y las extensiones Tracker (kaldigo), SimTracker, zTracker, Story Tracker,
  ScenePulse, ST-Outfits, Qvink Memory, Guided Generations
- Chub / Venus — *Stages*, estado por mensaje con restauración al retroceder
- Character.AI — presupuesto de memoria visible con contenido del usuario
  protegido de la expulsión
- Generative Agents (Park et al., UIST 2023) — puntuación recencia × relevancia
  × importancia, y el ciclo de reflexión
- MemGPT / Letta, mem0, Zep / Graphiti, A-MEM, MemoryBank
- Dialogue State Tracking y StateAct — el mecanismo más barato de todos
- LongMemEval, LoCoMo, STALE — evaluación y el hueco de la actualización
