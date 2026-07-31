# Threat model del control remoto de Luxy

- **Fecha:** 2026-07-31
- **Alcance:** emparejamiento, señalización, sesión remota, entrada, archivos
- **Estado:** vivo. Se revisa al cerrar el protocolo y tras implementar.

## Principio que ordena todo lo demás

> Luxy **nunca** debe convertirse en una herramienta de acceso oculto.

De ahí salen dos invariantes que no se negocian por comodidad ni por una demo:

1. **Un dispositivo no emparejado no puede hacer nada.** No hay puerta de
   servicio, ni código maestro, ni secreto compartido que valga por sí solo.
2. **Una sesión activa es siempre visible en el equipo controlado.** No existe
   modo silencioso, ni siquiera para el dueño del equipo.

## Los activos

| Activo | Por qué importa |
|---|---|
| Clave privada del dispositivo | Quien la tenga **es** ese dispositivo |
| Pantalla en vivo | Contraseñas escritas, correo, banca |
| Canal de entrada | Control total del ordenador dentro de la sesión |
| Portapapeles | Suele contener credenciales |
| Archivos | Exfiltración e introducción de malware |
| Registro de auditoría | Si se puede borrar, un ataque se vuelve invisible |

## Escenarios

### 1. Atacante en la red local

**Puede:** ver metadatos de tráfico, intentar suplantar mDNS/DNS.
**No puede:** leer la sesión. WebRTC obliga a DTLS-SRTP; no hay modo sin cifrar.

**Mitigación:** ninguna adicional necesaria para la confidencialidad. Sí se evita
exponer puertos: Luxy **no abre ningún puerto de escucha**. Todas las conexiones
salen del equipo hacia el gateway.

### 2. Atacante con acceso al gateway ← **el escenario que define el diseño**

> **Actualización tras la revisión de seguridad del 2026-07-31.** Este escenario
> tenía dos agujeros reales, ya cerrados, que conviene dejar por escrito porque
> ilustran cómo una propiedad puede estar *declarada* y no *implementada*:
>
> 1. **El emparejamiento se podía completar sin ningún humano.** `pair/start` y
>    `pair/confirm` no estaban autenticados y el bando lo elegía el cliente, así
>    que quien fotografiara el QR podía emparejar su propio dispositivo enviando
>    las dos confirmaciones. Las palabras no llegaban a intervenir.
> 2. **El gateway dictaba las palabras de confirmación.** Es decir: el ancla
>    contra la sustitución de claves la proporcionaba justo la parte que este
>    modelo considera no confiable. Ahora cada lado las calcula en local.
>
> Y una tercera, de diseño más que de código: mientras el escritorio no anclara
> localmente las claves de sus pares, la única fuente sobre *con quién estoy
> emparejado* era el gateway. Se ancla al confirmar, y su lista se contrasta
> contra la local en cada consulta.

Es el más importante porque el gateway es infraestructura de terceros
(Cloudflare + Supabase) y hay que asumir que puede caer.

**Puede:** ver quién se conecta con quién y cuándo, cortar el servicio, e
**intentar sustituir las huellas DTLS en la señalización para colocarse en medio**.

**Mitigación:** la oferta y la respuesta SDP **van firmadas** con la clave privada
del dispositivo (ECDSA P-256), y el otro extremo verifica la firma contra la
clave pública emparejada. La huella DTLS viaja dentro del SDP firmado.

**Resultado: un gateway comprometido no puede escuchar ni inyectar.** Queda
reducido a un buzón que puede negar el servicio, nunca a un intermediario.

Sin esta firma, todo lo demás daría igual: quien controla la señalización
controlaría la sesión por muy cifrado que fuera el transporte.

### 3. Token del móvil robado

**Puede:** si el token bastara, suplantar al móvil.

**Mitigación:** el token **no basta**. La autenticación exige firmar un reto con
la clave privada, que en Android vive en Keystore/StrongBox y en iOS en el Secure
Enclave, **no exportables**. Un token copiado de una copia de seguridad no sirve
sin el hardware. Ver [ADR 0001](adr/0001-identidad-de-dispositivo-p256.md).

