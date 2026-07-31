// punto de entrada del protocolo remoto.
//
// Este paquete NO conoce a Electron, ni a React Native, ni al gateway. Solo
// define que mensajes existen y como se validan. Lo importan las cuatro puntas:
// escritorio, movil, gateway y host remoto. Ver docs/adr/0004-react-native-expo.md
// para por que el movil puede importarlo tal cual.
export * from './version.js';
export * from './capabilities.js';
export * from './envelope.js';
export * from './control.js';
export * from './session.js';
export * from './guard.js';
export * from './session-state.js';
