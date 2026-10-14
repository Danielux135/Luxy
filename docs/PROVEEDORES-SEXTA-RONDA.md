# Sexta ronda de proveedores: la primera de pago

2026-10-13. Continuación de docs/PROVEEDORES-QUINTA-RONDA.md. Paso
`PROVEEDORES-006`; lo que le toca a Daniel está en `LA-063`.

**Cambio de criterio de Daniel respecto a las cinco rondas anteriores:** ya no
es «gratis y sin tarjeta». Tiene 5,00 $ en una tarjeta Visa prepago virtual
(la recompensa de una encuesta), y la pregunta pasa a ser dónde gastarlos.
Cuatro condiciones suyas:

1. que sirva **DeepSeek**;
2. que haya **muchos candidatos** entre los que elegir;
3. que sea **barato de verdad**;
4. que entren **los 5,00 $ íntegros**: el cargo total en la tarjeta, con
   impuestos y comisiones, tiene que ser como mucho 5,00 $, y lo que sobre en
   la tarjeta se pierde.

Siguen en pie el veto a las API de OpenAI y de Anthropic (`D-003`), el contrato
`chat completions` con `/v1/models` (`D-022`) y el descarte de quien prohíbe el
contenido adulto por categoría en su contrato.

**Aviso sobre el método.** Precios y catálogos leídos el 13/10 de los endpoints
públicos de cada proveedor, sin clave. Los términos, con una herramienta que
resume. **Ninguna llamada de inferencia: aquí no hay nada medido**, ni
latencia, ni español, ni contenido explícito. La quinta ronda sigue siendo la
única con números medidos.

---

## 1. Comparativa

| Sitio            | ¿Caben los 5,00 $ íntegros?                                                      | DeepSeek, $ por millón (entrada/salida)                        | Catálogo de texto               |
| ---------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------- |
| **NanoGPT**      | **Sí, comprobado al pagar**: importe libre, sin comisión, impuesto 0,00          | 35 ids. V4-Flash-0731 0,05/0,16 · V4-Pro 1,10/2,20             | 646 modelos, 52 de rol          |
| DeepInfra        | Probable: importe libre en céntimos; mínimo sin documentar; tarifas sin impuesto | 10 ids. V4-Flash-0731 0,06/0,18 · V4-Pro 1,30/2,60             | 177 modelos, 5 de rol, antiguos |
| DeepSeek directo | Dudoso: mínimo sin confirmar y una fuente dice que rechaza prepago               | flash 0,15-0,30/0,60-1,20 · v4-pro 0,66-1,32/1,98-3,96         | 2 modelos                       |
| OpenRouter       | **No**: mínimo 5 $ más 0,80 $ de comisión, 5,80 $                                | 18 ids                                                         | 459 modelos, 12 de rol          |
| Chutes           | Pago por uso sin mínimo, pero suscripción desde 10 $                             | 2 ids. V4-Flash-0731 0,44/1,32                                 | 14 modelos                      |
| Arli AI          | No: desde 10 $ al mes                                                            | ninguno                                                        | —                               |

Featherless e Infermatic siguen fuera por precio (25 $ y más al mes).

**Cuántos turnos de Lía dan 5 $.** Con un turno de unos 7.500 tokens de
entrada y 800 de salida (`docs/DEEPSEEK-LLAMADAS-VACIAS.md`): unos 9.900 con
`deepseek/deepseek-v4-flash-0731`, unos 4.900 con
`TheDrummer/Cydonia-24B-v4.3` (0,12/0,15) y entre 490 y 960 con V4-Pro.
`deepseek/deepseek-v4-pro-0813` salió el mismo día a dos precios según el
catálogo de NanoGPT que se consulte (0,48/1,98 y 1,10/2,50): no fiarse del más
bajo.

Al ritmo de septiembre, unas 220 llamadas al mes, Lía gastaría entre 0,20 $ y
2,30 $ al mes. **El dinero no es el problema que esto resuelve**: en la
pasarela actual quedan decenas de miles de yuanes. Lo que puede resolver es la
espera de unos 200 segundos por respuesta, y eso no está medido.

## 2. NanoGPT

Pasarela de pago por uso, NanoGPT LLC (Estados Unidos, ley de California).
Contrato `chat completions`; la clave viaja como `Authorization: Bearer`.

**El pago, tal como se vio en pantalla.** Depósito con tarjeta por Stripe,
importe libre («Custom», mínimo 0,10 $). La pantalla de pago de 5 $ decía
«Total a pagar 5,00 US$» con impuesto 0,00, y después el saldo marcaba 5,00 $
con un abono de 5,00 USD. Dos trampas en esa pantalla:

- la divisa viene marcada en **euros** (4,65 € a 0,93 por dólar); hay que
  cambiarla a dólares para que una tarjeta en dólares no convierta;
- Stripe Link trae **preseleccionada la tarjeta guardada** del correo de la
  cuenta. Para pagar con otra hay que pulsar «Pagar sin Link».

**Lo gratuito no sirve para Luxy.** Su página de precios dice «One free model,
available on web only». Por API sólo cuestan cero `nano-gpt-help` (el bot de
ayuda) y `auto-model` (un enrutador). Es el patrón del cierre de Featherless:
la parte gratis es interfaz web y la API empieza con el pago.

**La suscripción de 12 $ al mes no compensa.** Incluye 310 modelos, entre
ellos 32 ids de DeepSeek y Cydonia-24B-v4.3, con 60 millones de tokens de
entrada por semana. Para el volumen de Lía, el pago por uso cuesta una
fracción.

