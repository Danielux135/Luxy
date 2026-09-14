# Las llamadas vacias de DeepSeek: por que un turno gasta 2 o 3

Informe de solo lectura, 2026-09-14. Sin llamadas a ninguna API. Tres agentes
recogieron evidencia, uno intento tumbar la hipotesis del tamano del prompt y
otro defenderla: **los dos la refutaron**.

---

# Lo que ha pasado hoy con Lía

## 1. Qué está pasando

**Cuando el proveedor tarda más de cinco minutos en decir la primera palabra, Luxy cuelga solo y vuelve a llamar desde cero — y esa segunda llamada te la cobran entera, aunque la primera ya la hubieras pagado.**

Los cinco minutos no los eligió nadie. Son el valor de fábrica de la parte de Node que hace las llamadas por internet, y en todo el proyecto no hay una sola línea que lo cambie (lo he comprobado: no existe ninguna configuración de tiempos de red en `apps` ni en `packages`). Node es la v24.19.0 y ese límite son 300.000 milisegundos exactos. Dos de las tres llamadas vacías de hoy murieron a los **302 y 300 segundos**. Encaja al segundo.

Lo que ocurre después es lo caro: el error que sale de ahí no trae código de estado, y el filtro de reintentos de Luxy dice, literalmente, que sin código de estado se reintenta. Así que Luxy reenvía el prompt entero, hasta tres veces. **Los reintentos son de Luxy, no del proveedor.** Lo confirman los huecos entre las filas de tu captura: 2, 4 y 5 segundos, que es exactamente la espera programada de Luxy entre intentos.

La tercera llamada vacía murió a los 268 segundos, por debajo de esa raya: a ésa la cortó el otro lado. Son dos formas distintas de morir, y las dos acaban en lo mismo: otra llamada pagada.

## 2. Cuánto te cuesta

**Hoy**, hasta ahora: 8 turnos de Lía, **11 llamadas cobradas = 76,29 ¥**. De esas, **3 no devolvieron ni una palabra: 20,81 ¥ tirados**. Tu captura era de un momento anterior del día, con 8 llamadas, y cuadra al céntimo: 55,48 ÷ 6,935 = 8,00 exacto.

**En todo el registro** (del 4 al 14 de septiembre, 60 turnos de DeepSeek con contador fiable): 73 llamadas pagadas para 60 turnos. **13 llamadas de más = 90,16 ¥ desperdiciados de 506,26 ¥ gastados. Un 18% de todo lo que pagas por Lía no compra nada.**

Y ese 18% es un suelo, no un techo: hay **7 turnos más de DeepSeek en los que el contador quedó a cero** porque el turno falló antes de guardar métricas. Esas llamadas se pagaron igual y no constan en ninguna parte. Podrían ser entre 7 y 21 llamadas invisibles (hasta 145 ¥).

**Estimación mensual** (y es una estimación, con mucho margen): 6 días de juego en el registro han producido 90 ¥ de desperdicio, unos 15 ¥ por día jugado. Si juegas veinte días al mes, son **~300 ¥ al mes que no compran respuesta**.

**Lo que cuesta en espera**, que para ti probablemente pesa más: el turno de las 13:05 tardó **15 minutos y 26 segundos** en contestarte. El de las 13:17, **10 minutos**. Una respuesta sola hoy tarda entre 2m45 y 6m08.

Hay otra pérdida escondida: **el registro y el presupuesto solo apuntan los tokens de la llamada que salió bien**. Ese turno de tres llamadas figura con 7.601 tokens de entrada cuando de verdad se pagaron 22.835. O sea que el gasto que Luxy cree llevar es sistemáticamente menor que el real, y el presupuesto diario nunca va a frenar esto.

## 3. ¿Es el tamaño del prompt?

**No. Y esta vez no es «no hay datos suficientes»: los datos van en contra.**

Lo he comprobado yo mismo sobre el registro entero (1.487 líneas, 0 mal formadas, 67 turnos de DeepSeek, 58 con tokens y cuenta de llamadas a la vez).

Lo más claro está dentro del propio día de hoy:

| prompt (tokens) | qué pasó |
|---|---|
| 7.792 | 1 llamada, 184 s — **cuatro minutos antes del primer fallo** |
| 7.784 | 1 llamada, 163 s |
| **7.601** | **3 llamadas, 2 vacías** |
| **7.155** | **2 llamadas, 1 vacía** |
| 6.757 | 1 llamada, 222 s |
| 6.474 | 1 llamada, **368 s — la más lenta del día** |

Los dos prompts **más grandes** de hoy salieron a la primera y rápido. Los que fallaron eran **más pequeños**. Y el más pequeño de todos produjo la llamada más lenta. Un techo que deja pasar 7.792 y mata 7.601 no es un techo de tamaño.

Fuera de hoy, lo mismo: **nueve turnos históricos con prompt mayor que el que hoy gastó tres llamadas, y siete salieron a la primera** — 9.321 tokens en 138 segundos, 8.940 en 91, 8.230 en 60. Y al revés: el prompt **más pequeño de todo el registro** (4.042 tokens) también gastó una llamada de más.

