<!-- generado por una investigacion con 13 agentes el 2026-09-07 -->

# Proveedores de IA para el roleplay privado — investigacion 2026-09-07

Investigacion pedida por Daniel: APIs gratuitas de chat, vision, imagen, video
y demas, utiles para lo que Luxy hace en la boveda privada.

**Como leer esto.** Cada hallazgo paso por un verificador adversarial cuyo
trabajo era refutarlo, no confirmarlo. Lo refutado se cayo; lo que quedo dudoso
va etiquetado como **no confirmado** y no sostiene ninguna recomendacion.

Los cuatro criterios, en este orden:

1. **Gratis de verdad.** «Gratis pero pide tarjeta» NO cuenta — es lo que hizo
   descartar Mistral el mismo dia de esta investigacion (`LA-044`).
2. **Politica de contenido leida**, no supuesta ni sacada de un blog.
3. **Privacidad.** Si el nivel gratuito se paga con los datos, descalifica
   igual que la tarjeta: aqui el contenido es de una boveda cifrada.
4. **Enchufable**: contrato `chat completions`, o local en loopback.

Vetados por politica del repositorio y fuera del estudio: la API de OpenAI y la
de Anthropic.

---

{
  "summary": "Investiga APIs y modelos gratuitos (chat, vision, imagen, video, local) que sirvan al roleplay privado de Luxy, con verificacion adversarial",
  "agentCount": 13,
  "logs": [],
  "result": {
    "sintesis": "# Recomendación final — proveedores de IA para Luxy\n\nEsto es la síntesis después de pasar cada hallazgo por el verificador. Lo que el verificador refutó, se ha caído. Lo que quedó dudoso, va etiquetado como **no confirmado** y no se apoya ninguna decisión en ello.\n\nAntes de nada, tres cosas que cambian el marco:\n\n- **La trampa que rechazaste con Mistral aparece otra vez, dos veces en su forma literal** (OVHcloud y Cerebras piden método de pago guardado para activar el crédito \"gratis\") **y varias veces en una forma peor: se paga con los datos.** OpenRouter `:free` y el nivel gratuito de Gemini no piden tarjeta — piden el contenido. Para una bóveda privada eso descalifica igual de duro que la tarjeta, y así lo trato aquí.\n- **\"La política lo permite\" y \"el modelo lo hace\" son cosas distintas.** Se han separado en cada ficha. Ningún modelo alojado se ha probado con una imagen o un prompt real; nadie puede afirmar que colaborarán.\n- **En local no hay proveedor ni tarjeta, pero sí licencia de pesos.** Es el equivalente local de la política de contenido, y ahí ha caído el candidato que parecía el número uno.\n\n---\n\n## 1. VISIÓN (tu bloqueo actual) — la respuesta es local\n\nClaude Code se niega con NSFW y ese es el hueco. **No se cierra con ningún servicio alojado gratuito.** Se cierra en tu PC.\n\n### En tu PC (recomendado)\n\n**KoboldCpp + ToriiGate-0.5 — el camino con menos incógnitas**\nUn `.exe` portable para Windows, sin instalar ni compilar. Sin tarjeta, sin cuenta. **Política de contenido: ninguna, porque no hay proveedor**; ToriiGate-0.5 es **licencia MIT**, que no impone ninguna restricción de uso, y su propia ficha dice \"No censorship\" y que \"no requiere jailbreaks\" para estas imágenes. Se enchufa como una Conexión HTTP más en Studio apuntando a `http://127.0.0.1:5001/v1` — Luxy ya acepta http sin TLS en loopback. Pesa poco: Q4_K_M 3,07 GB + mmproj 364 MB, cabe en una GPU de 6 GB.\n*Sesgo real: está especializado en arte digital, anime y cómic. Para fotografía realista no es la mejor elección.*\n\n**llama.cpp (llama-server) — el camino de servicio permanente**\nMismo planteamiento, mejor para dejarlo corriendo en segundo plano. Su documentación oficial confirma multimodal por `/chat/completions` compatible con OpenAI, la forma de objeto `{url}` que Luxy usa por defecto, y el puerto 8080 en 127.0.0.1. Los zips de Windows con CUDA de la release actual son `llama-b10839-bin-win-cuda-12.4-x64.zip` (y hay que bajar además el `cudart-*` aparte).\n\n**Ollama — la opción de menor fricción para probar hoy**\n`ollama run huihui_ai/qwen3-vl-abliterated:8b-instruct` y ya tienes visión sin negativas. Apache 2.0. Es además tu mejor apuesta **para pies de foto en español**, porque Qwen3-VL sí es genuinamente multilingüe mientras los captioners especializados están centrados en inglés. Conexión a `http://127.0.0.1:11434/v1`.\n**Corrección importante frente a lo que se te pudo decir antes: NO hay que configurar `imageUrlFormat='string'` para Ollama.** Leído en su código fuente (`openai.go`, `FromChatRequest`), Ollama prueba **primero** la forma de objeto y solo cae a la cadena como respaldo. Déjalo en el valor por defecto de Luxy (`'object'`). Documentar una excepción que no existe habría añadido una trampa de configuración.\n\n### El caso JoyCaption — hay que decirlo claro\n\nJoyCaption Beta One es, técnicamente, el mejor captioner NSFW de foto realista que existe: su ficha dice literalmente \"Equal coverage of SFW and NSFW concepts\" y está entrenado a propósito para esto. **Pero su presentación como \"open weights, no restrictions\" es marketing del README, no un instrumento de licencia.** El repositorio contiene `LLAMA_LICENSE` y `LLAMA_USE_POLICY.md`, y el campo `license` de la ficha está vacío: se distribuye bajo la Llama 3.1 Community License y su Acceptable Use Policy — exactamente la misma familia de restricciones por la que se descarta Llama. **JoyCaption no es la alternativa limpia frente a Llama: es Llama.**\n\nPara un uso privado, local y no distribuido, esa cláusula es prácticamente inaplicable. Pero es tu decisión, y es una decisión de **riesgo asumido**, no de \"no hay restricciones\". Si tu criterio es evitar licencias con restricciones de uso ambiguas, JoyCaption cae y quedan en pie ToriiGate (MIT) y la familia Qwen (Apache 2.0). Si aceptas el riesgo, el mmproj está en `concedo/llama-joycaption-beta-one-hf-llava-mmproj-gguf` (878 MB, no ~600) — es del autor de KoboldCpp y está hecho para KoboldCpp.\n\n### En la nube (respaldo, con reservas)\n\n**Groq (`qwen/qwen3.6-27b`)** — el mejor de los alojados. Su AI policy solo prohíbe, en materia sexual, contenido sexualmente explícito **\"that is illegal\"**; no hay prohibición categórica de ficción adulta lícita. No retiene datos por defecto (logs 30 días). Contrato `chat completions` puro, cero código.\nTres avisos honestos: **(a) que no pida tarjeta NO está confirmado en ninguna página de Groq** — solo en blogs agregadores, que es justo la clase de fuente que aquí no vale; compruébalo en el alta antes de invertir tiempo. **(b)** El no-entrenamiento sí está confirmado, pero en el Services Agreement, no en la página que se citaba. **(c)** La política permite; el modelo lleva su propio alineamiento y probablemente se niegue. No lo des por resuelto sin probarlo.\nCuello de botella real: 8K tokens/minuto y 2.048 tokens por imagen ≈ 3 imágenes por minuto.\n\n**Cloudflare Workers AI** — 10.000 neurons/día sin tarjeta (verificado: `llama-3.2-11b-vision-instruct` **no** está en la lista de modelos que exigen método de pago). Sus términos no dicen nada de contenido adulto y prohíben explícitamente entrenar con tu contenido. Pero su capa compatible con OpenAI **no documenta imágenes ni `image_url`**, así que no se sabe si funciona. Dato nuevo que merece una mirada: el catálogo ya incluye **`moondream3.1-9B-A2B` servido por Cloudflare**, lo que permitiría usar Moondream sin aceptar los términos de M87 Labs que lo descalifican. Nadie lo ha evaluado.\n\n**AI Horde `interrogate`/`caption`** — gratis de verdad, sin tarjeta, y la fontanería ya existe en `apps/agent`. Su FAQ dice palabra por palabra: *\"Horde-wide, we censor only one type of generation: CSAM Images\"*. Pero el caption es BLIP: frases cortas, genéricas y pudorosas con contenido adulto. Y un worker voluntario puede ver la imagen (la FAQ lo admite: \"Technically, yes\"). Respaldo degradado, no solución.\n\n### Descartados en visión\n\n| Proveedor | Motivo |\n|---|---|\n| **Google / Gemini** | Doble: su política prohíbe *\"Sexually explicit content — for example, content created for the purpose of pornography\"* (cita correcta en `policies.google.com/terms/generative-ai/use-policy`, no en la URL de soporte), **y** el nivel gratuito usa tu contenido para mejorar productos con revisores humanos leyéndolo. |\n| **Moondream Cloud** | Sus términos prohíben contenido *\"vulgar, obscene\"* (4.2) y *\"obscene, pornographic\"* (5.5). Corrección: **sí habla chat completions** en `api.moondream.ai/v1`, al contrario de lo que se creía — pero da igual, la cláusula lo descalifica. Vía local o vía Cloudflare, sí. |\n| **OpenRouter `:free`** | Usar modelos gratuitos obliga a habilitar el enrutado hacia proveedores que pueden entrenar con tus datos; su propia doc confirma ajustes separados para free y de pago. *(La acusación más grave — que publican prompts en datasets públicos — no ha podido leerla nadie: ese artículo devuelve 403. Queda como no verificado.)* |\n| **Venice.ai** | La API es de pago, sin nivel gratuito. Y sus términos hacen garantizar que tu contenido no es \"pornographic\" — contradice su propia marca. |\n| **NVIDIA NIM** | En la línea de texto sí se pudo leer el PDF: cláusula 4.11 literal, *\"You will not use the API Service to create or distribute to others any defamatory, obscene, pornographic, vulgar, offensive, or violent content.\"* Descartado con la cita delante. Además \"trial purposes only, without use in production\". |\n| **Chutes / SiliconFlow / Alibaba** | Fin del gratuito, teléfono chino + identidad real, y caducidad a 90 días respectivamente. |\n| **Pollinations** | Reabierto por el verificador (el argumento de \"solo hay modelos frontera\" era falso: hay qwen3-vl, llama-4, mistral). Pero sigue sin política de retención localizable y por diseño es pasarela a terceros. Para la bóveda, probablemente descartado igual — ahora por el motivo correcto. |\n\n---\n\n## 2. IMAGEN — ya tienes lo mejor gratis; lo que falta es identidad de personaje\n\n**No existe hoy ningún servicio alojado que cumpla las cuatro condiciones y aporte algo sobre AI Horde.** Sogni AI tiene el mejor catálogo NSFW pero su FAQ exige \"a verified payment method\" para gastar el Spark gratuito — la trampa de Mistral. Comfy Cloud dice literalmente \"No payments. No credit card required.\" pero su nivel gratuito es interfaz, no API.\n\n**Lo que sí aportaría algo: ComfyUI en local (`127.0.0.1:8188`).** No por generar mejor, sino porque cubre exactamente lo que tu propio código admite que falta — `vault-image-provider.ts:64-65` dice que AI Horde no tiene \"ni IP-Adapter, ni FaceID, ni un modelo de edición por instrucción\". Con IP-Adapter FaceID o Qwen-Image-Edit (Apache 2.0, 20B) resuelves \"este personaje, en esta escena nueva\", que es el problema que la receta local de D-064 apaña pero no resuelve. Rutas verificadas en doc oficial: `POST /prompt`, `GET /history`, `GET /view`, `WS /ws`. Arranca por defecto en 127.0.0.1:8188, que es justo lo que exige la regla de loopback.\n*Si prefieres un adaptador barato de escribir: Forge expone `/sdapi/v1/txt2img` con `--api` (verificado en la wiki oficial de A1111), puerto 7860, JSON plano y base64 — mucho más parecido a lo que ya construyes para AI Horde que el grafo de nodos de ComfyUI.*\n\n**Dato caducado que te ahorra una tarde:** desde abril de 2026 Civitai se partió en dos dominios. `civitai.com` es SFW-only; los checkpoints X/XXX y sus LoRA están en **`civitai.red`**. Activar toggles en el dominio verde ya no sirve. Y su ToS prohíbe porno en la Sección 9 \"User Content\" — no es lenguaje de procesador de pagos como se sospechaba. **Qué términos rigen `civitai.red` no lo ha encontrado nadie**, así que no se puede afirmar que su API permita NSFW.\n\nDescartados: **Tensor.art** (SFW-only desde el 27/11/2025, el NSFW se fue a una plataforma de pago), **Pollinations** (`private` por defecto es **false** — publica en un feed público), **Cloudflare** (los FLUX llevan filtros NSFW a la entrada y a la salida según su model card), **getimg.ai** (su página de precios hoy no muestra ningún plan gratuito).\n**Modal queda reabierto:** se descartó por una tarjeta que su página de precios no exige (\"$30/month free credits\" en Starter, sin condición declarada). Pero sus términos prohíben material *\"indecent or obscene\"*, así que el bloqueo real es otro y sigue sin resolver.\n\n---\n\n## 3. TEXTO — ya tienes DeepSeek; esto es la red de seguridad\n\n**AI Horde por el puente OpenAI (`https://oai.aihorde.net/v1`) es el mejor hallazgo de todo el informe.** Es el único que cumple las cuatro condiciones a la vez:\n- Gratis de verdad, y **no hay pasarela de pago que pueda pedir tarjeta**: su README dice *\"Kudos can never be bought or sold — this is strictly against the Terms of Service\"*.\n- Política que **permite en positivo**: *\"Other than this one instance, the horde does not censor text generations at all\"* (la instancia es el filtro anti-CSAM en imágenes).\n- Contrato `chat completions` con `/v1/models` — cumple D-022, cero código, se añade desde Conexiones.\n- **Ya tienes cuenta y clave por las imágenes: es el mismo monedero de kudos.**\n\nY el catálogo, consultado en vivo, es de finetunes de rol, no de asistentes: Cydonia-24B, Skyfall-31B, Rocinante-X-12B, mini-magnum-12b, Violet-Lotus, Impish_Bloodmoon, Forgotten-Safeword-22B, Behemoth-X-123B.\n**Su pega, sin adornos: el cómputo lo pone un voluntario que técnicamente puede leer y guardar tu prompt.** Su FAQ lo admite (\"Technically, yes\"). El worker no sabe quién eres, pero ve el texto. Úsalo para lo explícito **no íntimo**; para lo íntimo de verdad, local.\n\n**Local para lo íntimo:** Ollama o LM Studio — ambos con `/v1/models` **verificado en documentación oficial**, que es lo que Luxy exige para catalogar. **KoboldCpp queda pendiente de una comprobación de diez segundos:** ninguna fuente primaria documenta que exponga `GET /v1/models` en formato OpenAI, y el verificador comprobó en `apps/desktop/src/main/ipc/handlers.ts` que sin eso la conexión no pasa ni el test ni el catálogo. Ejecuta `curl http://localhost:5001/v1/models` antes de elegirlo.\n\n**Groq como respaldo limpio** para narrativa no explícita: no entrena, no retiene por defecto, política permisiva. Mismo aviso de la tarjeta sin confirmar.\n\n**Descartado y anotado:** **Cerebras** — el verificador lo tumbó y va al mismo cajón que Mistral. Literal de su documentación: *\"If you skip adding a payment method at sign-up, Playground and API access remain inactive until you do\"*, con crédito de 5 $ que caduca a 30 días. Los blogs que dicen \"1M tokens/día gratis sin tarjeta para siempre\" son falsos. **No hace falta que abras cuenta para saberlo.**\n**OVHcloud** — misma trampa, y es una pena porque su política de datos era la mejor de todas (no entrenan, retención cero, UE). Si algún día aceptas poner tarjeta, sube muchos puestos.\n\n---\n\n## 4. VÍDEO — hoy no hay. Sin adornos.\n\n**El vídeo generativo gratuito, sin tarjeta y sin censura no existe como servicio alojado.** Tres muros verificados: la política (fal prohíbe expresamente *\"any other harmful, violent, or sexually explicit content\"*, y fal está detrás de medio catálogo ajeno; Alibaba modera entrada **y** salida), el dinero (los nueve modelos de vídeo de Pollinations están marcados `\"paid_only\":true` mientras la imagen es gratis), y los procesadores de pago (Civitai perdió el suyo, Tensor.art movió el NSFW tras un muro de pago).\n\n**Confirmación negativa que te ahorra tiempo:** revisadas las 59 rutas del swagger de AI Horde, **no hay ninguna de vídeo, ni reservada.** El Horde no va a cubrir este hueco.\n\n**Corrección importante — Venice sí tiene vídeo, y es la mejor pista:** el hallazgo original decía que no. Es falso y estaba caducado. `GET api.venice.ai/api/v1/models?type=video` devuelve ~131 modelos, y un subconjunto lleva `\"uncensored\":true` (wan-3-0, wan-2-7, seedance-1-5-pro, longcat, ovi, minimax-h3-max). Hay image-to-video, así que **la identidad del personaje se heredaría de la imagen que la bóveda ya genera**. Cuatro reservas que van en la misma frase: **(1)** no es chat completions, es cola asíncrona propia (`POST /video/queue`, sondeo de `/video/retrieve`) — adaptador obligatorio; **(2)** **no es gratis** — créditos con tarjeta, cripto o staking; **(3)** su ToS prohíbe lo \"pornographic\" pese al flag `uncensored`, y la API devuelve 422 por política — el flag es metadato del modelo, no una bendición contractual; **(4)** `\"privacy\":\"anonymized\"` significa que Venice te oculta al proveedor, pero el proveedor ve el prompt.\n\n**Si quieres vídeo hoy, es local.** Y la expectativa realista importa: clips de 5 segundos, 480p, minutos de espera. **FramePack** es el suelo del hardware de usuario — 6 GB de VRAM, consumo constante aunque el clip sea largo, y **es Apache-2.0** (el archivo LICENSE existe, aunque el README no lo mencione: eso no es silencio legal, es una licencia limpia). Es image-to-video, así que parte de la imagen que ya generas. **Wan 2.1/2.2** en ComfyUI es Apache 2.0 con una cláusula de uso responsable que va sobre **compartir** — y aquí nada sale del PC. **HunyuanVideo queda descartado**: su LICENSE excluye territorialmente a la Unión Europea, en mayúsculas. No es política de contenido, es que la licencia no te concede derechos.\n\nSi esto se integra, tiene que ser un **trabajo asíncrono con aviso al terminar**, nunca dentro del turno.\n\n---\n\n## 5. INFRAESTRUCTURA — dos arreglos baratos que no buscabas\n\n**El más rentable de todo el informe, y salió de leer tu código, no de la web:** `media-adapters.ts:89` tiene `DEFAULT_VOICE = 'cixingnansheng'` — **una voz china** — con un comentario explicando que se eligió porque 'alloy' devolvía `voice_id_invalid`. Tu TTS funciona, pero habla con la voz que quedaba.\n**Kokoro-82M** (Apache 2.0) trae **ef_dora, em_alex y em_santa en castellano**, corre en CPU, y su wrapper expone la **misma ruta `/v1/audio/speech`** que ya llamas. Es cambiar un baseUrl y una constante — y de paso el texto de la bóveda deja de salir del equipo, que hoy sí ocurre. *Matiz honesto: las voces españolas aparecen en VOICES.md **sin nota de calidad**, al contrario que las inglesas. Existen; escúchalas antes de fijarlas.*\n\n**Segundo: el ASR roto.** `ADAPTER_VERIFICATION` marca `transcription: { verified: false }`. **whisper.cpp** lo cierra: sin cuenta, sin tarjeta, sin política, y Whisper transcribe fonemas — no se niega. Un detalle que no es cosmético: **su ruta por defecto es `/inference`, no `/v1/audio/transcriptions`**. Hay que arrancar con `--inference-path /v1/audio/transcriptions` (el flag está documentado). \"Solo cambia el baseUrl\" era falso.\n\n**Groq como plan B de ASR**, con **corrección de límites**: las cifras que circulan (30 RPM / 14.400 RPD) son del tier de **texto**. Para whisper son **20 RPM, 2.000 peticiones/día y 28.800 segundos de audio/día** = 8 horas diarias. La unidad no son tokens, son segundos.\n\n**Dos trampas del mismo género que Mistral, para que consten:**\n- **AssemblyAI**: 50 $ gratis, sin tarjeta, y su propia FAQ dice *\"Free users do not have the ability to opt out of the model improvement program.\"* El nivel gratuito se paga con los datos.\n- **Deepgram**: 200 $ sin tarjeta (esto sí verificado en su web). Pero sus términos son **opt-out por defecto**: entrenan salvo que pongas `mip_opt_out=true` en **cada** petición. Una que se olvide y ese audio entra.\n- **DeepL**: se había descartado \"por pedir tarjeta\". **Eso no está probado** — su página oficial dice que no la pide, y la acusación venía de terceros. Sigue fuera, pero por motivos válidos (API propia, no habla chat completions), no por una tarjeta inventada. Conviene no ensuciar el precedente de Mistral, que sí es un rechazo real.\n\n**Lo que es adorno y no deberías tocar:** embeddings (tu `turn-index.ts` ya razonó por qué, y Ollama solo elimina una de sus tres objeciones); moderación con **Llama Guard**, que es peor que adorno — su taxonomía define S12 = Sexual Content e incluye la erótica explícitamente, así que marcaría **cada turno** de la bóveda; y **Cloudflare Workers AI**, que es la tentación más seductora precisamente porque tu cuenta ya existe — y meter el audio de la bóveda por el Worker convertiría tu \"única pieza pública\" en la que ve el contenido privado.\n\n---\n\n## Lo que haría yo, en orden\n\n1. **Prueba de humo de visión, 15 minutos, sin tocar Luxy.** Descarga KoboldCpp (`.exe`), ToriiGate-0.5 Q4_K_M + su mmproj, arranca, y pásale una imagen con el texto de `buildDescribePrompt()`. Responde de golpe las dos preguntas abiertas: si describe sin negarse, y si lo hace en español.\n2. Si el español falla: `ollama run huihui_ai/qwen3-vl-abliterated:8b-instruct` y compara. Conexión con el `imageUrlFormat` por defecto.\n3. **Da de alta AI Horde texto** (`https://oai.aihorde.net/v1`) como Conexión. Cero código, misma clave que ya tienes, y te da modelos de rol de 24B-123B que no puedes ejecutar en casa.\n4. **Cambia `DEFAULT_VOICE` a una voz española de Kokoro.** Es la mejora más barata que hay.\n5. **Decisión numerada pendiente, y no es un detalle:** D-064 dice que el proveedor de imágenes de la bóveda es del **personaje**. Un servidor de visión local es intrínsecamente de la **máquina** — si el turno cae en el portátil y llama-server solo corre en el sobremesa, no hay visión. Hay que modelarlo como capacidad de máquina, que la selección de máquina en `shared` lo tenga en cuenta, y decidir qué pasa cuando la máquina elegida no lo tiene levantado.\n\n## Huecos que siguen abiertos\n\n- **Si Groq pide tarjeta.** Es el candidato alojado número uno y su gratuidad se apoya solo en blogs. Se cierra dándote de alta y mirando si aparece un paso de facturación. Dado lo de Mistral, es el hueco más caro de la lista.\n- **Si los modelos alojados aceptan de hecho NSFW.** Nadie lo ha probado. Es la única prueba barata: una imagen, tres peticiones.\n- **Qué términos rigen `civitai.red`.** Sin eso no se puede afirmar ni negar que su API permita NSFW.\n- **El default de `safe` en Pollinations** no está documentado. No lo des por `false`: mándalo explícito.\n- **Rendimiento local real.** Nadie ha ejecutado nada en tu equipo. **Toda la recomendación local depende de un dato que no tengo: qué GPU tienes y cuánta VRAM.**\n\nY una nota de método: cuatro citas van a acabar en `DECISIONS.md` (Groq AI policy, AI Horde FAQ, Venice 10.9.c y Moondream 4.2/5.5). Todas se leyeron con herramientas que resumen. **Antes de fijarlas, ábrelas tú y confirma la transcripción literal.**",
    "lineas": 6
  },
  "workflowProgress": [
    {
      "type": "workflow_phase",
      "index": 1,
      "title": "Investigar"
    },
    {
      "type": "workflow_phase",
      "index": 2,
      "title": "Verificar"
    },
    {
      "type": "workflow_phase",
      "index": 3,
      "title": "Sintetizar"
    },
    {
      "type": "workflow_agent",
      "index": 1,
      "label": "investiga:vision",
      "phaseIndex": 1,
      "phaseTitle": "Investigar",
      "agentId": "a213818b190f7a691",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788779179416,
      "queuedAt": 1788779177805,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "CONCLUSION CORTA: el hueco de vision NO se cierra bien con …",
      "promptPreview": "CONTEXTO DEL PROYECTO (Luxy) — leelo entero antes de buscar:\n\nLuxy es un agente personal en Windows con una boveda privada cifrada donde el\nusuario (Daniel) hace roleplay adulto. Necesita proveedores de IA para eso.\n\nRESTRICCIONES DURAS, no negociables:\n- PROHIBIDO proponer la API de OpenAI y la de Anthropic. Estan vetadas por\n  politica del repositorio. No las incluyas ni como comparacion.\n- Un p…",
      "lastProgressAt": 1788779953854,
      "tokens": 126392,
      "toolCalls": 79,
      "durationMs": 774436,
      "resultPreview": "{\"proveedores\":[{\"nombre\":\"llama.cpp (llama-server) + JoyCaption Beta One GGUF — LOCAL\",\"categoria\":\"local\",\"url\":\"https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md\",\"gratis\":\"Gratis del todo y para siempre: software libre + pesos abiertos descargados de Hugging Face. No hay cuenta, ni cuota, ni servicio remoto. JoyCaption Beta One en GGUF va de IQ1_S (2,53 GB) a BF16 (16,1 GB);…"
    },
    {
      "type": "workflow_agent",
      "index": 2,
      "label": "investiga:vision-local",
      "phaseIndex": 1,
      "phaseTitle": "Investigar",
      "agentId": "a963906e0e7ad45fd",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788779179483,
      "queuedAt": 1788779177806,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "RESUMEN EN UNA FRASE: el hueco de vision NSFW se cierra hoy…",
      "promptPreview": "CONTEXTO DEL PROYECTO (Luxy) — leelo entero antes de buscar:\n\nLuxy es un agente personal en Windows con una boveda privada cifrada donde el\nusuario (Daniel) hace roleplay adulto. Necesita proveedores de IA para eso.\n\nRESTRICCIONES DURAS, no negociables:\n- PROHIBIDO proponer la API de OpenAI y la de Anthropic. Estan vetadas por\n  politica del repositorio. No las incluyas ni como comparacion.\n- Un p…",
      "lastProgressAt": 1788779899713,
      "tokens": 111828,
      "toolCalls": 53,
      "durationMs": 716925,
      "resultPreview": "{\"proveedores\":[{\"nombre\":\"llama.cpp / llama-server (ggml-org)\",\"categoria\":\"local\",\"url\":\"https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md\",\"gratis\":\"Software libre (MIT). Binarios precompilados para Windows x64 con CUDA (llama-*-bin-win-cu12-x64.zip) en la pagina de releases. Coste cero: ni cuenta, ni registro, ni telemetria de cuenta.\",\"tarjeta\":\"No. No hay cuenta que crear.…"
    },
    {
      "type": "workflow_agent",
      "index": 3,
      "label": "investiga:texto",
      "phaseIndex": 1,
      "phaseTitle": "Investigar",
      "agentId": "a0a00262f67b9b430",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788779179617,
      "queuedAt": 1788779177806,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "RESUMEN EJECUTIVO — qué haría yo, en orden 1) AI Horde text…",
      "promptPreview": "CONTEXTO DEL PROYECTO (Luxy) — leelo entero antes de buscar:\n\nLuxy es un agente personal en Windows con una boveda privada cifrada donde el\nusuario (Daniel) hace roleplay adulto. Necesita proveedores de IA para eso.\n\nRESTRICCIONES DURAS, no negociables:\n- PROHIBIDO proponer la API de OpenAI y la de Anthropic. Estan vetadas por\n  politica del repositorio. No las incluyas ni como comparacion.\n- Un p…",
      "lastProgressAt": 1788780353515,
      "tokens": 148355,
      "toolCalls": 79,
      "durationMs": 1170726,
      "resultPreview": "{\"proveedores\":[{\"nombre\":\"AI Horde — texto, vía el puente OpenAI oficial (oai.aihorde.net)\",\"categoria\":\"texto\",\"url\":\"https://oai.aihorde.net/\",\"gratis\":\"Gratis del todo, sin créditos ni caducidad. Es cómputo donado por voluntarios y se paga con «kudos», que no son dinero y no se pueden comprar. Con la clave anónima 0000000000 se genera sin cuenta, a la prioridad más baja de la cola. Con cuenta …"
    },
    {
      "type": "workflow_agent",
      "index": 4,
      "label": "investiga:imagen",
      "phaseIndex": 1,
      "phaseTitle": "Investigar",
      "agentId": "a1fad535768ba067d",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788779179580,
      "queuedAt": 1788779177806,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "RESUMEN HONESTO: no existe, a dia de hoy, ningun servicio A…",
      "promptPreview": "CONTEXTO DEL PROYECTO (Luxy) — leelo entero antes de buscar:\n\nLuxy es un agente personal en Windows con una boveda privada cifrada donde el\nusuario (Daniel) hace roleplay adulto. Necesita proveedores de IA para eso.\n\nRESTRICCIONES DURAS, no negociables:\n- PROHIBIDO proponer la API de OpenAI y la de Anthropic. Estan vetadas por\n  politica del repositorio. No las incluyas ni como comparacion.\n- Un p…",
      "lastProgressAt": 1788780048333,
      "tokens": 117847,
      "toolCalls": 58,
      "durationMs": 865544,
      "resultPreview": "{\"proveedores\":[{\"nombre\":\"ComfyUI en local (servidor HTTP en 127.0.0.1:8188)\",\"categoria\":\"local\",\"url\":\"https://docs.comfy.org/development/comfyui-server/comms_routes\",\"gratis\":\"Totalmente gratis y sin cuenta: es software que corre en el PC de Daniel. El coste es electricidad y VRAM, no dinero ni creditos.\",\"tarjeta\":\"No. No hay registro, ni pasarela de pago, ni terminos de servicio que aceptar.…"
    },
    {
      "type": "workflow_agent",
      "index": 5,
      "label": "investiga:video",
      "phaseIndex": 1,
      "phaseTitle": "Investigar",
      "agentId": "aa348a67e748f2d0e",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788779179773,
      "queuedAt": 1788779177807,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "RESPUESTA CORTA, SIN RELLENO: el video generativo gratuito,…",
      "promptPreview": "CONTEXTO DEL PROYECTO (Luxy) — leelo entero antes de buscar:\n\nLuxy es un agente personal en Windows con una boveda privada cifrada donde el\nusuario (Daniel) hace roleplay adulto. Necesita proveedores de IA para eso.\n\nRESTRICCIONES DURAS, no negociables:\n- PROHIBIDO proponer la API de OpenAI y la de Anthropic. Estan vetadas por\n  politica del repositorio. No las incluyas ni como comparacion.\n- Un p…",
      "lastProgressAt": 1788780008683,
      "tokens": 117712,
      "toolCalls": 59,
      "durationMs": 825892,
      "resultPreview": "{\"proveedores\":[{\"nombre\":\"ComfyUI local (Wan 2.1 / Wan 2.2, pesos Apache 2.0)\",\"categoria\":\"local\",\"gratis\":\"Totalmente. Software gratis (GPL-3.0) y pesos Wan bajo Apache 2.0. Cero coste por generacion, sin cuenta, sin cuota. Solo electricidad y disco (~30-60 GB por familia de modelos).\",\"tarjeta\":\"No. No hay registro ni pasarela de pago en ninguna parte del flujo.\",\"nsfw\":\"El unico camino sin ce…"
    },
    {
      "type": "workflow_agent",
      "index": 6,
      "label": "investiga:infraestructura",
      "phaseIndex": 1,
      "phaseTitle": "Investigar",
      "agentId": "afe5df4f536a1b5da",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788779179645,
      "queuedAt": 1788779177807,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "QUE SIRVE DE VERDAD Y QUE ES ADORNO — el veredicto que pedi…",
      "promptPreview": "CONTEXTO DEL PROYECTO (Luxy) — leelo entero antes de buscar:\n\nLuxy es un agente personal en Windows con una boveda privada cifrada donde el\nusuario (Daniel) hace roleplay adulto. Necesita proveedores de IA para eso.\n\nRESTRICCIONES DURAS, no negociables:\n- PROHIBIDO proponer la API de OpenAI y la de Anthropic. Estan vetadas por\n  politica del repositorio. No las incluyas ni como comparacion.\n- Un p…",
      "lastProgressAt": 1788779833978,
      "tokens": 112271,
      "toolCalls": 54,
      "durationMs": 651188,
      "resultPreview": "{\"proveedores\":[{\"nombre\":\"whisper.cpp (whisper-server)\",\"categoria\":\"local\",\"url\":\"https://github.com/ggml-org/whisper.cpp\",\"gratis\":\"Software libre completo. No hay nivel gratuito porque no hay servicio: se compila y corre en el PC. Modelos GGUF (tiny/base/small/medium/large-v3-turbo) descargables sin cuenta.\",\"tarjeta\":\"No. No hay cuenta, ni registro, ni pasarela de pago. Evidencia: es un repos…"
    },
    {
      "type": "workflow_agent",
      "index": 7,
      "label": "verifica:infraestructura",
      "phaseIndex": 2,
      "phaseTitle": "Verificar",
      "agentId": "a22236ea50b2fee7f",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788779837372,
      "queuedAt": 1788779835592,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "NO COMPROBADO, por orden de importancia: 1. TARJETA EN GROQ…",
      "promptPreview": "CONTEXTO DEL PROYECTO (Luxy) — leelo entero antes de buscar:\n\nLuxy es un agente personal en Windows con una boveda privada cifrada donde el\nusuario (Daniel) hace roleplay adulto. Necesita proveedores de IA para eso.\n\nRESTRICCIONES DURAS, no negociables:\n- PROHIBIDO proponer la API de OpenAI y la de Anthropic. Estan vetadas por\n  politica del repositorio. No las incluyas ni como comparacion.\n- Un p…",
      "lastProgressAt": 1788780290897,
      "tokens": 103994,
      "toolCalls": 45,
      "durationMs": 453524,
      "resultPreview": "{\"revisados\":[{\"nombre\":\"whisper.cpp (whisper-server)\",\"veredicto\":\"confirmado\",\"motivo\":\"Verificado en fuente primaria, y en un punto SUBE de confianza. El README dice literalmente «whisper-server HTTP transcription server with OAI-like API»; licencia MIT confirmada en el badge; lista de modelos confirmada (y mas amplia de lo citado: tiny.en, tiny, base.en, base, small.en, small, medium.en, mediu…"
    },
    {
      "type": "workflow_agent",
      "index": 8,
      "label": "verifica:vision-local",
      "phaseIndex": 2,
      "phaseTitle": "Verificar",
      "agentId": "a54279f1fe689ca83",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788779904356,
      "queuedAt": 1788779902703,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "NO COMPROBADO, y por orden de importancia: 1. NINGUNA PRUEB…",
      "promptPreview": "CONTEXTO DEL PROYECTO (Luxy) — leelo entero antes de buscar:\n\nLuxy es un agente personal en Windows con una boveda privada cifrada donde el\nusuario (Daniel) hace roleplay adulto. Necesita proveedores de IA para eso.\n\nRESTRICCIONES DURAS, no negociables:\n- PROHIBIDO proponer la API de OpenAI y la de Anthropic. Estan vetadas por\n  politica del repositorio. No las incluyas ni como comparacion.\n- Un p…",
      "lastProgressAt": 1788780307629,
      "tokens": 96936,
      "toolCalls": 40,
      "durationMs": 403272,
      "resultPreview": "{\"revisados\":[{\"nombre\":\"llama.cpp / llama-server (ggml-org)\",\"veredicto\":\"confirmado\",\"motivo\":\"Lo esencial resiste y de hecho sale REFORZADO. Verificado en docs/multimodal.md (raw de master): la frase «llama-server via OpenAI-compatible /chat/completions API» es textual, y los flags --mmproj, --no-mmproj y --no-mmproj-offload existen. Lo que el autor marcaba como NO verificado ya lo esta: tools/…"
    },
    {
      "type": "workflow_agent",
      "index": 9,
      "label": "verifica:vision",
      "phaseIndex": 2,
      "phaseTitle": "Verificar",
      "agentId": "a05e947a695c0bff0",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788779956981,
      "queuedAt": 1788779955406,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "QUE NO HE PODIDO COMPROBAR, y por que importa: 1. GROQ SIN …",
      "promptPreview": "CONTEXTO DEL PROYECTO (Luxy) — leelo entero antes de buscar:\n\nLuxy es un agente personal en Windows con una boveda privada cifrada donde el\nusuario (Daniel) hace roleplay adulto. Necesita proveedores de IA para eso.\n\nRESTRICCIONES DURAS, no negociables:\n- PROHIBIDO proponer la API de OpenAI y la de Anthropic. Estan vetadas por\n  politica del repositorio. No las incluyas ni como comparacion.\n- Un p…",
      "lastProgressAt": 1788780457789,
      "tokens": 105031,
      "toolCalls": 56,
      "durationMs": 500806,
      "resultPreview": "{\"revisados\":[{\"nombre\":\"llama.cpp (llama-server) + JoyCaption Beta One GGUF — LOCAL\",\"veredicto\":\"dudoso\",\"motivo\":\"El nucleo tecnico SI se confirma en fuente primaria (docs/multimodal.md de ggml-org/llama.cpp): llama-server hace multimodal «via OpenAI-compatible /chat/completions API», usa «-m model.gguf option with --mmproj file.gguf», y «By default, multimodal projector will be offloaded to GP…"
    },
    {
      "type": "workflow_agent",
      "index": 10,
      "label": "verifica:video",
      "phaseIndex": 2,
      "phaseTitle": "Verificar",
      "agentId": "ad55361266e033bd2",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788780011802,
      "queuedAt": 1788780010223,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "QUE NO PUDE COMPROBAR, por orden de importancia: 1. Venice:…",
      "promptPreview": "CONTEXTO DEL PROYECTO (Luxy) — leelo entero antes de buscar:\n\nLuxy es un agente personal en Windows con una boveda privada cifrada donde el\nusuario (Daniel) hace roleplay adulto. Necesita proveedores de IA para eso.\n\nRESTRICCIONES DURAS, no negociables:\n- PROHIBIDO proponer la API de OpenAI y la de Anthropic. Estan vetadas por\n  politica del repositorio. No las incluyas ni como comparacion.\n- Un p…",
      "lastProgressAt": 1788780552183,
      "tokens": 113343,
      "toolCalls": 63,
      "durationMs": 540380,
      "resultPreview": "{\"revisados\":[{\"nombre\":\"ComfyUI local (Wan 2.1 / Wan 2.2, pesos Apache 2.0)\",\"veredicto\":\"confirmado\",\"motivo\":\"Todo lo comprobable resiste. ComfyUI: la API de GitHub devuelve SPDX 'GPL-3.0' para comfyanonymous/ComfyUI. Rutas: docs.comfy.org/development/comfyui-server/comms_routes lista las 31 rutas HTTP + '/ws', incluidas POST /prompt, GET /history/{prompt_id}, GET /view. Wan2.1 y Wan2.2 READMEs…"
    },
    {
      "type": "workflow_agent",
      "index": 11,
      "label": "verifica:imagen",
      "phaseIndex": 2,
      "phaseTitle": "Verificar",
      "agentId": "a668ca38e91e220ec",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788780053791,
      "queuedAt": 1788780052065,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "QUE NO PUDE COMPROBAR Y POR QUE, para que no se lea este in…",
      "promptPreview": "CONTEXTO DEL PROYECTO (Luxy) — leelo entero antes de buscar:\n\nLuxy es un agente personal en Windows con una boveda privada cifrada donde el\nusuario (Daniel) hace roleplay adulto. Necesita proveedores de IA para eso.\n\nRESTRICCIONES DURAS, no negociables:\n- PROHIBIDO proponer la API de OpenAI y la de Anthropic. Estan vetadas por\n  politica del repositorio. No las incluyas ni como comparacion.\n- Un p…",
      "lastProgressAt": 1788780451101,
      "tokens": 96367,
      "toolCalls": 40,
      "durationMs": 397309,
      "resultPreview": "{\"revisados\":[{\"nombre\":\"ComfyUI en local (servidor HTTP en 127.0.0.1:8188)\",\"veredicto\":\"confirmado\",\"motivo\":\"Las seis rutas estan literalmente en la documentacion oficial (docs.comfy.org/development/comfyui-server/comms_routes): POST /prompt («submit a prompt to the queue», devuelve prompt_id y number), GET /history, GET /view, POST /upload/image, POST /upload/mask y el WebSocket /ws. La pagina…"
    },
    {
      "type": "workflow_agent",
      "index": 12,
      "label": "verifica:texto",
      "phaseIndex": 2,
      "phaseTitle": "Verificar",
      "agentId": "aadd83d155a50b7f7",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788780356555,
      "queuedAt": 1788780355042,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "RESUMEN DE LA REVISIÓN: de 16 hallazgos, 12 confirmados, 3 …",
      "promptPreview": "CONTEXTO DEL PROYECTO (Luxy) — leelo entero antes de buscar:\n\nLuxy es un agente personal en Windows con una boveda privada cifrada donde el\nusuario (Daniel) hace roleplay adulto. Necesita proveedores de IA para eso.\n\nRESTRICCIONES DURAS, no negociables:\n- PROHIBIDO proponer la API de OpenAI y la de Anthropic. Estan vetadas por\n  politica del repositorio. No las incluyas ni como comparacion.\n- Un p…",
      "lastProgressAt": 1788780799039,
      "tokens": 106173,
      "toolCalls": 51,
      "durationMs": 442483,
      "resultPreview": "{\"revisados\":[{\"nombre\":\"AI Horde — texto vía puente oai.aihorde.net\",\"veredicto\":\"confirmado\",\"motivo\":\"Intenté tumbarlo por los cuatro flancos y aguantó. (1) Contrato: descargué https://oai.aihorde.net/openapi.json y las rutas son exactamente /v1/models, /v1/chat/completions, /v1/responses, /heartbeat y /. No es parecido supuesto: /v1/models existe, que es lo que Luxy exige. (2) NSFW leído en po…"
    },
    {
      "type": "workflow_agent",
      "index": 13,
      "label": "sintesis",
      "phaseIndex": 3,
      "phaseTitle": "Sintetizar",
      "agentId": "a20c81796f17b5dd8",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788780804477,
      "queuedAt": 1788780800661,
      "attempt": 1,
      "lastToolName": "Bash",
      "lastToolSummary": "echo ok",
      "promptPreview": "CONTEXTO DEL PROYECTO (Luxy) — leelo entero antes de buscar:\n\nLuxy es un agente personal en Windows con una boveda privada cifrada donde el\nusuario (Daniel) hace roleplay adulto. Necesita proveedores de IA para eso.\n\nRESTRICCIONES DURAS, no negociables:\n- PROHIBIDO proponer la API de OpenAI y la de Anthropic. Estan vetadas por\n  politica del repositorio. No las incluyas ni como comparacion.\n- Un p…",
      "lastProgressAt": 1788780935585,
      "tokens": 231024,
      "toolCalls": 1,
      "durationMs": 131107,
      "resultPreview": "# Recomendación final — proveedores de IA para Luxy\n\nEsto es la síntesis después de pasar cada hallazgo por el verificador. Lo que el verificador refutó, se ha caído. Lo que quedó dudoso, va etiquetado como **no confirmado** y no se apoya ninguna decisión en ello.\n\nAntes de nada, tres cosas que cambian el marco:\n\n- **La trampa que rechazaste con Mistral aparece otra vez, dos veces en su forma lite…"
    }
  ],
  "totalTokens": 1587273,
  "totalToolCalls": 678
}