### 4. Teléfono perdido

**Puede:** quien lo tenga desbloqueado, conectarse.

**Mitigación:** revocación individual desde Desktop, efectiva en la siguiente
petición de sesión; "cerrar todas las sesiones"; opción de exigir biometría para
usar la clave; y el modo atendido, que sigue pidiendo confirmación en el
ordenador.

**Límite honesto:** si el atacante tiene el teléfono desbloqueado y el modo
desatendido está activo, entra hasta que se revoque. Por eso el desatendido está
**deshabilitado por defecto** y exige PIN local aparte.

### 5. Sesión WebRTC interceptada

**No puede** leerla: DTLS-SRTP es extremo a extremo, incluso pasando por TURN —
el relay sólo reenvía paquetes que no puede descifrar.

### 6. Señalización manipulada

Cubierto por el escenario 2. Además, cada mensaje lleva secuencia estrictamente
creciente y marca de tiempo con ventana de dos minutos.

### 7. TURN malicioso

**Puede:** ver volumen y temporización del tráfico, y cortarlo.
**No puede:** descifrar. TURN es un relay ciego.

**Mitigación:** credenciales TURN **efímeras**, generadas por el Worker con TTL
corto. Nunca credenciales permanentes en el cliente.

### 8. Paquete alterado en tránsito

Cubierto por SRTP, que autentica cada paquete.

### 9. Dispositivo previamente autorizado, ahora comprometido

Es el escenario **peor** y hay que ser honesto: un dispositivo emparejado y
comprometido puede hacer todo lo que se le concedió.

**Mitigación:** permisos por sesión, no permanentes; el modo atendido pide
confirmación cada vez; vencimiento de permisos; timeout de inactividad; duración
máxima configurable; indicador persistente en pantalla; y auditoría de cada
acción.

**Lo que NO se pretende:** Luxy no puede distinguir a un usuario legítimo de un
atacante que controla su móvil desbloqueado. Ningún producto de esta categoría
puede.

### 10. Aplicación maliciosa enviando eventos

**Mitigación:** la puerta única en `guardControlMessage`. Un mensaje sólo se
ejecuta si supera **seis** comprobaciones: tamaño, sesión viva, esquema, versión,
secuencia/reloj y **permiso concedido en esa sesión**. Está en un solo sitio a
propósito: repartido, tarde o temprano aparece un camino que se salta una.

Probado además revirtiendo las protecciones: sin la comprobación de permisos
fallan 5 pruebas, sin anti-replay fallan 2.

### 11. Intento de control con el PC bloqueado

**No es posible, y no se va a intentar.** La documentación de Microsoft es
explícita: sólo un proceso `LOCAL_SYSTEM` accede al escritorio seguro. Luxy corre
como proceso de usuario.

**Peligro real y distinto:** `SendInput` **falla en silencio** contra aplicaciones
elevadas — ni el valor de retorno ni `GetLastError` lo indican. El usuario hace
clic y no pasa nada. La interfaz debe detectarlo y decirlo, o parecerá un fallo
de Luxy. Ver [ADR 0005](adr/0005-host-windows.md).

### 12. Archivo malicioso transferido

**Mitigación:** nunca se ejecuta nada automáticamente; los archivos van a una
carpeta de descargas propia de Luxy; el nombre se sanea y se rechaza cualquier
recorrido de rutas; hay tope de tamaño y verificación de hash; y la recepción
requiere la capacidad `file_receive` concedida en esa sesión.

## Lo que queda fuera del modelo

Con honestidad, porque no reconocerlo sería peor:

- **Malware con privilegios en el equipo controlado.** Si ya está dentro, no
  necesita Luxy.
- **Un atacante con el móvil desbloqueado y emparejado.**
- **Compromiso del Secure Enclave o de StrongBox.**
- **Análisis de tráfico**: quién habla con quién y cuándo es visible para el
  gateway y para el TURN. Se acepta.

## Verificación

Cada escenario del 1 al 12 tiene su prueba automática o su decisión documentada.
Se ejecutará `/security-review` dos veces: al cerrar el protocolo y tras
implementar el host.