Los números: la correlación entre tamaño del prompt y «el turno gastó llamadas de más» es **0,025** (o sea, nada; p = 0,85). El prompt medio de los turnos limpios es 6.603 tokens; el de los turnos con llamada extra, 6.684. Ochenta tokens de diferencia.

Y hay un detalle que lo remata: **hoy el prompt ha ido encogiendo a lo largo del día** (de 21.302 a 16.933 caracteres) **mientras las llamadas se alargaban**.

**Lo que sí ha cambiado hoy es la velocidad del proveedor.** A igual tamaño de prompt, hoy la mediana es **203 segundos por llamada** frente a **61 segundos** los días anteriores — tres veces y media más lento, y eso sí es sólido estadísticamente (p = 0,002). Va lento todo el día, de las 11:32 a las 17:40, con prompts de todos los tamaños. Separando el efecto del día del efecto del prompt: **el día explica el 54% de la variación de la espera; el tamaño del prompt, el 2%.** El prompt añade unos **2,3 segundos por cada 1.000 tokens** (con un margen honesto de −7 a +11,5).

Un dato más, del propio proyecto: el catálogo anota que este modelo tardaba **~206 segundos en contestar a una petición trivial**, medido el 29 de julio. Ya vivía a tres minutos y medio de la pared con un prompt minúsculo.

**El dato que lo zanjaría, y es gratis:** que Luxy apunte **una línea de registro por llamada**, con el tiempo hasta la primera palabra, el tamaño del prompt enviado y por qué murió si murió. Ahora mismo solo se apunta una línea por turno, así que **de las tres llamadas que murieron hoy no queda constancia de nada** — ni de por qué, ni de cuántos tokens se pagaron. Con ese registro, en una semana de juego normal la pregunta se contesta mirando una tabla, sin gastar una llamada de más y sin discutir.

Aviso honesto: no puedo descartar un efecto **pequeño** del prompt. Con 58 turnos solo detectaría con seguridad algo grande. Lo que descarto es un efecto del tamaño que haga falta para explicar esto.

## 4. Qué se puede hacer

Ordenado por lo que más quita a cambio de menos riesgo.

**1. Quitar el límite de cinco minutos que nadie puso.** Es un cambio en un sitio: decirle a Node que espere, por ejemplo, 15 minutos de silencio en vez de 5. Trabajo: pequeño, un rato. Lo que gana: **de las tres llamadas vacías de hoy, dos habrían vivido** — y probablemente habrían contestado, porque el reintento siguiente sí contestó, a los 304 segundos. Es la única medida que ataca la causa y no el síntoma. Riesgo: una llamada de verdad atascada tarda más en rendirse. Se controla poniendo 15 minutos, no una hora.

**2. No reintentar a ciegas una respuesta vacía.** Hoy ese error se considera reintentable porque llega sin código de estado; basta marcarlo como no reintentable, o dejar un solo reintento **avisándote en pantalla**. Trabajo: pequeño, y hay que tocar una prueba. Lo que gana: no te ahorra dinero por sí solo —si no reintenta, lo reenvías tú y pagas igual— pero **te devuelve la decisión**: sabes que ha pasado, y eliges si quieres pagar otra. Ahora mismo es invisible: solo se te avisa cuando el motivo es un límite de frecuencia. Combinado con el punto 1, es lo que cierra el agujero.

**3. Registrar una línea por llamada.** Hora de inicio, tiempo hasta la primera palabra, tokens enviados, cómo acabó. Trabajo: pequeño. Lo que gana: la próxima vez que pase esto no hace falta una captura de pantalla ni tres días de análisis. Y es lo que zanja la pregunta del prompt de una vez.

**4. Contar todos los intentos en el presupuesto, no solo el último.** Trabajo: pequeño. Lo que gana: que lo que Luxy cree que gastas coincida con lo que gastas. Hoy no coincide. Y como esta pasarela cobra por llamada y no por palabra, el presupuesto de Luxy —que multiplica tokens por precio— es **estructuralmente ciego** a esta tarifa: un contador de llamadas por día sería lo que de verdad te protege.

**5. Si el proveedor sigue lento, probar DeepSeek V4 Flash para el roleplay.** Está en el catálogo, es de la misma familia y no exige tocar código: se cambia el modelo por defecto. Gana velocidad; pierde razonamiento. Solo si la lentitud de hoy se instala.

**Lo que NO haría: recortar el prompt.**

Por tres razones. Una: **te cobran por llamada, no por palabra** — añadir texto al prompt no te cuesta ni un yuan de más. Dos: los datos dicen que el tamaño no es lo que dispara los fallos. Tres: lo único que compra el tamaño es latencia, y son unos 2 segundos por cada 1.000 tokens sobre llamadas que hoy tardan 250. Recortar el prompt sería pagar en calidad de la conversación por un problema que está en otro sitio.

**Tampoco tocaría el tope de una hora de Luxy** todavía. Sí hay un desajuste feo —Studio deja de esperar a los 30 minutos pero el agente sigue hasta la hora— pero con los puntos 1 y 2 hechos deja de importar, y cambiarlo ahora solo añade una variable más.