---

# Anexo — 2026-09-07, segunda vuelta: solo vision alojada

Daniel acota los criterios despues de leer lo anterior:

- **no quiere modelos locales**, solo servicios alojados;
- **le da igual que entrenen con sus datos**: «es un chat explicito, no secretos
  nucleares».

Eso retira el filtro de privacidad —que habia descartado a OpenRouter y a
Cloudflare— pero **no** el de politica de contenido: Gemini, NVIDIA NIM y
Moondream Cloud siguen fuera porque sus terminos lo prohiben con cita, y eso no
depende de lo que a uno le parezca.

Siete agentes sobre las tres candidatas supervivientes. Conclusion, tal cual la
devolvio la sintesis:

{
  "summary": "Que APIs de vision alojadas, gratis y sin tarjeta permiten describir contenido adulto, ignorando el entrenamiento con datos",
  "agentCount": 7,
  "logs": [],
  "result": {
    "sintesis": "Ninguna de las tres cumple los tres criterios duros con certeza: la que mejor acredita el acceso gratis sin tarjeta no tiene política que permita el contenido (solo silencio), y la única política verificada que sí lo permite está en un proveedor cuyo acceso gratis sin tarjeta no se ha podido confirmar. Lo que sigue es orden de prueba, no una vía garantizada.\n\n## 1. Groq — la primera a probar (veredicto del verificador: DUDOSO)\n\n- **Gratis sin tarjeta: lo mejor acreditado del expediente, aunque no literal.** Cuatro páginas del propio Groq coinciden: existe un plan Free de $0 permanente, el método de pago se pide para *subir* a Developer («To upgrade from the Free tier to the Developer tier, you'll need to provide a valid payment method»), y el quickstart va de crear API key a llamar sin ningún paso de facturación. Groq **nunca escribe** «no credit card required»: es implicación estructural, no cita.\n- **Política: NO VERIFICABLE como permiso.** Aquí el verificador tumbó el hallazgo original. Sí existe el punto 5, «...sexually explicit content **that is illegal**», que acota la prohibición. Pero el punto 2 de la misma lista, que el informe no citó, prohíbe usar el servicio «for any illegal, **offensive**, invasive, discriminatory, dangerous, harmful...». «Offensive» va sin calificar: es cláusula paraguas discrecional. Groq no prohíbe, pero tampoco permite. Es silencio bien delimitado, no un sí.\n- **Contrato: CONFIRMADO por documentación, no por parecido.** `https://api.groq.com/openai/v1/chat/completions` con partes `image_url` y data URI base64 (sirve para la bóveda, sin publicar nada), y `/v1/models` documentado. Cumple el criterio 3 y D-022 sin sondear rutas.\n- **Punto débil estructural:** los dos modelos con vista (`qwen/qwen3.6-27b`, `qwen/qwen3.8-27b`) están en **Preview**, no en producción: «may be discontinued at short notice». Groq no tiene hoy ningún modelo de visión en producción.\n- **Volumen real:** el cuello es el TPM, no el RPM. 8K TPM ÷ 2048 tokens por imagen = 3 imágenes por minuto; ~200K TPD ≈ 80-90 al día. Y ojo: las «5 imágenes por petición» son del modelo, no del plan gratis — en Free no caben (5 × 2048 = 10.240 > 8K TPM).\n\n**Qué hacer para probarla, en una línea:** crear cuenta en console.groq.com, generar la API key en /keys y mandar una imagen real de la bóveda en base64 a `qwen/qwen3.6-27b` pidiendo pie de foto — esa única llamada confirma de paso que el alta no pide tarjeta.\n\n## 2. OpenRouter — segunda conexión en paralelo (DUDOSO)\n\n- **Gratis sin tarjeta: NO VERIFICABLE.** La cita que lo sostenía («The free tier needs no credit card») **no existe** en el blog al que se atribuía; lo que hay es una tabla comparativa que marca «No» en la columna Credit Card para Mistral, Cerebras y NVIDIA NIM — justo los que Daniel descartó en persona por pedir tarjeta. Fuente refutada por los propios datos de Daniel. Los indicios de primera parte (fila «Less than 10 créditos», 402 solo con saldo negativo) son indirectos, y los Terms dicen lo contrario: «OpenRouter requires users to purchase Credits to make API calls».\n- **Política: silencio DELEGADO.** OpenRouter no tiene cláusula de contenido adulto y traslada la responsabilidad por escrito: «You are solely responsible for reviewing the Model Terms applicable to each Model». La política real es la del proveedor de destino, y 5 de los 8 modelos gratis con vista los sirven Google AI Studio, Nvidia o AtlasCloud: los vetos ya ganados entrando por la puerta de atrás.\n- **Lo único positivamente favorable de todo el expediente:** Thinking Machines (`thinkingmachines/inkling:free`), con carve-out verificado literal — «...generate or manipulate sexually explicit content **for purposes other than** scientific, educational, documentary, or artistic purposes» — y además prohíbe «generate or manipulate», no describir.\n- **Contrato: CONFIRMADO en vivo.** `/v1/models` público, `architecture.input_modalities.includes(\"image\")` como filtro, formato `image_url` documentado. 20 RPM / 50 peticiones al día sin comprar nada.\n\n**Pendiente antes de usar `minimax/minimax-m3:free`** (el candidato con mejor pronóstico de colaboración): su proveedor es GMICloud y **su política no se ha podido leer** — sus tres documentos legales se renderizan por JavaScript y devuelven solo navegación. La cita «obscene» que se le atribuía no está verificada, y nadie ha abierto su Acceptable Use Policy dedicada, que es exactamente donde AtlasCloud escondía su veto. Hay que abrirla con un navegador de verdad antes de tocar ese modelo.\n\n## 3. Cloudflare Workers AI — descartada (NO SIRVE)\n\nFalla por lo técnico y está confirmado: **no expone `/v1/models`**. Su catálogo es `/ai/models/search`, con sobre propietario; `packages/shared/src/models/catalog-fetch.ts` espera la forma OpenAI `{data:[{id}]}`, así que la conexión ni se daría de alta. Además, y contra lo que decía el informe original, su política **no permite**: la lista de contenido prohibido es abierta («includes but is not limited to») y a su sola discreción — silencio, no permiso. No reabrirla por la vía de un adaptador nativo.\n\n## Política ≠ colaboración del modelo\n\nSon dos preguntas distintas y solo la primera está cerrada:\n\n| Modelo | La política | El modelo colaborará |\n|---|---|---|\n| `qwen/qwen3.6-27b` (Groq) | silencio, con cláusula «offensive» genérica encima | no probado; Qwen3-VL tiene fama de negarse (indicio: existen finetunes «NSFW-Caption» para arreglarlo — **no verificado**) |\n| `thinkingmachines/inkling:free` | **la mejor y verificada** (carve-out artístico) | mal pronóstico: laboratorio frontera, alineamiento fuerte |\n| `minimax/minimax-m3:free` | **desconocida** (GMICloud ilegible) | mejor pronóstico: pesos abiertos servidos por un tercero |\n\nNingún modelo gratis con vista del expediente es un modelo sin censura. Esto solo lo cierra el banco de pruebas de Luxy, con una imagen real.\n\n**Si un modelo se niega, se cambia de modelo, no de prompt.** El punto 13 de la política de Groq prohíbe «to intentionally circumvent any aspect of the Cloud Services... including abuse protections or safety mechanisms». Insistir para rodear una negativa es lo único que convertiría un silencio tolerable en un incumplimiento claro.\n\n## Dos comprobaciones antes de escribir código\n\n1. Alta en Groq: mirar si en algún punto pide tarjeta **o verificación por SMS** (esto último no lo dice ninguna página del proveedor; queda abierto).\n2. Abrir con navegador la Acceptable Use Policy de GMICloud, si se quiere usar MiniMax.\n\n## Nota de diseño para Luxy\n\nConfirmado en ambos catálogos: **no existe ningún campo de moderación ni de política de contenido** (`is_moderated`, `data_policy`, nada). Luxy puede autodetectar visión, pero la política hay que fijarla a mano por modelo y proveedor. En OpenRouter, además, fijar `provider.order` con `allow_fallbacks: false`, o una imagen de la bóveda puede acabar un día en Google AI Studio porque añadieron ese endpoint al modelo gratis. Y descartar `openrouter/free`: elige modelo al azar, es decir, política no determinista en cada llamada."
  },
  "workflowProgress": [
    {
      "type": "workflow_phase",
      "index": 1,
      "title": "Investigar"
    },
    {
      "type": "workflow_phase",
      "index": 2,
      "title": "Verificar"
    },
    {
      "type": "workflow_phase",
      "index": 3,
      "title": "Sintetizar"
    },
    {
      "type": "workflow_agent",
      "index": 1,
      "label": "investiga:openrouter",
      "phaseIndex": 1,
      "phaseTitle": "Investigar",
      "agentId": "a45a7561f4c3f72a8",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788788424633,
      "queuedAt": 1788788422961,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "NO exige tarjeta, pero con una contradiccion en su propia d…",
      "promptPreview": "CONTEXTO. Luxy es un agente personal en Windows con una boveda cifrada donde\nDaniel hace roleplay adulto. Necesita VISION: pasarle una imagen a un modelo y\nrecibir una descripcion, para usarla como pie de foto.\n\nDECISION QUE DANIEL ACABA DE TOMAR y que cambia los criterios:\n- **NO quiere modelos locales.** Nada de Ollama, LM Studio, KoboldCpp,\n  llama.cpp ni ComfyUI. Solo servicios alojados. No lo…",
      "lastProgressAt": 1788788813034,
      "tokens": 83822,
      "toolCalls": 29,
      "durationMs": 384950,
      "resultPreview": "{\"tarjeta\":\"NO exige tarjeta, pero con una contradiccion en su propia documentacion que conviene conocer.\\n\\nA FAVOR (docs de limites, openrouter.ai/docs/api-reference/limits): la tabla de limites de modelos `:free` tiene una fila explicita para cuentas con «Less than 10» creditos comprados (50 peticiones/dia). Esa fila solo tiene sentido si una cuenta que nunca ha pagado funciona. Ademas: «If you…"
    },
    {
      "type": "workflow_agent",
      "index": 2,
      "label": "investiga:cloudflare",
      "phaseIndex": 1,
      "phaseTitle": "Investigar",
      "agentId": "a6e1f2e1c48c9b66d",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788788424549,
      "queuedAt": 1788788422961,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "NO pide tarjeta. Confirmado en la fuente del proveedor (doc…",
      "promptPreview": "CONTEXTO. Luxy es un agente personal en Windows con una boveda cifrada donde\nDaniel hace roleplay adulto. Necesita VISION: pasarle una imagen a un modelo y\nrecibir una descripcion, para usarla como pie de foto.\n\nDECISION QUE DANIEL ACABA DE TOMAR y que cambia los criterios:\n- **NO quiere modelos locales.** Nada de Ollama, LM Studio, KoboldCpp,\n  llama.cpp ni ComfyUI. Solo servicios alojados. No lo…",
      "lastProgressAt": 1788788866826,
      "tokens": 94553,
      "toolCalls": 42,
      "durationMs": 442276,
      "resultPreview": "{\"tarjeta\":\"NO pide tarjeta. Confirmado en la fuente del proveedor (docs de precios de Workers AI): «Our free allocation allows anyone to use a total of 10,000 Neurons per day at no charge». En la tabla de planes, \\\"Workers Free\\\" incluye \\\"10,000 Neurons per day\\\" y el precio del excedente aparece como «N/A - Upgrade to Workers Paid». Eso es mejor que un free tier normal: al agotarse corta en sec…"
    },
    {
      "type": "workflow_agent",
      "index": 3,
      "label": "investiga:groq",
      "phaseIndex": 1,
      "phaseTitle": "Investigar",
      "agentId": "a403e81d21bef96e4",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788788424630,
      "queuedAt": 1788788422961,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "GROQ — SÍ se puede usar gratis sin tarjeta, y por fin hay f…",
      "promptPreview": "CONTEXTO. Luxy es un agente personal en Windows con una boveda cifrada donde\nDaniel hace roleplay adulto. Necesita VISION: pasarle una imagen a un modelo y\nrecibir una descripcion, para usarla como pie de foto.\n\nDECISION QUE DANIEL ACABA DE TOMAR y que cambia los criterios:\n- **NO quiere modelos locales.** Nada de Ollama, LM Studio, KoboldCpp,\n  llama.cpp ni ComfyUI. Solo servicios alojados. No lo…",
      "lastProgressAt": 1788788888565,
      "tokens": 97403,
      "toolCalls": 45,
      "durationMs": 460483,
      "resultPreview": "{\"tarjeta\":\"GROQ — SÍ se puede usar gratis sin tarjeta, y por fin hay fuente del proveedor (no un blog).\\n\\nLa prueba está en las Billing FAQs de Groq (console.groq.com/docs/billing-faqs), literal:\\n\\n«To upgrade from the Free tier to the Developer tier, you'll need to provide a valid payment method (credit card, US bank account, or SEPA debit account).»\\n\\nLéelo al revés: el método de pago se exi…"
    },
    {
      "type": "workflow_agent",
      "index": 4,
      "label": "verifica:openrouter",
      "phaseIndex": 2,
      "phaseTitle": "Verificar",
      "agentId": "a7fb62b363cd5b0ca",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788788816520,
      "queuedAt": 1788788814882,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "NO VERIFICABLE (no \"confirmado\"). La conclusion probablemen…",
      "promptPreview": "CONTEXTO. Luxy es un agente personal en Windows con una boveda cifrada donde\nDaniel hace roleplay adulto. Necesita VISION: pasarle una imagen a un modelo y\nrecibir una descripcion, para usarla como pie de foto.\n\nDECISION QUE DANIEL ACABA DE TOMAR y que cambia los criterios:\n- **NO quiere modelos locales.** Nada de Ollama, LM Studio, KoboldCpp,\n  llama.cpp ni ComfyUI. Solo servicios alojados. No lo…",
      "lastProgressAt": 1788789171459,
      "tokens": 83742,
      "toolCalls": 28,
      "durationMs": 354937,
      "resultPreview": "{\"tarjetaConfirmada\":\"NO VERIFICABLE (no \\\"confirmado\\\"). La conclusion probablemente sea cierta, pero la cita que la sostenia esta rota.\\n\\nLO QUE SI COMPROBE, primera parte y textual:\\n- openrouter.ai/docs/api-reference/limits: la tabla existe tal cual. Fila \\\"Credits Purchased: Less than 10\\\" -> \\\"20\\\" RPM / \\\"50\\\" RPD; fila \\\"At least 10\\\" -> 20 / 1000. Y textual: «If your account has a negati…"
    },
    {
      "type": "workflow_agent",
      "index": 5,
      "label": "verifica:cloudflare",
      "phaseIndex": 2,
      "phaseTitle": "Verificar",
      "agentId": "ae4bd3d0f9f98d141",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788788870184,
      "queuedAt": 1788788868463,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "CONFIRMADO en lo principal, REFUTADO en el matiz que el hal…",
      "promptPreview": "CONTEXTO. Luxy es un agente personal en Windows con una boveda cifrada donde\nDaniel hace roleplay adulto. Necesita VISION: pasarle una imagen a un modelo y\nrecibir una descripcion, para usarla como pie de foto.\n\nDECISION QUE DANIEL ACABA DE TOMAR y que cambia los criterios:\n- **NO quiere modelos locales.** Nada de Ollama, LM Studio, KoboldCpp,\n  llama.cpp ni ComfyUI. Solo servicios alojados. No lo…",
      "lastProgressAt": 1788789306735,
      "tokens": 94678,
      "toolCalls": 41,
      "durationMs": 436549,
      "resultPreview": "{\"tarjetaConfirmada\":\"CONFIRMADO en lo principal, REFUTADO en el matiz que el hallazgo subraya («sin peros»).\\n\\nVerificado en fuentes del proveedor, no en blogs:\\n- developers.cloudflare.com/workers-ai/platform/pricing/: «Our free allocation allows anyone to use a total of 10,000 Neurons per day at no charge». La cita existe y es literal.\\n- developers.cloudflare.com/workers/platform/pricing/: «B…"
    },
    {
      "type": "workflow_agent",
      "index": 6,
      "label": "verifica:groq",
      "phaseIndex": 2,
      "phaseTitle": "Verificar",
      "agentId": "ab61840d6d982e755",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788788896382,
      "queuedAt": 1788788892807,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "CONFIRMADO CON RESERVA — no he podido refutarlo, y además h…",
      "promptPreview": "CONTEXTO. Luxy es un agente personal en Windows con una boveda cifrada donde\nDaniel hace roleplay adulto. Necesita VISION: pasarle una imagen a un modelo y\nrecibir una descripcion, para usarla como pie de foto.\n\nDECISION QUE DANIEL ACABA DE TOMAR y que cambia los criterios:\n- **NO quiere modelos locales.** Nada de Ollama, LM Studio, KoboldCpp,\n  llama.cpp ni ComfyUI. Solo servicios alojados. No lo…",
      "lastProgressAt": 1788789207722,
      "tokens": 78489,
      "toolCalls": 27,
      "durationMs": 311338,
      "resultPreview": "{\"tarjetaConfirmada\":\"CONFIRMADO CON RESERVA — no he podido refutarlo, y además he encontrado una fuente primaria NUEVA que el hallazgo no tenía. Pero la frase literal sigue sin existir.\\n\\nLo que he verificado yo mismo en páginas de Groq:\\n\\n1. console.groq.com/settings/billing/plans (página de planes del propio console, se renderiza sin sesión). Tarjeta del plan Free, textos exactos: «Free» · «$…"
    },
    {
      "type": "workflow_agent",
      "index": 7,
      "label": "sintesis",
      "phaseIndex": 3,
      "phaseTitle": "Sintetizar",
      "agentId": "a4a82147f842ee351",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788789312772,
      "queuedAt": 1788789310859,
      "attempt": 1,
      "promptPreview": "CONTEXTO. Luxy es un agente personal en Windows con una boveda cifrada donde\nDaniel hace roleplay adulto. Necesita VISION: pasarle una imagen a un modelo y\nrecibir una descripcion, para usarla como pie de foto.\n\nDECISION QUE DANIEL ACABA DE TOMAR y que cambia los criterios:\n- **NO quiere modelos locales.** Nada de Ollama, LM Studio, KoboldCpp,\n  llama.cpp ni ComfyUI. Solo servicios alojados. No lo…",
      "lastProgressAt": 1788789386366,
      "tokens": 91417,
      "toolCalls": 0,
      "durationMs": 73592,
      "resultPreview": "Ninguna de las tres cumple los tres criterios duros con certeza: la que mejor acredita el acceso gratis sin tarjeta no tiene política que permita el contenido (solo silencio), y la única política verificada que sí lo permite está en un proveedor cuyo acceso gratis sin tarjeta no se ha podido confirmar. Lo que sigue es orden de prueba, no una vía garantizada.\n\n## 1. Groq — la primera a probar (vere…"
    }
  ],
  "totalTokens": 624104,
  "totalToolCalls": 212
}


