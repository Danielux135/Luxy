// criptografia de la boveda de Luxy.
//
// Este paquete es PURO: solo bytes, WebCrypto y @noble. No conoce Electron, ni
// el disco, ni la red, ni Supabase. Lo importan el proceso principal del
// escritorio y, en el futuro, el movil — y esa es la gracia: las dos puntas
// ejecutan la MISMA implementacion, igual que hace @luxy/remote-crypto.
//
// Lo que este paquete garantiza:
//
//   - un dato cifrado aqui solo se abre con la llave correcta Y en el dominio
//     correcto: el proposito viaja autenticado, no como una etiqueta suelta;
//   - alterar un solo bit hace fallar el descifrado, nunca devuelve basura;
//   - la contraseña no cifra datos, solo envuelve la llave maestra, asi que
//     cambiarla no obliga a recifrar nada;
//   - una conversacion se puede compartir sin entregar el resto de la boveda.
//
// Lo que NO garantiza, y debe decirse en voz alta:
//
//   - nada de esto protege frente a quien ya tiene la llave maestra en memoria;
//   - `wipe()` reduce la ventana de exposicion, no la elimina: V8 pudo copiar
//     el buffer antes;
//   - el proveedor de IA al que se envie un texto lo ve en claro. La boveda
//     protege el almacenamiento y el transporte propio de Luxy, no lo que un
//     tercero recibe porque el usuario decidio enviarselo.
export * from './bytes.js';
export * from './envelope.js';
export * from './kdf.js';
export * from './master-key.js';
export * from './recipient.js';