**Un cabo suelto que no puedo cerrar:** el turno del 11 de septiembre que duró 6 horas y 43 minutos. Ningún tope del sistema puede producir eso (los únicos son 5 minutos, 30 minutos y 1 hora), y sin embargo acabó marcado como «tiempo agotado», que solo lo escribe el reloj propio de Luxy. La única lectura compatible es que el ordenador estuviera suspendido casi todo ese rato: los relojes no avanzan con la máquina dormida. Lo acompaña que el registro **no escribe absolutamente nada entre las 17:49 y las 00:37**, seis horas y tres cuartos de silencio. Es la explicación que encaja, no una prueba.

**Otro cabo suelto, y éste es el que más me molesta:** de las 13 llamadas de más del histórico, solo las 3 de hoy son compatibles con la pared de los cinco minutos. Las otras 10 ocurrieron en turnos cuyas llamadas duraban **29, 32, 34, 39, 44, 46, 80, 123 y 135 segundos**: lejísimos de los 300. Es decir, **hay al menos una segunda causa de reintento que el registro no guarda en ninguna parte**. Los puntos 1 y 2 tapan la de hoy; el punto 3 es lo que permitirá ver la otra.

## 5. ¿Afecta esto a las promesas y a la memoria retroactiva?

**Empiezo por lo importante: no tuvieron nada que ver con lo de hoy.** El Studio que está corriendo en tu ordenador se construyó el **11 de septiembre a las 14:42**, y los dos bloques se han hecho **hoy**. No estaban en el programa cuando fallaron esas llamadas. Se ve también en el registro de composición del prompt: en los seis turnos de hoy no aparece ningún bloque «pendientes».

**En dinero: cero.** Esto es lo que hay que retener. La tarifa es por llamada, plana, 6,935 ¥ digas 100 palabras o 10.000. **Todo el texto que añadas al prompt es gratis en euros.**

**En espera: unos dos segundos.** He medido los dos bloques:

- **Promesas**: 1.411 caracteres de cabecera fija más dos líneas de contenido (el máximo son dos), entre 130 y 358 caracteres cada una. Total: 1.700-2.170 caracteres.
- **Memoria retroactiva**: su tope son 1.800 caracteres, pero **no es un bloque nuevo**: sustituye al bloque de memoria que ya existe, que hoy ocupa entre 473 y 670 caracteres. Así que lo que suma de verdad son 1.130-1.330 caracteres, no 1.800.

Los dos juntos: **unos 2.800-3.500 caracteres**, que con la calibración real que he sacado cruzando el registro con la factura (**tokens = 0,293 × caracteres + 1.519**, con un ajuste casi perfecto sobre 24 turnos) son **unos 830-1.020 tokens de entrada de más**. A 2,3 segundos por cada 1.000 tokens, eso son **unos 2 segundos de espera adicional**. En el peor caso de mi margen de error, unos 10. Sobre llamadas que hoy tardan 250-300 segundos, es ruido.

**Lo único que sí merece un vistazo, y es de diseño, no de coste:** de los ~1.900 caracteres del bloque de promesas, **1.411 son la instrucción** y solo 260-720 son las promesas en sí. Pagas tres cuartas partes del bloque en sermón para entregar dos líneas. No es un problema de dinero ni de tiempo; es que si algún día quieres adelgazar ahí, la grasa está en la cabecera, no en el contenido.

**Un aviso aparte que te va a venir bien para cualquier cuenta futura:** el campo `tokensEstimados` que Luxy escribe en el registro **se queda corto en unos 1.650 tokens, siempre**. Cuando el registro dice 6.087, la factura dice 7.784. El ritmo de crecimiento sí lo acierta (se equivoca un 3%), así que sirve para «cuánto añade este bloque», pero no para «cuánto estoy mandando».

**Conclusión sobre esto:** enchufa los dos bloques sin miedo. No compran llamadas vacías. Lo que conviene vigilar es otra cosa: el bloque de **turnos recientes** son los 8 últimos turnos **sin ningún tope de caracteres** —midan lo que midan—, y el bloque de **imagen** ya ocupa el 38% del prompt y crece ~250 caracteres por cada imagen que guardas. Ésos sí van a crecer solos. Pero mientras la tarifa sea por llamada, crecer solo cuesta segundos.

---

*No he escrito nada en el repositorio, no he ejecutado compilación ni pruebas, y no he hecho ninguna llamada a ninguna API. Los cálculos están en scripts fuera del repositorio, en `C:/Users/oscar/AppData/Local/Temp/claude/C--Users-oscar-Desktop-Daniel-Luxy/2e98ca23-956f-4422-915d-25da37ddd89e/scratchpad/final/`. Datos leídos: `C:/Users/oscar/AppData/Local/Luxy/logs/luxy.log` y `studio.log`, y el código de `apps/agent/src/providers/http-provider.ts` y `packages/shared/src/vault-prompt.ts`. La captura del panel la he tratado como dato transcrito; no la he visto yo.*