---

# Anexo — 2026-09-07, tercera vuelta: Alibaba Cloud Model Studio (Qwen)

Daniel encuentra la consola de Model Studio en Singapur y pide investigarla:
https://modelstudio.console.alibabacloud.com/ap-southeast-1

Siete agentes. **Veredicto: no sirve.** La causa no es el precio ni la tarjeta:
es una criba de contenido ANTES de la inferencia que Alibaba documenta en su
propia tabla de errores, y cuyo unico remedio documentado es cambiar la imagen
o abrir un ticket.

Leccion de metodo que deja este caso, y que conviene aplicar al siguiente
candidato: **la moderacion se pregunta la PRIMERA, no la ultima.** Un nivel
gratuito generoso no compensa un filtro obligatorio, y aqui las cuotas eran lo
mas visible de la pagina.

{
  "summary": "Investiga si Alibaba Cloud Model Studio (Qwen, Singapur) sirve para la vision NSFW de Luxy: coste real, tarjeta, moderacion y contrato",
  "agentCount": 7,
  "logs": [],
  "result": {
    "sintesis": "**No te sirve, y no por el precio: te sirve el contrato y probablemente hasta el alta sin tarjeta, pero Model Studio criba la imagen de entrada ANTES de que el modelo la mire, y el propio texto de error de Alibaba nombra «porn» como una de las categorías de esa criba.** Para tu caso —mandar una imagen de ficción adulta y pedir un pie de foto— eso no es un riesgo teórico: es literalmente el escenario que describe su documentación de errores. Descártala.\n\n---\n\n## 1. La moderación (lo que decide, y es del proveedor, no de blogs)\n\nFuente: la tabla oficial de códigos de error de Model Studio, verificada en los dos espejos (`alibabacloud.com/help/en/model-studio/error-code` y `help.aliyun.com/en/model-studio/error-code`).\n\n- Existe un filtro de plataforma llamado **Green Net (绿网)** en la propia ruta de inferencia. Código `400 - DataInspectionFailed` / `data_inspection_failed`, con **tres** variantes literales: «Input or output data may contain inappropriate content.», «Input data...», «Output data...». **Entrada Y salida, dicho por ellos**, no deducido.\n- La fila específica de imagen: «*Qwen rejected the input image before model inference; no actual ad/porn/OCR result was produced*». La causa documentada dice que es un «pre-inference content-compliance check on **multimodal input images**» — general, no de un modelo concreto (se intentó refutar por ahí y falló).\n- **La solución oficial que documenta Alibaba para ese bloqueo es: cambia la imagen, o abre un ticket de soporte.** No documentan ningún interruptor. Ésa es la frase más concluyente de toda la página.\n- La única palanca que sí existe, la cabecera `X-DashScope-DataInspection`, es **lo contrario** de un apagado: activa una capa *adicional* de pago (AI Guardrails), sólo admite el valor `\"cip\"` y se factura con mínimo de 1.000 tokens por comprobación. La capa base opera aparte.\n- El truco `\"disable\"` que circula por foros: **no verificable**. Sale de un issue de GitHub cerrado como «not planned», sin enlace a documentación de Alibaba y sin nadie que confirme que funcione. Y hay desinformación activa: un resumen de buscador lo atribuía a la documentación de LiteLLM, y allí esa cabecera no aparece. No lo persigas.\n- Al dispararse no hay degradación suave: **HTTP 400 y no hay respuesta**. Mismo status que un parámetro mal formado, así que habría que discriminar por el substring `DataInspectionFailed`.\n- ¿Es más laxo en Singapur? **Silencio documental**, y silencio no es permiso. La tabla de errores no excluye ap-southeast-1, y hay reportes de terceros (no del proveedor) de `InternalError.Algo.DataInspectionFailed` en `dashscope-intl.aliyuncs.com`, incluso falsos positivos sobre código benigno.\n\n**Corrección al primer pase:** la cita que se atribuía a la página de monitorización (model-telemetry) no existe ahí; esa página sólo dice «Number of content moderation blocks». La conclusión era correcta, la fuente no. La buena es `error-code`.\n\n## 2. La política (pregunta distinta, y aquí también en contra)\n\nSeparado a propósito: una cosa es qué permite el contrato y otra qué hará el sistema. Aquí coinciden las dos, que es el peor caso.\n\n- **Terms of Use internacional §2.3(c)** y **Membership Agreement §2.9(c)**: prohíben poner a disposición en la Plataforma material «defamatory, **obscene**, abusive...».\n- **Membership Agreement §3.2(e)(ii)**: «*is obscene or contains or infers any **pornography** or sex-related merchandising or any other content that otherwise promotes sexually explicit materials*».\n- **Términos propios de Model Studio** (bailian-service-notes), sobre lo que TÚ envías: «*avoid entering any content that may violate laws or **public order and good morals***». Es vaga, pero está en el documento correcto (la que apunta a la entrada de la API).\n- **Product Terms §3.4 y §3.6**: derecho a vigilar el uso y a suspender o terminar la cuenta.\n\nMatiz honesto: la cláusula que nombra «pornography» está redactada para *Member Content* publicado en la plataforma, y es discutible que un prompt privado a la API caiga ahí. **No existe** una política de uso aceptable específica de Model Studio con catálogo de conductas: eso es silencio, no permiso. Y queda un hueco: el Artículo 4.48 de los Product Terms (la sección propia de Model Studio) no se ha podido recuperar.\n\nCriterio 4, como dato y no como descarte: **no entrenan con tus datos** («will never use your data for model training»). Juega a tu favor y da igual.\n\n## 3. La tarjeta (sin resolver, y ya no importa)\n\n- La documentación **no** exige tarjeta para registrarse ni para activar Model Studio; la verificación de identidad la acotan ellos mismos con el paréntesis «(for China region)», y Singapur no es China continental. La evidencia más fuerte a favor: la página de errores describe la causa de `AllocationQuota.FreeTierOnly` como «*New unverified users exhaust free quota and make requests*» — o sea, dan por hecho que un usuario **no verificado** llama.\n- **Pero** no hay ninguna página de Alibaba que diga «no se requiere tarjeta». Esa frase sale de blogs: **no verificable**. Y existe un error documentado, `BASIC_INFO_UNCOMPLETED`, cuya causa es «*you haven't completed all your personal information, including a **valid payment method***», sin que se haya podido localizar en qué operación salta. Es el mismo patrón que te quemó con Mistral.\n- Veredicto de este criterio: **probable que pase, no verificado**. Sólo lo cerraría intentar el alta, y no merece la pena intentarla.\n- Por si algún día vuelve el tema: añadir tarjeta dispara una retención temporal de 1 USD y **no aceptan tarjetas virtuales**.\n\n## 4. El contrato (sale bien; es lo único bueno)\n\n- Chat completions compatible con OpenAI: **sí**, `POST {base}/chat/completions`, con `Authorization: Bearer` a secas. Encaja tal cual con Proveedores HTTP.\n- **Imágenes en base64: sí, documentado** — `{\"type\":\"image_url\",\"image_url\":{\"url\":\"data:image/png;base64,...\"}}`. No exige URL pública, así que tu bóveda cifrada no tendría que publicar nada. Era el punto que más podía romperse y no se rompe. Límite 10 MB ya codificado (5 MB en algunos modelos); JPEG, PNG, BMP, WEBP.\n- URL base Singapur: `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` (heredado, vivo, sin fecha de retirada) o `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`. Ojo: el dominio `token-plan.*` que alguien podría recomendarte está descrito por Alibaba como «*for interactive AI coding tools only — not for backend services*», es decir, excluye justo el uso de Luxy.\n- **`/v1/models`: no documentado.** El listado oficial es `GET /api/v1/models` con envoltorio DashScope, no forma OpenAI. La ruta compatible existe (devuelve 401, mientras una ruta inventada devuelve 404) pero su forma no está verificada. Corrección útil: **esto no bloquearía a Luxy**. En `packages/shared/src/models/registry.ts` una lista vacía se trata como «no se sabe», no como «no disponible», y `catalog-fetch.ts` devuelve lista vacía sin error ante un envoltorio ajeno. Catálogo vacío y modelo escrito a mano, nada más.\n\n## 5. Las cifras del gratis (últimas, porque no deciden)\n\n1.000.000 de tokens **por modelo** (los de visión incluidos), **90 días** desde la activación, sólo región Singapur con ámbito International, sólo inferencia en tiempo real. Caduca los uses o no: es una prueba con fecha de caducidad, no un nivel gratuito permanente. Si algún día se pagara, `qwen3-vl-flash` cuesta 0,05 USD por millón de entrada. Nada de esto compensa el punto 1. Aviso menor: los identificadores de snapshot que circulan (`qwen3-vl-plus-2025-12-19` y similares) no están confirmados; el catálogo rota rápido.\n\n---\n\n**Resumen operativo:** no abras cuenta. El bloqueo ocurre antes de la inferencia, cubre entrada y salida, y el único recurso que el propio proveedor documenta es cambiar el contenido o abrir un ticket. Para el siguiente candidato, haz de la moderación la **primera** pregunta y no la última: aquí el precio, el contrato y hasta el base64 estaban bien, y aun así no vale para nada."
  },
  "workflowProgress": [
    {
      "type": "workflow_phase",
      "index": 1,
      "title": "Investigar"
    },
    {
      "type": "workflow_phase",
      "index": 2,
      "title": "Verificar"
    },
    {
      "type": "workflow_phase",
      "index": 3,
      "title": "Sintetizar"
    },
    {
      "type": "workflow_agent",
      "index": 1,
      "label": "investiga:acceso",
      "phaseIndex": 1,
      "phaseTitle": "Investigar",
      "agentId": "af1a97bc52da6c5cb",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788790748685,
      "queuedAt": 1788790747030,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "Mi línea era acceso y coste real de Alibaba Cloud Model Stu…",
      "promptPreview": "OBJETIVO. Daniel ha encontrado esta pagina y quiere saber si le sirve:\nhttps://modelstudio.console.alibabacloud.com/ap-southeast-1  (tab API)\n\nEs **Alibaba Cloud Model Studio** (antes DashScope / Bailian), el servicio que\nsirve los modelos **Qwen**, en la region internacional ap-southeast-1\n(Singapur). Esa URL es una consola que exige cuenta: la investigacion tiene que\napoyarse en la DOCUMENTACION…",
      "lastProgressAt": 1788791075672,
      "tokens": 78482,
      "toolCalls": 28,
      "durationMs": 326985,
      "resultPreview": "{\"resumen\":\"Mi línea era acceso y coste real de Alibaba Cloud Model Studio (región Singapur, ap-southeast-1). Resultado: en lo económico es de lo mejor que hemos visto. El alta en alibabacloud.com sólo pide correo, contraseña, tipo de cuenta, país y verificación de móvil o correo; la tarjeta y la verificación de identidad son pasos POSTERIORES y, según la documentación de Alibaba, sólo obligatorio…"
    },
    {
      "type": "workflow_agent",
      "index": 2,
      "label": "investiga:moderacion",
      "phaseIndex": 1,
      "phaseTitle": "Investigar",
      "agentId": "a573b9b1eb9853408",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788790748702,
      "queuedAt": 1788790747031,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "Mi línea era moderación y política de contenido, y la respu…",
      "promptPreview": "OBJETIVO. Daniel ha encontrado esta pagina y quiere saber si le sirve:\nhttps://modelstudio.console.alibabacloud.com/ap-southeast-1  (tab API)\n\nEs **Alibaba Cloud Model Studio** (antes DashScope / Bailian), el servicio que\nsirve los modelos **Qwen**, en la region internacional ap-southeast-1\n(Singapur). Esa URL es una consola que exige cuenta: la investigacion tiene que\napoyarse en la DOCUMENTACION…",
      "lastProgressAt": 1788791166141,
      "tokens": 93369,
      "toolCalls": 38,
      "durationMs": 412720,
      "resultPreview": "{\"resumen\":\"Mi línea era moderación y política de contenido, y la respuesta es concluyente en contra. Alibaba Cloud Model Studio aplica un filtro de contenido en la propia ruta de inferencia, sobre ENTRADA y SALIDA, documentado por el proveedor con su propio código de error (`DataInspectionFailed`). Lo más grave para el caso de Daniel: la documentación de códigos de error describe explícitamente u…"
    },
    {
      "type": "workflow_agent",
      "index": 3,
      "label": "investiga:contrato",
      "phaseIndex": 1,
      "phaseTitle": "Investigar",
      "agentId": "a8cb2cad41b80d71f",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788790748697,
      "queuedAt": 1788790747032,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "Model Studio sí ofrece modo compatible con OpenAI y sí acep…",
      "promptPreview": "OBJETIVO. Daniel ha encontrado esta pagina y quiere saber si le sirve:\nhttps://modelstudio.console.alibabacloud.com/ap-southeast-1  (tab API)\n\nEs **Alibaba Cloud Model Studio** (antes DashScope / Bailian), el servicio que\nsirve los modelos **Qwen**, en la region internacional ap-southeast-1\n(Singapur). Esa URL es una consola que exige cuenta: la investigacion tiene que\napoyarse en la DOCUMENTACION…",
      "lastProgressAt": 1788791257986,
      "tokens": 95877,
      "toolCalls": 34,
      "durationMs": 504566,
      "resultPreview": "{\"resumen\":\"Model Studio sí ofrece modo compatible con OpenAI y sí acepta imágenes como data URI en base64, que es justo lo que necesita una bóveda cifrada: nada tiene que publicarse en internet. Técnicamente se enchufa a Luxy casi sin fricción. Dos reservas de contrato: (1) el catálogo de modelos documentado NO tiene forma OpenAI, es un endpoint DashScope propio en /api/v1/models con envoltorio d…"
    },
    {
      "type": "workflow_agent",
      "index": 4,
      "label": "verifica:acceso",
      "phaseIndex": 2,
      "phaseTitle": "Verificar",
      "agentId": "a88c17fef73676311",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788791078863,
      "queuedAt": 1788791077253,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "PARCIALMENTE CONFIRMADO, con una correccion de cita y una b…",
      "promptPreview": "OBJETIVO. Daniel ha encontrado esta pagina y quiere saber si le sirve:\nhttps://modelstudio.console.alibabacloud.com/ap-southeast-1  (tab API)\n\nEs **Alibaba Cloud Model Studio** (antes DashScope / Bailian), el servicio que\nsirve los modelos **Qwen**, en la region internacional ap-southeast-1\n(Singapur). Esa URL es una consola que exige cuenta: la investigacion tiene que\napoyarse en la DOCUMENTACION…",
      "lastProgressAt": 1788791588297,
      "tokens": 104386,
      "toolCalls": 45,
      "durationMs": 509432,
      "resultPreview": "{\"tarjetaConfirmada\":\"PARCIALMENTE CONFIRMADO, con una correccion de cita y una bandera roja sin cerrar.\\n\\nLO QUE SE SOSTIENE (lo he vuelto a leer en las paginas del proveedor):\\n- Alta: help/en/account/step-1-register-an-alibaba-cloud-account confirma que el registro pide correo, contrasena, Account Type, Country/Region y verificacion de movil o correo, y que anadir informacion de pago es una fa…"
    },
    {
      "type": "workflow_agent",
      "index": 5,
      "label": "verifica:moderacion",
      "phaseIndex": 2,
      "phaseTitle": "Verificar",
      "agentId": "a126c4cf5b01ef3dc",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788791169364,
      "queuedAt": 1788791167713,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "NO CONFIRMADO (no era mi linea, pero lo crucé). Lo que dice…",
      "promptPreview": "OBJETIVO. Daniel ha encontrado esta pagina y quiere saber si le sirve:\nhttps://modelstudio.console.alibabacloud.com/ap-southeast-1  (tab API)\n\nEs **Alibaba Cloud Model Studio** (antes DashScope / Bailian), el servicio que\nsirve los modelos **Qwen**, en la region internacional ap-southeast-1\n(Singapur). Esa URL es una consola que exige cuenta: la investigacion tiene que\napoyarse en la DOCUMENTACION…",
      "lastProgressAt": 1788791474407,
      "tokens": 84542,
      "toolCalls": 26,
      "durationMs": 305041,
      "resultPreview": "{\"tarjetaConfirmada\":\"NO CONFIRMADO (no era mi linea, pero lo crucé). Lo que dice el proveedor y lo que calla:\\n\\nCONFIRMADO en doc del proveedor (https://www.alibabacloud.com/help/en/model-studio/new-free-quota): la cuota gratis se concede automaticamente al activar Model Studio, «The free quota is valid for 90 days, starting from the date you activate Alibaba Cloud Model Studio, the model is rel…"
    },
    {
      "type": "workflow_agent",
      "index": 6,
      "label": "verifica:contrato",
      "phaseIndex": 2,
      "phaseTitle": "Verificar",
      "agentId": "a36f520556d426b9a",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788791261044,
      "queuedAt": 1788791259459,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "NO VERIFICADO, y sigue sin verificar. Mi línea era el contr…",
      "promptPreview": "OBJETIVO. Daniel ha encontrado esta pagina y quiere saber si le sirve:\nhttps://modelstudio.console.alibabacloud.com/ap-southeast-1  (tab API)\n\nEs **Alibaba Cloud Model Studio** (antes DashScope / Bailian), el servicio que\nsirve los modelos **Qwen**, en la region internacional ap-southeast-1\n(Singapur). Esa URL es una consola que exige cuenta: la investigacion tiene que\napoyarse en la DOCUMENTACION…",
      "lastProgressAt": 1788791564527,
      "tokens": 81693,
      "toolCalls": 21,
      "durationMs": 303481,
      "resultPreview": "{\"tarjetaConfirmada\":\"NO VERIFICADO, y sigue sin verificar. Mi línea era el contrato; no he leído la página de alta de Alibaba Cloud ni he creado cuenta, así que no afirmo ni que pida tarjeta ni que no. El hallazgo hace bien en negarse a afirmarlo.\\n\\nConfirmo la degradación del dato colateral: la cuota gratuita de 90 días (y las cifras de 1M/1M o 70M/100M tokens) sale de blogs y agregadores, NO d…"
    },
    {
      "type": "workflow_agent",
      "index": 7,
      "label": "sintesis",
      "phaseIndex": 3,
      "phaseTitle": "Sintetizar",
      "agentId": "a9e3360afbdeaec7a",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788791591777,
      "queuedAt": 1788791589840,
      "attempt": 1,
      "promptPreview": "OBJETIVO. Daniel ha encontrado esta pagina y quiere saber si le sirve:\nhttps://modelstudio.console.alibabacloud.com/ap-southeast-1  (tab API)\n\nEs **Alibaba Cloud Model Studio** (antes DashScope / Bailian), el servicio que\nsirve los modelos **Qwen**, en la region internacional ap-southeast-1\n(Singapur). Esa URL es una consola que exige cuenta: la investigacion tiene que\napoyarse en la DOCUMENTACION…",
      "lastProgressAt": 1788791686583,
      "tokens": 89984,
      "toolCalls": 0,
      "durationMs": 94803,
      "resultPreview": "**No te sirve, y no por el precio: te sirve el contrato y probablemente hasta el alta sin tarjeta, pero Model Studio criba la imagen de entrada ANTES de que el modelo la mire, y el propio texto de error de Alibaba nombra «porn» como una de las categorías de esa criba.** Para tu caso —mandar una imagen de ficción adulta y pedir un pie de foto— eso no es un riesgo teórico: es literalmente el escenar…"
    }
  ],
  "totalTokens": 628333,
  "totalToolCalls": 192
}