**Política de contenido.** Sus términos sólo enumeran dos prohibiciones en lo
sexual: contenido con menores, incluidas personas «que aparenten» menos de 18,
reales o sintéticas, y contenido explícito de una persona identificable sin su
consentimiento. No hay veto por categoría. Mantienen la cláusula de la cuarta
vuelta: si chocan con los términos del modelo, mandan los del modelo. La
moderación es opcional, por petición, con la cabecera `moderation`, y se cobra
aparte.

**Imagen y vídeo.** 243 modelos de imagen, 35 marcados `nsfw: true` en su
catálogo (afinados SDXL, Pony e Illustrious a 0,0051 $ la imagen de
1024x1024); 187 de vídeo, 76 marcados (variantes «Spicy» de imagen a vídeo
desde 0,02 $ por segundo a 480p). La marca no es del todo fiable: incluye
escaladores, y `wan-22-spicy` figura como `false`. **Ninguno entra por
Conexiones**: imagen sería un tercer proveedor en `VAULT_IMAGE_PROVIDERS`, el
alcance que `LA-046` describe para PixAI, y para vídeo no hay adaptador.

## 3. Qué hace con lo que le mandas

Según su documentación, leída y no auditada:

| Pregunta                 | NanoGPT                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| ¿Guarda el contenido?    | Dice que no en la inferencia normal. El registro de peticiones es opcional por clave y está **apagado** en la clave creada para Luxy    |
| ¿Quién más lo ve?        | El proveedor final, que recibe el texto y aplica su propia retención                                                                    |
| Cydonia-24B-v4.3         | Un solo proveedor, que declara no retener ni entrenar. Si cae, no hay alternativa                                                       |
| DeepSeek, ruta automática | Puede servirse por proveedores que declaran retener los prompts: 8 de los de V4-Flash-0731 y 5 de los de V4-Pro                         |

Con el criterio vigente de Daniel (que entrenen con lo enviado no descarta),
esto es un dato para elegir modelo, no un motivo de rechazo.

## 4. Qué cuesta enchufarlo a Luxy

**Texto: cero código, pero por Proveedores HTTP y no como conexión.**
Comprobado contra el código por el flujo `wf_c9fc4dd3-d13`:

- cada proveedor HTTP se registra con su identificador y sirve cualquier
  modelo de su endpoint; una conexión sólo registra las familias del catálogo
  de fábrica, y ahí Cydonia caería en `other`, no ejecutable;
- con la URL base `https://api.nano-gpt.com/api/v1`, el catálogo va a
  `/models` y el chat a `/chat/completions`. La documentación de NanoGPT manda
  usar ese host con clave, por admitir peticiones más largas; el otro,
  `https://nano-gpt.com/api/v1`, también vale. **Cambiar la URL después borra
  la clave guardada**;
- los identificadores con barra, mayúsculas y dos puntos pasan todas las
  validaciones y llegan intactos;
- de los 646 modelos quedan 640 elegibles en Privado: cinco enrutadores salen
  deshabilitados y un clasificador se filtra;
- la tabla de razonamiento (`D-107`) no casa con ningún nombre de NanoGPT.
  **Cambiado ese mismo día por `D-111`:** en NanoGPT el nivel se elige por
  modelo, en «Ajustes por modelo», con lo que declara su catálogo. Sin ajuste
  propio Luxy sigue sin mandar nada. El sufijo `:thinking` es otro
  identificador de modelo, no un interruptor de Luxy;
- **máximo de tokens 4096**, no los 8192 de fábrica: el único proveedor de
  Cydonia declara 4096 de salida, y no está documentado si NanoGPT recorta o
  rechaza cuando se pide más;
- un proveedor HTTP tenía un solo juego de muestreo y un solo máximo de tokens
  para todos sus modelos. **Cambiado por `D-111`:** su tarjeta tiene «Ajustes
  por modelo», con muestreo, nivel de razonamiento y máximo de tokens propios;
- el «Presupuesto diario» no frena nada en un proveedor HTTP: el coste
  estimado es siempre 0. El único tope es el saldo.

La clave sólo entra por el campo «Clave de API» del formulario: `secrets.enc`
se escribe únicamente desde el proceso principal, y la migración desde
`.env.providers` no la llama ninguna pantalla.

## 5. Lo que no está verificado

- **Que NanoGPT acepte el cuerpo que manda Luxy** (`stream_options`,
  `max_tokens`, dos mensajes). No hay ni una llamada a NanoGPT en el registro.
- **La latencia**, que es lo único que justificaría cambiar a Lía de modelo.
- **El contenido explícito**, en texto, imagen o vídeo.
- Si los DeepSeek sin `:thinking` razonan por defecto en NanoGPT. Desde
  `D-111` se puede pedir «Sin razonar» en el ajuste propio del modelo; que
  NanoGPT lo cumpla lo dirá `LA-064`.
- Si un modelo de rol como Cydonia rinde igual recibiendo todo el historial
  dentro de un único mensaje de usuario, que es como lo manda Luxy.
- **`D-003`**: el catálogo incluye modelos de Anthropic y de OpenAI, y Luxy no
  los filtra, porque su veto es por host. Si usarlos por aquí cuenta como
  saltarse la decisión no está escrito en ningún sitio; lo decide Daniel.
- Los términos del modelo que mandan sobre los de NanoGPT: para los DeepSeek
  serían los de DeepSeek, que la quinta ronda ya dejó como «sin verificar».