---

# Anexo — 2026-09-07, cuarta vuelta: proveedores de nicho «tipo Xavira»

Daniel: «investiga alternativas no tan conocidas, indaga profundamente en la
web, tipo paginas como Xavira, tiene que haber buenas alternativas con al menos
un poco de credito de prueba».

Trece agentes, seis frentes, 880 busquedas. Se partio del adaptador real
`apps/agent/src/providers/xavira.ts` para fijar la FORMA que habia que buscar
—personaje persistente + cola asincrona con sondeo— y se entro por puertas
laterales, no por listas de «mejores APIs gratis»: el indice de conexiones de
SillyTavern, comunidades de captioning y de LoRA, directorios de APIs adultas y
comparativas de usuarios.

**Aviso de proceso:** el agente de sintesis quedo marcado por el clasificador de
seguridad. Revisado el texto entero: es analisis de terminos de servicio y de
contratos de API, sin instrucciones ni recomendaciones de rodear el filtro de
nadie. Se conserva por su valor, con esta nota.

**La leccion de metodo, que vale mas que cualquier proveedor concreto:** lo que
decide no es «¿tiene filtro?», sino **como esta redactada la prohibicion
sexual**. Hay dos familias: los que prohiben una CATEGORIA («obscene»,
«pornographic», «sexually explicit») —ahi no hay nada que hacer, den el credito
que den— y los que prohiben CONDUCTAS y por tanto enumeran lo sexual prohibido
(menores, y contenido intimo de persona identificable sin consentimiento),
dejando el resto fuera a proposito. Buscar por esa forma de redaccion, y no por
la palabra «uncensored», es lo que rindio.

# Recomendación final\n\nTodo lo que sigue ha pasado por el verificador. Lo refutado se ha caído, lo dudoso va etiquetado. Cuando digo «silencio» quiero decir silencio, no permiso.\n\n**La regla que ha decidido casi todo.** No es «¿tiene filtro?», es **cómo está redactada la prohibición sexual**. Hay dos familias: los que prohíben una *categoría* («obscene», «pornographic», «sexually explicit», «indecent») — ahí no hay nada que hacer, dé el crédito que dé; y los que prohíben *conductas* y por tanto **enumeran** lo sexual prohibido (menores, y contenido íntimo de persona identificable sin consentimiento), dejando el resto fuera a propósito. Buscar por esa forma de redacción, y no por la palabra «uncensored», es lo que ha rendido.\n\n---\n\n## 1. VISIÓN — el frente que te desbloquea\n\nLos dos finalistas **no documentan filtro sobre la imagen de entrada**, que era la pregunta clave. Ninguno de los dos entrega crédito de prueba verificado sin tarjeta: hay que decirlo.\n\n**Replicate** — https://replicate.com · política: la mejor escrita de toda la investigación\nMarketplace con API de predicciones (crear → id → sondear), forma casi calcada a Xavira. Sin moderación propia: §2.7(d)(v) prohíbe sólo «to create **non-consensual** nudity or **illegal** pornographic content», y §8.6 reconoce en mayúsculas que el servicio genera contenido «PORNOGRAPHIC, LASCIVIOUS… OR RELATED TO FETISHES» y que no lo vigila. Modelo: `nsfw-api/joycaption-beta-one` — **0,010 $ por ejecución y ~11 s** (el informe original citaba 0,14 $/145 s: era la pre-alpha, dato corregido). Crédito: la colección «Try for Free» se usa sin tarjeta pero **no incluye captioning**; para JoyCaption hay que añadir tarjeta y crédito prepago (válido 1 año, no reembolsable). Base64 hasta 1 MB en data URI, por encima subida directa hasta 100 MB — la bóveda nunca publica nada. Dos asperezas: ese modelo recibe un **ZIP**, no una imagen suelta, y ambos figuran «Cold» (la primera llamada paga arranque). Requiere adaptador; el de Xavira sirve de plantilla.\n\n**Featherless AI** — https://featherless.ai · política: silencio, pero el más fuerte que existe\nHosting serverless de 40.000+ modelos de Hugging Face. Leí el ToS canónico entero: **ni una cláusula sobre contenido sexual, adulto o NSFW**; la única frase del tema es «Models accessed via Featherless may produce content that is not suitable for minors». Y no sólo alojan: **comercializan** categorías «Uncensored Models», «Abliterated Models» y «LLMs for Roleplay» en su propio pie de página. Modelo a pedir: `shutkit/Qwen2.5-VL-7B-NSFW-Caption-V3-abliterated`, vivo y «Warm», hecho a propósito para describir imágenes adultas. **Chat completions + base64 confirmado en /docs/vision → entra por Conexiones de Studio sin escribir una línea.** Cuatro correcciones duras del verificador: (a) **el plan de 10 $ ya no existe** — hoy son CHAT 25 $/mes y DEVELOPER 50 $/mes; (b) el plan CHAT **excluye por contrato tu caso**: «Not for reselling, **app/API traffic**, background automation»; el conforme es DEVELOPER, **50 $/mes**; (c) los 100.000 tokens de prueba **no se verifican en su web** (/pricing da 404, «free» aparece una sola vez en todo el sitio) — vienen de un issue de GitHub ajeno; (d) su ToS traspasa las políticas de los modelos, así que hay que quedarse en el Qwen abliterado (Apache-2.0) y **no** usar gemma-3, que arrastra la Gemma Prohibited Use Policy y sí prohíbe lo sexual explícito. El ToS lleva sin tocarse desde junio de 2024.\n\n**Aparcado, no descartado — Runware** (https://runware.ai): su ToS es de los pocos que acotan lo sexual **exclusivamente a menores**, el registro no pide tarjeta (formulario comprobado) y da 2 $ gratis. Pero su catálogo actual de Image-to-Text son **modelos propietarios de Claude, GPT y Gemini** — choca con el veto del repositorio y el modelo se negaría igual. Además el `taskType` real es `caption`, no `imageCaption`, exige campo `model`, y la URL de documentación que circula da 404. Si algún día aparece un VLM abierto en su catálogo comunitario (300k+), recupera de golpe todo lo perdido.\n\n**Descartados en visión, no reabrir:** PiAPI (su política **sí existía**, en `/nsfw-policy`, y prohíbe expresamente «Pornographic, sexually explicit, or other adult sexual content… generate, **transform**, store» aplicado a «uploaded files» — es el caso Alibaba otra vez), Inference.net («your User Content does not include nudity» — prohíbe lo que *subes*), Electron Hub (moderación obligatoria en mayúsculas, extendida a «real or **fictional** persons»), Novita («Is sexually explicit.»), FriendliAI (GPU dedicada de un solo inquilino, inviable económicamente; su política era en realidad favorable), Chutes (su propia FAQ: «We do not offer a free tier at this time»), Pollinations (sus modelos de visión son proxies a OpenAI y Anthropic).\n\n---\n\n## 2. IMAGEN\n\nYa tienes AI Horde gratis. Lo que sigue sólo aporta si mejora calidad, latencia o coherencia de personaje.\n\n**Wiro AI** — https://wiro.ai · prometedor **con una discrepancia grave sin resolver**\nMarketplace pequeño (Wiro AI Inc., California) con dos modelos vendidos como *Uncensored* (Seedream 5.0 Lite y 4.5), forma asíncrona idéntica a Xavira (`POST /Run/{owner}/{model}` → `taskid` → `POST /Task/Detail`, o `/sync`, o webhook) **y además** pasarela chat completions en `llm.wiro.ai/v1` con `/v1/models` vivo (responde 401, no 404) — cubre D-022. La ficha del modelo dice «No explicit safety measures implemented». Crédito anunciado: 50 y 200 generaciones, «No credit card required». Precio real **0,04 $/imagen**, no 0,03. El bloqueo de base64 estaba exagerado: el Run acepta multipart con ficheros, así que **no hace falta dejar la cara del personaje en su CDN público**.\n**Lo que hay que decirte antes de meter nada ahí, y son dos cosas:** (1) **tres verificadores no coinciden sobre si su ToS existe**. Uno lo leyó entero con navegador y trae citas literales (fechado 27-02-2026, sin cláusula de adulto, con CSAM y NCII enumerados). Otros dos, también con navegador real, reportan que **el ToS, la Política de Privacidad y las Service Credit Terms renderizan vacías** — sólo cabecera y pie. No puedo resolverlo desde aquí. Mientras no se resuelva, su permiso es marketing, no contrato. (2) Los modelos son `owner-slug = bytedance` y su ToS incluye «Third-Party Model Additional Terms»: **los términos de ByteDance sobre Seedream te vinculan a través de Wiro y nadie los ha leído**. Es la forma exacta del fallo de Alibaba entrando por la puerta de atrás.\n\n**Dezgo** — https://dezgo.com · **rehabilitado**: el descarte era un error de lectura\nSe había descartado citando «pornographic, X-RATED, obscene». Esa frase **no es una prohibición**: es el punto (VIII) de una enumeración dentro de la cláusula **LIMITATION OF LIABILITY** — un descargo que de hecho presupone que ese contenido existe. Su lista real de prohibiciones al usuario («RULES OF USER CONDUCT») no dice **nada** sobre adulto entre adultos. Está en silencio, igual que Wiro. Contras: ToS sin tocar desde 2023-02-05, sin coherencia de personaje, y no pude confirmar en fuente el nivel gratuito a 512x512 ni el depósito mínimo. Vale como banco de pruebas barato, no como cimiento.\n\n**Runware para imagen**: aquí sí aloja lo que interesa — Pony Diffusion XL, NoobAI XL, Illustrious XL — más herramientas de consistencia facial (PhotoMaker, PuLID, IP-Adapter), que es justo lo que a AI Horde le falta. Política acotada a menores, 2 $ gratis, registro sin tarjeta. Dudoso sólo porque no se ha comprobado si el crédito se libera sin añadir tarjeta.\n\n**NovelAI** (https://novelai.net) sólo si quieres **anime** con personaje coherente: Vibe Transfer es exactamente el patrón D-064 (identidad como receta local cifrable). Reservas serias: su ToS es **silencio total** sobre lo adulto, la API no es oficial para terceros (puede romperse sin aviso), y **el base64 del Vibe Transfer no lo respalda la fuente que se citó**. Prueba real confirmada en su documentación: 50 generaciones de texto + 30 de imagen con correo verificado, sin tarjeta. Luego 10 $/mes (Tablet).\n\n**Descartados en imagen:** Astria (prohíbe «nudity… or content otherwise meant to arouse sexual excitement», y duele porque su recurso `/tunes` era el mejor diseño de personaje persistente que he visto, con 20 $ de crédito sin tarjeta), ModelsLab (su propia página: «paid-only — there is no free tier, no free credits and no trial plan»), PixAI (moderación obligatoria: «Sensitive content created using realistic models is not allowed», con revisión de IA y cierre de cuenta), Segmind (por su propia boca: «Standard restrictions remain in place for **fully nude** and illegal content»), Novita, getimg.ai, RunDiffusion, Sozee (sin API pública).\n\n---\n\n## 3. VÍDEO — el frente que se queda sin ganador\n\n**Digo lo que hay: no existe un solo proveedor de vídeo adulto con API, política que lo permita y crédito de prueba a la vez.** Todos fallan uno de los tres. Los dos que resisten:\n\n**NanoGPT** — https://nano-gpt.com · el más barato de probar, y el único intacto tras la revisión\nPasarela de ~1.000 modelos. Moderación **opt-in y de pago**: «you can opt in to a paid input safety preflight by sending the `moderation` header» — si no la mandas, no hay preflight. Política que enumera: prohíbe menores y contenido íntimo de **persona identificable** sin consentimiento, nada más. Entrada `imageDataUrl` en **base64 hasta 4 MB**, sondeo claro (`GET /api/video/status?requestId=`). Coste de entrada: **0,10 $ en cripto sin tarjeta** (1 $ con tarjeta) — no es crédito de prueba, es saldo comprado, pero son diez céntimos. Debilidad real y no menor: es un router, y su propio ToS dice «If Model Terms conflict with these Terms, **the Model Terms control**». Hay que quedarse en rutas abiertas (Hunyuan, WAN) y leer los términos de ese upstream.\n\n**HotAPI** — https://hotapi.ai · el mejor encaje estructural, con tres peros\nPasarela sólo de modelos sin censura (Dark Enlightenment Limited, Hong Kong), documentos legales de 2026-08-31. Contrato calcado a Xavira: `POST /v1/{model}` → `task_id` → `GET /v1/tasks/{id}`, webhooks HMAC, `GET /v1/models`, y además `/v1/chat/completions` compatible con OpenAI. **Base64 confirmado literal en el fotograma inicial de todos sus modelos i2v.** AUP que no prohíbe lo adulto y que lo presupone al exigir «Verify the age of your users wherever adult-adjacent content can be generated». Los peros, los tres del verificador: (1) la cita estrella estaba **truncada** — la frase entera es «Enforcement is not automated review of every request, **and you should not read our silence as approval**»; (2) admite por escrito **filtro aguas arriba**: «Model capabilities, pricing, **safety filters**… are controlled by the upstream providers», y los modelos son de ByteDance y Alibaba — el mismo Alibaba que ya descartaste por criba previa; (3) su ToS §1 dice «It is **not a consumer content product**» y exige aceptar en nombre de una organización. Sin crédito de prueba: mínimo 20 $ y **sólo en cripto** («Card payments… are currently unavailable»). Sus propios ToS contemplan «promotional credits… from a support grant»: merece escribir a support@hotapi.ai antes de poner dinero.\n\n**Sogni** cae aquí y hay que corregir el motivo: `disableNSFWFilter` **no es un interruptor** — la documentación dice «request the alternate content policy for this project; **the server remains authoritative**». Y sus créditos gratuitos no alcanzan a los modelos de vídeo. **NamiFusion** tiene un modelo i2v propio y picante (Nami Wan 2.7 I2V Spicy Prime) y política que no lo prohíbe, pero su documentación de API vive tras login y su crédito es «eligible new accounts **may** receive»: hasta que alguien cree la cuenta, es dudoso.\n\n**Descartados en vídeo:** A2E.ai (encabeza todas las listas de «i2v sin censura» y su ToS dedica una sección entera en mayúsculas a prohibir el desnudo, con la excepción autoanulada), PiAPI, Eternal AI (el más parecido a Xavira de todo el informe — personaje persistente por ID, imagen, vídeo, base64, precios ridículos — y su Content Policy exige contenido **«G-rated»**), ModelsLab (init_image exige URL pública), ComfyICU (prohíbe la pornografía explícita **y** publica lo generado en el nivel gratuito), RunDiffusion. Conclusión de categoría: **alquilar GPU no esquiva la política, sólo la traslada del fabricante del modelo al arrendador**, y los dos arrendadores leídos la prohíben.\n\n**Tres avisos si algún día se escribe el adaptador de vídeo:** las URLs de salida caducan a 24 h en casi todos (descargar los bytes a la bóveda de inmediato, nunca guardar la URL); varios cobran **al enviar** la tarea, no al terminarla, lo que agrava la regla de no reintentar un corte que ya produjo salida; y HotAPI prohíbe expresamente reenrutar una petición rechazada a otro proveedor — la lógica de reintento debe distinguir fallo técnico de rechazo por política.\n\n---\n\n## 4. TEXTO — ya tienes DeepSeek; esto es lo que aportaría algo\n\n**DreamGen** — https://dreamgen.com · **la API está viva, y la política es la mejor redactada del lote**\nServicio pequeño con modelos propios afinados para rol (familia Lucid). Se creía muerta tras la migración a V2 porque su documentación de API desapareció del sitio. **Comprobado contra el servidor, no contra documentación:** `GET https://dreamgen.com/api/openai/v1/models` devuelve **200** sin clave, con `lucid-v1-medium` y `lucid-v1-extra-large`. Es chat completions con `/v1/models` vivo: **cumple D-022 y entra por Conexiones sin adaptador**. Política: la única prohibición de todo el terreno sexual es «Depicts, describes, or promotes sexual content involving minors, **including fictional minors**». Nada más. Que enumeren eso y sólo eso es la señal más limpia del informe. Contras: se reservan revisión discrecional («review, monitor, or remove any User Content that we determine, in our sole discretion, **objectionable**»), la licencia es «personal, non-commercial use», y **su página de precios ya no muestra nivel gratuito** — el crédito mensual renovable sale sólo de la documentación de SillyTavern, que está desactualizada. Hay que registrarse para saberlo.\n\n**Arli AI** — https://www.arliai.com · el único con nivel gratuito permanente declarado\nServicio pequeño construido para rol (su propia web lista SillyTavern, JanitorAI, RisuAI como frontends). Su cláusula de uso aceptable es corta y cerrada — «unlawful, illegal, fraudulent, or harmful… hate, harassment, violence, political manipulation, spam, or malware» — y **no menciona el contenido adulto en ninguna parte**; el servicio es 18+ por contrato y zero-log. `GET /v1/models` **existe** (401 con clave ausente frente a 404 en ruta inventada: prueba de control hecha). Free 0 $: «5 times / 2 days trial of all models», 12K de contexto, 1 petición simultánea, sin imagen. Además API de imagen con contrato SDNext. **Dos correcciones:** el argumento «no pueden moderar» está inflado — su zero-log dice que no *almacenan*, no que no puedan mirar; un clasificador en streaming no violaría esa cláusula. Y **queda abierto si el plan Free entrega clave de API o es sólo interfaz web**, que es literalmente lo que hundió a Infermatic.\n\n**Nomi.ai** — https://nomi.ai · el único self-serve con **personajes persistentes en servidor**\nAPI pública y documentada: `GET /v1/nomis`, `POST /v1/nomis/{uuid}/chat`, más salas multi-personaje. Es lo más «Xavira de texto» que existe sin ser B2B. Pero su ToS es **silencio absoluto** sobre contenido adulto (sólo 18+), y la cuenta gratuita limita a 1 compañero con mensajes de 400 caracteres — probablemente inservible para rol largo sin pagar ~16 $/mes. Merece un correo preguntando por escrito.\n\n**RedPill** (https://redpill.ai): inferencia dentro de enclaves TEE con atestación criptográfica, y su catálogo incluye «Phala: Gemma-4 26B-A4B **Uncensored (Heretic)**». Hoy no sirve (el gratuito es chat, no API; política en silencio total), pero es la respuesta correcta a «quiero un proveedor alojado donde lo íntimo no dependa de una promesa contractual sino de una prueba».\n\n**Descartados en texto, con motivo:** Mancer (portada «No filters, No guidelines, No constraints» y contrato «is obscene, lewd, or offensive **(as determined by Company)**» — y además el servicio está congelado: ToS de junio 2024, modelo más reciente de 2023), Infermatic (su tabla de precios dice literalmente «No API / ChapGPT Style Interface» en el plan gratis), Chub AI (la cita «Chub is uncensored… nor the type of interactions you are allowed to have» es real y está en su documentación, pero **su ToS renderiza vacío**: el único permiso escrito vive fuera de contrato, y no hay nivel gratuito), DeepInfra (su página de precios: «You have to add a card or pre-pay or you won't be able to use our services» — anotado en la lista corta del día que aceptes tarjeta, porque es el único con contrato limpio **y** retención cero verificada), Featherless para texto (25/50 $, sin nada gratis), uncensored.chat (`/terms` da 404, sin entidad legal, sólo cripto no reembolsable: mandar la bóveda a un operador anónimo sin contrato no es un riesgo económico), abliteration.ai (existe, tiene entidad en Delaware y su política no te prohíbe nada, pero el nivel gratuito son **500 tokens**), Electron Hub, Together, Fireworks, SiliconFlow, Hyperbolic, Nebius, fal, Modal, Baseten, RunPod, Lambda, GMI Cloud, Nscale, Atlas Cloud. **kluster.ai está muerto**: el dominio ni resuelve (ENOTFOUND), aunque siga listado como vivo en directorios.\n\n---\n\n## 5. El personaje persistente: el hueco real, y ya sabes vivir con él\n\nDe todo lo investigado, **ningún proveedor que permita contenido adulto ofrece un recurso de personaje persistente en su servidor y sea alcanzable**. Los que lo tienen bien diseñado —Astria `/tunes`, ModelsLab dreambooth, PixAI LoRA— prohíben, callan o cobran por adelantado. La única excepción con **autorización explícita por escrito** que ha aparecido en toda la investigación es **OhAPI (oh.xyz)**, cuyo ToS público dice: «For the avoidance of doubt, **lawful consensual adult content is not prohibited solely because it is sexually explicit**». Es el clon exacto de Xavira, con personajes y salas como objetos de primera clase. Se cae por precio y por forma: depósito mínimo 50 $, planes desde **4.999 $/mes**, y el contrato exige aceptar en nombre de una persona jurídica. (Corrección importante: se había descartado por «no publica política» y «sólo socios aprobados» — **ambas cosas son falsas**, y la fuente de esas dos afirmaciones era la página de comparativas de un competidor directo.)\n\nConclusión práctica: **D-064 no era un apaño, es el único patrón disponible en este nicho.** La identidad como receta local y cifrada es lo que hacen también Wiro (imagen de referencia), NovelAI (Vibe Transfer) y todos los i2v de vídeo. No hay que cambiar la arquitectura.\n\n---\n\n## 6. Dos avisos que no pertenecen a ningún frente\n\n**El ToS de Wiro AI.** Es la única discrepancia que no he podido cerrar y afecta al mejor candidato de imagen: un verificador lo leyó entero y cita cláusulas literales; otros dos, también con navegador real, informan de que **las tres páginas legales (términos, privacidad y condiciones de crédito) renderizan vacías**. Antes de apoyar nada en Wiro, hay que resolver esto —pedírselo por correo vale— y de paso preguntarles si los «Third-Party Model Additional Terms» de ByteDance aplican a los modelos marcados *Uncensored*.\n\n**DeepSeek, que es lo que usas hoy.** Un rastreador de políticas de terceros sostiene que sus términos prohíben contenido «pornographic, obscene, or sexually explicit». **No está verificado contra el documento original** y no lo doy por bueno. Pero si se confirma, la pieza de texto que ya está en producción descansa sobre una política que prohíbe su uso principal. Merece una comprobación directa, y es barata.\n\n---\n\n## 7. Por dónde empezar\n\n**Regístrate en Featherless AI y pídele a `shutkit/Qwen2.5-VL-7B-NSFW-Caption-V3-abliterated` que describa una imagen real de la bóveda.**\n\nPor qué esa y no otra: es lo que **desbloquea visión**, que es el frente parado; el registro cuesta cero y responde de una vez la única pregunta que no he podido cerrar (si los 100.000 tokens de prueba existen de verdad); es **chat completions con base64 confirmado**, así que entra por Conexiones de Studio sin escribir una línea de código ni un adaptador; su ToS es el único que he podido leer palabra por palabra sin encontrar ni una cláusula sobre contenido adulto, respaldado por un catálogo que **comercializa** modelos abliterados y de rol; y el modelo no es un generalista al que hay que convencer, está construido para no negarse.\n\nY con una imagen real cierras de una sola llamada la distinción que ninguna lectura de términos puede cerrar: **que la política lo permita no significa que el modelo colabore.** Eso sólo lo dice el banco de pruebas.\n\nSi el registro no entrega tokens gratis o el plan conforme resulta ser el de 50 $/mes, el plan B es **Replicate**: la mejor política escrita de todo el informe, 0,01 $ y 11 segundos por imagen. Cuesta una tarjeta y un adaptador, y el de Xavira sirve de plantilla.\n\nNada de lo anterior pasa por encima del filtro de nadie: los que prohíben este uso están descartados y documentados justo para que no se reabran ni se intente rodearlos.",
    "frentes": 6
  },
  "workflowProgress": [
    {
      "type": "workflow_phase",
      "index": 1,
      "title": "Investigar"
    },
    {
      "type": "workflow_phase",
      "index": 2,
      "title": "Verificar"
    },
    {
      "type": "workflow_phase",
      "index": 3,
      "title": "Sintetizar"
    },
    {
      "type": "workflow_agent",
      "index": 1,
      "label": "busca:vision",
      "phaseIndex": 1,
      "phaseTitle": "Investigar",
      "agentId": "a4eccd5a5a236e75c",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788793244431,
      "queuedAt": 1788793242835,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "No partí de listas de \"mejores APIs gratis\". Entré por cuat…",
      "promptPreview": "QUE ES LUXY. Un agente personal en Windows con una boveda cifrada donde Daniel\nhace roleplay adulto. Necesita proveedores de IA para eso.\n\nLO QUE PIDE AHORA, con sus palabras: «investiga alternativas no tan conocidas,\nindaga profundamente en la web, tipo paginas como Xavira, tiene que haber\nbuenas alternativas con al menos un poco de credito de prueba».\n\nQUE ES \"TIPO XAVIRA\". Xavira es el proveedo…",
      "lastProgressAt": 1788794081539,
      "tokens": 126735,
      "toolCalls": 80,
      "durationMs": 837107,
      "resultPreview": "{\"comoLoEncontre\":\"No partí de listas de \\\"mejores APIs gratis\\\". Entré por cuatro puertas laterales:\\n\\n1. **La comunidad de captioning / entrenamiento de LoRA.** Fue la pista más productiva, tal y como sugería el encargo. Quien etiqueta datasets adultos necesita un VLM que no se niegue, y esa comunidad construyó uno: **JoyCaption** (github.com/fpgaminer/joycaption), descrito por su autor como \\\"…"
    },
    {
      "type": "workflow_agent",
      "index": 2,
      "label": "busca:imagen",
      "phaseIndex": 1,
      "phaseTitle": "Investigar",
      "agentId": "a0c2cc5306eb63acc",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788793244566,
      "queuedAt": 1788793242835,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "Partí del adaptador real apps/agent/src/providers/xavira.ts…",
      "promptPreview": "QUE ES LUXY. Un agente personal en Windows con una boveda cifrada donde Daniel\nhace roleplay adulto. Necesita proveedores de IA para eso.\n\nLO QUE PIDE AHORA, con sus palabras: «investiga alternativas no tan conocidas,\nindaga profundamente en la web, tipo paginas como Xavira, tiene que haber\nbuenas alternativas con al menos un poco de credito de prueba».\n\nQUE ES \"TIPO XAVIRA\". Xavira es el proveedo…",
      "lastProgressAt": 1788794476100,
      "tokens": 155042,
      "toolCalls": 89,
      "durationMs": 1228331,
      "resultPreview": "{\"comoLoEncontre\":\"Partí del adaptador real apps/agent/src/providers/xavira.ts para fijar la forma a buscar (recurso de personaje persistente + cola asíncrona con sondeo). Luego busqué en directorios de APIs para adultos (aihaven.com/nsfw-api, hotapi.ai/en/blog/uncensored-ai-api-guide, nsfwcoders.com/blogs/api), comparativas de proveedores sin censura, listas de créditos gratis (getaiperks.com) y …"
    },
    {
      "type": "workflow_agent",
      "index": 3,
      "label": "busca:video",
      "phaseIndex": 1,
      "phaseTitle": "Investigar",
      "agentId": "a42d6c1b40484822e",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788793244603,
      "queuedAt": 1788793242835,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "No me fie de las listas de «mejores generadores NSFW» que c…",
      "promptPreview": "QUE ES LUXY. Un agente personal en Windows con una boveda cifrada donde Daniel\nhace roleplay adulto. Necesita proveedores de IA para eso.\n\nLO QUE PIDE AHORA, con sus palabras: «investiga alternativas no tan conocidas,\nindaga profundamente en la web, tipo paginas como Xavira, tiene que haber\nbuenas alternativas con al menos un poco de credito de prueba».\n\nQUE ES \"TIPO XAVIRA\". Xavira es el proveedo…",
      "lastProgressAt": 1788794437919,
      "tokens": 196003,
      "toolCalls": 106,
      "durationMs": 1190149,
      "resultPreview": "{\"proveedores\":[{\"nombre\":\"HotAPI\",\"url\":\"https://hotapi.ai\",\"queEs\":\"Pasarela de API pequeña y especializada SOLO en modelos sin censura (imagen, video, voz, chat), operada por Dark Enlightenment Limited (Hong Kong). Es lo mas parecido a Xavira que he encontrado: 16 modelos, endpoints dedicados por modelo, cola asincrona con sondeo o webhook firmado. No es un generalista: su producto ES el conten…"
    },
    {
      "type": "workflow_agent",
      "index": 4,
      "label": "busca:texto",
      "phaseIndex": 1,
      "phaseTitle": "Investigar",
      "agentId": "a21366ccb2b290233",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788793244867,
      "queuedAt": 1788793242835,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "No parti de listas de \"mejores APIs gratis\": esas devuelven…",
      "promptPreview": "QUE ES LUXY. Un agente personal en Windows con una boveda cifrada donde Daniel\nhace roleplay adulto. Necesita proveedores de IA para eso.\n\nLO QUE PIDE AHORA, con sus palabras: «investiga alternativas no tan conocidas,\nindaga profundamente en la web, tipo paginas como Xavira, tiene que haber\nbuenas alternativas con al menos un poco de credito de prueba».\n\nQUE ES \"TIPO XAVIRA\". Xavira es el proveedo…",
      "lastProgressAt": 1788794163481,
      "tokens": 118291,
      "toolCalls": 63,
      "durationMs": 915711,
      "resultPreview": "{\"comoLoEncontre\":\"No parti de listas de \\\"mejores APIs gratis\\\": esas devuelven siempre los mismos gigantes y ya estan descartados. Entre en el ecosistema por donde lo hacen los usuarios de rol.\\n\\n1. **El indice de conexiones de SillyTavern** (https://docs.sillytavern.app/usage/api-connections/) resulto ser el mejor directorio de proveedores de nicho que existe: es la lista de servicios que la c…"
    },
    {
      "type": "workflow_agent",
      "index": 5,
      "label": "busca:marketplaces",
      "phaseIndex": 1,
      "phaseTitle": "Investigar",
      "agentId": "a3dcfec4b868c9b3c",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788793244646,
      "queuedAt": 1788793242835,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "Partí de la lista encargada (DeepInfra, Together, Fireworks…",
      "promptPreview": "QUE ES LUXY. Un agente personal en Windows con una boveda cifrada donde Daniel\nhace roleplay adulto. Necesita proveedores de IA para eso.\n\nLO QUE PIDE AHORA, con sus palabras: «investiga alternativas no tan conocidas,\nindaga profundamente en la web, tipo paginas como Xavira, tiene que haber\nbuenas alternativas con al menos un poco de credito de prueba».\n\nQUE ES \"TIPO XAVIRA\". Xavira es el proveedo…",
      "lastProgressAt": 1788794384354,
      "tokens": 148284,
      "toolCalls": 122,
      "durationMs": 1136584,
      "resultPreview": "{\"proveedores\":[{\"nombre\":\"Mancer\",\"url\":\"https://mancer.tech/\",\"queEs\":\"Servicio pequeño y veterano de inferencia sobre pesos abiertos, nacido dentro de la comunidad de roleplay (SillyTavern lo trae integrado de fábrica como tipo de API). No es un gigante generalista: sirve un catálogo corto de fine-tunes de roleplay con saldo por créditos, sin suscripción.\",\"moderacion\":\"Es el único de todo el f…"
    },
    {
      "type": "workflow_agent",
      "index": 6,
      "label": "busca:companion",
      "phaseIndex": 1,
      "phaseTitle": "Investigar",
      "agentId": "a142390c358bc258a",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788793244966,
      "queuedAt": 1788793242835,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "Frente asignado: ecosistema companion/roleplay con API. Rut…",
      "promptPreview": "QUE ES LUXY. Un agente personal en Windows con una boveda cifrada donde Daniel\nhace roleplay adulto. Necesita proveedores de IA para eso.\n\nLO QUE PIDE AHORA, con sus palabras: «investiga alternativas no tan conocidas,\nindaga profundamente en la web, tipo paginas como Xavira, tiene que haber\nbuenas alternativas con al menos un poco de credito de prueba».\n\nQUE ES \"TIPO XAVIRA\". Xavira es el proveedo…",
      "lastProgressAt": 1788794445934,
      "tokens": 158946,
      "toolCalls": 98,
      "durationMs": 1198163,
      "resultPreview": "{\"comoLoEncontre\":\"Frente asignado: ecosistema companion/roleplay con API. Rutas seguidas, en este orden: (1) directorios y listas de la comunidad — `zukixa/cool-ai-stuff` (el directorio de APIs de IA más citado en Discords de roleplay), `mnfst/awesome-free-llm-apis`, free-llm.com; (2) la lista de backends soportados por SillyTavern (docs.sillytavern.app/usage/api-connections/), que es de facto el…"
    },
    {
      "type": "workflow_agent",
      "index": 7,
      "label": "verifica:vision",
      "phaseIndex": 2,
      "phaseTitle": "Verificar",
      "agentId": "a7bab2020cc3a20fd",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788794084504,
      "queuedAt": 1788794083013,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "TRES COSAS QUE NO HE PODIDO CERRAR Y QUE EXIGEN CREAR CUENT…",
      "promptPreview": "QUE ES LUXY. Un agente personal en Windows con una boveda cifrada donde Daniel\nhace roleplay adulto. Necesita proveedores de IA para eso.\n\nLO QUE PIDE AHORA, con sus palabras: «investiga alternativas no tan conocidas,\nindaga profundamente en la web, tipo paginas como Xavira, tiene que haber\nbuenas alternativas con al menos un poco de credito de prueba».\n\nQUE ES \"TIPO XAVIRA\". Xavira es el proveedo…",
      "lastProgressAt": 1788794793035,
      "tokens": 139118,
      "toolCalls": 69,
      "durationMs": 708530,
      "resultPreview": "{\"revisados\":[{\"nombre\":\"Featherless AI\",\"existe\":\"confirmado\",\"moderacion\":\"confirmado\",\"tarjeta\":\"no verificable\",\"politica\":\"confirmado\",\"veredictoFinal\":\"prometedor\",\"correccion\":\"POLITICA CONFIRMADA AL PIE DE LA LETRA. Lei el documento canonico entero en navegador (featherless.ai/legal/terms-of-service; /terms redirige alli). No hay ninguna clausula sobre contenido sexual, adulto, pornografic…"
    },
    {
      "type": "workflow_agent",
      "index": 8,
      "label": "verifica:texto",
      "phaseIndex": 2,
      "phaseTitle": "Verificar",
      "agentId": "a0998544dd6191736",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788794166885,
      "queuedAt": 1788794165064,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "HUECOS QUE NO HE PODIDO CERRAR, y por que. 1. **`GET /v1/mo…",
      "promptPreview": "QUE ES LUXY. Un agente personal en Windows con una boveda cifrada donde Daniel\nhace roleplay adulto. Necesita proveedores de IA para eso.\n\nLO QUE PIDE AHORA, con sus palabras: «investiga alternativas no tan conocidas,\nindaga profundamente en la web, tipo paginas como Xavira, tiene que haber\nbuenas alternativas con al menos un poco de credito de prueba».\n\nQUE ES \"TIPO XAVIRA\". Xavira es el proveedo…",
      "lastProgressAt": 1788794690569,
      "tokens": 110170,
      "toolCalls": 50,
      "durationMs": 523683,
      "resultPreview": "{\"revisados\":[{\"nombre\":\"Arli AI\",\"existe\":\"confirmado\",\"moderacion\":\"no verificable\",\"tarjeta\":\"no verificable\",\"politica\":\"confirmado\",\"veredictoFinal\":\"prometedor\",\"correccion\":\"POLITICA CONFIRMADA LITERALMENTE. La clausula de uso aceptable en https://www.arliai.com/terms es exactamente la citada: «You agree not to use the Services for unlawful, illegal, fraudulent, or harmful activities, inclu…"
    },
    {
      "type": "workflow_agent",
      "index": 9,
      "label": "verifica:marketplaces",
      "phaseIndex": 2,
      "phaseTitle": "Verificar",
      "agentId": "a1060434afef59bbc",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788794387929,
      "queuedAt": 1788794385924,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "QUE CAMBIA EL ORDEN DEL FRENTE, en una linea: Infermatic ca…",
      "promptPreview": "QUE ES LUXY. Un agente personal en Windows con una boveda cifrada donde Daniel\nhace roleplay adulto. Necesita proveedores de IA para eso.\n\nLO QUE PIDE AHORA, con sus palabras: «investiga alternativas no tan conocidas,\nindaga profundamente en la web, tipo paginas como Xavira, tiene que haber\nbuenas alternativas con al menos un poco de credito de prueba».\n\nQUE ES \"TIPO XAVIRA\". Xavira es el proveedo…",
      "lastProgressAt": 1788794956994,
      "tokens": 109701,
      "toolCalls": 52,
      "durationMs": 569063,
      "resultPreview": "{\"revisados\":[{\"nombre\":\"Mancer\",\"existe\":\"confirmado\",\"moderacion\":\"confirmado\",\"tarjeta\":\"confirmado\",\"politica\":\"confirmado\",\"veredictoFinal\":\"prometedor\",\"correccion\":\"Todo sostenido en fuente, y el servicio esta VIVO hoy: https://neuro.mancer.tech/models responde con sello «Data fetched 2026-09-07». El modelo gratis existe y es MythoLite, listado literalmente «FREE FREE» (entrada y salida) ju…"
    },
    {
      "type": "workflow_agent",
      "index": 10,
      "label": "verifica:video",
      "phaseIndex": 2,
      "phaseTitle": "Verificar",
      "agentId": "aaa6cad7183aa86e4",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788794441187,
      "queuedAt": 1788794439433,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "QUE NO HE PODIDO CERRAR, y conviene no darlo por resuelto: …",
      "promptPreview": "QUE ES LUXY. Un agente personal en Windows con una boveda cifrada donde Daniel\nhace roleplay adulto. Necesita proveedores de IA para eso.\n\nLO QUE PIDE AHORA, con sus palabras: «investiga alternativas no tan conocidas,\nindaga profundamente en la web, tipo paginas como Xavira, tiene que haber\nbuenas alternativas con al menos un poco de credito de prueba».\n\nQUE ES \"TIPO XAVIRA\". Xavira es el proveedo…",
      "lastProgressAt": 1788794874024,
      "tokens": 113139,
      "toolCalls": 36,
      "durationMs": 432836,
      "resultPreview": "{\"revisados\":[{\"nombre\":\"HotAPI\",\"existe\":\"confirmado\",\"moderacion\":\"confirmado\",\"tarjeta\":\"confirmado\",\"politica\":\"confirmado\",\"veredictoFinal\":\"prometedor\",\"correccion\":\"Servicio vivo y leido entero en navegador (WebFetch recibe 403; hay que usar navegador). AUP y ToS fechados 2026-08-31, verificados. CORRECCION 1, la mas importante: el informe TRUNCO la cita clave. La frase real de la AUP §4 es…"
    },
    {
      "type": "workflow_agent",
      "index": 11,
      "label": "verifica:companion",
      "phaseIndex": 2,
      "phaseTitle": "Verificar",
      "agentId": "a7ce46d5ef4648be0",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788794449328,
      "queuedAt": 1788794447517,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "LO QUE NO HE PODIDO COMPROBAR Y HAY QUE RESOLVER ANTES DE D…",
      "promptPreview": "QUE ES LUXY. Un agente personal en Windows con una boveda cifrada donde Daniel\nhace roleplay adulto. Necesita proveedores de IA para eso.\n\nLO QUE PIDE AHORA, con sus palabras: «investiga alternativas no tan conocidas,\nindaga profundamente en la web, tipo paginas como Xavira, tiene que haber\nbuenas alternativas con al menos un poco de credito de prueba».\n\nQUE ES \"TIPO XAVIRA\". Xavira es el proveedo…",
      "lastProgressAt": 1788794991383,
      "tokens": 125742,
      "toolCalls": 66,
      "durationMs": 542053,
      "resultPreview": "{\"revisados\":[{\"nombre\":\"Wiro AI\",\"existe\":\"confirmado\",\"moderacion\":\"no verificable\",\"tarjeta\":\"refutado\",\"politica\":\"confirmado\",\"veredictoFinal\":\"dudoso\",\"correccion\":\"EMPRESA REAL, PERO SIN NINGUN DOCUMENTO LEGAL. Confirmo que existe y esta viva: startup de Estambul fundada en 2023, respaldada por Y Combinator, 27 empleados (pitchbook.com/profiles/company/596112-22, crunchbase.com/organization…"
    },
    {
      "type": "workflow_agent",
      "index": 12,
      "label": "verifica:imagen",
      "phaseIndex": 2,
      "phaseTitle": "Verificar",
      "agentId": "afd7aac104f1abce9",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788794479202,
      "queuedAt": 1788794477588,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "LO QUE CAMBIA EL ORDEN DE PRIORIDADES. Tres hallazgos se ca…",
      "promptPreview": "QUE ES LUXY. Un agente personal en Windows con una boveda cifrada donde Daniel\nhace roleplay adulto. Necesita proveedores de IA para eso.\n\nLO QUE PIDE AHORA, con sus palabras: «investiga alternativas no tan conocidas,\nindaga profundamente en la web, tipo paginas como Xavira, tiene que haber\nbuenas alternativas con al menos un poco de credito de prueba».\n\nQUE ES \"TIPO XAVIRA\". Xavira es el proveedo…",
      "lastProgressAt": 1788795144890,
      "tokens": 149364,
      "toolCalls": 49,
      "durationMs": 665688,
      "resultPreview": "{\"revisados\":[{\"nombre\":\"Wiro AI\",\"existe\":\"confirmado\",\"moderacion\":\"confirmado\",\"tarjeta\":\"confirmado\",\"politica\":\"confirmado\",\"veredictoFinal\":\"prometedor\",\"correccion\":\"AGUANTA, y sale reforzado, pero con tres correcciones y un agujero nuevo. VERIFICADO EN FUENTE: lei el ToS entero (no lo daba WebFetch, hubo que renderizarlo con navegador). «Last Updated: February 27, 2026» exacto. La lista de…"
    },
    {
      "type": "workflow_agent",
      "index": 13,
      "label": "sintesis",
      "phaseIndex": 3,
      "phaseTitle": "Sintetizar",
      "agentId": "a62757d0a7318cb0b",
      "model": "claude-opus-5",
      "state": "done",
      "startedAt": 1788795150069,
      "queuedAt": 1788795146368,
      "attempt": 1,
      "promptPreview": "QUE ES LUXY. Un agente personal en Windows con una boveda cifrada donde Daniel\nhace roleplay adulto. Necesita proveedores de IA para eso.\n\nLO QUE PIDE AHORA, con sus palabras: «investiga alternativas no tan conocidas,\nindaga profundamente en la web, tipo paginas como Xavira, tiene que haber\nbuenas alternativas con al menos un poco de credito de prueba».\n\nQUE ES \"TIPO XAVIRA\". Xavira es el proveedo…",
      "lastProgressAt": 1788795380282,
      "tokens": 260322,
      "toolCalls": 0,
      "durationMs": 230212,
      "resultPreview": "# Recomendación final\n\nTodo lo que sigue ha pasado por el verificador. Lo refutado se ha caído, lo dudoso va etiquetado. Cuando digo «silencio» quiero decir silencio, no permiso.\n\n**La regla que ha decidido casi todo.** No es «¿tiene filtro?», es **cómo está redactada la prohibición sexual**. Hay dos familias: los que prohíben una *categoría* («obscene», «pornographic», «sexually explicit», «indec…"
    }
  ],
  "totalTokens": 1910857,
  "totalToolCalls": 880
}
